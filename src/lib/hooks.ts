"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { computeBudget, type BudgetSummary } from "./budget";
import { db } from "./db";
import { DEFAULT_CATEGORIES } from "./defaults";
import type {
  Category,
  Expense,
  Goal,
  GoalContribution,
  Income,
  IOU,
  Recurring,
  Settings,
  WishItem,
} from "./types";

/** undefined while loading, null when the app hasn't been set up. */
export function useSettings(): Settings | null | undefined {
  return useLiveQuery(async () => (await db.settings.get("me")) ?? null, []);
}

const DEFAULT_ORDER = new Map(DEFAULT_CATEGORIES.map((c, i) => [c.id, i]));

/** Built-in categories in their natural order (Food first), custom ones after. */
export function useCategories(): Category[] {
  const cats = useLiveQuery(() => db.categories.toArray(), []);
  return useMemo(
    () => [...(cats ?? [])].sort((a, b) => (DEFAULT_ORDER.get(a.id) ?? 99) - (DEFAULT_ORDER.get(b.id) ?? 99)),
    [cats],
  );
}

export function useCategoryMap(): Map<string, Category> {
  const cats = useCategories();
  return useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
}

export function useExpenses(): Expense[] | undefined {
  return useLiveQuery(() => db.expenses.orderBy("ts").reverse().toArray(), []);
}

export function useRecurring(): Recurring[] {
  return useLiveQuery(() => db.recurring.toArray(), []) ?? [];
}

export function useGoals(): Goal[] {
  return useLiveQuery(() => db.goals.toArray(), []) ?? [];
}

export function useContributions(): GoalContribution[] {
  return useLiveQuery(() => db.goalContributions.toArray(), []) ?? [];
}

export function useIOUs(): IOU[] {
  return useLiveQuery(() => db.ious.orderBy("ts").reverse().toArray(), []) ?? [];
}

export function useWishlist(): WishItem[] {
  return useLiveQuery(() => db.wishlist.toArray(), []) ?? [];
}

export function useIncome(): Income[] {
  return useLiveQuery(() => db.income.orderBy("ts").reverse().toArray(), []) ?? [];
}

/** Current time, refreshed every minute so day boundaries roll over. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function useBudget(): BudgetSummary | undefined {
  const settings = useSettings();
  const expenses = useExpenses();
  const recurring = useRecurring();
  const goals = useGoals();
  const contributions = useContributions();
  const income = useIncome();
  const ious = useIOUs();
  const now = useNow();
  return useMemo(() => {
    if (!settings || !expenses) return undefined;
    return computeBudget({ settings, expenses, recurring, goals, contributions, income, ious, now });
  }, [settings, expenses, recurring, goals, contributions, income, ious, now]);
}
