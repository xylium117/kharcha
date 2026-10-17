"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { goalSaved, inRange } from "@/lib/budget";
import { celebrate } from "@/lib/confetti";
import { copyUsage, FEEDBACK_URL, weekNumber } from "@/lib/feedback";
import { db } from "@/lib/db";
import { dayKey, rupee } from "@/lib/format";
import { useCategoryMap, useContributions, useExpenses, useGoals, useNow, useSettings } from "@/lib/hooks";
import { buildDayMap, loggingStreak, underLimitStreak } from "@/lib/streaks";

import { WasteAuditModal, ChallengesModal } from "@/components/WasteAndChallenges";

const SEASON_BANNER = {
  normal: null,
  exam: { emoji: "📚", text: "Exam season · Essentials first" },
  fest: { emoji: "🎉", text: "Fest mode · Extra fund active" },
  home: { emoji: "🏠", text: "Home trip · Lower spend mode" },
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
  const quickButtons = useMemo(
    () => quick.filter((q) => q.id !== "q-xerox" && q.label.toLowerCase() !== "xerox"),
    [quick],
  );

  useEffect(() => {
    db.quickButtons.where("id").equals("q-xerox").delete().catch(() => {});
  }, []);

  const badgeCount = useLiveQuery(() => db.badges.count(), []) ?? 0;
  const { quickAdd } = useAddExpense();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [addMoneyKey, setAddMoneyKey] = useState(0);
  const [showWasteAudit, setShowWasteAudit] = useState(false);
  const [showChallenges, setShowChallenges] = useState(false);

  const streaks = useMemo(() => {
    if (!settings || !expenses) return { log: 0, under: 0, todayActive: false };
    const days = buildDayMap(expenses, settings.noSpendDays);
    return {
      log: loggingStreak(days, now, settings.streakFreezesUsed ?? []),
      under: underLimitStreak(days, settings, now),
      todayActive: !!days.get(dayKey(now))?.active,
    };
  }, [settings, expenses, now]);

  const catBudgetAlerts = useMemo(() => {
    if (!settings?.categoryBudgets || !expenses || !budget?.period) return [];
    const caps = settings.categoryBudgets;
    if (Object.keys(caps).length === 0) return [];
    const catSpend = new Map<string, number>();
    for (const e of expenses) {
      if (!inRange(e.ts, budget.period.start, budget.period.nextStart)) continue;
      catSpend.set(e.categoryId, (catSpend.get(e.categoryId) ?? 0) + e.amount);
    }
    return Object.entries(caps)
      .filter(([catId, cap]) => (catSpend.get(catId) ?? 0) >= cap * 0.9)
      .map(([catId, cap]) => ({ catId, cap, spent: catSpend.get(catId) ?? 0 }));
  }, [settings, expenses, budget?.period]);

  useEffect(() => {
    if (typeof window === "undefined" || !settings) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    if (!action) return;
    if (action === "zero-spend") {
      const todayKey = dayKey(now);
      if (!settings.noSpendDays.includes(todayKey)) {
        db.settings.update("me", { noSpendDays: [...settings.noSpendDays, todayKey] }).then(() => {
          toast({ emoji: "0️⃣", tone: "good", message: "No-spend day logged!" });
        });
      }
    } else if (action === "quick-add") {
      openAdd();
    }
    router.replace("/", { scroll: false });
  }, [settings]);

  if (!settings || !expenses || !budget) return null;

  const mood = moodFromHealth(budget.health);
  const hour = now.getHours();
  const greeting = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const line = MOOD_LINE[mood][now.getDate() % MOOD_LINE[mood].length];
  const total = budget.budget + budget.incomeThisPeriod;
  const used = total > 0 ? (budget.spent + budget.savedThisPeriod + budget.lentThisPeriod) / total : 0;
  const ringColor = used > 1 ? "var(--bad)" : used > budget.period.dayIndex / budget.period.daysInPeriod + 0.1 ? "#ffb86b" : "var(--accent)";
  const banner = SEASON_BANNER[settings.seasonMode];
  const over = budget.safeToday < 0;
  const week = weekNumber(settings.createdAt, now);

  const todayKey = dayKey(now);
  const isTodayNoSpend = !!settings.noSpendDays?.includes(todayKey);

  async function toggleNoSpend() {
    if (!settings) return;
    if (isTodayNoSpend) {
      const updated = settings.noSpendDays.filter((d) => d !== todayKey);
      await db.settings.update("me", { noSpendDays: updated });
      toast({ emoji: "↩️", message: "No-spend day removed" });
      return;
    }
    await db.settings.update("me", { noSpendDays: [...settings.noSpendDays, todayKey] });
    celebrate();
    toast({ emoji: "0️⃣", tone: "good", message: "No-spend day logged. Legend! 🏆" });
  }

  const activeGoals = goals.filter((g) => !g.completedAt).slice(0, 2);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Mascot mood={mood} size={64} className="animate-bob" />
        <div className="min-w-0">
          <p className="text-sm text-muted">{format(now, "EEEE, d MMMM")}</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {greeting}, {settings.name}!
          </h1>
          <p className="text-sm font-medium text-muted">Stash says: {line}</p>
        </div>
      </div>

      {banner && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-card px-3.5 py-2 text-xs sm:text-sm">
          <span className="text-base sm:text-lg">{banner.emoji}</span>
          <span className="font-semibold">{banner.text}</span>
        </div>
      )}

      {catBudgetAlerts.map(({ catId, cap, spent }) => {
        const cat = cats.get(catId);
        const isOver = spent >= cap;
        return (
          <div key={catId} className={`flex items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-xs sm:text-sm ${isOver ? "border-bad/30 bg-bad/5 text-bad" : "border-warn/30 bg-[#fff4dc] text-[#7a4b00] dark:bg-[#3a2e10] dark:text-[#ffd98a]"}`}>
            <span className="text-base sm:text-lg">{cat?.emoji ?? "🏷️"}</span>
            <span className="flex-1 truncate">
              <b>{cat?.name ?? catId}</b> {isOver ? "exceeded cap" : "near cap"} ({rupee(spent)} / {rupee(cap)})
            </span>
          </div>
        );
      })}

      {backupDue(settings, now.getTime()) && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-warn/30 bg-[#fff4dc] px-3.5 py-2.5 text-xs text-[#7a4b00] dark:bg-[#3a2e10] dark:text-[#ffd98a]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">💾</span>
            <span className="truncate"><b>Backup due</b> · Save data offline</span>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={async () => {
                await backupNow();
                toast({ emoji: "💾", tone: "good", message: "Backup saved" });
              }}
              className="h-7 rounded-full bg-[#7a4b00] px-2.5 text-[11px] font-bold text-white dark:bg-[#ffd98a] dark:text-[#3a2e10]"
            >
              Back up
            </button>
            <button
              onClick={() => db.settings.update("me", { backupSnoozeUntil: now.getTime() + 3 * 24 * 60 * 60 * 1000 })}
              className="h-7 rounded-full px-2 text-[11px] font-bold"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {FEEDBACK_URL && week >= 2 && (settings.feedbackWeekDone ?? 0) < week && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-accent/30 bg-accent-soft px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">📝</span>
            <span className="truncate"><b>Week {week} check-in</b> (2 mins)</span>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <a
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => db.settings.update("me", { feedbackWeekDone: week })}
              className="grid h-7 place-items-center rounded-full bg-accent px-2.5 text-[11px] font-bold text-white dark:text-[#15142a]"
            >
              Feedback
            </a>
            <button onClick={() => db.settings.update("me", { feedbackWeekDone: week })} className="h-7 rounded-full px-2 text-[11px] font-bold">
              Skip
            </button>
          </div>
        </div>
      )}

      {hour >= 20 && !streaks.todayActive && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-card px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base shrink-0">🌙</span>
            <span className="truncate">Keep your <b>{streaks.log}-day</b> streak alive</span>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={() => openAdd()} className="h-7 rounded-full bg-accent px-2.5 text-[11px] font-bold text-white dark:text-[#15142a]">
              + Spend
            </button>
            <button onClick={toggleNoSpend} className="h-7 rounded-full bg-bg-soft px-2.5 text-[11px] font-bold">
              {isTodayNoSpend ? "₹0 logged" : "₹0 today"}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
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

      <div className="grid grid-cols-3 items-stretch gap-3">
        <StatTile label="Logging streak" value={`🔥 ${streaks.log}`} hint={streaks.log === 1 ? "day" : "days"} tone="#FFD6A5" />
        <StatTile label="Under-limit streak" value={`🐷 ${streaks.under}`} hint="days" tone="#B8F2E6" />
        <Link href="/settings#badges" className="block h-full transition hover:-translate-y-0.5">
          <StatTile label="Badges" value={`🏅 ${badgeCount}`} hint="collected" tone="#C8B6FF" />
        </Link>
      </div>

      <Card delay={0.08} className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-xs sm:text-sm font-bold flex items-center gap-1.5 text-ink">
              <span>🎯</span> Challenges &amp; Insights
            </h2>
            <p className="text-[11px] sm:text-xs text-muted truncate">Savings habits &amp; waste audit</p>
          </div>
          <div className="flex gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => setShowWasteAudit(true)}
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-line bg-bg-soft px-2.5 text-xs font-semibold text-ink transition hover:border-accent/40 active:scale-95"
            >
              🔥 Waste Audit
            </button>
            <button
              onClick={() => setShowChallenges(true)}
              className="inline-flex h-8 items-center gap-1 rounded-xl bg-accent px-2.5 text-xs font-semibold text-white dark:text-[#15142a] shadow-soft transition hover:opacity-90 active:scale-95"
            >
              🏆 Challenges
            </button>
          </div>
        </div>
      </Card>

      <Card delay={0.1}>
        <SectionTitle action={<button onClick={() => openAdd({ tab: "form" })} className="text-sm font-semibold text-accent">Full form</button>}>
          ⚡ Quick add
        </SectionTitle>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            onClick={toggleNoSpend}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-2xl border py-1.5 pl-1.5 pr-3 text-sm font-semibold transition hover:-translate-y-0.5 active:scale-95",
              isTodayNoSpend
                ? "border-good bg-good/15 text-good shadow-soft"
                : "border-line bg-bg-soft hover:border-good/50 text-ink"
            )}
            title={isTodayNoSpend ? "Tap to remove ₹0 day" : "Log ₹0 spend today"}
          >
            <span
              className={cn(
                "grid size-8 place-items-center rounded-xl text-lg transition-transform",
                isTodayNoSpend ? "bg-good/25 scale-105" : "bg-[#CAFFBF]"
              )}
            >
              {isTodayNoSpend ? "✅" : "0️⃣"}
            </span>
            <span>{isTodayNoSpend ? "₹0 Logged" : "₹0 Spent"}</span>
            <span className="num text-xs font-bold text-good">
              {rupee(0)}
            </span>
          </button>

          {quickButtons.map((q) => (
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
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
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
          <Card delay={0.2} className="bg-gradient-to-br from-card to-accent-soft">
            <div className="flex items-start gap-3">
              <Mascot mood="happy" size={52} />
              <div className="min-w-0 flex-1">
                <p className="font-bold">Ask Stash</p>
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
              <button aria-label="Ask Stash" className="grid size-11 place-items-center rounded-2xl bg-accent text-white dark:text-[#15142a]">
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
      {showWasteAudit && <WasteAuditModal onClose={() => setShowWasteAudit(false)} />}
      {showChallenges && <ChallengesModal onClose={() => setShowChallenges(false)} />}
    </div>
  );
}
