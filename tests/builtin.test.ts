import { describe, expect, it } from "vitest";
import { builtinWeeklyReport, parseExpenseBuiltin } from "../src/lib/server/builtin";
import { describe as describeStats, welchTTest, tukeyFences, histogram } from "../src/lib/stats";

describe("Built-in offline expense parser", () => {
  const categories = [
    { id: "food", name: "Food & Canteen" },
    { id: "transport", name: "Transport" },
    { id: "academics", name: "Academics" },
    { id: "shopping", name: "Shopping" },
  ];

  it("parses food with place and payment mode", () => {
    const res = parseExpenseBuiltin("momos 120 at Dey's stall, paid UPI", categories, "2026-10-09", "Friday", "17:30");
    expect(res.amount).toBe(120);
    expect(res.title.toLowerCase()).toContain("momo");
    expect(res.place).toBe("Dey's stall");
    expect(res.paymentMode).toBe("UPI");
    expect(res.categoryId).toBe("food");
    expect(res.date).toBe("2026-10-09");
  });

  it("parses cash expense and need tag", () => {
    const res = parseExpenseBuiltin("chai 15 cash", categories, "2026-10-09", "Friday", "17:30");
    expect(res.amount).toBe(15);
    expect(res.paymentMode).toBe("Cash");
    expect(res.categoryId).toBe("food");
    expect(res.date).toBe("2026-10-09");
  });

  it("parses travel note and transport category", () => {
    const res = parseExpenseBuiltin("auto to college 40", categories, "2026-10-09", "Friday", "17:30");
    expect(res.amount).toBe(40);
    expect(res.categoryId).toBe("transport");
    expect(res.tag).toBe("need");
  });

  it("parses regret as waste tag and yesterday date", () => {
    const res = parseExpenseBuiltin("zomato biryani 280 yesterday, regret it", categories, "2026-10-09", "Friday", "17:30");
    expect(res.amount).toBe(280);
    expect(res.tag).toBe("waste");
    expect(res.date).toBe("2026-10-08");
    expect(res.categoryId).toBe("food");
  });
});

describe("Built-in weekly report card", () => {
  it("generates structured report card matching grade", () => {
    const report = builtinWeeklyReport("Aayush", "Summary data", "A");
    expect(report.grade).toBe("A");
    expect(report.headline.length).toBeGreaterThan(0);
    expect(report.wins.length).toBeGreaterThanOrEqual(2);
    expect(report.tip.length).toBeGreaterThan(0);
    expect(report.funLine).toContain("🦉");
  });
});

describe("Stats Lab 30-day statistical calculations", () => {
  // Realistic 30 days of daily expense totals
  const dailySpend = [
    120, 150, 80, 210, 350, 420, 95, 110, 180, 130,
    290, 500, 75, 140, 160, 220, 310, 450, 90, 125,
    170, 240, 380, 480, 100, 115, 190, 135, 300, 520
  ];

  it("calculates accurate descriptive statistics for 30 days", () => {
    const stats = describeStats(dailySpend);
    expect(stats).not.toBeNull();
    if (!stats) return;

    expect(stats.n).toBe(30);
    expect(stats.min).toBe(75);
    expect(stats.max).toBe(520);
    expect(stats.mean).toBeGreaterThan(200);
    expect(stats.median).toBeGreaterThan(150);
    expect(stats.iqr).toBeGreaterThan(0);
    expect(stats.sd).toBeGreaterThan(0);
    expect(stats.se).toBeGreaterThan(0);
    expect(stats.ci95[0]).toBeLessThan(stats.mean);
    expect(stats.ci95[1]).toBeGreaterThan(stats.mean);
    expect(stats.gini).toBeGreaterThan(0);
    expect(stats.gini).toBeLessThanOrEqual(1);
    expect(typeof stats.kurtosis).toBe("number");
  });

  it("computes Tukey fences correctly", () => {
    const stats = describeStats(dailySpend)!;
    const fences = tukeyFences(stats);
    expect(fences.lower).toBeLessThan(stats.q1);
    expect(fences.upper).toBeGreaterThan(stats.q3);
  });

  it("computes Welch t-test for weekday vs weekend differences", () => {
    const weekdays = [120, 150, 80, 210, 95, 110, 180, 130, 75, 140, 160, 220, 90, 125, 170, 240, 100, 115, 190, 135];
    const weekends = [350, 420, 290, 500, 310, 450, 380, 480, 300, 520];

    const result = welchTTest(weekends, weekdays);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.meanA).toBeGreaterThan(result.meanB);
    expect(result.diff).toBeGreaterThan(100);
    expect(result.p).toBeLessThan(0.01); // Statistically significant difference
    expect(result.significant05).toBe(true);
    expect(result.cohensD).toBeGreaterThan(0.8); // Large effect size
  });

  it("creates histogram bins spanning the 30-day distribution", () => {
    const bins = histogram(dailySpend, 6);
    expect(bins.length).toBeGreaterThanOrEqual(1);
    const totalCount = bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(30);
  });
});
