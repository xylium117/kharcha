import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";

/**
 * Two interchangeable AI backends:
 * - "gemini": Google's free tier (GEMINI_API_KEY). Free-tier prompts may be used by Google,
 *   so the client sends a trimmed snapshot (no places, notes or names) – see /api/status.
 * - "claude": paid Anthropic API (ANTHROPIC_API_KEY).
 * Gemini wins when both keys are set, unless AI_PROVIDER says otherwise.
 */
export type Provider = "gemini" | "claude";

export function aiProvider(): Provider | null {
  const forced = process.env.AI_PROVIDER;
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return null;
}

export function aiConfigured(): boolean {
  return aiProvider() !== null;
}

// ---------- Claude ----------

export const GURU_MODEL = process.env.GURU_MODEL || "claude-sonnet-5-5";
export const PARSER_MODEL = process.env.PARSER_MODEL || "claude-haiku-4-5";

/** Models that accept `fallbacks: "default"` on the Claude API. */
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

export function fallbackParams(model: string) {
  return FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : { betas: [] as string[] };
}

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

// ---------- Gemini ----------

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

let gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return gemini;
}

/** The free tier is sometimes briefly overloaded (500/503): retry twice with a short pause. */
async function withRetry<R>(fn: () => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const busy = err instanceof GeminiApiError && (err.status === 503 || err.status === 500);
      if (!busy || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** Streams a chat reply from Gemini as plain-text chunks. */
export async function* geminiChat(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const stream = await withRetry(() =>
    getGemini().models.generateContentStream({
      model: GEMINI_MODEL,
      contents: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      config: { systemInstruction: system, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
    }),
  );
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}

/** One Gemini call constrained to a JSON schema, validated with zod. Returns null if the output doesn't fit. */
export async function geminiJSON<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T> | null> {
  // Gemini rejects the "$schema" meta key, so drop it.
  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;
  const call = (withSchema: boolean) =>
    withRetry(() => getGemini().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: user }] }],
      config: {
        systemInstruction: withSchema
          ? system
          : `${system}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
        responseMimeType: "application/json",
        ...(withSchema ? { responseJsonSchema: jsonSchema } : {}),
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }));
  let res;
  try {
    res = await call(true);
  } catch (err) {
    // A model that rejects the schema (400) still gets the schema as instructions; zod checks the result.
    if (err instanceof GeminiApiError && err.status === 400) res = await call(false);
    else throw err;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(res.text ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------- shared ----------

/** Returns a Response to send back when the request isn't allowed, or null when it is. */
export function guard(req: Request): Response | null {
  if (!aiConfigured()) {
    return Response.json(
      { error: "AI is offline: add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to .env.local and restart." },
      { status: 503 },
    );
  }
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers.get("x-app-passcode") !== pass) {
    return Response.json({ error: "Wrong or missing app passcode (set it in Settings → AI guide)." }, { status: 401 });
  }
  return null;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof GeminiApiError) {
    if (err.status === 429) {
      return Response.json({ error: "Sinchan has hit the free Gemini limit – try again in a minute (or tomorrow)." }, { status: 429 });
    }
    if (err.status === 503 || err.status === 500) {
      return Response.json({ error: "Google's free AI is busy right now – try again in a moment." }, { status: 503 });
    }
    if (err.status === 404) {
      return Response.json({ error: `Gemini model "${GEMINI_MODEL}" isn't available – set GEMINI_MODEL=gemini-flash-latest.` }, { status: 502 });
    }
    if (err.status === 400 || err.status === 401 || err.status === 403) {
      return Response.json({ error: `Gemini rejected the request (${err.status}). Check GEMINI_API_KEY and GEMINI_MODEL.` }, { status: 502 });
    }
    return Response.json({ error: `Gemini error (${err.status}): ${err.message}` }, { status: 502 });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return Response.json({ error: "Your Anthropic API key was rejected. Check .env.local." }, { status: 401 });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "Sinchan is getting too many questions – try again in a minute." }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    return Response.json({ error: `AI error (${err.status ?? "network"}): ${err.message}` }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong talking to the AI." }, { status: 500 });
}

export const GURU_SYSTEM = `You are Sinchan 🦉, an owl and the personal money mentor inside "Kharcha", an expense tracker for college students in India who live on monthly pocket money from family. Speak to the user as "you" and refer to yourself as "I". Don't assume their name, course or background; if the snapshot includes a name, you may use it now and then (if they're also called Sinchan, enjoy the coincidence).

Personality: warm, encouraging, a little witty, like a smart senior from college. Light Hinglish is fine occasionally. A quick, simple stats analogy (averages, outliers, "your typical day") can make a point land – don't overdo it.

How to answer:
- Every user turn starts with a <finance_snapshot> block containing live numbers from the app. Ground every number you mention in it; never invent figures. If something isn't in the snapshot, say so.
- Use ₹ and Indian number formatting. Keep replies short and skimmable: usually 2–6 sentences or a few bullets, under ~120 words unless asked for detail.
- Be honest about tradeoffs. Don't lecture or shame; suggest cheaper swaps (canteen vs Zomato, sharing, walking short distances) when relevant.
- For "can I buy / eat / spend on X" questions: compare the price with SAFE TO SPEND TODAY and remaining budget, mention the effect on goals if relevant, then end with a final line exactly in the form "VERDICT: go", "VERDICT: think" or "VERDICT: skip" (go = fits comfortably, think = possible but has a cost, skip = doesn't fit). Only add a VERDICT line for these purchase decisions.
- For general tips, plans or questions about spending patterns, give concrete, student-realistic advice based on the data.
- You are not a licensed financial advisor: for investing questions (stocks, crypto, mutual funds), keep it to general education and suggest learning more before putting pocket money at risk.`;
