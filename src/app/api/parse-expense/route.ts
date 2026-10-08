import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { aiProvider, errorResponse, geminiJSON, getClient, guard, localJSON, PARSER_MODEL } from "@/lib/server/ai";

const Body = z.object({
  text: z.string().min(1).max(500),
  categories: z.array(z.object({ id: z.string(), name: z.string() })).min(1).max(50),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.string(),
  time: z.string(),
});

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { text, categories, today, weekday, time } = parsed.data;

  const ids = categories.map((c) => c.id) as [string, ...string[]];
  const Schema = z.object({
    amount: z.number().describe("Amount in rupees"),
    title: z.string().describe("Short name of what was bought, e.g. 'Momos'"),
    categoryId: z.enum(ids),
    place: z.string().nullable().describe("Shop or place, if mentioned"),
    paymentMode: z.enum(["UPI", "Cash", "Card", "Other"]),
    tag: z.enum(["need", "want", "waste"]),
    date: z.string().describe("yyyy-MM-dd"),
    time: z.string().nullable().describe("HH:mm in 24h, if a time is mentioned or implied"),
  });

  const system = `You turn a college student's quick note about a purchase into a structured expense.
Categories (id: name): ${categories.map((c) => `${c.id}: ${c.name}`).join("; ")}.
Today is ${weekday} ${today}, current time ${time}. Resolve relative dates like "yesterday".
Defaults when not stated: paymentMode UPI, date today, time null.
Tag: "need" for essentials (meals, travel to college, notes, medicine), "want" for treats and nice-to-haves, "waste" when the note signals regret or junk ("unnecessary", "regret", "impulse", late-night junk).`;

  try {
    let result: z.infer<typeof Schema> | null;
    const provider = aiProvider();
    if (provider === "gemini") {
      result = await geminiJSON(system, text, Schema);
    } else if (provider === "local") {
      result = await localJSON(system, text, Schema);
    } else {
      const response = await getClient().messages.parse({
        model: PARSER_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: text }],
        output_config: { format: zodOutputFormat(Schema) },
      });
      result = response.parsed_output;
    }
    if (!result) {
      return Response.json({ error: "Couldn't understand that – try e.g. 'momos 120 at Dey's stall'." }, { status: 422 });
    }
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
