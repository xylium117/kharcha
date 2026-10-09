"use client";

import { addDays, format, startOfDay } from "date-fns";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Compass,
  HelpCircle,
  Lightbulb,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoxPlot,
  ForecastChart,
  Histogram,
  Legend,
  Swatch,
  type ForecastDatum,
} from "@/components/charts";
import {
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  Segmented,
  StatTile,
  cn,
} from "@/components/ui";
import {
  budgetFor,
  dailyTotals,
  getPeriod,
  inRange,
  sum,
  upcomingRecurring,
} from "@/lib/budget";
import { db } from "@/lib/db";
import { rupee } from "@/lib/format";
import { useExpenses, useNow, useRecurring, useSettings } from "@/lib/hooks";
import {
  describe,
  explainFormalP,
  forecastPeriod,
  histogram,
  normalCdf,
  tukeyFences,
  welchTTest,
  zOutliers,
} from "@/lib/stats";
import { buildDayMap } from "@/lib/streaks";

const WINDOWS = { "30": 30, "90": 90, all: 3650 } as const;
type Win = keyof typeof WINDOWS;

const SLOTS = [
  { label: "Morning", hint: "5–11 AM", test: (h: number) => h >= 5 && h < 11 },
  { label: "Lunch", hint: "11 AM–3 PM", test: (h: number) => h >= 11 && h < 15 },
  { label: "Afternoon", hint: "3–7 PM", test: (h: number) => h >= 15 && h < 19 },
  { label: "Evening", hint: "7–11 PM", test: (h: number) => h >= 19 && h < 23 },
  { label: "Late Night", hint: "11 PM–5 AM", test: (h: number) => h >= 23 || h < 5 },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function StatsPage() {
  const settings = useSettings();
  const expenses = useExpenses();
  const recurring = useRecurring();
  const now = useNow();
  const [win, setWin] = useState<Win>("30");

  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || !settings) return;
    counted.current = true;
    db.settings.update("me", { statsVisits: (settings.statsVisits ?? 0) + 1 });
  }, [settings]);

  const s = useMemo(() => {
    if (!settings || !expenses?.length) return null;
    const today = startOfDay(now);
    const first = startOfDay(Math.min(...expenses.map((e) => e.ts)));
    const winStart = addDays(today, -WINDOWS[win]);
    const start = first > winStart ? first : winStart;
    const dayInfo = buildDayMap(expenses, settings.noSpendDays);

    const days = dailyTotals(expenses, start, today).filter(
      (d) => dayInfo.get(d.day)?.active,
    );
    const values = days.map((d) => d.total);
    const desc = describe(values);
    if (!desc) return null;

    const fences = tukeyFences(desc);
    const outliers = zOutliers(days, (d) => d.total, 2)
      .slice(0, 8)
      .map((o) => {
        const dayEnd = addDays(o.item.date, 1);
        const top = expenses
          .filter((e) => inRange(e.ts, o.item.date, dayEnd))
          .sort((a, b) => b.amount - a.amount)[0];
        return { ...o, top };
      });

    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const weekend = days.filter((d) => isWeekend(d.date)).map((d) => d.total);
    const weekday = days.filter((d) => !isWeekend(d.date)).map((d) => d.total);
    const welch = welchTTest(weekend, weekday);

    const winExpenses = expenses.filter(
      (e) => e.ts >= start.getTime() && e.ts < today.getTime(),
    );
    const grid = WEEKDAYS.map(() => SLOTS.map(() => 0));
    for (const e of winExpenses) {
      const d = new Date(e.ts);
      const wd = (d.getDay() + 6) % 7;
      const slot = SLOTS.findIndex((sl) => sl.test(d.getHours()));
      if (slot >= 0) grid[wd][slot] += e.amount;
    }
    const gridMax = Math.max(1, ...grid.flat());
    const rowTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
    const colTotals = SLOTS.map((_, colIdx) =>
      grid.reduce((acc, row) => acc + row[colIdx], 0),
    );
    const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

    const p = getPeriod(now, settings.monthStartDay);
    const budget = budgetFor(settings, p.key);
    const discretionary = expenses.filter((e) => !e.recurringId);
    const periodDays = dailyTotals(discretionary, p.start, today)
      .filter((d) => dayInfo.get(d.day)?.active)
      .map((d) => d.total);
    const history = dailyTotals(discretionary, addDays(p.start, -30), p.start)
      .filter((d) => dayInfo.get(d.day)?.active)
      .map((d) => d.total);
    const spentSoFar = sum(
      expenses.filter((e) => inRange(e.ts, p.start, addDays(today, 1))),
      (e) => e.amount,
    );
    const remainingDays = p.daysLeft - 1;
    const fc = forecastPeriod(
      periodDays,
      spentSoFar,
      remainingDays,
      history,
      upcomingRecurring(recurring, today, p.nextStart),
    );
    let fcData: ForecastDatum[] = [];
    let pWithin: number | null = null;
    if (fc) {
      const all = dailyTotals(expenses, p.start, addDays(today, 1));
      let cum = 0;
      fcData = all.map((d) => {
        cum += d.total;
        return {
          label: format(d.date, "d"),
          full: format(d.date, "EEE d MMM"),
          actual: cum,
        };
      });
      fcData[fcData.length - 1] = {
        ...fcData[fcData.length - 1],
        projected: cum,
        band: [cum, cum],
      };
      for (let j = 1; j <= remainingDays; j++) {
        const d = addDays(today, j);
        const at = fc.at(j);
        fcData.push({
          label: format(d, "d"),
          full: format(d, "EEE d MMM"),
          projected: at.expected,
          band: [at.lower, at.upper],
        });
      }
      pWithin =
        fc.se > 0
          ? normalCdf((budget - fc.expected) / fc.se)
          : fc.expected <= budget
            ? 1
            : 0;
    }

    return {
      desc,
      fences,
      outliers,
      days,
      values,
      welch,
      weekend,
      weekday,
      grid,
      gridMax,
      rowTotals,
      colTotals,
      grandTotal,
      fc,
      fcData,
      budget,
      spentSoFar,
      pWithin,
      start,
      today,
    };
  }, [settings, expenses, recurring, now, win]);

  if (!settings || !expenses) return null;

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-tr from-[#7c5cff] to-[#a891ff] text-white shadow-soft">
              <BarChart3 size={22} strokeWidth={2.4} />
            </div>
            <div>
              <div className="text-xl font-extrabold tracking-tight sm:text-2xl text-ink">
                Stats Lab
              </div>
              <div className="text-xs font-semibold text-muted">
                Your spending, visualised.
              </div>
            </div>
          </div>
        }
        subtitle=""
        action={
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-semibold text-muted sm:inline">
              Timeframe:
            </span>
            <Segmented
              value={win}
              onChange={setWin}
              size="sm"
              options={[
                { value: "30", label: "30d" },
                { value: "90", label: "90d" },
                { value: "all", label: "All" },
              ]}
            />
          </div>
        }
      />

      {!s || s.desc.n < 5 ? (
        <Card className="border-line bg-card p-8 text-center shadow-soft">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-bg-soft text-muted">
            <BarChart3 size={24} />
          </div>
          <h3 className="text-base font-bold text-ink">
            Need at least 5 logged days
          </h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
            The stats hub needs at least 5 days of expense logs to detect your typical spending
            patterns and calculate reliable benchmarks.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-xs text-muted shadow-soft">
            <div className="flex items-center gap-2">
              <span className="inline-block size-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span>
                Analyzing{" "}
                <strong className="text-ink font-bold">{s.desc.n} logged days</strong>{" "}
                ({format(s.start, "d MMM yyyy")} to {format(addDays(s.today, -1), "d MMM yyyy")})
              </span>
            </div>
            <div className="text-xs text-muted">
              Today is excluded from historical benchmarks so uncompleted hours don't skew your averages.
            </div>
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-ink flex items-center gap-2">
                  <Activity size={18} className="text-[#7c5cff]" />
                  Your Daily Spending Profile
                </h2>
                <p className="text-xs text-muted">
                  The fundamental numbers that define your regular spending rhythm.
                </p>
              </div>
              <span className="rounded-lg bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">
                Core Metrics
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <StatTile
                label="Average Day"
                value={rupee(s.desc.mean)}
                tone="#C8B6FF"
              />
              <StatTile
                label="Typical Day"
                value={rupee(s.desc.median)}
                tone="#A0C4FF"
              />
              <StatTile
                label="Normal Swing"
                value={`±${rupee(s.desc.sd)}`}
                tone="#FFD6A5"
              />
              <StatTile
                label="Routine Span"
                value={rupee(s.desc.iqr)}
                tone="#B8F2E6"
              />
              <StatTile
                label="Consistency"
                value={`${Math.round(s.desc.cv * 100)}%`}
                tone="#FFC6D9"
              />
              <StatTile
                label="Skewness"
                value={`${s.desc.skewness > 0 ? "+" : ""}${s.desc.skewness.toFixed(1)}`}
                tone="#FDFFB6"
              />
              <StatTile
                label="True Average Band"
                value={`${rupee(Math.round(s.desc.ci95[0]))} – ${rupee(Math.round(s.desc.ci95[1]))}`}
                tone="#C8B6FF"
              />
              <StatTile
                label="Spend Balance"
                value={`${s.desc.gini.toFixed(2)} / 1.0`}
                tone="#FFADAD"
              />
              <StatTile
                label="Cheapest Day"
                value={rupee(s.desc.min)}
                tone="#B8F2E6"
              />
              <StatTile
                label="Priciest Day"
                value={rupee(s.desc.max)}
                tone="#FFD6A5"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-line bg-gradient-to-r from-bg-soft/70 to-card p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent">
                <Lightbulb size={16} />
                What These Numbers Mean For Your Wallet
              </div>
              <div className="space-y-2 text-xs leading-relaxed text-ink/90">
                <p>
                  • <strong>Routine vs. Spikes:</strong> On an ordinary day without big plans, you typically spend around{" "}
                  <strong className="text-ink font-bold">{rupee(s.desc.median)}</strong> (your median). Because of a few
                  higher-spend days (like outings or shopping), your mathematical average climbs to{" "}
                  <strong className="text-ink font-bold">{rupee(s.desc.mean)}</strong>. That difference of{" "}
                  <strong className="text-ink font-bold">{rupee(Math.abs(s.desc.mean - s.desc.median))}</strong> shows how much
                  occasional treats bump up your daily budget.
                </p>
                <p>
                  • <strong>Your Safe Routine Zone:</strong> Half of all your days naturally land between{" "}
                  <strong className="text-ink font-bold">{rupee(s.desc.q1)}</strong> and{" "}
                  <strong className="text-ink font-bold">{rupee(s.desc.q3)}</strong>. If you keep normal days under{" "}
                  <strong className="text-ink font-bold">{rupee(s.desc.q3)}</strong>, your wallet stays in its natural comfort zone.
                </p>
                <p>
                  • <strong>Predictability:</strong> Your consistency score is{" "}
                  <strong className="text-ink font-bold">{Math.round(s.desc.cv * 100)}%</strong>.{" "}
                  {s.desc.cv < 0.4
                    ? "Your expenses are very consistent and predictable, making it easy to budget ahead without surprise shortfalls."
                    : s.desc.cv < 0.75
                      ? "You maintain a solid regular routine with occasional higher outings on special occasions."
                      : "Your spending swings between very quiet days and big splurge days. Budgeting around your typical median day helps avoid unexpected crunches."}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <div className="mb-3">
                <h3 className="text-sm font-bold text-ink">
                  How Much You Spend Each Day
                </h3>
                <p className="text-xs text-muted">
                  Shows how many days you spent in each price bracket. The tallest bar is your spending comfort zone.
                </p>
              </div>
              <Histogram
                bins={histogram(s.values)}
                markers={
                  <Legend>
                    <Swatch color="var(--chart-bar)">Number of Days</Swatch>
                  </Legend>
                }
              />
              <p className="mt-3 text-[11px] text-muted">
                Bars automatically group your daily spends into natural intervals so you can quickly see which spending amounts happen most often.
              </p>
            </Card>

            <Card>
              <div className="mb-3">
                <h3 className="text-sm font-bold text-ink">
                  Spending Spread
                </h3>
                <p className="text-xs text-muted">
                  Shows where your normal days live, with dots marking unusual high-spend days.
                </p>
              </div>
              <Legend>
                <Swatch color="var(--chart-bar)">Middle 50% of days, Middle Line</Swatch>
                <Swatch color="var(--ink)">▼ Average Spend</Swatch>
                <Swatch color="var(--chart-over)">Unusual Spike Days</Swatch>
              </Legend>
              <BoxPlot
                {...s.desc}
                lowerFence={s.fences.lower}
                upperFence={s.fences.upper}
                outliers={s.values.filter((v) => v > s.fences.upper || v < s.fences.lower)}
              />

              <div className="mt-4 rounded-xl border border-line bg-bg-soft/40 p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-2">
                  How Your Days Break Down
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-5">
                  <div>
                    <span className="text-muted block text-[10px]">Cheapest Day</span>
                    <strong className="num font-bold text-ink">{rupee(s.desc.min)}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">Lower 25%</span>
                    <strong className="num font-bold text-ink">{rupee(s.desc.q1)}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">Typical Day</span>
                    <strong className="num font-bold text-accent">{rupee(s.desc.median)}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">Upper 25%</span>
                    <strong className="num font-bold text-ink">{rupee(s.desc.q3)}</strong>
                  </div>
                  <div>
                    <span className="text-muted block text-[10px]">Priciest Day</span>
                    <strong className="num font-bold text-bad">{rupee(s.desc.max)}</strong>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <Zap size={16} className="text-amber-500" />
                  Noticeable Spending Spikes
                </h3>
                <p className="text-xs text-muted">
                  Days where you spent noticeably more than your normal routine.
                </p>
              </div>
              <span className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                Spike Alert
              </span>
            </div>

            {s.outliers.length === 0 ? (
              <div className="rounded-2xl border border-line bg-bg-soft/50 p-4 text-xs text-muted">
                No major spike days detected in this timeframe! Your spending stayed closely within your expected daily range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="pb-2 font-semibold">Date</th>
                      <th className="pb-2 font-semibold">Total Spent</th>
                      <th className="pb-2 font-semibold">Above Typical Day By</th>
                      <th className="pb-2 font-semibold">How Unusual?</th>
                      <th className="pb-2 font-semibold">Main Expense Item</th>
                      <th className="pb-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {s.outliers.map((o) => (
                      <tr key={o.item.day} className="hover:bg-bg-soft/50">
                        <td className="py-2.5 font-medium text-ink">
                          {format(o.item.date, "EEE, d MMM yyyy")}
                        </td>
                        <td className="num py-2.5 font-bold text-ink">{rupee(o.value)}</td>
                        <td className="num py-2.5 text-muted">
                          +{rupee(Math.round(o.value - s.desc.median))}
                        </td>
                        <td className="num py-2.5 font-semibold text-bad">
                          {o.z >= 3 ? "3× typical swing" : "2× typical swing"}
                        </td>
                        <td className="py-2.5 text-ink/90">
                          {o.top ? (
                            <span>
                              <strong>{o.top.title}</strong> ({rupee(o.top.amount)})
                            </span>
                          ) : (
                            <span className="text-muted">Combined daily purchases</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[10px] font-bold uppercase",
                              o.z >= 3
                                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {o.z >= 3 ? "Major Outlier" : "Noticeable Spike"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-ink flex items-center gap-2">
                  <Scale size={18} className="text-[#a0c4ff]" />
                  Weekend vs. Weekday Reality Check
                </h2>
                <p className="text-xs text-muted">
                  Do you actually spend more on weekends, or did a couple of random days just skew the numbers?
                </p>
              </div>
              <span className="rounded-lg bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">
                Pattern Test
              </span>
            </div>

            {!s.welch ? (
              <p className="text-xs text-muted">
                Need at least 2 weekend and 2 weekday records in this timeframe to run the comparison.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile
                    label="Weekend Average"
                    value={rupee(s.welch.meanA)}
                    tone="#FFC6D9"
                  />
                  <StatTile
                    label="Weekday Average"
                    value={rupee(s.welch.meanB)}
                    tone="#A0C4FF"
                  />
                  <StatTile
                    label="The Difference"
                    value={`${rupee(Math.abs(s.welch.diff))} ${s.welch.diff >= 0 ? "more" : "less"}`}
                    tone="#C8B6FF"
                  />
                  <StatTile
                    label="Is It a Real Habit?"
                    value={s.welch.p < 0.05 ? "Confirmed Pattern" : "Normal Variation"}
                    tone={s.welch.p < 0.05 ? "#B8F2E6" : "#FFD6A5"}
                  />
                </div>

                <div className="rounded-2xl border border-line bg-gradient-to-r from-bg-soft/80 to-card p-4 text-xs leading-relaxed text-ink/90">
                  <div className="mb-1.5 flex items-center gap-2 font-bold text-ink">
                    <CheckCircle2 size={16} className={s.welch.p < 0.05 ? "text-emerald-500" : "text-amber-500"} />
                    The Bottom Line:
                  </div>
                  <p>
                    {s.welch.p < 0.05 ? (
                      <>
                        <strong>Yes, your weekend spending is legitimately higher!</strong> You spend an extra{" "}
                        <strong>{rupee(Math.abs(s.welch.diff))} per day</strong> on weekends compared to weekdays.
                        With statistical testing (p = {s.welch.p < 0.001 ? "< 0.001" : s.welch.p.toFixed(3)}), there is{" "}
                        <strong>over 95% certainty</strong> that this is an established behavioral pattern, not random luck.
                      </>
                    ) : (
                      <>
                        <strong>Your spending is fairly even throughout the week.</strong> The difference of{" "}
                        {rupee(Math.abs(s.welch.diff))} per day between weekends and weekdays is small enough that it looks
                        like normal day-to-day variation rather than a deliberate weekend surge.
                      </>
                    )}
                  </p>
                  {s.welch.diff > 50 && (
                    <p className="mt-2 text-muted">
                      💡 <strong>Quick Savings Opportunity:</strong> If you kept your weekend spending just a little closer
                      to your weekday level ({rupee(s.welch.meanB)}), you would save approximately{" "}
                      <strong className="text-ink">{rupee(Math.round(s.welch.diff * 8))}</strong> every month.
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-ink flex items-center gap-2">
                  <Compass size={18} className="text-[#10b981]" />
                  Month-End Spending Forecast
                </h2>
                <p className="text-xs text-muted">
                  Where you're on track to finish this month based on your current daily pace and scheduled bills.
                </p>
              </div>
              <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                Pace Projection
              </span>
            </div>

            {!s.fc ? (
              <p className="text-xs text-muted">
                Need at least 3 logged days in this budget period to calculate a forecast.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                  <StatTile
                    label="Projected Total"
                    value={rupee(s.fc.expected)}
                    tone={s.fc.expected <= s.budget ? "#B8F2E6" : "#FFADAD"}
                  />
                  <StatTile
                    label="Monthly Budget"
                    value={rupee(s.budget)}
                    tone="#A0C4FF"
                  />
                  <StatTile
                    label="Likely Finish Range"
                    value={`${rupee(s.fc.lower)} – ${rupee(s.fc.upper)}`}
                    tone="#C8B6FF"
                  />
                  <StatTile
                    label="Budget Safety Chance"
                    value={s.pWithin != null ? `${Math.round(s.pWithin * 100)}%` : "N/A"}
                    tone={
                      s.pWithin != null && s.pWithin >= 0.7
                        ? "#B8F2E6"
                        : s.pWithin != null && s.pWithin >= 0.4
                          ? "#FFD6A5"
                          : "#FFADAD"
                    }
                  />
                  <StatTile
                    label="Daily Pace Trend"
                    value={`${s.fc.trendSlope >= 0 ? "+" : ""}${rupee(s.fc.trendSlope, true)} / day`}
                    tone="#FDFFB6"
                  />
                </div>

                <ForecastChart data={s.fcData} budget={s.budget} height={250} />

                <div className="grid gap-3 text-xs sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-card p-3 shadow-soft">
                    <div className="font-bold text-ink mb-1">How This is Calculated</div>
                    <div className="text-muted leading-relaxed">
                      We start with what you've spent so far ({rupee(s.spentSoFar)}), add known upcoming fixed bills
                      (like mobile recharge), and project your remaining days using your typical daily spending pace.
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-card p-3 shadow-soft">
                    <div className="font-bold text-ink mb-1">Recent 7-Day Pace</div>
                    <div className="text-muted leading-relaxed">
                      If you maintain exactly your last 7 days' pace, your month-end total would be{" "}
                      <strong className="text-ink font-semibold">{rupee(s.fc.movingAvg)}</strong>.
                      {s.fc.capped > 0 &&
                        ` We automatically smoothed ${s.fc.capped} big outlier day so a single purchase doesn't distort your whole projection.`}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-card p-3 shadow-soft">
                    <div className="font-bold text-ink mb-1">Pace Drift (Trend)</div>
                    <div className="text-muted leading-relaxed">
                      Your daily spending is{" "}
                      <strong className="text-ink font-semibold">
                        {s.fc.trendSlope >= 0 ? "increasing by " : "decreasing by "}
                        {rupee(Math.abs(s.fc.trendSlope), true)} each day
                      </strong>
                      . Tracking this helps you catch spending creep before the end of the month.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-ink flex items-center gap-2">
                  <Clock size={18} className="text-[#ea580c]" />
                  When Does Your Money Go?
                </h2>
                <p className="text-xs text-muted">
                  Discover your peak spending windows: see which days and hours see the most money out the door.
                </p>
              </div>
              <span className="rounded-lg bg-orange-500/10 px-2.5 py-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400">
                Weekly Clock
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] border-separate border-spacing-1.5 text-xs">
                <thead>
                  <tr>
                    <th className="p-2 text-left font-semibold text-muted">Day / Slot</th>
                    {SLOTS.map((sl) => (
                      <th key={sl.label} className="p-2 text-center font-semibold text-muted">
                        <div>{sl.label}</div>
                        <div className="text-[10px] font-normal text-muted/70">{sl.hint}</div>
                      </th>
                    ))}
                    <th className="p-2 text-right font-semibold text-ink">
                      <div>Day Total</div>
                      <div className="text-[10px] font-normal text-muted">Sum &amp; Share</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map((wd, i) => {
                    const rowSum = s.rowTotals[i];
                    const rowPct = s.grandTotal > 0 ? (rowSum / s.grandTotal) * 100 : 0;
                    return (
                      <tr key={wd}>
                        <th className="p-2 text-left font-bold text-ink">{wd}</th>
                        {s.grid[i].map((v, j) => {
                          const intensity = v / s.gridMax;
                          return (
                            <td
                              key={j}
                              title={`${wd} ${SLOTS[j].label}: ${rupee(v)}`}
                              className="num h-11 rounded-xl text-center font-bold transition hover:ring-2 hover:ring-accent"
                              style={{
                                background: v
                                  ? `color-mix(in srgb, var(--chart-bar) ${Math.round(18 + intensity * 82)}%, var(--card))`
                                  : "var(--bg-soft)",
                                color: intensity > 0.5 ? "#fff" : "var(--ink)",
                              }}
                            >
                              {v ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)) : "—"}
                            </td>
                          );
                        })}
                        <td className="p-2 text-right">
                          <div className="num font-bold text-ink">{rupee(rowSum)}</div>
                          <div className="num text-[10px] text-muted">{rowPct.toFixed(1)}%</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <th className="p-2 text-left font-bold text-ink">Slot Total</th>
                    {SLOTS.map((sl, j) => {
                      const colSum = s.colTotals[j];
                      const colPct = s.grandTotal > 0 ? (colSum / s.grandTotal) * 100 : 0;
                      return (
                        <td key={sl.label} className="p-2 text-center">
                          <div className="num font-bold text-ink">{rupee(colSum)}</div>
                          <div className="num text-[10px] text-muted">{colPct.toFixed(1)}%</div>
                        </td>
                      );
                    })}
                    <td className="p-2 text-right">
                      <div className="num text-sm font-extrabold text-accent">
                        {rupee(s.grandTotal)}
                      </div>
                      <div className="text-[10px] font-semibold text-muted">100% Total</div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                Darker purple shading indicates higher spending density during that specific time block.
              </span>
              <span className="font-semibold text-ink">
                🔥 Peak Spending Window:{" "}
                <strong className="text-accent">
                  {(() => {
                    let maxVal = -1;
                    let best = "N/A";
                    for (let i = 0; i < WEEKDAYS.length; i++) {
                      for (let j = 0; j < SLOTS.length; j++) {
                        if (s.grid[i][j] > maxVal) {
                          maxVal = s.grid[i][j];
                          best = `${WEEKDAYS[i]} ${SLOTS[j].label} (${rupee(maxVal)})`;
                        }
                      }
                    }
                    return best;
                  })()}
                </strong>
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
