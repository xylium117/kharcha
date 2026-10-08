"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { rupee } from "@/lib/format";
import type { Category } from "@/lib/types";
import { cn } from "./ui";

const AXIS = { fontSize: 11, fill: "var(--muted)" };
const compact = (v: number) => (v >= 1000 ? `₹${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `₹${Math.round(v)}`);

export function Swatch({ color, dashed, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      {dashed ? (
        <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: color }} />
      ) : (
        <span className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />
      )}
      {children}
    </span>
  );
}

export function Legend({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-2 flex flex-wrap gap-x-4 gap-y-1", className)}>{children}</div>;
}

/** Tooltip body shared by every chart. `rows` turns the hovered datum into lines. */
function tip(rows: (datum: Record<string, unknown>) => { label: string; value: string; color?: string }[], title?: (datum: Record<string, unknown>) => string) {
  return function TipContent({ active, payload }: TooltipContentProps) {
    if (!active || !payload?.length) return null;
    const datum = payload[0].payload as Record<string, unknown>;
    return (
      <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-soft">
        {title && <div className="mb-1 font-semibold text-ink">{title(datum)}</div>}
        {rows(datum).map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-muted">
            {r.color && <span className="inline-block size-2 rounded-[2px]" style={{ background: r.color }} />}
            <span>{r.label}</span>
            <span className="num ml-auto pl-3 font-semibold text-ink">{r.value}</span>
          </div>
        ))}
      </div>
    );
  };
}

// ---------- daily spend with limit line ----------

export interface DailyDatum {
  label: string;
  full: string;
  total: number;
  over: boolean;
}

export function DailyBars({ data, limit, height = 220 }: { data: DailyDatum[]; limit: number; height?: number }) {
  return (
    <div>
      <Legend>
        <Swatch color="var(--chart-bar)">Spent</Swatch>
        <Swatch color="var(--chart-over)">Over daily limit</Swatch>
        <Swatch color="var(--muted)" dashed>
          Even daily limit {rupee(limit)}
        </Swatch>
      </Legend>
      <BarChart responsive style={{ width: "100%", height }} data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
        <Tooltip
          cursor={{ fill: "var(--bg-soft)" }}
          content={tip(
            (d) => [{ label: "Spent", value: rupee(d.total as number), color: d.over ? "var(--chart-over)" : "var(--chart-bar)" }],
            (d) => d.full as string,
          )}
        />
        <ReferenceLine y={limit} stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} />
        <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={22}>
          {data.map((d) => (
            <Cell key={d.full} fill={d.over ? "var(--chart-over)" : "var(--chart-bar)"} />
          ))}
        </Bar>
      </BarChart>
    </div>
  );
}

// ---------- ranked category list (direct-labelled, one hue) ----------

export function RankedBars({
  rows,
  total,
}: {
  rows: { cat?: Category; id: string; amount: number }[];
  total: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl text-lg" style={{ background: r.cat?.color ?? "#eee" }} aria-hidden>
            {r.cat?.emoji ?? "✨"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-semibold">{r.cat?.name ?? r.id}</span>
              <span className="num shrink-0 text-muted">
                <b className="text-ink">{rupee(r.amount)}</b> · {total > 0 ? Math.round((r.amount / total) * 100) : 0}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-soft">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--chart-bar)" }}
                initial={{ width: 0 }}
                animate={{ width: `${(r.amount / max) * 100}%` }}
                transition={{ duration: 0.7, delay: i * 0.04 }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- need / want / waste split ----------

export function SplitBar({ need, want, waste }: { need: number; want: number; waste: number }) {
  const total = need + want + waste;
  const parts = [
    { key: "need", label: "✅ Need", value: need, color: "var(--s-need)" },
    { key: "want", label: "💭 Want", value: want, color: "var(--s-want)" },
    { key: "waste", label: "🗑️ Waste", value: waste, color: "var(--s-waste)" },
  ];
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full bg-bg-soft">
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <motion.div
                key={p.key}
                title={`${p.label}: ${rupee(p.value)}`}
                style={{ background: p.color }}
                initial={{ flexGrow: 0 }}
                animate={{ flexGrow: p.value / total }}
                transition={{ duration: 0.7 }}
                className="h-full basis-0"
              />
            ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {parts.map((p) => (
          <div key={p.key} className="rounded-2xl bg-bg-soft p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <span className="inline-block size-2.5 rounded-[3px]" style={{ background: p.color }} />
              {p.label}
            </div>
            <div className="num mt-0.5 font-bold">{rupee(p.value)}</div>
            <div className="num text-xs text-muted">{total > 0 ? Math.round((p.value / total) * 100) : 0}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- months: spent bars + budget line ----------

export interface MonthDatum {
  label: string;
  full: string;
  spent: number;
  /** null for future months, so the budget line stops at today. */
  budget: number | null;
}

export function MonthBars({ data, height = 240 }: { data: MonthDatum[]; height?: number }) {
  return (
    <div>
      <Legend>
        <Swatch color="var(--chart-bar)">Spent</Swatch>
        <Swatch color="var(--chart-over)">Over budget</Swatch>
        <Swatch color="var(--muted)" dashed>
          Budget
        </Swatch>
      </Legend>
      <ComposedChart responsive style={{ width: "100%", height }} data={data} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
        <Tooltip
          cursor={{ fill: "var(--bg-soft)" }}
          content={tip(
            (d) => [
              { label: "Spent", value: rupee(d.spent as number), color: d.budget != null && (d.spent as number) > (d.budget as number) ? "var(--chart-over)" : "var(--chart-bar)" },
              ...(d.budget != null ? [{ label: "Budget", value: rupee(d.budget as number) }] : []),
            ],
            (d) => d.full as string,
          )}
        />
        <Bar dataKey="spent" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((d) => (
            <Cell key={d.full} fill={d.budget != null && d.spent > d.budget && d.spent > 0 ? "var(--chart-over)" : "var(--chart-bar)"} />
          ))}
        </Bar>
        <Line dataKey="budget" type="step" stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} activeDot={false} />
      </ComposedChart>
    </div>
  );
}

// ---------- category trend lines (max 3 series) ----------

export function TrendLines({
  data,
  series,
  height = 220,
}: {
  data: Record<string, number | string>[];
  series: { key: string; name: string }[];
  height?: number;
}) {
  const colors = ["var(--s1)", "var(--s2)", "var(--s3)"];
  return (
    <div>
      <Legend>
        {series.map((s, i) => (
          <Swatch key={s.key} color={colors[i]}>
            {s.name}
          </Swatch>
        ))}
      </Legend>
      <LineChart responsive style={{ width: "100%", height }} data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
        <Tooltip
          cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
          content={tip(
            (d) => series.map((s, i) => ({ label: s.name, value: rupee(Number(d[s.key] ?? 0)), color: colors[i] })),
            (d) => String(d.full),
          )}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stroke={colors[i]}
            strokeWidth={2}
            dot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)", fill: colors[i] }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
          />
        ))}
      </LineChart>
    </div>
  );
}

// ---------- histogram ----------

export function Histogram({ bins, markers, height = 200 }: { bins: { label: string; count: number; x0: number; x1: number }[]; markers?: ReactNode; height?: number }) {
  return (
    <div>
      {markers}
      <BarChart responsive style={{ width: "100%", height }} data={bins} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
        <Tooltip
          cursor={{ fill: "var(--bg-soft)" }}
          content={tip(
            (d) => [{ label: "Days", value: String(d.count) }],
            (d) => `₹${Math.round(d.x0 as number)} – ₹${Math.round(d.x1 as number)} per day`,
          )}
        />
        <Bar dataKey="count" fill="var(--chart-bar)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </div>
  );
}

// ---------- box plot (horizontal, SVG) ----------

export function BoxPlot({
  min,
  q1,
  median,
  q3,
  max,
  mean,
  lowerFence,
  upperFence,
  outliers,
}: {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  lowerFence: number;
  upperFence: number;
  outliers: number[];
}) {
  // Draw at the real pixel width so labels stay readable on phones and laptops alike.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lo = Math.min(min, 0);
  const hi = max * 1.05 || 1;
  const x = (v: number) => 16 + ((v - lo) / (hi - lo)) * (W - 32);
  const whiskLo = Math.max(min, lowerFence);
  const whiskHi = Math.min(max, upperFence);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (hi - lo));
  return (
    <div ref={wrap}>
      <svg viewBox={`0 0 ${W} 96`} width={W} height={96} className="block" role="img" aria-label={`Box plot: median ${rupee(median)}, middle half between ${rupee(q1)} and ${rupee(q3)}`}>
        <line x1={x(whiskLo)} x2={x(q1)} y1={40} y2={40} stroke="var(--muted)" strokeWidth={2} />
        <line x1={x(q3)} x2={x(whiskHi)} y1={40} y2={40} stroke="var(--muted)" strokeWidth={2} />
        <line x1={x(whiskLo)} x2={x(whiskLo)} y1={30} y2={50} stroke="var(--muted)" strokeWidth={2} />
        <line x1={x(whiskHi)} x2={x(whiskHi)} y1={30} y2={50} stroke="var(--muted)" strokeWidth={2} />
        <rect x={x(q1)} y={22} width={Math.max(2, x(q3) - x(q1))} height={36} rx={6} fill="color-mix(in srgb, var(--chart-bar) 22%, transparent)" stroke="var(--chart-bar)" strokeWidth={2} />
        <line x1={x(median)} x2={x(median)} y1={22} y2={58} stroke="var(--chart-bar)" strokeWidth={3} />
        <path d={`M${x(mean)} 14 l5 -8 h-10 z`} fill="var(--ink)">
          <title>Mean {rupee(mean)}</title>
        </path>
        {outliers.map((o, i) => (
          <circle key={i} cx={x(o)} cy={40} r={4.5} fill="var(--chart-over)" stroke="var(--card)" strokeWidth={2}>
            <title>Outlier day: {rupee(o)}</title>
          </circle>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={86} textAnchor="middle" fontSize={11} fill="var(--muted)">
            {compact(t)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ---------- forecast: cumulative actual + projection band ----------

export interface ForecastDatum {
  label: string;
  full: string;
  actual?: number;
  projected?: number;
  band?: [number, number];
}

export function ForecastChart({ data, budget, height = 240 }: { data: ForecastDatum[]; budget: number; height?: number }) {
  return (
    <div>
      <Legend>
        <Swatch color="var(--chart-bar)">Spent so far (cumulative)</Swatch>
        <Swatch color="var(--s2)" dashed>
          Projection
        </Swatch>
        <Swatch color="color-mix(in srgb, var(--s2) 25%, transparent)">95% interval</Swatch>
        <Swatch color="var(--muted)" dashed>
          Budget {rupee(budget)}
        </Swatch>
      </Legend>
      <ComposedChart responsive style={{ width: "100%", height }} data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
        <Tooltip
          cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
          content={tip(
            (d) => {
              const rows: { label: string; value: string; color?: string }[] = [];
              if (d.actual != null) rows.push({ label: "Spent", value: rupee(d.actual as number), color: "var(--chart-bar)" });
              if (d.projected != null) rows.push({ label: "Projected", value: rupee(d.projected as number), color: "var(--s2)" });
              const band = d.band as [number, number] | undefined;
              if (band) rows.push({ label: "95% range", value: `${rupee(band[0])} – ${rupee(band[1])}` });
              return rows;
            },
            (d) => d.full as string,
          )}
        />
        <ReferenceLine y={budget} stroke="var(--muted)" strokeDasharray="5 4" strokeWidth={1.5} />
        <Area dataKey="band" stroke="none" fill="var(--s2)" fillOpacity={0.18} activeDot={false} isAnimationActive={false} />
        <Line dataKey="projected" stroke="var(--s2)" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} />
        <Line dataKey="actual" stroke="var(--chart-bar)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
      </ComposedChart>
    </div>
  );
}
