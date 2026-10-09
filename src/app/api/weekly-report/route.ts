import { z } from "zod";
import {
  aiProvider,
  builtinWeeklyReport,
  errorResponse,
  geminiJSON,
  guard,
  groqJSON,
  openrouterJSON,
} from "@/lib/server/ai";

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

  const system = `You are Stash, an owl and friendly money mentor writing a weekly spending report card for your user (${name}), a college student in India living on pocket money. Address them as "you". Be warm, specific and brief; use the Indian Rupee symbol and only numbers from the data. The rule-based score suggests grade ${suggestedGrade}; keep the grade within one step of it.`;
  const user = `Last week's data:\n${summary}`;

  try {
    // Cascade: try each AI provider, fall back to offline generator last
    const startProvider = aiProvider();
    const providers = [
      { name: "gemini",     fn: () => geminiJSON(system, user, Report) },
      { name: "groq",       fn: () => groqJSON(system, user, Report) },
      { name: "openrouter", fn: () => openrouterJSON(system, user, Report) },
    ];
    const idx = providers.findIndex((p) => p.name === startProvider);
    const sorted = idx > 0 ? [...providers.slice(idx), ...providers.slice(0, idx)] : providers;

    let report: z.infer<typeof Report> | null = null;
    for (const provider of sorted) {
      try {
        report = await provider.fn();
        if (report) break;
      } catch (err) {
        console.warn(`[Kharcha] weekly-report ${provider.name} failed:`, (err as Error).message);
      }
    }

    // Final fallback: offline rule-based report (no AI needed)
    if (!report) {
      report = builtinWeeklyReport(name, summary, suggestedGrade);
    }

    return Response.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
