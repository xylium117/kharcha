import "server-only";
import { z } from "zod";
import { builtinWeeklyReport, parseExpenseBuiltin } from "./builtin";

export { builtinWeeklyReport, parseExpenseBuiltin };

/**
 * AI backends supported:
 * - "gemini": Google Gemini API (GEMINI_API_KEY, e.g. gemini-flash-latest). Fast and generous free tier!
 * - "groq": Blazing fast free cloud models via Groq (GROQ_API_KEY, e.g. llama-3.3-70b-versatile).
 * - "openrouter": Free models via OpenRouter (OPENROUTER_API_KEY).
 * - "builtin": 100% offline, dataset-trained local financial reasoning engine for Stash. Zero key needed!
 */
export type Provider = "builtin" | "gemini" | "groq" | "openrouter";

export function aiProvider(): Provider {
  const forced = process.env.AI_PROVIDER;
  if (forced === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (forced === "groq" && process.env.GROQ_API_KEY) return "groq";
  if (forced === "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
  if (forced === "builtin") return "builtin";

  // Auto-detect if not forced
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "builtin";
}

export function aiConfigured(): boolean {
  return true;
}

// ---------- Gemini (Google AI) ----------

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

export async function* geminiChat(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const contents = [
    { role: "user", parts: [{ text: `[System Instructions]\n${system}` }] },
    { role: "model", parts: [{ text: "Understood! I am Stash, your student finance mentor." }] },
    ...history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  ];

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini error (${res.status}): ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body from Gemini");
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      try {
        const json = JSON.parse(payload) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {
        // Skip malformed chunks
      }
    }
  }
}

export async function geminiJSON<T extends z.ZodType>(
  system: string,
  user: string,
  schema: T,
): Promise<z.infer<T> | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${system}\n\nUser input: ${user}\n\nReply with ONLY a valid JSON object matching this schema (no markdown, no code blocks):\n${JSON.stringify(jsonSchema)}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini error (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const parsed = schema.safeParse(JSON.parse(cleaned));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ---------- OpenAI-compatible chat helper (Groq, OpenRouter) ----------

async function* openAIChatStream(
  url: string,
  headers: Record<string, string>,
  model: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const messages = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 2048,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`LLM error (${res.status}): ${text}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body from LLM");
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const text = json.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // Skip malformed SSE chunks
      }
    }
  }
}

async function openAIJSON<T extends z.ZodType>(
  url: string,
  headers: Record<string, string>,
  model: string,
  system: string,
  user: string,
  schema: T,
): Promise<z.infer<T> | null> {
  const jsonSchema = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete jsonSchema.$schema;

  const messages = [
    {
      role: "system",
      content: `${system}\n\nReply with ONLY a valid JSON object matching this schema (no markdown, no explanation):\n${JSON.stringify(jsonSchema)}`,
    },
    { role: "user", content: user },
  ];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: 1024,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`LLM error (${res.status}): ${text}`);
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

// ---------- Groq (Free high-speed cloud inference) ----------

export const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

export async function* groqChat(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  yield* openAIChatStream(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${key}` },
    GROQ_MODEL,
    system,
    history,
  );
}

export async function groqJSON<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T> | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return openAIJSON("https://api.groq.com/openai/v1/chat/completions", { Authorization: `Bearer ${key}` }, GROQ_MODEL, system, user, schema);
}

// ---------- OpenRouter (Free community models) ----------

export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

export async function* openrouterChat(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AsyncGenerator<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  yield* openAIChatStream(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://kharcha.app",
      "X-Title": "Kharcha - Student Finance App",
    },
    OPENROUTER_MODEL,
    system,
    history,
  );
}

export async function openrouterJSON<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T> | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return openAIJSON(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://kharcha.app",
      "X-Title": "Kharcha - Student Finance App",
    },
    OPENROUTER_MODEL,
    system,
    user,
    schema,
  );
}

// ---------- shared ----------

/** Returns a Response to send back when the request isn't allowed, or null when it is. */
export function guard(req: Request): Response | null {
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers.get("x-app-passcode") !== pass) {
    return Response.json({ error: "Wrong or missing app passcode (set it in Settings -> AI guide)." }, { status: 401 });
  }
  return null;
}

export function errorResponse(err: unknown): Response {
  // Gemini errors
  if (err instanceof Error && err.message.toLowerCase().includes("gemini")) {
    if (err.message.includes("429")) {
      return Response.json({ error: "Stash hit the free Gemini rate limit - try again in a minute." }, { status: 429 });
    }
    if (err.message.includes("503")) {
      return Response.json({ error: "Gemini is busy right now - try again in a few moments." }, { status: 503 });
    }
    return Response.json({ error: `Gemini error: ${err.message}` }, { status: 502 });
  }
  // Groq errors
  if (err instanceof Error && err.message.toLowerCase().includes("groq")) {
    if (err.message.includes("429")) {
      return Response.json({ error: "Stash hit the Groq rate limit - try again in a minute." }, { status: 429 });
    }
    return Response.json({ error: `Groq error: ${err.message}` }, { status: 502 });
  }
  // OpenRouter errors
  if (err instanceof Error && (err.message.toLowerCase().includes("openrouter") || err.message.includes("openrouter.ai"))) {
    return Response.json({ error: `OpenRouter error: ${err.message}` }, { status: 502 });
  }
  // Generic LLM errors
  if (err instanceof Error && err.message.startsWith("LLM error")) {
    if (err.message.includes("429")) {
      return Response.json({ error: "AI rate limit hit - try again in a minute." }, { status: 429 });
    }
    return Response.json({ error: `AI error: ${err.message}` }, { status: 502 });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong processing your request." }, { status: 500 });
}

export const GURU_SYSTEM = `You are Stash, an owl emoji financial mentor inside "Kharcha", an expense tracker for college students in India who live on monthly pocket money from family. Speak to the user as "you" and refer to yourself as "I". Don't assume their name, course or background; if the snapshot includes a name, you may use it now and then.

Personality: warm, encouraging, a little witty, like a smart senior from college. Light Hinglish is fine occasionally.

How to answer:
- Every user turn starts with a <finance_snapshot> block containing live numbers from the app. Ground every number you mention in it; never invent figures.
- Use the Indian Rupee symbol and Indian number formatting. Keep replies short and skimmable.
- For purchase decision questions: end with a final line "VERDICT: go", "VERDICT: think" or "VERDICT: skip".
- For general tips or plans, give concrete, student-realistic advice based on the data.

Season / Semester context:
- The snapshot includes a "Season mode" line. Always factor it into your advice:
  - "Exam season": Prioritise food, notes, transport; avoid fun spends. Stress is high, budget must stay intact.
  - "Fest mode": A little extra fun budget is fine this month; enjoy but track it.
  - "Home trip": Expect lower daily spend; a great time to save ahead for the next semester.
  - "Normal days": Standard college life. Balanced need/want split is the goal.
- When the user asks about cheap food, spending plans, wasteful habits, or whether to make a purchase, always weave in the season context where relevant.

Examples of questions you must answer well:
- "Cheap dinner ideas under X rupees" - give real, specific student-friendly options (canteen thali, egg bhurji, dosa, maggi) and tie to their safe-to-spend today.
- "Where am I wasting the most money?" - reference their waste-tagged spend, top category, and want percentage, give one actionable cut.
- "Plan my spending for the rest of this month" - daily allowance, upcoming recurring, goal reserve, days left - give a clear per-day plan.
- "Is a jacket a good idea right now?" - compare to safe-to-spend and remaining; give VERDICT.`;
