"use client";

import { addDays, format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { fetchWeeklyReport, getAIStatus } from "@/lib/ai-client";
import { celebrate } from "@/lib/confetti";
import { db } from "@/lib/db";
import { dayKey } from "@/lib/format";
import { useCategories, useExpenses, useNow, useSettings } from "@/lib/hooks";
import { lastWeekStart, localReport, metricsSummary, weekMetrics } from "@/lib/report";
import { Button, Card, SectionTitle } from "./ui";

const GRADE_COLOR: Record<string, string> = {
  "A+": "#B8F2E6",
  A: "#CAFFBF",
  B: "#A0C4FF",
  C: "#FDFFB6",
  D: "#FFD6A5",
  F: "#FFADAD",
};

export function WeeklyReportCard({ delay = 0 }: { delay?: number }) {
  const settings = useSettings();
  const expenses = useExpenses();
  const categories = useCategories();
  const now = useNow();
  const ws = lastWeekStart(now);
  const key = dayKey(ws);
  const report = useLiveQuery(() => db.reports.get(key), [key]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!settings || !expenses) return null;
  const firstTs = expenses.length ? expenses[expenses.length - 1].ts : now.getTime();
  if (firstTs > addDays(ws, 7).getTime()) return null; // no data from last week yet

  async function generate() {
    if (!settings || !expenses) return;
    setBusy(true);
    setErr("");
    const m = weekMetrics(expenses, settings, categories, ws);
    try {
      const { ai, trimSnapshot } = await getAIStatus();
      if (ai) {
        const r = await fetchWeeklyReport(trimSnapshot ? "you" : settings.name, metricsSummary(m, { trimmed: trimSnapshot }), m.grade);
        await db.reports.put({ ...r, weekStart: key, createdAt: Date.now(), byAI: true });
      } else {
        await db.reports.put(localReport(m));
      }
      if (m.score >= 80) celebrate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      await db.reports.put(localReport(m));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card delay={delay}>
      <SectionTitle
        action={
          report && (
            <button onClick={generate} disabled={busy} className="grid size-8 place-items-center rounded-full text-muted hover:bg-bg-soft" aria-label="Regenerate report">
              <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
            </button>
          )
        }
      >
        📜 Weekly report card
      </SectionTitle>
      <p className="-mt-2 mb-3 text-xs text-muted">
        {format(ws, "d MMM")} – {format(addDays(ws, 6), "d MMM")}
      </p>
      {!report ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">Stash has graded your last week. Ready to see it?</p>
          <Button onClick={generate} disabled={busy}>
            {busy ? "Grading…" : "Reveal my grade 🎓"}
          </Button>
        </div>
      ) : (
        <div className="flex gap-4">
          <div
            className="num grid size-16 shrink-0 place-items-center rounded-2xl text-3xl font-extrabold text-[#2d2a3e]"
            style={{ background: GRADE_COLOR[report.grade] ?? "#C8B6FF" }}
          >
            {report.grade}
          </div>
          <div className="min-w-0 space-y-2 text-sm">
            <p className="font-bold">{report.headline}</p>
            <ul className="space-y-1">
              {report.wins.map((w) => (
                <li key={w}>✅ {w}</li>
              ))}
            </ul>
            <p>
              <b>Next week:</b> {report.tip}
            </p>
            <p className="text-muted italic">{report.funLine}</p>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-bad">AI report failed ({err}). Showing the offline version.</p>}
    </Card>
  );
}
