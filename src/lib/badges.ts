import { budgetFor, getPeriod, inRange, sum } from "./budget";
import { buildDayMap, loggingStreak, noJunkWeek, underLimitStreak } from "./streaks";
import type { Expense, Goal, GoalContribution, IOU, Settings, WishItem } from "./types";

export interface BadgeDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

export const BADGES: BadgeDef[] = [
  { id: "first-log", name: "First Log", emoji: "🐣", description: "Logged your very first expense" },
  { id: "streak-3", name: "Warming Up", emoji: "🔥", description: "3-day logging streak" },
  { id: "streak-7", name: "Habit Builder", emoji: "📆", description: "7-day logging streak" },
  { id: "streak-30", name: "Unstoppable", emoji: "🚀", description: "30-day logging streak" },
  { id: "saver-7", name: "7-Day Saver", emoji: "🐷", description: "Stayed under your daily limit 7 days in a row" },
  { id: "no-junk", name: "No-Junk Week", emoji: "🥦", description: "A full week without a single 'waste' expense" },
  { id: "zero-day", name: "Zero Hero", emoji: "0️⃣", description: "Marked a no-spend day" },
  { id: "goal-getter", name: "Goal Getter", emoji: "🎯", description: "Completed a savings goal" },
  { id: "budget-ninja", name: "Budget Ninja", emoji: "🥷", description: "Finished a whole month under budget" },
  { id: "stats-nerd", name: "Stats Nerd", emoji: "🤓", description: "Opened the Stats Lab 5 times" },
  { id: "curious", name: "Curious Mind", emoji: "🦉", description: "Asked Sinchan 10 questions" },
  { id: "fair-square", name: "Fair & Square", emoji: "🤝", description: "Settled 5 IOUs" },
  { id: "impulse-slayer", name: "Impulse Slayer", emoji: "🗡️", description: "Skipped an item after the 24h cool-off" },
  { id: "centurion", name: "Centurion", emoji: "💯", description: "Logged 100 expenses" },
];

export interface BadgeContext {
  settings: Settings;
  expenses: Expense[];
  goals: Goal[];
  contributions: GoalContribution[];
  ious: IOU[];
  wishlist: WishItem[];
  now: Date;
}

/** Ids of badges whose conditions are met right now. */
export function earnedBadges(ctx: BadgeContext): string[] {
  const { settings, expenses, goals, ious, wishlist, contributions, now } = ctx;
  const days = buildDayMap(expenses, settings.noSpendDays);
  const streak = loggingStreak(days, now);
  const out: string[] = [];
  if (expenses.length >= 1) out.push("first-log");
  if (streak >= 3) out.push("streak-3");
  if (streak >= 7) out.push("streak-7");
  if (streak >= 30) out.push("streak-30");
  if (underLimitStreak(days, settings, now) >= 7) out.push("saver-7");
  if (noJunkWeek(days, now)) out.push("no-junk");
  if (settings.noSpendDays.length > 0) out.push("zero-day");
  if (goals.some((g) => g.completedAt)) out.push("goal-getter");
  if (ninja(settings, expenses, contributions, now)) out.push("budget-ninja");
  if (settings.statsVisits >= 5) out.push("stats-nerd");
  if (settings.guruQuestions >= 10) out.push("curious");
  if (ious.filter((i) => i.settled).length >= 5) out.push("fair-square");
  if (wishlist.some((w) => w.status === "skipped")) out.push("impulse-slayer");
  if (expenses.length >= 100) out.push("centurion");
  return out;
}

function ninja(settings: Settings, expenses: Expense[], contributions: GoalContribution[], now: Date): boolean {
  for (let off = -1; off >= -12; off--) {
    const p = getPeriod(now, settings.monthStartDay, off);
    if (p.nextStart.getTime() < settings.createdAt) break;
    const pe = expenses.filter((e) => inRange(e.ts, p.start, p.nextStart));
    if (pe.length < 10) continue;
    const spent = sum(pe, (e) => e.amount) + sum(contributions.filter((c) => inRange(c.ts, p.start, p.nextStart)), (c) => c.amount);
    if (spent <= budgetFor(settings, p.key)) return true;
  }
  return false;
}
