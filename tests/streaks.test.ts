import { describe, expect, it } from "vitest";
import { defaultSettings } from "@/lib/defaults";
import { buildDayMap, loggingStreak, noJunkWeek, underLimitStreak } from "@/lib/streaks";
import type { Expense, Tag } from "@/lib/types";

const at = (m: number, d: number) => new Date(2026, m - 1, d, 12);
function exp(m: number, d: number, amount = 50, tag: Tag = "need"): Expense {
  return { id: `${m}-${d}-${amount}-${tag}`, amount, categoryId: "food", title: "x", paymentMode: "UPI", tag, ts: at(m, d).getTime(), source: "form" };
}

describe("loggingStreak", () => {
  it("doesn't break just because today isn't logged yet", () => {
    const days = buildDayMap([exp(10, 3), exp(10, 4), exp(10, 5)], []);
    expect(loggingStreak(days, at(10, 6))).toBe(3);
  });

  it("counts today once logged", () => {
    const days = buildDayMap([exp(10, 4), exp(10, 5), exp(10, 6)], []);
    expect(loggingStreak(days, at(10, 6))).toBe(3);
  });

  it("continues across a month boundary", () => {
    const days = buildDayMap([exp(9, 29), exp(9, 30), exp(10, 1), exp(10, 2)], []);
    expect(loggingStreak(days, at(10, 2))).toBe(4);
  });

  it("counts marked no-spend days and breaks on gaps", () => {
    const days = buildDayMap([exp(10, 1), exp(10, 3)], ["2026-10-04"]);
    expect(loggingStreak(days, at(10, 4))).toBe(2);
  });
});

describe("underLimitStreak", () => {
  const settings = defaultSettings("T", 3100); // October: ₹100/day even limit

  it("stops at a day over the limit", () => {
    const days = buildDayMap([exp(10, 3, 90), exp(10, 4, 100), exp(10, 5, 150)], []);
    expect(underLimitStreak(days, settings, at(10, 6))).toBe(0);
  });

  it("counts consecutive days within the limit", () => {
    const days = buildDayMap([exp(10, 2, 150), exp(10, 3, 90), exp(10, 4, 100), exp(10, 5, 20)], []);
    expect(underLimitStreak(days, settings, at(10, 6))).toBe(3);
  });
});

describe("noJunkWeek", () => {
  it("needs 7 logged days without waste", () => {
    const clean = [1, 2, 3, 4, 5, 6, 7].map((d) => exp(10, d));
    expect(noJunkWeek(buildDayMap(clean, []), at(10, 8))).toBe(true);
    expect(noJunkWeek(buildDayMap([...clean, exp(10, 4, 30, "waste")], []), at(10, 8))).toBe(false);
    expect(noJunkWeek(buildDayMap(clean.slice(1), []), at(10, 8))).toBe(false);
  });
});
