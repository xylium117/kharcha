import { format } from "date-fns";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹1,25,000 style (Indian digit grouping). */
export function rupee(n: number, precise = false): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}₹${(precise ? inr2 : inr).format(Math.abs(n))}`;
}

export function dayKey(d: Date | number): string {
  return format(d, "yyyy-MM-dd");
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Current time in ms – for event handlers (keeps render code free of impure calls). */
export function timestamp(): number {
  return Date.now();
}
