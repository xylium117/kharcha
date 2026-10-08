import { describe, expect, it } from "vitest";
import { weekNumber } from "@/lib/feedback";

describe("weekNumber", () => {
  const start = new Date(2026, 9, 1, 18, 0).getTime();
  it("counts weeks from the day the app was set up", () => {
    expect(weekNumber(start, new Date(2026, 9, 1, 9, 0))).toBe(1);
    expect(weekNumber(start, new Date(2026, 9, 7))).toBe(1);
    expect(weekNumber(start, new Date(2026, 9, 8))).toBe(2);
    expect(weekNumber(start, new Date(2026, 11, 31))).toBe(14);
  });
});
