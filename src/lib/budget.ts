import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  startOfDay,
} from "date-fns";
import { dayKey, parseDayKey } from "./format";
import type { Expense, Goal, GoalContribution, Income, IOU, Recurring, Settings } from "./types";

export interface Period {
  start: Date;
  /** Exclusive end: the start of the next period. */
  nextStart: Date;
  key: string;
  daysInPeriod: number;
  /** Days left including today. */
  daysLeft: number;
  /** 1-based index of today inside the period. */
  dayIndex: number;
}

export function getPeriod(now: Date, startDay: number, offset = 0): Period {
  const sd = Math.min(Math.max(1, startDay), 28);
  const today = startOfDay(now);
  let start =
    today.getDate() >= sd
      ? new Date(today.getFullYear(), today.getMonth(), sd)
      : new Date(today.getFullYear(), today.getMonth() - 1, sd);
  if (offset) start = addMonths(start, offset);
  const nextStart = addMonths(start, 1);
  const daysInPeriod = differenceInCalendarDays(nextStart, start);
  const inPeriod = today >= start && today < nextStart;
  const daysLeft = inPeriod ? differenceInCalendarDays(nextStart, today) : today < start ? daysInPeriod : 0;
  const dayIndex = inPeriod ? differenceInCalendarDays(today, start) + 1 : today < start ? 0 : daysInPeriod;
  return {
    start,
    nextStart,
    key: dayKey(start).slice(0, 7),
    daysInPeriod,
    daysLeft,
    dayIndex,
  };
}

export function budgetFor(settings: Settings, periodKey: string): number {
  return settings.budgetOverrides?.[periodKey] ?? settings.monthlyBudget;
}

export function inRange(ts: number, start: Date, endExclusive: Date): boolean {
  return ts >= start.getTime() && ts < endExclusive.getTime();
}

export function sum<T>(items: T[], f: (t: T) => number): number {
  let s = 0;
  for (const it of items) s += f(it);
  return s;
}

export function stepRecurring(date: Date, frequency: Recurring["frequency"]): Date {
  return frequency === "weekly" ? addWeeks(date, 1) : addMonths(date, 1);
}

/** Recurring charges that will land after today but before the period ends. */
export function upcomingRecurring(recurring: Recurring[], today: Date, nextStart: Date): number {
  const t = startOfDay(today);
  let total = 0;
  for (const r of recurring) {
    if (!r.active) continue;
    let d = parseDayKey(r.nextDate);
    let guard = 0;
    while (d < nextStart && guard++ < 60) {
      if (d > t) total += r.amount;
      d = stepRecurring(d, r.frequency);
    }
  }
  return total;
}

export function goalSaved(goalId: string, contributions: GoalContribution[]): number {
  return sum(
    contributions.filter((c) => c.goalId === goalId),
    (c) => c.amount,
  );
}

/** Rupees per day needed to hit a goal by its deadline. */
export function goalPerDay(goal: Goal, saved: number, today: Date): number {
  const remaining = goal.target - saved;
  if (remaining <= 0) return 0;
  const days = Math.max(1, differenceInCalendarDays(parseDayKey(goal.deadline), startOfDay(today)) + 1);
  return remaining / days;
}

/** Money to keep aside for goals during the rest of this period. */
export function goalReserve(
  goals: Goal[],
  contributions: GoalContribution[],
  today: Date,
  daysLeft: number,
): number {
  let reserve = 0;
  for (const g of goals) {
    if (g.completedAt) continue;
    const saved = goalSaved(g.id, contributions);
    const remaining = g.target - saved;
    if (remaining <= 0) continue;
    reserve += Math.min(remaining, goalPerDay(g, saved, today) * daysLeft);
  }
  return reserve;
}

export type Health = "great" | "ok" | "tight" | "over";

export interface BudgetSummary {
  period: Period;
  budget: number;
  spent: number;
  spentToday: number;
  spentBeforeToday: number;
  savedThisPeriod: number;
  /** Gifts, refunds and IOU repayments received this period. */
  incomeThisPeriod: number;
  /** Money paid for friends this period that they still owe ("they owe me" IOUs created now). */
  lentThisPeriod: number;
  upcomingRecurring: number;
  goalReserve: number;
  /** budget + income − spent before today − lent − saved − upcoming bills − goal reserve. */
  pool: number;
  /** Fair share per day for the rest of the period, fixed for the whole day. */
  dailyAllowance: number;
  /** dailyAllowance minus what was already spent today. Negative = overspent today. */
  safeToday: number;
  /** budget + income − spent − lent − saved: cash still in the wallet. */
  remaining: number;
  /** Simple pace projection of total spend at period end. */
  projectedEnd: number;
  /** budget / days in period – the "even split" limit. */
  evenDailyLimit: number;
  health: Health;
}

