"use client";

import { format, startOfMonth, endOfMonth } from "date-fns";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, TrendingDown, Flame, Award, X, CheckCircle2, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { useCategories, useExpenses, useNow, useSettings } from "@/lib/hooks";
import { getPeriod, inRange, tagTotals } from "@/lib/budget";
import { dayKey, rupee } from "@/lib/format";
import { buildDayMap, underLimitStreak } from "@/lib/streaks";
import { Button, Card, SectionTitle } from "@/components/ui";
import { celebrate } from "@/lib/confetti";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Challenge {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** How many days the challenge runs */
  days: number;
  /** Tag that must NOT appear during the challenge (null = just no-spend days) */
  forbiddenCategory?: string;
  /** For "under budget" challenges – max amount per day */
  dailyCap?: number;
  /** Number of no-spend days required */
  noSpendDays?: number;
  badgeId?: string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: "no-zomato-7",
    name: "No Zomato/Swiggy – 7 Days",
    icon: "🚫🍕",
    description: "Avoid ordering food online for 7 days straight. Cook, eat at mess, or grab something nearby.",
    days: 7,
    forbiddenCategory: "food",
  },
  {
    id: "weekend-under-300",
    name: "Weekend Under ₹300",
    icon: "💰",
    description: "Keep your weekend spending under ₹300 total (Sat + Sun combined).",
    days: 2,
    dailyCap: 150,
  },
  {
    id: "5-no-spend-days",
    name: "5 No-Spend Days in a Month",
    icon: "🏆",
    description: "Log 5 completely zero-spend days in a single month. Use the ₹0 button!",
    days: 30,
    noSpendDays: 5,
    badgeId: "zero-hero-5",
  },
  {
    id: "no-wants-3",
    name: "3-Day Wants Detox",
    icon: "🧘",
    description: "Go 3 days without logging a single 'Want' expense. Needs only!",
    days: 3,
    forbiddenCategory: "want",
  },
  {
    id: "under-daily-5",
    name: "5 Days Under Daily Limit",
    icon: "📉",
    description: "Stay under your daily budget limit for 5 consecutive days.",
    days: 5,
  },
];

// ─── Waste Audit Modal ────────────────────────────────────────────────────────

interface WasteAuditProps {
  onClose: () => void;
}

