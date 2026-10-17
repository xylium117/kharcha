import { format } from "date-fns";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Currency symbol map for supported currencies. */
export const CURRENCY_MAP: Record<string, { symbol: string; locale: string }> = {
  INR: { symbol: "₹", locale: "en-IN" },
  USD: { symbol: "$", locale: "en-US" },
  EUR: { symbol: "€", locale: "de-DE" },
  GBP: { symbol: "£", locale: "en-GB" },
  JPY: { symbol: "¥", locale: "ja-JP" },
  SGD: { symbol: "S$", locale: "en-SG" },
  AED: { symbol: "د.إ", locale: "ar-AE" },
  CAD: { symbol: "CA$", locale: "en-CA" },
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_MAP);

function getCurrencyFormatter(currency: string, precise = false) {
  const info = CURRENCY_MAP[currency] ?? CURRENCY_MAP.INR;
  return new Intl.NumberFormat(info.locale, { maximumFractionDigits: precise ? 2 : 0 });
}

/** Format an amount with the given currency symbol (defaults to ₹ INR). */
export function formatMoney(n: number, currency = "INR", precise = false): string {
  const sign = n < 0 ? "−" : "";
  const info = CURRENCY_MAP[currency] ?? CURRENCY_MAP.INR;
  const fmt = getCurrencyFormatter(currency, precise);
  return `${sign}${info.symbol}${fmt.format(Math.abs(n))}`;
}

/** ₹1,25,000 style (Indian digit grouping). Legacy helper kept for compat. */
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
