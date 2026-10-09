import { z } from "zod";
import {
  aiProvider,
  errorResponse,
  geminiChat,
  groqChat,
  guard,
  GURU_SYSTEM,
  openrouterChat,
} from "@/lib/server/ai";

const Body = z.object({
  snapshot: z.string().max(20_000),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

type Turn = { role: "user" | "assistant"; content: string };

const PROVIDER_TIMEOUT_MS = 5000; // skip provider if first chunk takes >5s

/** Race a promise against a timeout. Rejects with TimeoutError if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/** Try each provider in order; skip to next on error or timeout. */
async function* cascadeChat(
  turns: Turn[],
  startProvider: string,
): AsyncGenerator<string> {
  const order: Array<{ name: string; fn: () => AsyncGenerator<string> }> = [
    { name: "gemini",     fn: () => geminiChat(GURU_SYSTEM, turns) },
    { name: "groq",       fn: () => groqChat(GURU_SYSTEM, turns) },
    { name: "openrouter", fn: () => openrouterChat(GURU_SYSTEM, turns) },
  ];

  // Put configured provider first
  const idx = order.findIndex((p) => p.name === startProvider);
  const sorted = idx > 0 ? [...order.slice(idx), ...order.slice(0, idx)] : order;

  let lastErr: unknown;
  for (const provider of sorted) {
    const gen = provider.fn();
    try {
      // Timeout only on the first chunk — after that stream freely
      const first = await withTimeout(gen.next(), PROVIDER_TIMEOUT_MS, provider.name);
      if (!first.done) {
        yield first.value;
        yield* gen;
        return;
      }
    } catch (err) {
      console.warn(`[Kharcha AI] ${provider.name} skipped (${(err as Error).message}), trying next…`);
      lastErr = err;
      try { await gen.return(undefined); } catch { /* ignore */ }
    }
  }
  throw lastErr ?? new Error("All AI providers failed");
}

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

  // Keep the last 16 turns, starting with a user turn.
  let history = parsed.data.messages.slice(-16);
  while (history.length && history[0].role !== "user") history = history.slice(1);
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "Last message must be from the user" }, { status: 400 });
  }

  const turns: Turn[] = history.map((m, i) =>
    i === history.length - 1
      ? { role: "user", content: `<finance_snapshot>\n${parsed.data.snapshot}\n</finance_snapshot>\n\n${m.content}` }
      : m,
  );

  const startProvider = aiProvider();
  const chunks = cascadeChat(turns, startProvider);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of chunks) {
          controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "All AI providers are unavailable right now. Please try again in a moment.";
        controller.enqueue(encoder.encode(`\n\nSorry, Stash is having trouble connecting to AI right now. ${msg}`));
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
