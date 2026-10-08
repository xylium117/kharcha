"use client";

import { format, isToday, isYesterday } from "date-fns";
import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { ExpenseRow } from "@/components/ExpenseRow";
import { Button, Card, Chip, EmptyState, Input, Label, PageHeader, Select } from "@/components/ui";
import { PAYMENT_MODES, TAGS } from "@/lib/defaults";
import { dayKey, rupee } from "@/lib/format";
import { useCategories, useCategoryMap, useExpenses } from "@/lib/hooks";
import type { Expense, Tag } from "@/lib/types";

const PAGE = 60;

export default function HistoryPage() {
  const expenses = useExpenses();
  const categories = useCategories();
  const cats = useCategoryMap();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [pay, setPay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    if (!expenses) return [];
    const needle = q.trim().toLowerCase();
    return expenses.filter((e) => {
      if (needle && !`${e.title} ${e.place ?? ""} ${e.note ?? ""}`.toLowerCase().includes(needle)) return false;
      if (cat && e.categoryId !== cat) return false;
      if (tags.length && !tags.includes(e.tag)) return false;
      if (pay && e.paymentMode !== pay) return false;
      const k = dayKey(e.ts);
      if (from && k < from) return false;
      if (to && k > to) return false;
      return true;
    });
  }, [expenses, q, cat, tags, pay, from, to]);

  const groups = useMemo(() => {
    const dayTotal = new Map<string, number>();
    for (const e of filtered) dayTotal.set(dayKey(e.ts), (dayTotal.get(dayKey(e.ts)) ?? 0) + e.amount);
    const out: { key: string; date: Date; items: Expense[]; total: number }[] = [];
    for (const e of filtered.slice(0, limit)) {
      const k = dayKey(e.ts);
      let g = out[out.length - 1];
      if (!g || g.key !== k) {
        g = { key: k, date: new Date(e.ts), items: [], total: dayTotal.get(k) ?? 0 };
        out.push(g);
      }
      g.items.push(e);
    }
    return out;
  }, [filtered, limit]);

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const activeFilters = [cat, pay, from, to].filter(Boolean).length + tags.length;

  if (!expenses) return null;

  return (
    <div>
      <PageHeader title="History" subtitle={`${filtered.length} expenses · ${rupee(total)}`} />

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search momos, Zomato, canteen…" className="pl-10" />
        </div>
        <Button variant={showFilters || activeFilters ? "soft" : "ghost"} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <SlidersHorizontal size={18} />
          <span className="hidden sm:inline">Filters</span>
          {activeFilters > 0 && <span className="num rounded-full bg-accent px-1.5 text-xs text-white dark:text-[#15142a]">{activeFilters}</span>}
        </Button>
      </div>

      {showFilters && (
        <Card className="mb-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {TAGS.map((t) => (
              <Chip
                key={t.id}
                color={t.color}
                active={tags.includes(t.id)}
                onClick={() => setTags((ts) => (ts.includes(t.id) ? ts.filter((x) => x !== t.id) : [...ts, t.id]))}
              >
                {t.emoji} {t.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="f-cat">Category</Label>
              <Select id="f-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="f-pay">Paid with</Label>
              <Select id="f-pay" value={pay} onChange={(e) => setPay(e.target.value)}>
                <option value="">Any</option>
                {PAYMENT_MODES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="f-from">From</Label>
              <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="f-to">To</Label>
              <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCat("");
                setTags([]);
                setPay("");
                setFrom("");
                setTo("");
              }}
            >
              Clear filters
            </Button>
          )}
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState emoji="🔍" title={expenses.length ? "No matches" : "No expenses yet"}>
            {expenses.length ? "Try a different search or clear the filters." : "Tap ＋ to log your first one."}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g, i) => (
            <Card key={g.key} delay={Math.min(i, 6) * 0.03}>
              <div className="mb-1 flex items-baseline justify-between px-1">
                <h2 className="font-bold">
                  {isToday(g.date) ? "Today" : isYesterday(g.date) ? "Yesterday" : format(g.date, "EEE, d MMM yyyy")}
                </h2>
                <span className="num text-sm font-semibold text-muted">{rupee(g.total)}</span>
              </div>
              <div className="-mx-2">
                {g.items.map((e) => (
                  <ExpenseRow key={e.id} e={e} cat={cats.get(e.categoryId)} />
                ))}
              </div>
            </Card>
          ))}
          {filtered.length > limit && (
            <Button variant="soft" className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Show more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
