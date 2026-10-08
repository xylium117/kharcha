"use client";

import { format } from "date-fns";
import { Repeat } from "lucide-react";
import { rupee } from "@/lib/format";
import type { Category, Expense } from "@/lib/types";
import { useUI } from "./AppShell";

const TAG_STYLE = {
  need: { label: "need", bg: "#B8F2E6" },
  want: { label: "want", bg: "#FFD6A5" },
  waste: { label: "waste", bg: "#FFADAD" },
};

export function ExpenseRow({ e, cat, showDate }: { e: Expense; cat?: Category; showDate?: boolean }) {
  const { openAdd } = useUI();
  return (
    <button
      onClick={() => openAdd({ edit: e })}
      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-bg-soft"
    >
      <span
        className="grid size-11 shrink-0 place-items-center rounded-2xl text-xl"
        style={{ background: cat?.color ?? "#eee" }}
        aria-hidden
      >
        {cat?.emoji ?? "✨"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate font-semibold">
          {e.title}
          {e.mood && <span className="text-sm">{e.mood}</span>}
          {e.recurringId && <Repeat size={13} className="shrink-0 text-muted" aria-label="Recurring" />}
        </span>
        <span className="block truncate text-xs text-muted">
          {showDate ? format(e.ts, "d MMM, h:mm a") : format(e.ts, "h:mm a")}
          {e.place ? ` · ${e.place}` : ""} · {e.paymentMode}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className="num font-bold">{rupee(e.amount)}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2d2a3e]"
          style={{ background: TAG_STYLE[e.tag].bg }}
        >
          {TAG_STYLE[e.tag].label}
        </span>
      </span>
    </button>
  );
}
