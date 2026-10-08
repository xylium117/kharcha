"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAIStatus, parseExpenseText } from "@/lib/ai-client";
import { db, uid } from "@/lib/db";
import { MOODS, PAYMENT_MODES, TAGS } from "@/lib/defaults";
import { rupee, timestamp } from "@/lib/format";
import { useCategories } from "@/lib/hooks";
import type { Expense, PaymentMode, QuickButton, Tag } from "@/lib/types";
import { useUI } from "./AppShell";
import { Button, Chip, Input, Label, Segmented, Sheet, cn } from "./ui";

export type AddTab = "quick" | "form" | "ai";

interface FormState {
  amount: string;
  title: string;
  categoryId: string;
  tag: Tag;
  paymentMode: PaymentMode;
  place: string;
  when: string;
  note: string;
  mood: string;
}

function initialForm(edit?: Expense, prefill?: Partial<Expense>): FormState {
  const src = edit ?? prefill ?? {};
  return {
    amount: src.amount ? String(src.amount) : "",
    title: src.title ?? "",
    categoryId: src.categoryId ?? "food",
    tag: src.tag ?? "need",
    paymentMode: src.paymentMode ?? "UPI",
    place: src.place ?? "",
    when: format(src.ts ?? timestamp(), "yyyy-MM-dd'T'HH:mm"),
    note: src.note ?? "",
    mood: src.mood ?? "",
  };
}

/** Saves an expense with an undo toast, and warns when it tips today over the safe-to-spend. */
export function useAddExpense() {
  const { toast, budget } = useUI();
  const categories = useCategories();

  async function addExpense(e: Expense) {
    await db.expenses.add(e);
    const cat = categories.find((c) => c.id === e.categoryId);
    toast({
      emoji: cat?.emoji ?? "✅",
      message: `${e.title} ${rupee(e.amount)} added`,
      action: { label: "Undo", onClick: () => db.expenses.delete(e.id) },
    });
    const isToday = format(e.ts, "yyyy-MM-dd") === format(timestamp(), "yyyy-MM-dd");
    if (budget && isToday && budget.safeToday >= 0 && budget.safeToday - e.amount < 0) {
      const over = e.amount - budget.safeToday;
      setTimeout(() => toast({ emoji: "😬", tone: "warn", message: `That's ${rupee(over)} over today's safe-to-spend.` }), 400);
    }
  }

  async function quickAdd(q: QuickButton) {
    await addExpense({
      id: uid(),
      amount: q.amount,
      title: q.label,
      categoryId: q.categoryId,
      tag: q.tag ?? "need",
      paymentMode: q.paymentMode ?? "UPI",
      ts: timestamp(),
      source: "quick",
    });
  }

  return { addExpense, quickAdd };
}

