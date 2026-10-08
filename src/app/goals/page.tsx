"use client";

import { addMonths, differenceInCalendarDays, format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useUI } from "@/components/AppShell";
import { Button, Card, EmptyState, Input, Label, PageHeader, Progress, Sheet, cn } from "@/components/ui";
import { goalPerDay, goalSaved } from "@/lib/budget";
import { celebrate } from "@/lib/confetti";
import { db, uid } from "@/lib/db";
import { dayKey, parseDayKey, rupee, timestamp } from "@/lib/format";
import { useContributions, useGoals, useNow } from "@/lib/hooks";
import type { Goal } from "@/lib/types";

const EMOJIS = ["🎧", "📱", "💻", "👟", "🏖️", "🎸", "📷", "🎁", "📚", "🚲", "🎮", "💰"];

export default function GoalsPage() {
  const goals = useGoals();
  const contributions = useContributions();
  const now = useNow();
  const { toast } = useUI();
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<Goal | null>(null);

  const active = goals.filter((g) => !g.completedAt).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const done = goals.filter((g) => g.completedAt);
  const totalSaved = contributions.reduce((s, c) => s + c.amount, 0);

  async function remove(g: Goal) {
    const cs = contributions.filter((c) => c.goalId === g.id);
    await db.transaction("rw", db.goals, db.goalContributions, async () => {
      await db.goals.delete(g.id);
      await db.goalContributions.bulkDelete(cs.map((c) => c.id));
    });
    toast({
      emoji: "🗑️",
      message: `Deleted "${g.title}"`,
      action: {
        label: "Undo",
        onClick: () =>
          db.transaction("rw", db.goals, db.goalContributions, async () => {
            await db.goals.add(g);
            await db.goalContributions.bulkAdd(cs);
          }),
      },
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Savings goals 🎯"
        subtitle={`${rupee(totalSaved)} saved across all goals`}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> New goal
          </Button>
        }
      />

      {goals.length === 0 && (
        <Card>
          <EmptyState emoji="🎯" title="No goals yet">
            Saving for headphones, a trip or a new phone? Add a goal and Stash will tell you how much to put aside each day.
          </EmptyState>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {active.map((g, i) => {
          const saved = goalSaved(g.id, contributions);
          const perDay = goalPerDay(g, saved, now);
          const daysLeft = differenceInCalendarDays(parseDayKey(g.deadline), now);
          const pct = saved / g.target;
          return (
            <Card key={g.id} delay={i * 0.05}>
              <div className="flex items-start gap-3">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-mint text-3xl">{g.emoji}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold">{g.title}</h2>
                  <p className="text-xs text-muted">
                    by {format(parseDayKey(g.deadline), "d MMM yyyy")} ·{" "}
                    {daysLeft >= 0 ? `${daysLeft} days left` : <span className="text-bad">deadline passed</span>}
                  </p>
                </div>
                <button onClick={() => remove(g)} aria-label={`Delete ${g.title}`} className="grid size-9 place-items-center rounded-full text-muted hover:bg-bg-soft hover:text-bad">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="num text-2xl font-bold">{rupee(saved)}</span>
                <span className="num text-sm text-muted">of {rupee(g.target)}</span>
              </div>
              <Progress value={pct} color="var(--s-need)" className="mt-2 h-3" />
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-sm">
                  Save <b className="num">{rupee(Math.ceil(perDay))}/day</b> <span className="text-muted">to make it 🐷</span>
                </p>
                <Button size="sm" variant="soft" onClick={() => setAdding(g)}>
                  + Add money
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {done.length > 0 && (
        <Card>
          <h2 className="mb-3 font-bold">🏆 Completed</h2>
          <div className="flex flex-wrap gap-2">
            {done.map((g) => (
              <span key={g.id} className="rounded-full bg-mint px-3 py-1.5 text-sm font-semibold text-[#2d2a3e]">
                {g.emoji} {g.title} · {rupee(g.target)}
              </span>
            ))}
          </div>
        </Card>
      )}

      <NewGoalSheet open={creating} onClose={() => setCreating(false)} />
      <ContributeSheet
        goal={adding}
        saved={adding ? goalSaved(adding.id, contributions) : 0}
        onClose={() => setAdding(null)}
        onDone={(g, reached) => {
          if (reached) {
            celebrate(true);
            toast({ emoji: g.emoji, tone: "good", message: `Goal reached: ${g.title}! 🎉` });
          } else {
            toast({ emoji: "🐷", message: "Saved! Every rupee counts." });
          }
        }}
      />
    </div>
  );
}

function NewGoalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState(() => dayKey(addMonths(new Date(), 3)));
  const valid = title.trim() && Number(target) > 0 && deadline;

  async function save() {
    if (!valid) return;
    await db.goals.add({ id: uid(), title: title.trim(), emoji, target: Number(target), deadline, createdAt: timestamp() });
    setTitle("");
    setTarget("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="New savings goal">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <Label>Pick an icon</Label>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                type="button"
                key={e}
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={cn("grid size-11 place-items-center rounded-2xl text-2xl", emoji === e ? "bg-accent-soft ring-2 ring-accent" : "bg-bg-soft")}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="g-title">What are you saving for?</Label>
          <Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wireless headphones" maxLength={50} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="g-target">Target (₹)</Label>
            <Input id="g-target" type="number" inputMode="numeric" min={1} value={target} onChange={(e) => setTarget(e.target.value)} className="num" />
          </div>
          <div>
            <Label htmlFor="g-deadline">By</Label>
            <Input id="g-deadline" type="date" value={deadline} min={dayKey(new Date())} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        {valid && (
          <p className="rounded-2xl bg-bg-soft p-3 text-sm">
            🦉 That&apos;s about{" "}
            <b className="num">
              {rupee(Math.ceil(Number(target) / Math.max(1, differenceInCalendarDays(parseDayKey(deadline), new Date()) + 1)))}
            </b>{" "}
            a day. Totally doable!
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={!valid}>
          Create goal
        </Button>
      </form>
    </Sheet>
  );
}

function ContributeSheet({
  goal,
  saved,
  onClose,
  onDone,
}: {
  goal: Goal | null;
  saved: number;
  onClose: () => void;
  onDone: (g: Goal, reached: boolean) => void;
}) {
  const [amount, setAmount] = useState("");
  const remaining = goal ? Math.max(0, goal.target - saved) : 0;

  async function save() {
    const a = Number(amount);
    if (!goal || !(a > 0)) return;
    const reached = saved + a >= goal.target;
    await db.transaction("rw", db.goals, db.goalContributions, async () => {
      await db.goalContributions.add({ id: uid(), goalId: goal.id, amount: a, ts: timestamp() });
      if (reached) await db.goals.update(goal.id, { completedAt: timestamp() });
    });
    setAmount("");
    onDone(goal, reached);
    onClose();
  }

  return (
    <Sheet open={!!goal} onClose={onClose} title={goal ? `${goal.emoji} Add to ${goal.title}` : ""}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-muted">
          {rupee(remaining)} to go. Money you put here comes out of this month&apos;s spendable budget.
        </p>
        <div className="flex items-center gap-2 rounded-3xl bg-bg-soft px-4 py-2">
          <span className="num text-3xl font-bold text-muted">₹</span>
          <input
            autoFocus
            aria-label="Amount"
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="num h-14 w-full bg-transparent text-4xl font-bold outline-none"
          />
        </div>
        <div className="flex gap-2">
          {[50, 100, 200, 500].map((v) => (
            <button type="button" key={v} onClick={() => setAmount(String(v))} className="num h-10 flex-1 rounded-2xl bg-bg-soft text-sm font-semibold">
              ₹{v}
            </button>
          ))}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={!(Number(amount) > 0)}>
          Save to goal 🐷
        </Button>
      </form>
    </Sheet>
  );
}
