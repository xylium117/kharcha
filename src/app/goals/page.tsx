"use client";

import { addMonths, differenceInCalendarDays, format } from "date-fns";
import { Plus, Trash2, ShieldAlert, Trophy } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { useState } from "react";
import { useUI } from "@/components/AppShell";
import { Button, Card, EmptyState, Input, Label, PageHeader, Progress, SectionTitle, Sheet, cn } from "@/components/ui";
import { budgetFor, getPeriod, goalPerDay, goalSaved, inRange } from "@/lib/budget";
import { celebrate } from "@/lib/confetti";
import { db, uid } from "@/lib/db";
import { dayKey, parseDayKey, rupee, timestamp } from "@/lib/format";
import { useCategories, useContributions, useExpenses, useGoals, useNow, useSettings } from "@/lib/hooks";
import { recordLocalDeletion } from "@/lib/sync";
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
    await recordLocalDeletion("goals", g.id);
    for (const c of cs) {
      await recordLocalDeletion("goalContributions", c.id);
    }
    toast({
      emoji: "trash",
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
        title="Goals"
        subtitle={`${rupee(totalSaved)} saved across all goals`}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> New goal
          </Button>
        }
      />

      {goals.length === 0 && (
        <Card>
          <EmptyState emoji="💰" title="No goals yet">
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
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-mint">
                  <AppIcon name={g.emoji} size={28} />
                </span>
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
                  Save <b className="num">{rupee(Math.ceil(perDay))}/day</b> <span className="text-muted">to make it</span>
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
          <h2 className="mb-3 font-bold flex items-center gap-1.5"><Trophy size={16} className="text-[#FFD166]" /> Completed</h2>
          <div className="flex flex-wrap gap-2">
            {done.map((g) => (
              <span key={g.id} className="rounded-full bg-mint px-3 py-1.5 text-sm font-semibold text-[#2d2a3e] inline-flex items-center gap-1.5">
                <AppIcon name={g.emoji} size={15} /> {g.title} · {rupee(g.target)}
              </span>
            ))}
          </div>
        </Card>
      )}

      <SpendingLimitsCard />

      <NewGoalSheet open={creating} onClose={() => setCreating(false)} />
      <ContributeSheet
        goal={adding}
        saved={adding ? goalSaved(adding.id, contributions) : 0}
        onClose={() => setAdding(null)}
        onDone={(g, reached) => {
          if (reached) {
            celebrate(true);
            toast({ emoji: g.emoji, tone: "good", message: `Goal reached: ${g.title}!` });
          } else {
            toast({ emoji: "piggy", message: "Saved! Every rupee counts." });
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
                className={cn("grid size-11 place-items-center rounded-2xl", emoji === e ? "bg-accent-soft ring-2 ring-accent" : "bg-bg-soft")}
              >
                <AppIcon name={e} size={22} />
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
            That&apos;s about{" "}
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
          Save to goal
        </Button>
      </form>
    </Sheet>
  );
}

function SpendingLimitsCard() {
  const settings = useSettings();
  const categories = useCategories();
  const expenses = useExpenses();
  const now = useNow();

  if (!settings) return null;

  const budgets = settings.categoryBudgets ?? {};
  const period = getPeriod(now, settings.monthStartDay);

  const catSpend = new Map<string, number>();
  if (expenses) {
    for (const e of expenses) {
      if (!inRange(e.ts, period.start, period.nextStart)) continue;
      catSpend.set(e.categoryId, (catSpend.get(e.categoryId) ?? 0) + e.amount);
    }
  }

  async function updateBudget(catId: string, value: string) {
    const n = Number(value);
    const next = { ...budgets };
    if (n > 0) next[catId] = n;
    else delete next[catId];
    await db.settings.update("me", { categoryBudgets: next });
  }

  const catsWithCaps = categories.filter((c) => budgets[c.id] != null);
  const catsWithoutCaps = categories.filter((c) => budgets[c.id] == null);

  return (
    <Card delay={0.3}>
      <SectionTitle>
        <span className="flex items-center gap-1.5">
          <ShieldAlert size={16} className="text-accent" />
          Spending Limits
        </span>
      </SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-muted">
        Set monthly spend caps per category to keep your goals on track. Leave blank for no limit.
      </p>

      {catsWithCaps.length > 0 && (
        <div className="space-y-3 mb-4">
          {catsWithCaps.map((c) => {
            const cap = budgets[c.id];
            const spent = catSpend.get(c.id) ?? 0;
            const pct = cap > 0 ? Math.min(1, spent / cap) : 0;
            const isOver = spent >= cap;
            const isNear = spent >= cap * 0.9 && !isOver;
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-bg-soft p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{c.emoji}</span>
                  <span className="flex-1 text-sm font-semibold truncate">{c.name}</span>
                  <span className={cn("text-sm font-bold num", isOver ? "text-bad" : isNear ? "text-warn" : "text-good")}>
                    {rupee(spent)} / {rupee(cap)}
                  </span>
                </div>
                <Progress
                  value={pct}
                  color={isOver ? "var(--bad)" : isNear ? "#ffb86b" : "var(--s-need)"}
                  className="h-2"
                />
                <div className="flex items-center justify-between mt-2">
                  <Input
                    aria-label={`Budget cap for ${c.name}`}
                    type="number"
                    min={0}
                    placeholder="No cap"
                    value={budgets[c.id] ?? ""}
                    onChange={(e) => updateBudget(c.id, e.target.value)}
                    className="w-24 num px-2 text-sm"
                  />
                  <span className="text-xs text-muted">
                    {isOver ? "Over limit!" : isNear ? "Almost there" : `${rupee(cap - spent)} left`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {catsWithoutCaps.length > 0 && (
        <div>
          {catsWithCaps.length > 0 && (
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Other categories</p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {catsWithoutCaps.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="w-7 text-center text-lg">{c.emoji}</span>
                <span className="flex-1 truncate text-sm">{c.name}</span>
                <Input
                  aria-label={`Budget cap for ${c.name}`}
                  type="number"
                  min={0}
                  placeholder="No cap"
                  value=""
                  onChange={(e) => updateBudget(c.id, e.target.value)}
                  className="w-24 num px-2 text-sm"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
