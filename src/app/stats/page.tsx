"use client";

import { addDays, format, startOfDay } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxPlot, ForecastChart, Histogram, Legend, Swatch, type ForecastDatum } from "@/components/charts";
import { Card, EmptyState, PageHeader, SectionTitle, Segmented, StatTile, cn } from "@/components/ui";
import { budgetFor, dailyTotals, getPeriod, inRange, sum, upcomingRecurring } from "@/lib/budget";
import { db } from "@/lib/db";
import { rupee } from "@/lib/format";
import { useExpenses, useNow, useRecurring, useSettings } from "@/lib/hooks";
import { describe, explainP, forecastPeriod, histogram, normalCdf, tukeyFences, welchTTest, zOutliers } from "@/lib/stats";
import { buildDayMap } from "@/lib/streaks";

const WINDOWS = { "30": 30, "90": 90, all: 3650 } as const;
type Win = keyof typeof WINDOWS;

const SLOTS = [
  { label: "Morning", hint: "5–11", test: (h: number) => h >= 5 && h < 11 },
  { label: "Lunch", hint: "11–15", test: (h: number) => h >= 11 && h < 15 },
  { label: "Evening", hint: "15–19", test: (h: number) => h >= 15 && h < 19 },
  { label: "Night", hint: "19–23", test: (h: number) => h >= 19 && h < 23 },
  { label: "Late", hint: "23–5", test: (h: number) => h >= 23 || h < 5 },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function StatsPage() {
  const settings = useSettings();
  const expenses = useExpenses();
  const recurring = useRecurring();
  const now = useNow();
  const [win, setWin] = useState<Win>("90");

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
    // Only days that were logged (an expense or a marked no-spend day). Unlogged days are missing data, not ₹0.
    const days = dailyTotals(expenses, start, today).filter((d) => dayInfo.get(d.day)?.active);
    const values = days.map((d) => d.total);
    const desc = describe(values);
    if (!desc) return null;
    const fences = tukeyFences(desc);
    const outliers = zOutliers(days, (d) => d.total, 2).slice(0, 5).map((o) => {
      const dayEnd = addDays(o.item.date, 1);
      const top = expenses.filter((e) => inRange(e.ts, o.item.date, dayEnd)).sort((a, b) => b.amount - a.amount)[0];
      return { ...o, top };
    });

    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const weekend = days.filter((d) => isWeekend(d.date)).map((d) => d.total);
    const weekday = days.filter((d) => !isWeekend(d.date)).map((d) => d.total);
    const welch = welchTTest(weekend, weekday);

    // Heatmap: total spent per weekday × time-of-day slot
    const winExpenses = expenses.filter((e) => e.ts >= start.getTime() && e.ts < today.getTime());
    const grid = WEEKDAYS.map(() => SLOTS.map(() => 0));
    for (const e of winExpenses) {
      const d = new Date(e.ts);
      const wd = (d.getDay() + 6) % 7;
      const slot = SLOTS.findIndex((sl) => sl.test(d.getHours()));
      grid[wd][slot] += e.amount;
    }
    const gridMax = Math.max(1, ...grid.flat());

    // Forecast for the current budget period
    const p = getPeriod(now, settings.monthStartDay);
    const budget = budgetFor(settings, p.key);
    // Recurring bills are known in advance, so they are added explicitly rather than modelled as daily noise.
    const discretionary = expenses.filter((e) => !e.recurringId);
    const periodDays = dailyTotals(discretionary, p.start, today).filter((d) => dayInfo.get(d.day)?.active).map((d) => d.total);
    const history = dailyTotals(discretionary, addDays(p.start, -30), p.start).filter((d) => dayInfo.get(d.day)?.active).map((d) => d.total);
    const spentSoFar = sum(expenses.filter((e) => inRange(e.ts, p.start, addDays(today, 1))), (e) => e.amount);
    const remainingDays = p.daysLeft - 1;
    const fc = forecastPeriod(periodDays, spentSoFar, remainingDays, history, upcomingRecurring(recurring, today, p.nextStart));
    let fcData: ForecastDatum[] = [];
    let pWithin: number | null = null;
    if (fc) {
      const all = dailyTotals(expenses, p.start, addDays(today, 1));
      let cum = 0;
      fcData = all.map((d) => {
        cum += d.total;
        return { label: format(d.date, "d"), full: format(d.date, "EEE d MMM"), actual: cum };
      });
      fcData[fcData.length - 1] = { ...fcData[fcData.length - 1], projected: cum, band: [cum, cum] };
      for (let j = 1; j <= remainingDays; j++) {
        const d = addDays(today, j);
        const at = fc.at(j);
        fcData.push({ label: format(d, "d"), full: format(d, "EEE d MMM"), projected: at.expected, band: [at.lower, at.upper] });
      }
      pWithin = fc.se > 0 ? normalCdf((budget - fc.expected) / fc.se) : fc.expected <= budget ? 1 : 0;
    }

    return { desc, fences, outliers, days, values, welch, weekend, weekday, grid, gridMax, fc, fcData, budget, pWithin, start };
  }, [settings, expenses, recurring, now, win]);

  if (!settings || !expenses) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stats Lab 📊"
        subtitle="Your spending, through a statistician's eyes."
        action={
          <Segmented
            value={win}
            onChange={setWin}
            options={[
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />
      {!s || s.desc.n < 5 ? (
        <Card>
          <EmptyState emoji="🧪" title="Not enough data yet">
            The lab needs at least 5 logged days. Keep logging and come back – sample size matters!
          </EmptyState>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted">
            Sample: <b className="text-ink">{s.desc.n} logged days</b> since {format(s.start, "d MMM")} (today excluded). Days you didn&apos;t
            log are treated as missing data, not ₹0.
          </p>

          <Card>
            <SectionTitle>📐 Descriptive statistics – daily spend</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Mean (x̄)" value={rupee(s.desc.mean)} tone="#C8B6FF" />
              <StatTile label="Median" value={rupee(s.desc.median)} tone="#A0C4FF" />
              <StatTile label="Std. deviation (s)" value={rupee(s.desc.sd)} tone="#FFD6A5" />
              <StatTile label="IQR (Q3 − Q1)" value={rupee(s.desc.iqr)} hint={`${rupee(s.desc.q1)} – ${rupee(s.desc.q3)}`} tone="#B8F2E6" />
              <StatTile label="Coeff. of variation" value={`${Math.round(s.desc.cv * 100)}%`} hint="s ÷ x̄" />
              <StatTile label="Skewness" value={s.desc.skewness.toFixed(2)} hint={s.desc.skewness > 0.5 ? "right-skewed" : s.desc.skewness < -0.5 ? "left-skewed" : "fairly symmetric"} />
              <StatTile label="Min day" value={rupee(s.desc.min)} />
              <StatTile label="Max day" value={rupee(s.desc.max)} />
            </div>
            <p className="mt-3 rounded-2xl bg-bg-soft p-3 text-sm">
              🦉{" "}
              {s.desc.mean > s.desc.median * 1.1
                ? `Your mean (${rupee(s.desc.mean)}) sits above your median (${rupee(s.desc.median)}) – a few big-spend days drag the average up. A "typical" day costs you about ${rupee(s.desc.median)}.`
                : `Mean and median are close, so your spending is fairly balanced – a typical day costs about ${rupee(s.desc.median)}.`}{" "}
              {s.desc.cv > 0.8 ? "Your CV is high: spending swings a lot from day to day." : "Your CV is moderate: spending is reasonably consistent."}
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>📊 Distribution (histogram)</SectionTitle>
              <Histogram
                bins={histogram(s.values)}
                markers={
                  <Legend>
                    <Swatch color="var(--chart-bar)">Number of days</Swatch>
                  </Legend>
                }
              />
              <p className="mt-2 text-xs text-muted">Bin width chosen by the Freedman–Diaconis rule (2·IQR·n^(−1/3)).</p>
            </Card>
            <Card>
              <SectionTitle>📦 Box plot &amp; outliers</SectionTitle>
              <Legend>
                <Swatch color="var(--chart-bar)">Q1–Q3 box, median line</Swatch>
                <Swatch color="var(--ink)">▼ mean</Swatch>
                <Swatch color="var(--chart-over)">Tukey outlier</Swatch>
              </Legend>
              <BoxPlot
                {...s.desc}
                lowerFence={s.fences.lower}
                upperFence={s.fences.upper}
                outliers={s.values.filter((v) => v > s.fences.upper || v < s.fences.lower)}
              />
              <SectionTitle className="mt-4">🚨 Unusual days (z ≥ 2)</SectionTitle>
              {s.outliers.length === 0 ? (
                <p className="text-sm text-muted">No day was 2σ above normal. Steady spender! 🧘</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {s.outliers.map((o) => (
                    <li key={o.item.day} className="flex items-start gap-2 rounded-2xl bg-bg-soft p-2.5">
                      <span className="num shrink-0 rounded-lg bg-card px-2 py-0.5 font-bold text-bad">{o.z.toFixed(1)}σ</span>
                      <span>
                        <b>{format(o.item.date, "EEE d MMM")}</b> – {rupee(o.value)} spent
                        {o.top && (
                          <span className="text-muted">
                            {" "}
                            (biggest: {o.top.title} {rupee(o.top.amount)})
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <SectionTitle>🗓️ Weekend vs weekday – Welch&apos;s t-test</SectionTitle>
            {!s.welch ? (
              <p className="text-sm text-muted">Need at least 2 weekend and 2 weekday days.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={`Weekend mean (n=${s.welch.nA})`} value={rupee(s.welch.meanA)} tone="#FFC6D9" />
                  <StatTile label={`Weekday mean (n=${s.welch.nB})`} value={rupee(s.welch.meanB)} tone="#A0C4FF" />
                  <StatTile label="t statistic" value={s.welch.t.toFixed(2)} hint={`df ≈ ${s.welch.df.toFixed(1)}`} />
                  <StatTile label="p-value (two-sided)" value={s.welch.p < 0.001 ? "< 0.001" : s.welch.p.toFixed(3)} />
                </div>
                <div className="rounded-2xl bg-bg-soft p-4 text-sm leading-relaxed">
                  <p className="mb-2 font-semibold">H₀: μ<sub>weekend</sub> = μ<sub>weekday</sub></p>
                  <p>
                    On weekends you spend {rupee(Math.abs(s.welch.diff))} {s.welch.diff >= 0 ? "more" : "less"} per day on average. With p ={" "}
                    {s.welch.p < 0.001 ? "< 0.001" : s.welch.p.toFixed(3)}, there&apos;s <b>{explainP(s.welch.p)}</b>.
                  </p>
                  <p className="mt-2 text-muted">
                    Welch&apos;s test doesn&apos;t assume equal variances. Daily spends are skewed, so treat it as a rough guide – with n ={" "}
                    {s.welch.nA + s.welch.nB} the CLT helps.
                  </p>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>🔮 Month-end forecast</SectionTitle>
            {!s.fc ? (
              <p className="text-sm text-muted">Need at least 3 logged days to forecast.</p>
            ) : (
              <>
                <p className="mb-3 text-sm">
                  At this pace you&apos;ll end the period at <b className="num">{rupee(s.fc.expected)}</b>{" "}
                  <span className="text-muted">
                    (95% interval {rupee(s.fc.lower)} – {rupee(s.fc.upper)})
                  </span>{" "}
                  vs a budget of <b className="num">{rupee(s.budget)}</b>.{" "}
                  {s.pWithin != null && (
                    <>
                      Chance of staying within budget:{" "}
                      <b className={cn("num", s.pWithin >= 0.6 ? "text-good" : s.pWithin >= 0.3 ? "text-warn" : "text-bad")}>
                        {Math.round(s.pWithin * 100)}%
                      </b>
                      .
                    </>
                  )}
                </p>
                <ForecastChart data={s.fcData} budget={s.budget} />
                <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
                  <p>
                    <b className="text-ink">Model:</b> future days i.i.d. with mean {rupee(s.fc.mu)}, recurring bills added separately
                    {s.fc.capped > 0 && `, ${s.fc.capped} splurge day${s.fc.capped > 1 ? "s" : ""} winsorized at Q3 + 1.5·IQR`}. SE = s·√(r + r²/n), t-critical
                    with {s.fc.daysObserved - 1} df.
                  </p>
                  <p>
                    <b className="text-ink">7-day moving average</b> says {rupee(s.fc.movingAvg)}.
                  </p>
                  <p>
                    <b className="text-ink">Trend:</b> daily spend is {s.fc.trendSlope >= 0 ? "rising" : "falling"} by about {rupee(Math.abs(s.fc.trendSlope), true)} per day (OLS slope).
                  </p>
                </div>
              </>
            )}
          </Card>

          <Card>
            <SectionTitle>🔥 When do you spend? (₹ by weekday × time)</SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th />
                    {SLOTS.map((sl) => (
                      <th key={sl.label} className="pb-1 font-semibold text-muted">
                        {sl.label}
                        <div className="font-normal">{sl.hint}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map((wd, i) => (
                    <tr key={wd}>
                      <th className="pr-2 text-left font-semibold text-muted">{wd}</th>
                      {s.grid[i].map((v, j) => {
                        const k = v / s.gridMax;
                        return (
                          <td
                            key={j}
                            title={`${wd} ${SLOTS[j].label}: ${rupee(v)}`}
                            className="num h-10 rounded-lg text-center font-semibold"
                            style={{
                              background: v ? `color-mix(in srgb, var(--chart-bar) ${Math.round(12 + k * 88)}%, var(--card))` : "var(--bg-soft)",
                              color: k > 0.55 ? "#fff" : "var(--ink)",
                            }}
                          >
                            {v ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)) : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Darker = more money spent in that slot during the selected window.</p>
          </Card>
        </>
      )}
    </div>
  );
}

