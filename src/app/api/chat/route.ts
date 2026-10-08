import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiProvider, errorResponse, fallbackParams, geminiChat, getClient, guard, GURU_MODEL, GURU_SYSTEM, huggingfaceChat, localChat } from "@/lib/server/ai";

const Body = z.object({
  snapshot: z.string().max(20_000),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

type Turn = { role: "user" | "assistant"; content: string };

/** Claude's reply as text chunks; refusals and cut-offs get a short note. */
async function* claudeChat(history: Turn[]): AsyncGenerator<string> {
  const stream = getClient().beta.messages.stream({
    model: GURU_MODEL,
    max_tokens: 4000,
    ...fallbackParams(GURU_MODEL),
    output_config: { effort: "low" },
    system: [{ type: "text", text: GURU_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: history as Anthropic.Beta.BetaMessageParam[],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") yield "\n\nSorry, I can't help with that one. Ask me something about your money! 🦉";
  else if (final.stop_reason === "max_tokens") yield "…";
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

  const provider = aiProvider();
  const chunks =
    provider === "huggingface" ? huggingfaceChat(GURU_SYSTEM, turns)
    : provider === "gemini" ? geminiChat(GURU_SYSTEM, turns)
    : provider === "local" ? localChat(GURU_SYSTEM, turns)
    : claudeChat(turns);

  // Pull the first chunk before answering, so setup errors (bad key, rate limit) become proper error responses.
  let first: IteratorResult<string>;
  try {
    first = await chunks.next();
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(encoder.encode(first.value));
        for await (const text of chunks) controller.enqueue(encoder.encode(text));
      } catch (err) {
        const { error } = (await errorResponse(err).json()) as { error: string };
        controller.enqueue(encoder.encode(`\n\n⚠️ ${error}`));
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
