import { addDays, startOfDay } from "date-fns";
import { budgetFor, getPeriod } from "./budget";
import { dayKey } from "./format";
import type { Expense, Settings } from "./types";

export interface DayInfo {
  total: number;
  active: boolean;
  hasWaste: boolean;
}

export function buildDayMap(expenses: Expense[], noSpendDays: string[]): Map<string, DayInfo> {
  const m = new Map<string, DayInfo>();
  for (const e of expenses) {
    const k = dayKey(e.ts);
    const d = m.get(k) ?? { total: 0, active: true, hasWaste: false };
    d.total += e.amount;
    if (e.tag === "waste") d.hasWaste = true;
    m.set(k, d);
  }
  for (const k of noSpendDays) if (!m.has(k)) m.set(k, { total: 0, active: true, hasWaste: false });
  return m;
}

/** Consecutive days with something logged (an expense or a "no-spend day"). Today counts if logged; a not-yet-logged today doesn't break it. */
export function loggingStreak(days: Map<string, DayInfo>, now: Date): number {
  let d = startOfDay(now);
  if (!days.get(dayKey(d))?.active) d = addDays(d, -1);
  let n = 0;
  while (days.get(dayKey(d))?.active) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function evenLimitForDay(settings: Settings, day: Date): number {
  const p = getPeriod(day, settings.monthStartDay);
  return budgetFor(settings, p.key) / p.daysInPeriod;
}

/** Consecutive logged days where spending stayed within the even daily limit (budget ÷ days in period). */
export function underLimitStreak(days: Map<string, DayInfo>, settings: Settings, now: Date): number {
  const ok = (d: Date) => {
    const info = days.get(dayKey(d));
    return !!info?.active && info.total <= evenLimitForDay(settings, d);
  };
  let d = startOfDay(now);
  if (!ok(d)) d = addDays(d, -1);
  let n = 0;
  while (ok(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** True if each of the 7 days before today was logged and had no "waste" expense. */
export function noJunkWeek(days: Map<string, DayInfo>, now: Date): boolean {
  for (let i = 1; i <= 7; i++) {
    const info = days.get(dayKey(addDays(startOfDay(now), -i)));
    if (!info?.active || info.hasWaste) return false;
  }
  return true;
}
