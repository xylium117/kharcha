"use client";

import { addDays, addMonths, format, min as minDate, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { DailyBars, MonthBars, RankedBars, SplitBar, TrendLines } from "@/components/charts";
import { ExpenseRow } from "@/components/ExpenseRow";
import { Card, EmptyState, PageHeader, SectionTitle, Segmented, StatTile } from "@/components/ui";
import { budgetFor, categoryTotals, dailyTotals, getPeriod, incomeIn, inRange, lentIn, sum, tagTotals } from "@/lib/budget";
import { rupee } from "@/lib/format";
import { useCategoryMap, useContributions, useExpenses, useIncome, useIOUs, useNow, useSettings } from "@/lib/hooks";
import type { Category, Expense, Settings } from "@/lib/types";

export default function ReportsPage() {
  const [view, setView] = useState<"month" | "year">("month");
  const settings = useSettings();
  const expenses = useExpenses();
  if (!settings || !expenses) return null;
  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Where did the money go?"
        action={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "month", label: "Monthly" },
              { value: "year", label: "Yearly" },
            ]}
          />
        }
      />
      {view === "month" ? <MonthView settings={settings} expenses={expenses} /> : <YearView settings={settings} expenses={expenses} />}
    </div>
  );
}

function Stepper({ label, onPrev, onNext, canNext }: { label: string; onPrev: () => void; onNext: () => void; canNext: boolean }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-2xl border border-line bg-card px-2 py-1.5">
      <button onClick={onPrev} aria-label="Previous" className="grid size-9 place-items-center rounded-xl hover:bg-bg-soft">
        <ChevronLeft size={18} />
      </button>
      <span className="font-bold">{label}</span>
      <button onClick={onNext} disabled={!canNext} aria-label="Next" className="grid size-9 place-items-center rounded-xl hover:bg-bg-soft disabled:opacity-30">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function rankRows(list: Expense[], cats: Map<string, Category>) {
  return [...categoryTotals(list).entries()].sort((a, b) => b[1] - a[1]).map(([id, amount]) => ({ id, amount, cat: cats.get(id) }));
}

function MonthView({ settings, expenses }: { settings: Settings; expenses: Expense[] }) {
  const now = useNow();
  const cats = useCategoryMap();
  const contributions = useContributions();
  const income = useIncome();
  const ious = useIOUs();
  const [offset, setOffset] = useState(0);
  const p = getPeriod(now, settings.monthStartDay, offset);
  const budget = budgetFor(settings, p.key);

  const data = useMemo(() => {
    const list = expenses.filter((e) => inRange(e.ts, p.start, p.nextStart));
    const end = minDate([p.nextStart, addDays(startOfDay(now), 1)]);
    const limit = budget / p.daysInPeriod;
    const days = dailyTotals(list, p.start, end).map((d) => ({
      label: format(d.date, "d"),
      full: format(d.date, "EEE d MMM"),
      total: d.total,
      over: d.total > limit,
    }));
    const saved = sum(contributions.filter((c) => inRange(c.ts, p.start, p.nextStart)), (c) => c.amount);
    const pay = new Map<string, number>();
    for (const e of list) pay.set(e.paymentMode, (pay.get(e.paymentMode) ?? 0) + e.amount);
    return {
      list,
      days,
      limit,
      spent: sum(list, (e) => e.amount),
      saved,
      tags: tagTotals(list),
      ranked: rankRows(list, cats),
      biggest: [...list].sort((a, b) => b.amount - a.amount).slice(0, 5),
      pay: [...pay.entries()].sort((a, b) => b[1] - a[1]),
      elapsed: Math.max(1, days.length),
    };
  }, [expenses, contributions, cats, p.start, p.nextStart, p.daysInPeriod, budget, now]);

  const moneyIn = incomeIn(income, p.start, p.nextStart);
  const lent = lentIn(ious, p.start, p.nextStart);
  const left = budget + moneyIn - lent - data.spent - data.saved;
  const label = `${format(p.start, "d MMM")} – ${format(addDays(p.nextStart, -1), "d MMM yyyy")}`;

  return (
    <div className="space-y-4">
      <Stepper label={label} onPrev={() => setOffset((o) => o - 1)} onNext={() => setOffset((o) => o + 1)} canNext={offset < 0} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Spent" value={rupee(data.spent)} tone="#C8B6FF" />
        <StatTile label="Budget" value={rupee(budget)} hint={moneyIn ? `+ ${rupee(moneyIn)} money in` : undefined} tone="#A0C4FF" />
        <StatTile label={left >= 0 ? "Left" : "Over by"} value={rupee(Math.abs(left))} hint={[data.saved && `${rupee(data.saved)} to goals`, lent && `${rupee(lent)} lent`].filter(Boolean).join(" · ") || undefined} tone={left >= 0 ? "#B8F2E6" : "#FFADAD"} />
        <StatTile label="Average / day" value={rupee(data.spent / data.elapsed)} hint={`limit ${rupee(data.limit)}`} tone="#FFD6A5" />
      </div>

      {data.list.length === 0 ? (
        <Card>
          <EmptyState emoji="🗓️" title="No expenses in this period" />
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle>📊 Daily spending</SectionTitle>
            <DailyBars data={data.days} limit={data.limit} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>🍩 By category</SectionTitle>
              <RankedBars rows={data.ranked} total={data.spent} />
            </Card>
            <div className="space-y-4">
              <Card>
                <SectionTitle>🧠 Need vs Want vs Waste</SectionTitle>
                <SplitBar {...data.tags} />
                <p className="mt-3 text-sm text-muted">
                  {data.tags.waste > 0 ? (
                    <>
                      You wasted <b className="text-ink">{rupee(data.tags.waste)}</b> this period 😬 – that&apos;s about{" "}
                      {Math.round(data.tags.waste / 15)} cups of chai.
                    </>
                  ) : (
                    <>Zero waste this period. Absolute legend! 🌱</>
                  )}
                </p>
              </Card>
              <Card>
                <SectionTitle>💳 Paid with</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {data.pay.map(([mode, amt]) => (
                    <span key={mode} className="rounded-full bg-bg-soft px-3 py-1.5 text-sm">
                      {mode} <b className="num">{rupee(amt)}</b>
                    </span>
                  ))}
                </div>
              </Card>
            </div>
          </div>
          <Card>
            <SectionTitle>🏆 Biggest expenses</SectionTitle>
            <div className="-mx-2">
              {data.biggest.map((e) => (
                <ExpenseRow key={e.id} e={e} cat={cats.get(e.categoryId)} showDate />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function YearView({ settings, expenses }: { settings: Settings; expenses: Expense[] }) {
  const now = useNow();
  const cats = useCategoryMap();
  const [mode, setMode] = useState<"calendar" | "academic">("calendar");
  const [offset, setOffset] = useState(0);
  const acStart = settings.academicStartMonth - 1;

  const data = useMemo(() => {
    const baseYear =
      mode === "calendar" ? now.getFullYear() + offset : (now.getMonth() >= acStart ? now.getFullYear() : now.getFullYear() - 1) + offset;
    const firstMonth = new Date(baseYear, mode === "calendar" ? 0 : acStart, 1);
    const months = Array.from({ length: 12 }, (_, i) => {
      const anchor = addMonths(firstMonth, i);
      const p = getPeriod(new Date(anchor.getFullYear(), anchor.getMonth(), settings.monthStartDay), settings.monthStartDay);
      const list = expenses.filter((e) => inRange(e.ts, p.start, p.nextStart));
      return { p, anchor, list, spent: sum(list, (e) => e.amount), budget: budgetFor(settings, p.key), future: p.start > now };
    });
    const shown = months.filter((m) => !m.future);
    const all = shown.flatMap((m) => m.list);
    const withData = shown.filter((m) => m.spent > 0);
    const ranked = rankRows(all, cats);
    const top3 = ranked.slice(0, 3);
    const trend = shown.map((m) => {
      const t = categoryTotals(m.list);
      const row: Record<string, number | string> = { label: format(m.anchor, "MMM"), full: format(m.anchor, "MMMM yyyy") };
      for (const c of top3) row[c.id] = t.get(c.id) ?? 0;
      return row;
    });
    const semesters =
      mode === "academic"
        ? [months.slice(0, 6), months.slice(6)].map((ms, i) => {
            const list = ms.filter((m) => !m.future).flatMap((m) => m.list);
            return {
              name: i === 0 ? "Odd semester" : "Even semester",
              range: `${format(ms[0].anchor, "MMM yyyy")} – ${format(ms[5].anchor, "MMM yyyy")}`,
              spent: sum(list, (e) => e.amount),
              budget: sum(ms.filter((m) => !m.future), (m) => m.budget),
              top: rankRows(list, cats).slice(0, 3),
              waste: tagTotals(list).waste,
            };
          })
        : [];
    return {
      label: mode === "calendar" ? String(baseYear) : `${baseYear}–${String(baseYear + 1).slice(2)}`,
      bars: months.map((m) => ({ label: format(m.anchor, "MMM"), full: format(m.anchor, "MMMM yyyy"), spent: m.spent, budget: m.future ? null : m.budget })),
      total: sum(all, (e) => e.amount),
      withData,
      ranked,
      top3,
      trend,
      semesters,
      isCurrent: offset === 0,
    };
  }, [mode, offset, now, acStart, expenses, settings, cats]);

  const best = [...data.withData].sort((a, b) => a.spent - b.spent)[0];
  const worst = [...data.withData].sort((a, b) => b.spent - a.spent)[0];

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setOffset(0);
          }}
          options={[
            { value: "calendar", label: "Calendar year" },
            { value: "academic", label: "Academic year" },
          ]}
        />
      </div>
      <Stepper label={data.label} onPrev={() => setOffset((o) => o - 1)} onNext={() => setOffset((o) => o + 1)} canNext={offset < 0} />

      {data.total === 0 ? (
        <Card>
          <EmptyState emoji="📅" title="No expenses in this year yet" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total spent" value={rupee(data.total)} tone="#C8B6FF" />
            <StatTile label="Avg / month" value={rupee(data.total / Math.max(1, data.withData.length))} tone="#A0C4FF" />
            <StatTile label="Thriftiest month" value={best ? format(best.anchor, "MMM") : "–"} hint={best && rupee(best.spent)} tone="#B8F2E6" />
            <StatTile label="Priciest month" value={worst ? format(worst.anchor, "MMM") : "–"} hint={worst && rupee(worst.spent)} tone="#FFD6A5" />
          </div>

          {data.semesters.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.semesters.map((s) => (
                <Card key={s.name}>
                  <SectionTitle>🎓 {s.name}</SectionTitle>
                  <p className="-mt-2 mb-3 text-xs text-muted">{s.range}</p>
                  <p className="num text-2xl font-bold">{rupee(s.spent)}</p>
                  <p className="text-sm text-muted">
                    of {rupee(s.budget)} budget so far · {rupee(s.waste)} waste
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.top.map((t) => (
                      <span key={t.id} className="rounded-full bg-bg-soft px-3 py-1 text-xs font-semibold">
                        {t.cat?.emoji} {t.cat?.name} {rupee(t.amount)}
                      </span>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <SectionTitle>📈 Month by month</SectionTitle>
            <MonthBars data={data.bars} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>📉 Top 3 categories over time</SectionTitle>
              <TrendLines
                data={data.trend}
                series={data.top3.map((t) => ({ key: t.id, name: `${t.cat?.emoji ?? ""} ${t.cat?.name ?? t.id}` }))}
              />
            </Card>
            <Card>
              <SectionTitle>🍩 Year by category</SectionTitle>
              <RankedBars rows={data.ranked} total={data.total} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