export function AddExpenseSheet({
  open,
  onClose,
  initialTab,
  edit,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: AddTab;
  edit?: Expense;
  prefill?: Partial<Expense>;
}) {
  const { toast } = useUI();
  const categories = useCategories();
  const quick = useLiveQuery(() => db.quickButtons.orderBy("order").toArray(), []) ?? [];
  // AppShell remounts this sheet (new key) every time it opens, so props seed fresh state.
  const [tab, setTab] = useState<AddTab>(edit || prefill ? "form" : (initialTab ?? "quick"));
  const [form, setForm] = useState<FormState>(() => initialForm(edit, prefill));
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiFilled, setAiFilled] = useState(false);
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const [shake, setShake] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) getAIStatus().then((s) => setAiOnline(s.ai));
  }, [open]);

  useEffect(() => {
    if (open && tab === "form" && !edit) setTimeout(() => amountRef.current?.focus(), 250);
  }, [open, tab, edit]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const catOf = (id: string) => categories.find((c) => c.id === id);

  const { addExpense, quickAdd } = useAddExpense();

  async function save() {
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      amountRef.current?.focus();
      return;
    }
    const cat = catOf(form.categoryId);
    const ts = new Date(form.when).getTime() || timestamp();
    const data = {
      amount,
      title: form.title.trim() || cat?.name || "Expense",
      categoryId: form.categoryId,
      tag: form.tag,
      paymentMode: form.paymentMode,
      place: form.place.trim() || undefined,
      note: form.note.trim() || undefined,
      mood: form.mood || undefined,
      ts,
    };
    if (edit) {
      await db.expenses.update(edit.id, data);
      toast({ emoji: "✏️", message: "Expense updated" });
    } else {
      await addExpense({ id: uid(), source: aiFilled ? "ai" : "form", ...data });
    }
    onClose();
  }

  async function remove() {
    if (!edit) return;
    await db.expenses.delete(edit.id);
    toast({ emoji: "🗑️", message: `${edit.title} deleted`, action: { label: "Undo", onClick: () => db.expenses.add(edit) } });
    onClose();
  }

  async function runAI() {
    if (!aiText.trim()) return;
    setAiBusy(true);
    setAiError("");
    try {
      const p = await parseExpenseText(
        aiText.trim(),
        categories.map((c) => ({ id: c.id, name: c.name })),
      );
      setForm({
        amount: String(p.amount),
        title: p.title,
        categoryId: p.categoryId,
        tag: p.tag,
        paymentMode: p.paymentMode,
        place: p.place ?? "",
        when: `${p.date}T${p.time ?? format(timestamp(), "HH:mm")}`,
        note: "",
        mood: "",
      });
      setAiFilled(true);
      setTab("form");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={edit ? "Edit expense" : "Add expense"}>
      {!edit && (
        <Segmented
          className="mb-4 w-full"
          value={tab}
          onChange={setTab}
          options={[
            { value: "quick", label: "⚡ Quick" },
            { value: "form", label: "📝 Form" },
            { value: "ai", label: "✨ Just type" },
          ]}
        />
      )}

      {tab === "quick" && !edit && (
        <div>
          <div className="grid grid-cols-3 gap-2">
            {quick.map((q) => {
              const cat = catOf(q.categoryId);
              return (
                <button
                  key={q.id}
                  onClick={() => quickAdd(q)}
                  className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-bg-soft p-3 transition hover:-translate-y-0.5 hover:border-accent/40 active:scale-95"
                >
                  <span className="grid size-11 place-items-center rounded-xl text-2xl" style={{ background: cat?.color ?? "#C8B6FF" }}>
                    {q.emoji}
                  </span>
                  <span className="text-sm font-semibold">{q.label}</span>
                  <span className="num text-xs text-muted">{rupee(q.amount)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-center text-xs text-muted">
            One tap logs it right now. Customize these in{" "}
            <Link href="/settings" onClick={onClose} className="font-semibold text-accent">
              Settings
            </Link>
            .
          </p>
        </div>
      )}

      {tab === "ai" && !edit && (
        <div className="space-y-3">
          <p className="text-sm text-muted">Type it like you&apos;d text a friend. Kharcha fills in the form, and you check it before saving.</p>
          <textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runAI();
              }
            }}
            rows={3}
            maxLength={300}
            placeholder="momos 120 at Dey's stall, paid UPI"
            className="w-full resize-none rounded-2xl border border-line bg-bg-soft p-3.5 text-[15px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
          <div className="flex flex-wrap gap-2">
            {["chai 15 cash", "auto to college 40", "zomato biryani 280 yesterday, regret it"].map((s) => (
              <Chip key={s} onClick={() => setAiText(s)}>
                {s}
              </Chip>
            ))}
          </div>
          {aiOnline === false && (
            <p className="rounded-2xl bg-bg-soft p-3 text-sm text-muted">
              🦉 Kharcha is offline. Add your free <code>GEMINI_API_KEY</code> to <code>.env.local</code> and restart the app to use this.
            </p>
          )}
          {aiError && <p className="text-sm text-bad">{aiError}</p>}
          <Button className="w-full" onClick={runAI} disabled={aiBusy || !aiText.trim() || aiOnline === false}>
            <Wand2 size={16} /> {aiBusy ? "Reading your note…" : "Fill the form"}
          </Button>
        </div>
      )}

      {tab === "form" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {aiFilled && (
            <div className="flex items-center gap-2 rounded-2xl bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
              <Sparkles size={16} /> Filled by Kharcha – check it and save.
            </div>
          )}
          <div className={cn("flex items-center gap-2 rounded-3xl bg-bg-soft px-4 py-2", shake && "animate-shake")}>
            <span className="num text-3xl font-bold text-muted">₹</span>
            <input
              ref={amountRef}
              aria-label="Amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0"
              className="num h-14 w-full bg-transparent text-4xl font-bold outline-none placeholder:text-muted/40"
            />
          </div>

          <div>
            <Label htmlFor="ex-title">What was it?</Label>
            <Input id="ex-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Momos" maxLength={60} />
          </div>

          <div>
            <Label>Category</Label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <Chip key={c.id} active={form.categoryId === c.id} color={c.color} onClick={() => set("categoryId", c.id)}>
                  <span>{c.emoji}</span> {c.name}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <Label>Need, want or waste?</Label>
            <div className="grid grid-cols-3 gap-2">
              {TAGS.map((t) => (
                <Chip key={t.id} active={form.tag === t.id} color={t.color} onClick={() => set("tag", t.id)} className="justify-center">
                  {t.emoji} {t.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ex-place">Where?</Label>
              <Input id="ex-place" value={form.place} onChange={(e) => set("place", e.target.value)} placeholder="Shop / place" maxLength={60} />
            </div>
            <div>
              <Label htmlFor="ex-when">When?</Label>
              <Input id="ex-when" type="datetime-local" value={form.when} onChange={(e) => set("when", e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Paid with</Label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_MODES.map((p) => (
                <Chip key={p} active={form.paymentMode === p} onClick={() => set("paymentMode", p)}>
                  {p}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <Label htmlFor="ex-note">Note</Label>
              <Input id="ex-note" value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Optional" maxLength={140} />
            </div>
            <div>
              <Label>Mood</Label>
              <div className="flex gap-1">
                {MOODS.map((m) => (
                  <button
                    type="button"
                    key={m}
                    aria-pressed={form.mood === m}
                    onClick={() => set("mood", form.mood === m ? "" : m)}
                    className={cn(
                      "grid size-11 place-items-center rounded-2xl text-xl transition",
                      form.mood === m ? "bg-accent-soft ring-2 ring-accent" : "bg-bg-soft opacity-70 hover:opacity-100",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            {edit && (
              <Button type="button" variant="danger" onClick={remove} aria-label="Delete expense">
                <Trash2 size={16} />
              </Button>
            )}
            <Button type="submit" size="lg" className="flex-1">
              {edit ? "Save changes" : "Save expense"}
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
