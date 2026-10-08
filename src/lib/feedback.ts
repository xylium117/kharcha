import { differenceInCalendarDays } from "date-fns";
import { db } from "./db";
import { dayKey } from "./format";

/** Google Form (or any link) for friends' feedback. Set NEXT_PUBLIC_FEEDBACK_URL; features hide when unset. */
export const FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_URL || "";

/** 1 in the first week after setting up the app, 2 in the second, … */
export function weekNumber(createdAt: number, now: Date): number {
  return Math.floor(Math.max(0, differenceInCalendarDays(now, createdAt)) / 7) + 1;
}

/**
 * Anonymous usage counts a tester can paste into the feedback form.
 * Counts only: no amounts, items, places, names or notes.
 */
export async function usageSummary(now = new Date()): Promise<string> {
  const [settings, expenses, goals, ious, income, wishlist, badges, recurring] = await Promise.all([
    db.settings.get("me"),
    db.expenses.toArray(),
    db.goals.toArray(),
    db.ious.toArray(),
    db.income.toArray(),
    db.wishlist.toArray(),
    db.badges.count(),
    db.recurring.toArray(),
  ]);
  if (!settings) return "Kharcha usage: not set up yet.";
  const daysUsing = Math.max(1, differenceInCalendarDays(now, settings.createdAt) + 1);
  const daysLogged = new Set([...expenses.map((e) => dayKey(e.ts)), ...settings.noSpendDays]).size;
  const by = (s: string) => expenses.filter((e) => e.source === s).length;
  const standalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  return [
    `Kharcha usage – week ${weekNumber(settings.createdAt, now)}`,
    `Days since start: ${daysUsing} · days with something logged: ${daysLogged} (${Math.round((daysLogged / daysUsing) * 100)}%)`,
    `Expenses logged: ${expenses.length} (quick ${by("quick")}, form ${by("form")}, just-type ${by("ai")}, recurring ${by("recurring")}, split ${by("split")})`,
    `Questions to Sinchan: ${settings.guruQuestions ?? 0} · Stats Lab visits: ${settings.statsVisits ?? 0} · badges: ${badges}`,
    `Goals: ${goals.length} · IOUs: ${ious.length} · money-in entries: ${income.length} · wishlist items: ${wishlist.length} · recurring: ${recurring.length}`,
    `Backed up: ${settings.lastBackupAt ? "yes" : "no"} · installed as app: ${standalone ? "yes" : "no"}`,
  ].join("\n");
}

/** Copies the usage summary to the clipboard; false when the browser doesn't allow it. */
export async function copyUsage(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await usageSummary());
    return true;
  } catch {
    return false;
  }
}
