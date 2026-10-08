"use client";

import { format } from "date-fns";
import { useRef, useState } from "react";
import { celebrate } from "@/lib/confetti";
import { db, uid } from "@/lib/db";
import { rupee, timestamp } from "@/lib/format";
import type { IncomeSource } from "@/lib/types";
import { useUI } from "./AppShell";
import { Button, Chip, Input, Label, Sheet, cn } from "./ui";

const SOURCES: { id: IncomeSource; label: string }[] = [
  { id: "gift", label: "🎁 Gift" },
  { id: "refund", label: "↩️ Refund" },
  { id: "repayment", label: "🤝 Paid back" },
  { id: "other", label: "✨ Other" },
];

/** Logs money coming in on top of pocket money; it raises this month's spendable amount. */
export function AddMoneySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useUI();
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<IncomeSource>("gift");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [shake, setShake] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  async function save() {
    const a = Number(amount);
    if (!(a > 0)) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      amountRef.current?.focus();
      return;
    }
    const entry = { id: uid(), amount: a, source, note: note.trim() || undefined, ts: new Date(when).getTime() || timestamp() };
    await db.income.add(entry);
    celebrate();
    toast({
      emoji: "💸",
      tone: "good",
      message: `${rupee(a)} added to this month's budget`,
      action: { label: "Undo", onClick: () => db.income.delete(entry.id) },
    });
    setAmount("");
    setNote("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add money">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-muted">Birthday money, a refund, a friend paying you back – it all raises what you can spend this month.</p>
        <div className={cn("flex items-center gap-2 rounded-3xl bg-bg-soft px-4 py-2", shake && "animate-shake")}>
          <span className="num shrink-0 whitespace-nowrap text-3xl font-bold text-good">+₹</span>
          <input
            ref={amountRef}
            autoFocus
            aria-label="Amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="num h-14 w-full bg-transparent text-4xl font-bold outline-none placeholder:text-muted/40"
          />
        </div>
        <div>
          <Label>Where&apos;s it from?</Label>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <Chip key={s.id} active={source === s.id} color="#B8F2E6" onClick={() => setSource(s.id)}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="am-note">Note</Label>
            <Input id="am-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="From Mama" maxLength={60} />
          </div>
          <div>
            <Label htmlFor="am-when">When?</Label>
            <Input id="am-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted">
          Tip: when a friend pays back an IOU, just mark it settled in Splits &amp; IOUs – it&apos;s added here automatically.
        </p>
        <Button type="submit" size="lg" className="w-full">
          Add to my budget
        </Button>
      </form>
    </Sheet>
  );
}
