import { z } from "zod";
import {
  aiProvider,
  errorResponse,
  geminiJSON,
  guard,
  groqJSON,
  openrouterJSON,
  parseExpenseBuiltin,
} from "@/lib/server/ai";

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
    // Cascade: try each AI provider, fall back to offline regex parser last
    const startProvider = aiProvider();
    const providers = [
      { name: "gemini",     fn: () => geminiJSON(system, text, Schema) },
      { name: "groq",       fn: () => groqJSON(system, text, Schema) },
      { name: "openrouter", fn: () => openrouterJSON(system, text, Schema) },
    ];
    const idx = providers.findIndex((p) => p.name === startProvider);
    const sorted = idx > 0 ? [...providers.slice(idx), ...providers.slice(0, idx)] : providers;

    let result: z.infer<typeof Schema> | null = null;
    for (const provider of sorted) {
      try {
        result = await provider.fn();
        if (result) break;
      } catch (err) {
        console.warn(`[Kharcha] parse-expense ${provider.name} failed:`, (err as Error).message);
      }
    }

    // Final fallback: offline regex parser (always works, no AI needed)
    if (!result) {
      result = parseExpenseBuiltin(text, categories, today, weekday, time);
    }

    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
