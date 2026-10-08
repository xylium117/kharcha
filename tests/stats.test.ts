import { describe as group, expect, it } from "vitest";
import { describe, forecastPeriod, histogram, normalCdf, tCritical, tTwoSidedP, welchTTest, zOutliers } from "@/lib/stats";

group("describe", () => {
  it("matches hand-computed values", () => {
    const d = describe([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(d.n).toBe(8);
    expect(d.mean).toBe(5);
    expect(d.median).toBe(4.5);
    expect(d.sd).toBeCloseTo(Math.sqrt(32 / 7), 6); // sample SD
    expect(d.min).toBe(2);
    expect(d.max).toBe(9);
  });

  it("returns null for no data", () => {
    expect(describe([])).toBeNull();
  });
});

group("t distribution", () => {
  it("gives the textbook critical value", () => {
    expect(tCritical(10)).toBeCloseTo(2.228, 2);
    expect(tCritical(30)).toBeCloseTo(2.042, 2);
  });

  it("gives two-sided p-values", () => {
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(0, 5)).toBeCloseTo(1, 6);
  });
});

group("welchTTest", () => {
  it("reduces to the pooled result for equal variances and sizes", () => {
    const r = welchTTest([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])!;
    expect(r.t).toBeCloseTo(-5, 6);
    expect(r.df).toBeCloseTo(8, 6);
    expect(r.p).toBeCloseTo(0.00105, 4);
  });

  it("needs at least two values per group", () => {
    expect(welchTTest([1], [2, 3])).toBeNull();
  });
});

group("normalCdf", () => {
  it("matches standard values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });
});

group("histogram", () => {
  it("puts every value in exactly one bin", () => {
    const values = [10, 20, 20, 35, 40, 80, 120, 15, 60, 60, 45];
    const bins = histogram(values);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(values.length);
    expect(bins[0].x0).toBeLessThanOrEqual(10);
    expect(bins[bins.length - 1].x1).toBeGreaterThan(120);
  });
});

group("zOutliers", () => {
  it("flags the spike day", () => {
    const out = zOutliers([10, 10, 10, 10, 10, 10, 100], (v) => v, 2);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(100);
  });
});

group("forecastPeriod", () => {
  it("projects a constant spender exactly", () => {
    const f = forecastPeriod(Array(10).fill(100), 1050, 20)!;
    expect(f.expected).toBe(3050);
    expect(f.lower).toBe(3050);
    expect(f.upper).toBe(3050);
  });

  it("widens the interval further into the future", () => {
    const f = forecastPeriod([50, 150, 80, 120, 100, 90, 110, 60, 140, 100], 1000, 20)!;
    const near = f.at(2);
    const far = f.at(20);
    expect(far.upper - far.lower).toBeGreaterThan(near.upper - near.lower);
    expect(f.mu).toBeCloseTo(100);
  });

  it("caps a splurge day so it doesn't dominate, and adds known bills", () => {
    const f = forecastPeriod([90, 110, 100, 95, 105, 100, 2000, 100], 2700, 10, [], 300)!;
    expect(f.capped).toBe(1);
    expect(f.mu).toBeLessThan(150); // raw mean would be ~337
    expect(f.at(10).expected).toBeCloseTo(2700 + f.mu * 10 + 300);
  });

  it("needs at least 3 days", () => {
    expect(forecastPeriod([100, 100], 200, 10)).toBeNull();
  });
});
