import { addDays, format, startOfWeek } from "date-fns";
import { categoryTotals, inRange, sum, tagTotals } from "./budget";
import { dayKey, rupee } from "./format";
import { buildDayMap, evenLimitForDay } from "./streaks";
import type { Category, Expense, Settings, WeeklyReport } from "./types";

export function lastWeekStart(now: Date): Date {
  return addDays(startOfWeek(now, { weekStartsOn: 1 }), -7);
}

export interface WeekMetrics {
  weekStart: Date;
  total: number;
  prevTotal: number;
  limit: number;
  daysLogged: number;
  daysUnder: number;
  waste: number;
  wasteShare: number;
  topCategory?: { name: string; amount: number };
  biggest?: Expense;
  count: number;
  score: number;
  grade: string;
}

export function weekMetrics(
  expenses: Expense[],
  settings: Settings,
  categories: Category[],
  weekStart: Date,
): WeekMetrics {
  const end = addDays(weekStart, 7);
  const we = expenses.filter((e) => inRange(e.ts, weekStart, end));
  const prev = expenses.filter((e) => inRange(e.ts, addDays(weekStart, -7), weekStart));
  const days = buildDayMap(expenses, settings.noSpendDays);
  let daysLogged = 0;
  let daysUnder = 0;
  let limit = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const lim = evenLimitForDay(settings, d);
    limit += lim;
    const info = days.get(dayKey(d));
    if (info?.active) {
      daysLogged++;
      if (info.total <= lim) daysUnder++;
    }
  }
  const total = sum(we, (e) => e.amount);
  const waste = tagTotals(we).waste;
  const wasteShare = total > 0 ? waste / total : 0;
  const cats = [...categoryTotals(we).entries()].sort((a, b) => b[1] - a[1]);
  const catName = new Map(categories.map((c) => [c.id, `${c.emoji} ${c.name}`]));
  const biggest = [...we].sort((a, b) => b.amount - a.amount)[0];

  const overshoot = limit > 0 ? Math.max(0, total / limit - 1) : 0;
  const score =
    (daysUnder / 7) * 40 + (daysLogged / 7) * 25 + (1 - wasteShare) * 20 + Math.max(0, 15 - overshoot * 60);
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : score >= 50 ? "D" : "F";

  return {
    weekStart,
    total,
    prevTotal: sum(prev, (e) => e.amount),
    limit,
    daysLogged,
    daysUnder,
    waste,
    wasteShare,
    topCategory: cats[0] ? { name: catName.get(cats[0][0]) ?? cats[0][0], amount: cats[0][1] } : undefined,
    biggest,
    count: we.length,
    score,
    grade,
  };
}

export function metricsSummary(m: WeekMetrics, { trimmed = false } = {}): string {
  return [
    `Week of ${format(m.weekStart, "d MMM")} – ${format(addDays(m.weekStart, 6), "d MMM yyyy")}`,
    `Total spent: ${rupee(m.total)} (week before: ${rupee(m.prevTotal)}). Even-split weekly limit: ${rupee(m.limit)}.`,
    `Days logged: ${m.daysLogged}/7. Days within daily limit: ${m.daysUnder}/7. Expenses logged: ${m.count}.`,
    `Waste-tagged: ${rupee(m.waste)} (${Math.round(m.wasteShare * 100)}% of spend).`,
    m.topCategory ? `Top category: ${m.topCategory.name} ${rupee(m.topCategory.amount)}.` : "",
    m.biggest ? `Biggest single expense: ${trimmed ? "" : `${m.biggest.title} `}${rupee(m.biggest.amount)}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Used when the AI is offline. */
export function localReport(m: WeekMetrics): WeeklyReport {
  const wins: string[] = [];
  if (m.daysLogged >= 6) wins.push(`Logged ${m.daysLogged} of 7 days – great consistency`);
  if (m.daysUnder >= 4) wins.push(`${m.daysUnder} days inside your daily limit`);
  if (m.total < m.prevTotal) wins.push(`Spent ${rupee(m.prevTotal - m.total)} less than the week before`);
  if (m.wasteShare < 0.05) wins.push("Almost zero waste spending");
  if (!wins.length) wins.push("You kept tracking – that's the first step");
  const tip =
    m.wasteShare > 0.15
      ? `Waste was ${Math.round(m.wasteShare * 100)}% of spending – try a 24h cool-off before late-night orders.`
      : m.total > m.limit
        ? `You went ${rupee(m.total - m.limit)} over the weekly limit – plan one no-spend day next week.`
        : m.topCategory
          ? `${m.topCategory.name} was your biggest category – look for one cheaper swap there.`
          : "Log every expense next week so the numbers tell the full story.";
  return {
    weekStart: dayKey(m.weekStart),
    grade: m.grade,
    headline: m.score >= 80 ? "Solid week, money master!" : m.score >= 60 ? "Decent week – room to level up" : "Tough week – next one's a fresh sample",
    wins,
    tip,
    funLine: "Remember: one bad week is just an outlier, not the trend 📈",
    createdAt: Date.now(),
    byAI: false,
  };
}
