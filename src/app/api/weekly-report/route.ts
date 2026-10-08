import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { aiProvider, errorResponse, fallbackParams, geminiJSON, getClient, guard, GURU_MODEL, localJSON } from "@/lib/server/ai";

const Body = z.object({
  name: z.string().max(60),
  summary: z.string().max(8000),
  suggestedGrade: z.string().max(3),
});

const Report = z.object({
  grade: z.enum(["A+", "A", "B", "C", "D", "F"]),
  headline: z.string().describe("One upbeat line, max 12 words"),
  wins: z.array(z.string()).describe("2-3 short things that went well"),
  tip: z.string().describe("One specific, doable tip for next week"),
  funLine: z.string().describe("A playful one-liner, can use a stats pun"),
});

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { name, summary, suggestedGrade } = parsed.data;

  const system = `You are Sinchan 🦉, an owl and friendly money mentor writing a weekly spending report card for your user (${name}), a college student in India living on pocket money. Address them as "you". Be warm, specific and brief; use ₹ and only numbers from the data. The rule-based score suggests grade ${suggestedGrade}; keep the grade within one step of it.`;
  const user = `Last week's data:\n${summary}`;

  try {
    let report: z.infer<typeof Report> | null;
    const provider = aiProvider();
    if (provider === "gemini") {
      report = await geminiJSON(system, user, Report);
    } else if (provider === "local") {
      report = await localJSON(system, user, Report);
    } else {
      const response = await getClient().beta.messages.parse({
        model: GURU_MODEL,
        max_tokens: 2000,
        ...fallbackParams(GURU_MODEL),
        output_config: { effort: "low", format: betaZodOutputFormat(Report) },
        system,
        messages: [{ role: "user", content: user }],
      });
      report = response.stop_reason === "refusal" ? null : response.parsed_output;
    }
    if (!report) {
      return Response.json({ error: "Couldn't write the report this time." }, { status: 422 });
    }
    return Response.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
