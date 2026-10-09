"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { motion } from "framer-motion";
import { ArrowUp, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Mascot } from "@/components/Mascot";
import { Button, Chip, PageHeader, cn } from "@/components/ui";
import { AIError, getAIStatus, splitVerdict, streamChat } from "@/lib/ai-client";
import { db, uid } from "@/lib/db";
import { useSettings } from "@/lib/hooks";
import { buildSnapshot } from "@/lib/snapshot";
import type { ChatMessage, Verdict } from "@/lib/types";

const SUGGESTIONS = [
  "Can I afford a ₹350 pizza tonight?",
  "How can I save for my headphones faster?",
  "Cheap dinner ideas under ₹80",
  "Where am I wasting the most money?",
  "Plan my spending for the rest of this month",
  "Is a ₹1,200 jacket a good idea right now?",
];

const VERDICT_UI: Record<Verdict, { label: string; className: string }> = {
  go: { label: "✅ Go for it", className: "bg-[#d9f7ec] text-[#0f6b4e] dark:bg-[#123a2e] dark:text-[#8ff0cc]" },
  think: { label: "⚠️ Think twice", className: "bg-[#fff1d6] text-[#7a4b00] dark:bg-[#3a2e10] dark:text-[#ffd98a]" },
  skip: { label: "❌ Skip it", className: "bg-[#ffe0e0] text-[#9b2c2c] dark:bg-[#3d1a1f] dark:text-[#ffb3b3]" },
};

export default function GuidePage() {
  return (
    <Suspense>
      <Guide />
    </Suspense>
  );
}

function Guide() {
  const settings = useSettings();
  const messages = useLiveQuery(() => db.chatMessages.orderBy("createdAt").toArray(), []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const [trimSnapshot, setTrimSnapshot] = useState(true);
  const [passcodeRequired, setPasscodeRequired] = useState(false);
  const [wrongPasscode, setWrongPasscode] = useState(false);
  const [passInput, setPassInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const autoSent = useRef(false);

  useEffect(() => {
    getAIStatus().then((s) => {
      setAiOnline(s.ai);
      setTrimSnapshot(s.trimSnapshot);
      setPasscodeRequired(s.passcodeRequired);
    });
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages?.length, streaming]);

  // The online app needs its passcode before Kharcha can answer; ask for it right in the chat.
  const needPasscode = aiOnline === true && ((passcodeRequired && !settings?.appPasscode) || wrongPasscode);

  async function savePasscode() {
    const p = passInput.trim();
    if (!p) return;
    await db.settings.update("me", { appPasscode: p });
    setPassInput("");
    setWrongPasscode(false);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming !== null || !messages || aiOnline === false || needPasscode) return;
    setInput("");
    setError("");
    const userMsg: ChatMessage = { id: uid(), role: "user", content: q, createdAt: Date.now() };
    await db.chatMessages.add(userMsg);
    if (settings) db.settings.update("me", { guruQuestions: (settings.guruQuestions ?? 0) + 1 });
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const full = await streamChat(history, await buildSnapshot(new Date(), { trimmed: trimSnapshot }), (t) => setStreaming(t), controller.signal);
      const { text: clean, verdict } = splitVerdict(full);
      await db.chatMessages.add({ id: uid(), role: "assistant", content: clean || "…", verdict, createdAt: Date.now() });
    } catch (e) {
      if (e instanceof AIError && e.status === 401) {
        // Missing or wrong passcode: take the question back and ask for the passcode right here.
        await db.chatMessages.delete(userMsg.id);
        setInput(q);
        setWrongPasscode(true);
      } else if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setStreaming(null);
    }
  }

  // Ask the question passed from the dashboard (?q=...)
  useEffect(() => {
    const q = params.get("q");
    if (!q || autoSent.current || !messages || aiOnline !== true) return;
    autoSent.current = true;
    router.replace("/guide");
    send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, messages, aiOnline]);

  async function clear() {
    abortRef.current?.abort();
    await db.chatMessages.clear();
  }

  if (!messages) return null;
  const live = streaming !== null ? splitVerdict(streaming, true) : null;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <PageHeader
        title="Ask Stash 🦉"
        subtitle="Your personal money mentor – knows your budget, goals and habits."
        action={
          messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <Trash2 size={15} /> Clear
            </Button>
          )
        }
      />


      {needPasscode && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            savePasscode();
          }}
          className="mb-4 rounded-2xl border border-accent/40 bg-accent-soft p-4 text-sm"
        >
          <p className="font-semibold">🔒 {wrongPasscode ? "That passcode didn't work" : "One-time setup on this device"}</p>
          <p className="mt-1 text-muted">Enter the app passcode (the APP_PASSCODE you chose) so I can answer you here.</p>
          <div className="mt-3 flex gap-2">
            <label htmlFor="chat-pass" className="sr-only">
              App passcode
            </label>
            <input
              id="chat-pass"
              type="password"
              autoComplete="off"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              placeholder="Passcode"
              className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-card px-3.5 text-[15px] outline-none focus:border-accent"
            />
            <Button type="submit" disabled={!passInput.trim()}>
              Save
            </Button>
          </div>
        </form>
      )}

      <div className="flex-1 space-y-4">
        {messages.length === 0 && streaming === null && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center py-6 text-center">
            <Mascot mood="happy" size={96} className="animate-bob" />
            <p className="mt-3 max-w-sm text-sm text-muted">
              Hi {settings?.name ?? "there"}! Ask me before you buy something, or ask for a plan. I&apos;ll check your real numbers first.
            </p>
            <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Chip key={s} onClick={() => (aiOnline ? send(s) : setInput(s))} className="h-auto py-2">
                  {s}
                </Chip>
              ))}
            </div>
          </motion.div>
        )}

        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} verdict={m.verdict}>
            {m.content}
          </Bubble>
        ))}
        {live && (
          <Bubble role="assistant" verdict={live.verdict}>
            {live.text || <TypingDots />}
          </Bubble>
        )}
        {error && <p className="text-center text-sm text-bad">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-24 mt-4 flex items-end gap-2 rounded-3xl border border-line bg-card p-2 shadow-soft md:bottom-4"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Should I buy…?"
          aria-label="Message Stash"
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] outline-none"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!input.trim() || streaming !== null || aiOnline === false || needPasscode}
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-white transition active:scale-90 disabled:opacity-40 dark:text-[#15142a]"
        >
          <ArrowUp size={20} />
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, verdict, children }: { role: "user" | "assistant"; verdict?: Verdict; children: ReactNode }) {
  const mine = role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}
    >
      {!mine && <Mascot mood={verdict === "skip" ? "worried" : verdict === "go" ? "party" : "happy"} size={34} />}
      <div
        className={cn(
          "max-w-[85%] rounded-3xl px-4 py-3 text-[15px] leading-relaxed sm:max-w-[75%]",
          mine ? "rounded-br-lg bg-accent text-white dark:text-[#15142a]" : "rounded-bl-lg border border-line bg-card",
        )}
      >
        {typeof children === "string" ? <RichText text={children} /> : children}
        {verdict && (
          <div className={cn("mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold", VERDICT_UI[verdict].className)}>
            {VERDICT_UI[verdict].label}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Minimal markdown: paragraphs, "- " bullets and **bold**. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-5">
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) {
      bullets.push(m[1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`} className="my-1 first:mt-0 last:mb-0">{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Stash is typing">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-full bg-muted"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}
