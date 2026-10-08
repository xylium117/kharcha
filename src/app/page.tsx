"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AddMoneySheet } from "@/components/AddMoneySheet";
import { useAddExpense } from "@/components/AddExpenseSheet";
import { useUI } from "@/components/AppShell";
import { ExpenseRow } from "@/components/ExpenseRow";
import { Mascot, moodFromHealth } from "@/components/Mascot";
import { Ring } from "@/components/Ring";
import { SafeToSpendSheet } from "@/components/SafeToSpendSheet";
import { Card, EmptyState, Money, Progress, SectionTitle, StatTile, cn } from "@/components/ui";
import { WeeklyReportCard } from "@/components/WeeklyReportCard";
import { backupDue, backupNow } from "@/lib/backup";
import { goalSaved } from "@/lib/budget";
import { celebrate } from "@/lib/confetti";
import { copyUsage, FEEDBACK_URL, weekNumber } from "@/lib/feedback";
import { db } from "@/lib/db";
import { dayKey, rupee } from "@/lib/format";
import { useCategoryMap, useContributions, useExpenses, useGoals, useNow, useSettings } from "@/lib/hooks";
import { buildDayMap, loggingStreak, underLimitStreak } from "@/lib/streaks";

const SEASON_BANNER = {
  normal: null,
  exam: { emoji: "📚", text: "Exam season – food, notes & travel first. Sinchan will be strict about fun spends." },
  fest: { emoji: "🎉", text: "Fest mode – enjoy! Your fest fund is included in this month's budget." },
  home: { emoji: "🏠", text: "Home trip – lower budget this month. Perfect time to stash some savings." },
};

const MOOD_LINE = {
  happy: ["You're crushing it! 💜", "Budget's looking healthy.", "Great pace this month!"],
  chill: ["Doing okay – stay mindful.", "Steady as she goes.", "Not bad, keep an eye on wants."],
  worried: ["Hmm, spending's running hot 😬", "Let's slow down a bit.", "Time for a few cheap days?"],
  party: ["Party time! 🎉"],
};