export function WasteAuditModal({ onClose }: WasteAuditProps) {
  const settings = useSettings();
  const now = useNow();
  const categories = useCategories();
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const thisMonthExpenses = useLiveQuery(async () => {
    if (!settings) return [];
    const period = getPeriod(now, settings.monthStartDay);
    return db.expenses
      .where("ts")
      .between(period.start.getTime(), period.nextStart.getTime())
      .toArray();
  }, [settings, now]) ?? [];

  const wasteExpenses = useMemo(
    () => thisMonthExpenses.filter((e) => e.tag === "waste"),
    [thisMonthExpenses],
  );

  const totalWaste = useMemo(() => wasteExpenses.reduce((s, e) => s + e.amount, 0), [wasteExpenses]);

  // Category breakdown of waste
  const wasteByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of wasteExpenses) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [wasteExpenses]);

  // Savings potential: what could have been saved
  const savingsGoalPotential = totalWaste;
  const chaiBuys = Math.floor(totalWaste / 15);
  const busTrips = Math.floor(totalWaste / 20);

  if (!settings) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[var(--bg)] p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">🔥 Waste Audit</h2>
            <p className="text-sm text-[var(--muted)]">This month's money burned on "Waste"</p>
          </div>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--bg-soft)]">
            <X size={16} />
          </button>
        </div>

        {wasteExpenses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="text-5xl">🎉</span>
            <p className="font-bold text-lg">No waste this month!</p>
            <p className="text-sm text-[var(--muted)]">You haven't logged a single waste expense. Keep it up!</p>
          </div>
        ) : (
          <>
            {/* Big waste number */}
            <div className="rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-5 mb-4">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Total Wasted</p>
              <p className="text-4xl font-black text-red-600 dark:text-red-400 num">{rupee(totalWaste)}</p>
              <p className="text-sm text-red-500 mt-1">
                That's <b>{chaiBuys} chais</b> or <b>{busTrips} bus rides</b> you paid for — and got nothing back.
              </p>
            </div>

            {/* Savings translation */}
            <div className="rounded-2xl bg-[var(--bg-soft)] p-4 mb-4">
              <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
                💡 If you'd saved this instead…
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[var(--bg)] p-3 text-center">
                  <p className="text-2xl font-bold num">{rupee(savingsGoalPotential)}</p>
                  <p className="text-xs text-[var(--muted)]">closer to your goals</p>
                </div>
                <div className="rounded-xl bg-[var(--bg)] p-3 text-center">
                  <p className="text-2xl font-bold num">{rupee(totalWaste / 30)}/day</p>
                  <p className="text-xs text-[var(--muted)]">avg waste per day</p>
                </div>
              </div>
            </div>

            {/* Category breakdown */}
            {wasteByCat.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">Where did it go?</p>
                <ul className="space-y-2">
                  {wasteByCat.map(([catId, amt]) => {
                    const cat = catMap.get(catId);
                    const pct = Math.round((amt / totalWaste) * 100);
                    return (
                      <li key={catId} className="flex items-center gap-3">
                        <span className="text-lg w-7 shrink-0">{cat?.emoji ?? "✨"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between mb-1">
                            <span className="text-sm font-medium truncate">{cat?.name ?? catId}</span>
                            <span className="text-sm font-bold num">{rupee(amt)}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--bg-soft)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-red-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-[var(--muted)] w-8 text-right">{pct}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Recent waste items */}
            {wasteExpenses.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">Recent waste</p>
                <ul className="space-y-1">
                  {wasteExpenses.slice(0, 5).map((e) => (
                    <li key={e.id} className="flex items-center justify-between rounded-xl bg-[var(--bg-soft)] px-3 py-2">
                      <span className="text-sm">{e.title}</span>
                      <div className="text-right">
                        <span className="text-sm font-bold num">{rupee(e.amount)}</span>
                        <p className="text-[11px] text-[var(--muted)]">{format(e.ts, "d MMM")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              className="w-full mt-4"
              variant="soft"
              onClick={onClose}
            >
              Got it – I'll do better 💪
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Mini Savings Challenges ──────────────────────────────────────────────────

interface ChallengesProps {
  onClose: () => void;
}

export function ChallengesModal({ onClose }: ChallengesProps) {
  const settings = useSettings();
  const now = useNow();
  const expenses = useExpenses() ?? [];
  const [completing, setCompleting] = useState<string | null>(null);

  const completed = new Set(settings?.completedChallenges ?? []);

  // ─── Automated Challenge Detection ─────────────────────────────────────────
  const autoStatus = useMemo(() => {
    // 1. no-zomato-7
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const foodAppRegex = /zomato|swiggy|blinkit|zepto|instamart|eatclub|domino/i;
    const foodOrders = expenses.filter(
      (e) => e.ts >= sevenDaysAgo.getTime() && (foodAppRegex.test(e.title) || (e.note && foodAppRegex.test(e.note))),
    );
    const daysWithFoodOrder = new Set(foodOrders.map((e) => dayKey(new Date(e.ts))));
    const zomatoCleanDays = Math.max(0, 7 - daysWithFoodOrder.size);
    const zomatoPassed = zomatoCleanDays >= 7;

    // 2. weekend-under-300
    const d = now.getDay();
    const daysSinceSat = (d + 1) % 7;
    const sat = new Date(now);
    sat.setDate(sat.getDate() - daysSinceSat);
    sat.setHours(0, 0, 0, 0);
    const sun = new Date(sat);
    sun.setDate(sun.getDate() + 1);
    sun.setHours(23, 59, 59, 999);
    const weekendExpenses = expenses.filter((e) => e.ts >= sat.getTime() && e.ts <= sun.getTime());
    const weekendSpend = weekendExpenses.reduce((s, e) => s + e.amount, 0);
    const weekendPassed = weekendSpend <= 300;

    // 3. 5-no-spend-days
    const period = getPeriod(now, settings?.monthStartDay ?? 1);
    const monthNoSpend = (settings?.noSpendDays ?? []).filter((dk) => {
      const [y, m, day] = dk.split("-").map(Number);
      const date = new Date(y, m - 1, day);
      return date >= period.start && date < period.nextStart;
    }).length;
    const fiveNoSpendPassed = monthNoSpend >= 5;

    // 4. no-wants-3
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(0, 0, 0, 0);
    const wantExpenses = expenses.filter((e) => e.ts >= threeDaysAgo.getTime() && e.tag === "want");
    const daysWithWants = new Set(wantExpenses.map((e) => dayKey(new Date(e.ts))));
    const wantsCleanDays = Math.max(0, 3 - daysWithWants.size);
    const wantsPassed = wantsCleanDays >= 3;

    // 5. under-daily-5
    const dayMap = buildDayMap(expenses, settings?.noSpendDays ?? []);
    const underStreak = settings ? underLimitStreak(dayMap, settings, now) : 0;
    const underDailyPassed = underStreak >= 5;

    return {
      "no-zomato-7": {
        passed: zomatoPassed,
        progress: `${zomatoCleanDays}/7 days clean`,
        pct: Math.round((zomatoCleanDays / 7) * 100),
      },
      "weekend-under-300": {
        passed: weekendPassed,
        progress: `${rupee(weekendSpend)} / ₹300 spent`,
        pct: Math.min(100, Math.round((weekendSpend / 300) * 100)),
        isGood: weekendSpend <= 300,
      },
      "5-no-spend-days": {
        passed: fiveNoSpendPassed,
        progress: `${monthNoSpend}/5 no-spend days`,
        pct: Math.round((Math.min(monthNoSpend, 5) / 5) * 100),
      },
      "no-wants-3": {
        passed: wantsPassed,
        progress: `${wantsCleanDays}/3 days clean`,
        pct: Math.round((wantsCleanDays / 3) * 100),
      },
      "under-daily-5": {
        passed: underDailyPassed,
        progress: `${Math.min(underStreak, 5)}/5 days under limit`,
        pct: Math.round((Math.min(underStreak, 5) / 5) * 100),
      },
    } as Record<string, { passed: boolean; progress: string; pct: number; isGood?: boolean }>;
  }, [expenses, now, settings]);

  async function completeChallenge(id: string) {
    if (!settings || completed.has(id)) return;
    setCompleting(id);
    const newCompleted = [...(settings.completedChallenges ?? []), id];
    await db.settings.update("me", { completedChallenges: newCompleted });
    await celebrate();
    setCompleting(null);
  }

  async function uncompleteChallenge(id: string) {
    if (!settings) return;
    const newCompleted = (settings.completedChallenges ?? []).filter((c) => c !== id);
    await db.settings.update("me", { completedChallenges: newCompleted });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-[var(--bg)] p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              🏆 Mini Savings Challenges
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {completed.size}/{CHALLENGES.length} challenges claimed · auto-evaluated
            </p>
          </div>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--bg-soft)]">
            <X size={16} />
          </button>
        </div>

        <ul className="space-y-3">
          {CHALLENGES.map((ch) => {
            const isSaved = completed.has(ch.id);
            const auto = autoStatus[ch.id];
            const isAutoCompleted = !!auto?.passed;
            const done = isSaved || isAutoCompleted;

            return (
              <li
                key={ch.id}
                className={`rounded-2xl border p-4 transition-all ${
                  isSaved
                    ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]"
                    : isAutoCompleted
                      ? "border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20"
                      : "border-[var(--line)] bg-[var(--bg-soft)]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-3xl shrink-0">{ch.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm">{ch.name}</h3>
                      {isSaved ? (
                        <span className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1">
                          <Award size={12} /> Claimed!
                        </span>
                      ) : isAutoCompleted ? (
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full">
                          <Sparkles size={11} /> Auto-Detected!
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--muted)] mt-0.5">{ch.description}</p>

                    {/* Progress Bar & Status */}
                    {auto && (
                      <div className="mt-2.5">
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="font-semibold text-[var(--ink)]">
                            {isAutoCompleted ? "Goal achieved!" : auto.progress}
                          </span>
                          <span className="text-[var(--muted)] num">{auto.pct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--bg)] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isAutoCompleted ? "bg-emerald-500" : "bg-[var(--accent)]"
                            }`}
                            style={{ width: `${auto.pct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                        {ch.days === 2 ? "Weekend" : ch.days === 30 ? "Monthly" : `${ch.days} days`}
                      </span>

                      {!isSaved ? (
                        <button
                          onClick={() => completeChallenge(ch.id)}
                          disabled={completing === ch.id}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition active:scale-95 disabled:opacity-50 ${
                            isAutoCompleted
                              ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-soft"
                              : "bg-[var(--accent)] text-white dark:text-[var(--bg)] hover:opacity-90"
                          }`}
                        >
                          {completing === ch.id
                            ? "🎉 Claiming…"
                            : isAutoCompleted
                              ? "Claim Badge 🎉"
                              : "Mark Complete"}
                        </button>
                      ) : (
                        <button
                          onClick={() => uncompleteChallenge(ch.id)}
                          className="rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--bad)] transition"
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 rounded-2xl bg-[var(--bg-soft)] p-3 text-xs text-[var(--muted)] flex items-start gap-2">
          <Sparkles size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            <b>Live Auto-Detection:</b> Progress is calculated automatically from your expenses and daily check-ins. When you finish a challenge, tap <b>Claim Badge</b> to add it to your collection!
          </span>
        </div>
      </div>
    </div>
  );
}