export interface BudgetInput {
  settings: Settings;
  expenses: Expense[];
  recurring: Recurring[];
  goals: Goal[];
  contributions: GoalContribution[];
  income?: Income[];
  ious?: IOU[];
  now: Date;
}

/**
 * Cash-flow view of friends: paying for a friend ("they owe me") takes money out of the period the IOU
 * was created in; their repayment arrives as income when the IOU is settled. "I owe" IOUs don't touch
 * the pool – my share was already logged as an expense.
 */
export function lentIn(ious: IOU[], start: Date, endExclusive: Date): number {
  return sum(
    ious.filter((i) => i.direction === "theyOwe" && inRange(i.ts, start, endExclusive)),
    (i) => i.amount,
  );
}

export function incomeIn(income: Income[], start: Date, endExclusive: Date): number {
  return sum(
    income.filter((i) => inRange(i.ts, start, endExclusive)),
    (i) => i.amount,
  );
}

export function computeBudget({
  settings,
  expenses,
  recurring,
  goals,
  contributions,
  income = [],
  ious = [],
  now,
}: BudgetInput): BudgetSummary {
  const period = getPeriod(now, settings.monthStartDay);
  const budget = budgetFor(settings, period.key);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  const periodExpenses = expenses.filter((e) => inRange(e.ts, period.start, period.nextStart));
  const spent = sum(periodExpenses, (e) => e.amount);
  const spentToday = sum(
    periodExpenses.filter((e) => inRange(e.ts, today, tomorrow)),
    (e) => e.amount,
  );
  const spentBeforeToday = sum(
    periodExpenses.filter((e) => e.ts < today.getTime()),
    (e) => e.amount,
  );
  const savedThisPeriod = sum(
    contributions.filter((c) => inRange(c.ts, period.start, period.nextStart)),
    (c) => c.amount,
  );
  const incomeThisPeriod = incomeIn(income, period.start, period.nextStart);
  const lentThisPeriod = lentIn(ious, period.start, period.nextStart);
  const upcoming = upcomingRecurring(recurring, today, period.nextStart);
  const daysLeft = Math.max(1, period.daysLeft);
  const reserve = goalReserve(goals, contributions, today, daysLeft);

  const available = budget + incomeThisPeriod - lentThisPeriod;
  const pool = available - spentBeforeToday - savedThisPeriod - upcoming - reserve;
  const dailyAllowance = Math.max(0, pool) / daysLeft;
  const safeToday = dailyAllowance - spentToday;
  const remaining = available - spent - savedThisPeriod;
  const elapsed = Math.max(1, period.dayIndex);
  const projectedEnd = (spent / elapsed) * period.daysInPeriod;
  const evenDailyLimit = budget / period.daysInPeriod;

  let health: Health;
  if (remaining < 0 || pool - spentToday < 0) health = "over";
  else if (safeToday < 0 || projectedEnd > available) health = "tight";
  else if (projectedEnd > available * 0.85) health = "ok";
  else health = "great";

  return {
    period,
    budget,
    spent,
    spentToday,
    spentBeforeToday,
    savedThisPeriod,
    incomeThisPeriod,
    lentThisPeriod,
    upcomingRecurring: upcoming,
    goalReserve: reserve,
    pool,
    dailyAllowance,
    safeToday,
    remaining,
    projectedEnd,
    evenDailyLimit,
    health,
  };
}

/** Totals per calendar day between start (inclusive) and endExclusive. Zero days included. */
export function dailyTotals(
  expenses: Expense[],
  start: Date,
  endExclusive: Date,
): { day: string; date: Date; total: number }[] {
  const map = new Map<string, number>();
  for (const e of expenses) {
    if (!inRange(e.ts, start, endExclusive)) continue;
    const k = dayKey(e.ts);
    map.set(k, (map.get(k) ?? 0) + e.amount);
  }
  const out: { day: string; date: Date; total: number }[] = [];
  for (let d = startOfDay(start); d < endExclusive; d = addDays(d, 1)) {
    const k = dayKey(d);
    out.push({ day: k, date: d, total: map.get(k) ?? 0 });
  }
  return out;
}

export function categoryTotals(expenses: Expense[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of expenses) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.amount);
  return m;
}

export function tagTotals(expenses: Expense[]): Record<"need" | "want" | "waste", number> {
  const t = { need: 0, want: 0, waste: 0 };
  for (const e of expenses) t[e.tag] += e.amount;
  return t;
}
