import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";

/**
 * Four interchangeable AI backends:
 * - "huggingface": Hugging Face Serverless Inference API (HF_TOKEN / HUGGINGFACE_API_KEY).
 *   Free, cloud-hosted, runs models like Qwen/Qwen2.5-7B-Instruct or meta-llama/Llama-3.2-3B-Instruct.
 * - "gemini": Google's free tier (GEMINI_API_KEY). Free-tier prompts may be used by Google,
 *   so the client sends a trimmed snapshot (no places, notes or names) – see /api/status.
 * - "claude": paid Anthropic API (ANTHROPIC_API_KEY).
 * - "local": self-hosted fine-tuned Stash model (LOCAL_LLM_URL, e.g. http://localhost:11434).
 *   Run `uv run python llm/serve.py --model ./llm/merged/stash-v1` to start it.
 * Explicit AI_PROVIDER wins, otherwise HF_TOKEN > LOCAL_LLM_URL > GEMINI_API_KEY > ANTHROPIC_API_KEY.
 */
export type Provider = "huggingface" | "gemini" | "claude" | "local";

export function aiProvider(): Provider | null {
  const forced = process.env.AI_PROVIDER;
  if (forced === "huggingface" && (process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY)) return "huggingface";
  if (forced === "local" && process.env.LOCAL_LLM_URL) return "local";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY) return "huggingface";
  if (process.env.LOCAL_LLM_URL) return "local";
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

// ---------- Local fine-tuned model ----------

/** Streams a chat reply from the local Stash inference server (serve.py). */
export async function* localChat(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const url = process.env.LOCAL_LLM_URL;
  if (!url) throw new Error("LOCAL_LLM_URL is not set");

  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true, max_tokens: 1024 }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Local LLM error (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const text = json.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // skip malformed SSE lines
      }
    }
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

/**
 * One call to the local fine-tuned model for structured JSON output.
 * The model is prompted to return only a JSON object; the result is validated with zod.
 * Returns null if the output doesn't fit the schema.
 */
export async function localJSON<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T> | null> {
  const url = process.env.LOCAL_LLM_URL;
  if (!url) throw new Error("LOCAL_LLM_URL is not set");

  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;

  const messages = [
    { role: "system", content: `${system}\n\nReply with ONLY a valid JSON object matching this schema (no markdown, no explanation):\n${JSON.stringify(jsonSchema)}` },
    { role: "user", content: user },
  ];

  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: false, max_tokens: 1024, temperature: 0.1 }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Local LLM error (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  // Strip optional markdown fences the model might add
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const parsed = schema.safeParse(JSON.parse(cleaned));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------- Hugging Face (Serverless Inference) ----------

export const HF_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-7B-Instruct";

/** Streams a chat reply from Hugging Face Serverless Inference API. */
export async function* huggingfaceChat(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
  if (!token) throw new Error("HF_TOKEN or HUGGINGFACE_API_KEY is not set");

  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch("https://router.huggingface.co/hf-inference/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages,
      stream: true,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Hugging Face error (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const text = json.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

/** One call to Hugging Face Serverless Inference API for structured JSON output. */
export async function huggingfaceJSON<T extends z.ZodType>(
  system: string,
  user: string,
  schema: T,
): Promise<z.infer<T> | null> {
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
  if (!token) throw new Error("HF_TOKEN or HUGGINGFACE_API_KEY is not set");

  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;

  const messages = [
    {
      role: "system",
      content: `${system}\n\nReply with ONLY a valid raw JSON object matching this schema (no markdown formatting, no code fences, no explanation):\n${JSON.stringify(jsonSchema)}`,
    },
    { role: "user", content: user },
  ];

  const res = await fetch("https://router.huggingface.co/hf-inference/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages,
      stream: false,
      max_tokens: 1024,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Hugging Face error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const parsed = schema.safeParse(JSON.parse(cleaned));
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
      { error: "AI is offline: add HF_TOKEN (free Hugging Face token), GEMINI_API_KEY, or ANTHROPIC_API_KEY to .env.local." },
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
  // Hugging Face errors
  if (err instanceof Error && err.message.startsWith("Hugging Face error")) {
    if (err.message.includes("429")) {
      return Response.json({ error: "Stash reached the Hugging Face rate limit – try again in a minute." }, { status: 429 });
    }
    if (err.message.includes("401") || err.message.includes("403")) {
      return Response.json({ error: "Your Hugging Face token (HF_TOKEN) was rejected. Check .env.local." }, { status: 401 });
    }
    if (err.message.includes("503") || err.message.toLowerCase().includes("loading")) {
      return Response.json({ error: "Hugging Face model is waking up – please retry in ~20 seconds!" }, { status: 503 });
    }
    return Response.json({ error: `Hugging Face error: ${err.message}` }, { status: 502 });
  }
  // Local model connection errors
  if (err instanceof Error && err.message.startsWith("Local LLM error")) {
    return Response.json({ error: `Local model error: ${err.message}` }, { status: 502 });
  }
  if (err instanceof TypeError && String(err.message).includes("fetch") && process.env.LOCAL_LLM_URL) {
    return Response.json(
      { error: `Cannot reach local model at ${process.env.LOCAL_LLM_URL}. Is serve.py running?` },
      { status: 503 },
    );
  }
  if (err instanceof GeminiApiError) {
    if (err.status === 429) {
      return Response.json({ error: "Stash has hit the free Gemini limit – try again in a minute (or tomorrow)." }, { status: 429 });
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
    return Response.json({ error: "Stash is getting too many questions – try again in a minute." }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    return Response.json({ error: `AI error (${err.status ?? "network"}): ${err.message}` }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong talking to the AI." }, { status: 500 });
}

export const GURU_SYSTEM = `You are Stash 🦉, an owl and the personal money mentor inside "Kharcha", an expense tracker for college students in India who live on monthly pocket money from family. Speak to the user as "you" and refer to yourself as "I". Don't assume their name, course or background; if the snapshot includes a name, you may use it now and then (if they're also called Stash, enjoy the coincidence).

Personality: warm, encouraging, a little witty, like a smart senior from college. Light Hinglish is fine occasionally. A quick, simple stats analogy (averages, outliers, "your typical day") can make a point land – don't overdo it.

How to answer:
- Every user turn starts with a <finance_snapshot> block containing live numbers from the app. Ground every number you mention in it; never invent figures. If something isn't in the snapshot, say so.
- Use ₹ and Indian number formatting. Keep replies short and skimmable: usually 2–6 sentences or a few bullets, under ~120 words unless asked for detail.
- Be honest about tradeoffs. Don't lecture or shame; suggest cheaper swaps (canteen vs Zomato, sharing, walking short distances) when relevant.
- For "can I buy / eat / spend on X" questions: compare the price with SAFE TO SPEND TODAY and remaining budget, mention the effect on goals if relevant, then end with a final line exactly in the form "VERDICT: go", "VERDICT: think" or "VERDICT: skip" (go = fits comfortably, think = possible but has a cost, skip = doesn't fit). Only add a VERDICT line for these purchase decisions.
- For general tips, plans or questions about spending patterns, give concrete, student-realistic advice based on the data.
- You are not a licensed financial advisor: for investing questions (stocks, crypto, mutual funds), keep it to general education and suggest learning more before putting pocket money at risk.`;
