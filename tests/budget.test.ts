import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";
import { computeBudget, getPeriod, goalReserve, upcomingRecurring } from "@/lib/budget";
import { defaultSettings } from "@/lib/defaults";
import { dayKey } from "@/lib/format";
import type { Expense, Goal, Recurring } from "@/lib/types";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

function exp(amount: number, date: Date): Expense {
  return { id: `${date.getTime()}-${amount}-${Math.random()}`, amount, categoryId: "food", title: "x", paymentMode: "UPI", tag: "need", ts: date.getTime(), source: "form" };
}

describe("getPeriod", () => {
  it("handles a period starting on the 1st", () => {
    const p = getPeriod(at(2026, 10, 6), 1);
    expect(dayKey(p.start)).toBe("2026-10-01");
    expect(dayKey(p.nextStart)).toBe("2026-11-01");
    expect(p.daysInPeriod).toBe(31);
    expect(p.daysLeft).toBe(26);
    expect(p.dayIndex).toBe(6);
  });

  it("handles pocket money arriving mid-month", () => {
    const p = getPeriod(at(2026, 10, 6), 10);
    expect(dayKey(p.start)).toBe("2026-09-10");
    expect(dayKey(p.nextStart)).toBe("2026-10-10");
    expect(p.daysInPeriod).toBe(30);
    expect(p.daysLeft).toBe(4);
    expect(p.dayIndex).toBe(27);
  });

  it("supports offsets to previous periods", () => {
    const p = getPeriod(at(2026, 1, 15), 1, -1);
    expect(dayKey(p.start)).toBe("2025-12-01");
    expect(p.daysInPeriod).toBe(31);
  });
});

describe("computeBudget", () => {
  const settings = defaultSettings("Test", 3100);
  const base = { settings, recurring: [] as Recurring[], goals: [] as Goal[], contributions: [] };

  it("splits what's left evenly over the remaining days", () => {
    const expenses = [1, 2, 3, 4, 5].map((d) => exp(100, at(2026, 10, d))).concat(exp(50, at(2026, 10, 6, 9)));
    const b = computeBudget({ ...base, expenses, now: at(2026, 10, 6, 15) });
    expect(b.spent).toBe(550);
    expect(b.spentBeforeToday).toBe(500);
    expect(b.dailyAllowance).toBeCloseTo(100); // (3100 - 500) / 26
    expect(b.safeToday).toBeCloseTo(50);
    expect(b.remaining).toBe(2550);
    expect(b.health).toBe("ok"); // projected ₹2,842 is >85% of budget
  });

  it("gives the whole remaining pool on the last day of the period", () => {
    const b = computeBudget({ ...base, expenses: [exp(3000, at(2026, 10, 2))], now: at(2026, 10, 31) });
    expect(b.period.daysLeft).toBe(1);
    expect(b.dailyAllowance).toBeCloseTo(100);
  });

  it("never gives a negative allowance when overspent", () => {
    const b = computeBudget({ ...base, expenses: [exp(3500, at(2026, 10, 2)), exp(40, at(2026, 10, 6))], now: at(2026, 10, 6) });
    expect(b.dailyAllowance).toBe(0);
    expect(b.safeToday).toBe(-40);
    expect(b.health).toBe("over");
  });

  it("subtracts upcoming recurring charges and goal reserves", () => {
    const recurring: Recurring[] = [{ id: "r", title: "Recharge", amount: 260, categoryId: "mobile", frequency: "monthly", nextDate: "2026-10-20", active: true }];
    const b = computeBudget({ ...base, recurring, expenses: [], now: at(2026, 10, 6) });
    expect(b.upcomingRecurring).toBe(260);
    expect(b.dailyAllowance).toBeCloseTo((3100 - 260) / 26);
  });
});

describe("upcomingRecurring", () => {
  it("counts every weekly occurrence after today within the period", () => {
    const r: Recurring = { id: "w", title: "Gym", amount: 50, categoryId: "health", frequency: "weekly", nextDate: "2026-10-08", active: true };
    expect(upcomingRecurring([r], at(2026, 10, 6), new Date(2026, 10, 1))).toBe(200); // 8, 15, 22, 29
  });

  it("ignores charges due today (they get posted) and inactive ones", () => {
    const today: Recurring = { id: "t", title: "A", amount: 99, categoryId: "x", frequency: "monthly", nextDate: "2026-10-06", active: true };
    const off: Recurring = { id: "o", title: "B", amount: 99, categoryId: "x", frequency: "monthly", nextDate: "2026-10-20", active: false };
    expect(upcomingRecurring([today, off], at(2026, 10, 6), new Date(2026, 10, 1))).toBe(0);
  });
});

describe("goalReserve", () => {
  it("reserves the per-day goal amount for the rest of the period", () => {
    const today = at(2026, 10, 6);
    const goal: Goal = { id: "g", title: "Headphones", emoji: "🎧", target: 1000, deadline: dayKey(addDays(today, 99)), createdAt: 0 };
    expect(goalReserve([goal], [], today, 26)).toBeCloseTo(260); // 1000 / 100 days × 26
  });

  it("caps the reserve at what's still needed", () => {
    const today = at(2026, 10, 6);
    const goal: Goal = { id: "g", title: "Book", emoji: "📚", target: 300, deadline: dayKey(addDays(today, 2)), createdAt: 0 };
    expect(goalReserve([goal], [{ id: "c", goalId: "g", amount: 100, ts: 0 }], today, 26)).toBe(200);
  });
});

describe("money in and lent to friends", () => {
  const settings = defaultSettings("Test", 3100);
  const base = { settings, recurring: [] as Recurring[], goals: [] as Goal[], contributions: [] };

  it("adds gifts and repayments to what's left", () => {
    const income = [{ id: "g", amount: 520, source: "gift" as const, ts: at(2026, 10, 3).getTime() }];
    const b = computeBudget({ ...base, expenses: [], income, now: at(2026, 10, 6) });
    expect(b.incomeThisPeriod).toBe(520);
    expect(b.dailyAllowance).toBeCloseTo((3100 + 520) / 26);
    expect(b.remaining).toBe(3620);
  });

  it("takes money paid for friends out until they pay it back", () => {
    const ious = [
      { id: "r", person: "Rahul", amount: 260, direction: "theyOwe" as const, reason: "Pizza", ts: at(2026, 10, 2).getTime(), settled: false },
      { id: "p", person: "Priya", amount: 80, direction: "iOwe" as const, reason: "Xerox", ts: at(2026, 10, 2).getTime(), settled: false },
    ];
    const lent = computeBudget({ ...base, expenses: [], ious, now: at(2026, 10, 6) });
    expect(lent.lentThisPeriod).toBe(260); // "I owe" doesn't count: my share is already an expense
    expect(lent.dailyAllowance).toBeCloseTo((3100 - 260) / 26);

    // Rahul pays back: settled IOU + repayment income → back to the full pool
    const repaid = computeBudget({
      ...base,
      expenses: [],
      ious: [{ ...ious[0], settled: true }, ious[1]],
      income: [{ id: "x", amount: 260, source: "repayment" as const, ts: at(2026, 10, 5).getTime(), iouId: "r" }],
      now: at(2026, 10, 6),
    });
    expect(repaid.dailyAllowance).toBeCloseTo(3100 / 26);
  });

  it("ignores money from other periods", () => {
    const income = [{ id: "old", amount: 999, source: "gift" as const, ts: at(2026, 9, 20).getTime() }];
    expect(computeBudget({ ...base, expenses: [], income, now: at(2026, 10, 6) }).incomeThisPeriod).toBe(0);
  });
});
