"use client";

import { addDays, format } from "date-fns";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { inRange, type BudgetSummary } from "@/lib/budget";
import { db } from "@/lib/db";
import { rupee } from "@/lib/format";
import { useIncome } from "@/lib/hooks";
import type { IncomeSource } from "@/lib/types";
import { useUI } from "./AppShell";
import { Sheet, cn } from "./ui";

const SOURCE_LABEL: Record<IncomeSource, string> = { gift: "🎁 Gift", refund: "↩️ Refund", repayment: "🤝 Paid back", other: "✨ Other" };

function Row({ label, value, sign, hint, strong }: { label: ReactNode; value: number; sign?: "+" | "−" | "="; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 py-2", strong && "border-t border-line pt-3")}>
      <div className="min-w-0">
        <div className={cn("text-sm", strong ? "font-bold" : "font-medium")}>{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className={cn("num shrink-0 font-semibold", strong && "text-lg font-bold", sign === "+" && "text-good", sign === "−" && "text-muted")}>
        {sign && sign !== "=" ? `${sign} ` : ""}
        {rupee(Math.abs(value))}
      </div>
    </div>
  );
}

/** Shows how "safe to spend today" is worked out, step by step. */
export function SafeToSpendSheet({ open, onClose, b }: { open: boolean; onClose: () => void; b: BudgetSummary }) {
  const { toast } = useUI();
  const income = useIncome().filter((i) => inRange(i.ts, b.period.start, b.period.nextStart));
  const days = Math.max(1, b.period.daysLeft);

  return (
    <Sheet open={open} onClose={onClose} title="How is this worked out?">
      <p className="mb-2 text-sm text-muted">
        Your money for {format(b.period.start, "d MMM")} – {format(addDays(b.period.nextStart, -1), "d MMM")}, shared fairly over the days left.
      </p>
      <div className="rounded-2xl bg-bg-soft px-4 py-1">
        <Row label="Pocket money this month" value={b.budget} />
        {b.incomeThisPeriod > 0 && <Row label="Money in (gifts, refunds, paid back)" value={b.incomeThisPeriod} sign="+" />}
        <Row label="Spent before today" value={b.spentBeforeToday} sign="−" />
        {b.lentThisPeriod > 0 && (
          <Row label="Paid for friends" value={b.lentThisPeriod} sign="−" hint="Comes back when you mark their IOU settled" />
        )}
        {b.savedThisPeriod > 0 && <Row label="Moved to savings goals" value={b.savedThisPeriod} sign="−" />}
        {b.upcomingRecurring > 0 && <Row label="Bills still to come this month" value={b.upcomingRecurring} sign="−" hint="Recurring expenses like your recharge" />}
        {b.goalReserve > 0 && (
          <Row
            label="Set aside for your goals"
            value={b.goalReserve}
            sign="−"
            hint={
              <>
                Each goal&apos;s ₹/day × days left.{" "}
                <Link href="/goals" onClick={onClose} className="font-semibold text-accent">
                  Change goals
                </Link>
              </>
            }
          />
        )}
        <Row label="Left for the rest of the month" value={Math.max(0, b.pool)} sign="=" strong />
        <Row label={`÷ ${days} day${days > 1 ? "s" : ""} left (incl. today)`} value={b.dailyAllowance} hint="Your daily allowance – it stays fixed all day" />
        <Row label="Spent today" value={b.spentToday} sign="−" />
        <Row label={b.safeToday >= 0 ? "Safe to spend today" : "Over today's limit by"} value={b.safeToday} sign="=" strong />
      </div>
      {b.pool < 0 && (
        <p className="mt-3 rounded-2xl bg-[#fff1d6] p-3 text-sm text-[#7a4b00] dark:bg-[#3a2e10] dark:text-[#ffd98a]">
          Your bills and goal savings need more than what&apos;s left, so the daily allowance is ₹0. Pausing a goal or adding money would free some up.
        </p>
      )}

      {income.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-bold">Money in this month</h3>
          <ul>
            {income.map((i) => (
              <li key={i.id} className="flex items-center gap-3 border-b border-line py-2 text-sm last:border-0">
                <span className="min-w-0 flex-1 truncate">
                  {SOURCE_LABEL[i.source]}
                  {i.note ? <span className="text-muted"> · {i.note}</span> : null}
                  <span className="block text-xs text-muted">{format(i.ts, "d MMM, h:mm a")}</span>
                </span>
                <span className="num font-semibold text-good">+{rupee(i.amount)}</span>
                <button
                  aria-label="Delete this entry"
                  onClick={async () => {
                    await db.income.delete(i.id);
                    toast({ emoji: "🗑️", message: "Removed", action: { label: "Undo", onClick: () => db.income.add(i) } });
                  }}
                  className="grid size-9 place-items-center rounded-full text-muted hover:text-bad"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