export default function Dashboard() {
  const settings = useSettings();
  const expenses = useExpenses();
  const goals = useGoals();
  const contributions = useContributions();
  const cats = useCategoryMap();
  const now = useNow();
  const { budget, openAdd, toast } = useUI();
  const router = useRouter();
  const [ask, setAsk] = useState("");
  const quick = useLiveQuery(() => db.quickButtons.orderBy("order").toArray(), []) ?? [];
  const badgeCount = useLiveQuery(() => db.badges.count(), []) ?? 0;
  const { quickAdd } = useAddExpense();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [addMoneyKey, setAddMoneyKey] = useState(0);

  const streaks = useMemo(() => {
    if (!settings || !expenses) return { log: 0, under: 0, todayActive: false };
    const days = buildDayMap(expenses, settings.noSpendDays);
    return {
      log: loggingStreak(days, now),
      under: underLimitStreak(days, settings, now),
      todayActive: !!days.get(dayKey(now))?.active,
    };
  }, [settings, expenses, now]);

  if (!settings || !expenses || !budget) return null;

  const mood = moodFromHealth(budget.health);
  const hour = now.getHours();
  const greeting = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const line = MOOD_LINE[mood][now.getDate() % MOOD_LINE[mood].length];
  // Pocket money plus any money in; lent-out cash counts as used until friends pay it back.
  const total = budget.budget + budget.incomeThisPeriod;
  const used = total > 0 ? (budget.spent + budget.savedThisPeriod + budget.lentThisPeriod) / total : 0;
  const ringColor = used > 1 ? "var(--bad)" : used > budget.period.dayIndex / budget.period.daysInPeriod + 0.1 ? "#ffb86b" : "var(--accent)";
  const banner = SEASON_BANNER[settings.seasonMode];
  const over = budget.safeToday < 0;
  const week = weekNumber(settings.createdAt, now);

  async function markNoSpend() {
    if (!settings) return;
    await db.settings.update("me", { noSpendDays: [...settings.noSpendDays, dayKey(now)] });
    celebrate();
    toast({ emoji: "0️⃣", tone: "good", message: "No-spend day logged. Legend! 🏆" });
  }

  const activeGoals = goals.filter((g) => !g.completedAt).slice(0, 2);

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div className="flex items-center gap-3">
        <Mascot mood={mood} size={64} className="animate-bob" />
        <div className="min-w-0">
          <p className="text-sm text-muted">{format(now, "EEEE, d MMMM")}</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {greeting}, {settings.name}!
          </h1>
          <p className="text-sm font-medium text-muted">Sinchan says: {line}</p>
        </div>
      </div>

      {banner && (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm">
          <span className="text-xl">{banner.emoji}</span>
          <span>{banner.text}</span>
        </div>
      )}

      {backupDue(settings, now.getTime()) && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warn/30 bg-[#fff4dc] px-4 py-3 text-sm text-[#7a4b00] dark:bg-[#3a2e10] dark:text-[#ffd98a]">
          <span className="text-xl">💾</span>
          <span className="min-w-0 flex-1">
            {settings.lastBackupAt
              ? `Last backup ${formatDistanceToNowStrict(settings.lastBackupAt)} ago.`
              : "You haven't backed up yet."}{" "}
            Your data lives only on this device – a backup file keeps it safe.
          </span>
          <span className="flex gap-2">
            <button
              onClick={async () => {
                await backupNow();
                toast({ emoji: "💾", tone: "good", message: "Backup saved to your Downloads" });
              }}
              className="h-9 rounded-full bg-[#7a4b00] px-3 text-xs font-bold text-white dark:bg-[#ffd98a] dark:text-[#3a2e10]"
            >
              Back up now
            </button>
            <button
              onClick={() => db.settings.update("me", { backupSnoozeUntil: now.getTime() + 3 * 24 * 60 * 60 * 1000 })}
              className="h-9 rounded-full px-3 text-xs font-bold"
            >
              Later
            </button>
          </span>
        </div>
      )}

      {FEEDBACK_URL && week >= 2 && (settings.feedbackWeekDone ?? 0) < week && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <span className="text-xl">📝</span>
          <span className="min-w-0 flex-1">
            <b>Week {week} check-in:</b> 2 minutes to say what worked and what annoyed you?
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              onClick={async () =>
                toast(
                  (await copyUsage())
                    ? { emoji: "📋", message: "Usage counts copied – paste them into the form" }
                    : { emoji: "⚠️", tone: "warn", message: "Couldn't copy – you can skip this part" },
                )
              }
              className="h-9 rounded-full bg-card px-3 text-xs font-bold"
            >
              1. Copy my usage
            </button>
            <a
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => db.settings.update("me", { feedbackWeekDone: week })}
              className="grid h-9 place-items-center rounded-full bg-accent px-3 text-xs font-bold text-white dark:text-[#15142a]"
            >
              2. Open feedback form
            </a>
            <button onClick={() => db.settings.update("me", { feedbackWeekDone: week })} className="h-9 rounded-full px-3 text-xs font-bold">
              Not now
            </button>
          </span>
        </div>
      )}

      {hour >= 20 && !streaks.todayActive && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-sm">
          <span className="text-xl">🌙</span>
          <span className="min-w-0 flex-1">Nothing logged today yet – keep your {streaks.log}-day streak alive!</span>
          <span className="flex gap-2">
            <button onClick={() => openAdd()} className="h-9 rounded-full bg-accent px-3 text-xs font-bold text-white dark:text-[#15142a]">
              Add expense
            </button>
            <button onClick={markNoSpend} className="h-9 rounded-full bg-bg-soft px-3 text-xs font-bold">
              I spent ₹0
            </button>
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        {/* Safe to spend */}
        <Card
          className={cn("relative overflow-hidden border-0 text-[#2d2a3e]", over && "animate-shake")}
          as="div"
        >
          <div
            className="absolute inset-0"
            style={{
              background: over
                ? "linear-gradient(135deg, #FFC6D9 0%, #FFADAD 100%)"
                : "linear-gradient(135deg, #C8B6FF 0%, #FFC6D9 55%, #FFD6A5 100%)",
            }}
          />
          <div className="relative">
            <p className="text-sm font-semibold opacity-75">{over ? "Over today's limit by" : "Safe to spend today"}</p>
            <Money value={Math.abs(budget.safeToday)} className="mt-1 block text-5xl font-bold sm:text-6xl" />
            <p className="mt-2 text-sm font-medium opacity-75">
              {rupee(budget.dailyAllowance)} daily allowance · {rupee(budget.spentToday)} spent today
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-white/50 px-3 py-1">🗓️ {budget.period.daysLeft} days left</span>
              {budget.upcomingRecurring > 0 && (
                <span className="rounded-full bg-white/50 px-3 py-1">🔁 {rupee(budget.upcomingRecurring)} bills coming</span>
              )}
              {budget.goalReserve > 0 && (
                <span className="rounded-full bg-white/50 px-3 py-1">🎯 {rupee(budget.goalReserve)} set aside for goals</span>
              )}
              {budget.incomeThisPeriod > 0 && (
                <span className="rounded-full bg-white/50 px-3 py-1">💸 +{rupee(budget.incomeThisPeriod)} money in</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setShowBreakdown(true)}
                className="h-9 rounded-full bg-white/75 px-3 text-xs font-bold text-[#2d2a3e] transition hover:bg-white active:scale-95"
              >
                How is this worked out?
              </button>
              <button
                onClick={() => {
                  setAddMoneyKey((k) => k + 1);
                  setShowAddMoney(true);
                }}
                className="h-9 rounded-full bg-white/75 px-3 text-xs font-bold text-[#2d2a3e] transition hover:bg-white active:scale-95"
              >
                ＋ Add money
              </button>
            </div>
          </div>
        </Card>

        {/* Month ring */}
        <Card delay={0.05} className="flex items-center gap-4">
          <Ring value={used} color={ringColor}>
            <div>
              <div className="num text-2xl font-bold">{Math.round(used * 100)}%</div>
              <div className="text-[11px] font-semibold text-muted">used</div>
            </div>
          </Ring>
          <div className="min-w-0 space-y-1.5 text-sm">
            <p className="text-xs font-semibold text-muted">
              {format(budget.period.start, "d MMM")} budget period · day {budget.period.dayIndex}/{budget.period.daysInPeriod}
            </p>
            <p>
              <Money value={budget.spent} className="text-xl font-bold" /> <span className="text-muted">of {rupee(total)}</span>
            </p>
            <p className="text-muted">
              {budget.remaining >= 0 ? (
                <>
                  <b className="text-ink">{rupee(budget.remaining)}</b> left
                </>
              ) : (
                <b className="text-bad">{rupee(-budget.remaining)} over budget</b>
              )}
            </p>
            <p className="text-xs text-muted">
              At this pace: <b className={budget.projectedEnd > total - budget.lentThisPeriod ? "text-bad" : "text-good"}>{rupee(budget.projectedEnd)}</b> by month end
            </p>
          </div>
        </Card>
      </div>

      {/* Streaks */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Logging streak" value={`🔥 ${streaks.log}`} hint={streaks.log === 1 ? "day" : "days"} tone="#FFD6A5" />
        <StatTile label="Under-limit streak" value={`🐷 ${streaks.under}`} hint="days" tone="#B8F2E6" />
        <Link href="/settings#badges" className="block transition hover:-translate-y-0.5">
          <StatTile label="Badges" value={`🏅 ${badgeCount}`} hint="collected" tone="#C8B6FF" />
        </Link>
      </div>

      {/* Quick add */}
      <Card delay={0.1}>
        <SectionTitle action={<button onClick={() => openAdd({ tab: "form" })} className="text-sm font-semibold text-accent">Full form</button>}>
          ⚡ Quick add
        </SectionTitle>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {quick.map((q) => (
            <button
              key={q.id}
              onClick={() => quickAdd(q)}
              className="flex shrink-0 items-center gap-2 rounded-2xl border border-line bg-bg-soft py-1.5 pl-1.5 pr-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-accent/40 active:scale-95"
            >
              <span className="grid size-8 place-items-center rounded-xl text-lg" style={{ background: cats.get(q.categoryId)?.color ?? "#C8B6FF" }}>
                {q.emoji}
              </span> {q.label} <span className="num text-muted">{rupee(q.amount)}</span>
            </button>
          ))}
          {!streaks.todayActive && (
            <button
              onClick={markNoSpend}
              className="flex shrink-0 items-center gap-2 rounded-2xl border border-dashed border-good/50 px-3 py-2 text-sm font-semibold text-good"
            >
              🙌 I spent ₹0 today
            </button>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent */}
        <Card delay={0.15}>
          <SectionTitle
            action={
              <Link href="/history" className="flex items-center gap-1 text-sm font-semibold text-accent">
                All <ArrowRight size={14} />
              </Link>
            }
          >
            🧾 Recent
          </SectionTitle>
          {expenses.length === 0 ? (
            <EmptyState emoji="🪙" title="Nothing logged yet">
              Tap ＋ to add your first expense. Even a ₹10 chai counts!
            </EmptyState>
          ) : (
            <div className="-mx-2">
              {expenses.slice(0, 5).map((e) => (
                <ExpenseRow key={e.id} e={e} cat={cats.get(e.categoryId)} showDate />
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {/* Ask Sinchan */}
          <Card delay={0.2} className="bg-gradient-to-br from-card to-accent-soft">
            <div className="flex items-start gap-3">
              <Mascot mood="happy" size={52} />
              <div className="min-w-0 flex-1">
                <p className="font-bold">Ask Sinchan</p>
                <p className="text-sm text-muted">&ldquo;Can I afford a ₹350 pizza tonight?&rdquo;</p>
              </div>
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(ask.trim() ? `/guide?q=${encodeURIComponent(ask.trim())}` : "/guide");
              }}
            >
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Should I buy…"
                className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-card px-3.5 text-[15px] outline-none focus:border-accent"
              />
              <button aria-label="Ask Sinchan" className="grid size-11 place-items-center rounded-2xl bg-accent text-white dark:text-[#15142a]">
                <Send size={18} />
              </button>
            </form>
          </Card>

          {activeGoals.length > 0 && (
            <Card delay={0.25}>
              <SectionTitle
                action={
                  <Link href="/goals" className="flex items-center gap-1 text-sm font-semibold text-accent">
                    Goals <ArrowRight size={14} />
                  </Link>
                }
              >
                🎯 Saving for
              </SectionTitle>
              <div className="space-y-3">
                {activeGoals.map((g) => {
                  const saved = goalSaved(g.id, contributions);
                  return (
                    <div key={g.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-semibold">
                          {g.emoji} {g.title}
                        </span>
                        <span className="num text-muted">
                          {rupee(saved)} / {rupee(g.target)}
                        </span>
                      </div>
                      <Progress value={saved / g.target} color="#B8F2E6" />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <WeeklyReportCard delay={0.3} />
        </div>
      </div>

      <SafeToSpendSheet open={showBreakdown} onClose={() => setShowBreakdown(false)} b={budget} />
      <AddMoneySheet key={addMoneyKey} open={showAddMoney} onClose={() => setShowAddMoney(false)} />
    </div>
  );
}
