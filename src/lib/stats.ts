import {
  linearRegression,
  mean as ssMean,
  median as ssMedian,
  quantileSorted,
  sampleStandardDeviation,
} from "simple-statistics";

export interface Describe {
  n: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
  cv: number;
  skewness: number;
}

export function describe(values: number[]): Describe | null {
  const n = values.length;
  if (n === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = ssMean(values);
  const sd = n > 1 ? sampleStandardDeviation(values) : 0;
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  let skewness = 0;
  if (n > 2 && sd > 0) {
    const m3 = values.reduce((s, x) => s + ((x - mean) / sd) ** 3, 0);
    skewness = (n / ((n - 1) * (n - 2))) * m3;
  }
  return {
    n,
    mean,
    median: ssMedian(values),
    sd,
    min: sorted[0],
    max: sorted[n - 1],
    q1,
    q3,
    iqr: q3 - q1,
    cv: mean > 0 ? sd / mean : 0,
    skewness,
  };
}

export interface Outlier<T> {
  item: T;
  value: number;
  z: number;
}

/** Items whose z-score is at least `threshold` (high spenders only). */
export function zOutliers<T>(items: T[], value: (t: T) => number, threshold = 2): Outlier<T>[] {
  const vals = items.map(value);
  if (vals.length < 3) return [];
  const m = ssMean(vals);
  const sd = sampleStandardDeviation(vals);
  if (sd === 0) return [];
  return items
    .map((item, i) => ({ item, value: vals[i], z: (vals[i] - m) / sd }))
    .filter((o) => o.z >= threshold)
    .sort((a, b) => b.z - a.z);
}

/** Box-plot fences (Tukey). */
export function tukeyFences(d: Describe): { lower: number; upper: number } {
  return { lower: d.q1 - 1.5 * d.iqr, upper: d.q3 + 1.5 * d.iqr };
}

// ---------- t distribution ----------

function logGamma(x: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a t statistic with df degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!isFinite(t)) return 0;
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

/** Critical t value for a two-sided interval (bisection). */
export function tCritical(df: number, alpha = 0.05): number {
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface WelchResult {
  meanA: number;
  meanB: number;
  diff: number;
  t: number;
  df: number;
  p: number;
  nA: number;
  nB: number;
}

export function welchTTest(a: number[], b: number[]): WelchResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const mA = ssMean(a);
  const mB = ssMean(b);
  const vA = sampleStandardDeviation(a) ** 2;
  const vB = sampleStandardDeviation(b) ** 2;
  const seA = vA / a.length;
  const seB = vB / b.length;
  const se = Math.sqrt(seA + seB);
  if (se === 0) return { meanA: mA, meanB: mB, diff: mA - mB, t: 0, df: a.length + b.length - 2, p: 1, nA: a.length, nB: b.length };
  const t = (mA - mB) / se;
  const df = (seA + seB) ** 2 / (seA ** 2 / (a.length - 1) + seB ** 2 / (b.length - 1));
  return { meanA: mA, meanB: mB, diff: mA - mB, t, df, p: tTwoSidedP(t, df), nA: a.length, nB: b.length };
}

// ---------- histogram ----------

export interface Bin {
  x0: number;
  x1: number;
  count: number;
  label: string;
}

export function histogram(values: number[], maxBins = 12): Bin[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max === min) return [{ x0: min, x1: max, count: values.length, label: `${Math.round(min)}` }];
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  // Freedman–Diaconis, falling back to Sturges
  let width = iqr > 0 ? (2 * iqr) / Math.cbrt(values.length) : 0;
  let bins = width > 0 ? Math.ceil((max - min) / width) : Math.ceil(Math.log2(values.length) + 1);
  bins = Math.min(maxBins, Math.max(4, bins));
  width = niceStep((max - min) / bins);
  const start = Math.floor(min / width) * width;
  const out: Bin[] = [];
  for (let x = start; x <= max; x += width) {
    out.push({ x0: x, x1: x + width, count: 0, label: `${Math.round(x)}–${Math.round(x + width)}` });
  }
  for (const v of values) {
    const i = Math.min(out.length - 1, Math.floor((v - start) / width));
    out[i].count++;
  }
  return out;
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * p;
}

// ---------- forecast ----------

export interface Forecast {
  /** Projection assuming daily spends are i.i.d. with the observed mean. */
  expected: number;
  lower: number;
  upper: number;
  /** Projection using the last-7-day moving average. */
  movingAvg: number;
  /** Linear trend in daily spend (₹ per day, per day). */
  trendSlope: number;
  daysObserved: number;
  daysRemaining: number;
  /** Standard error of the projected total. */
  se: number;
  /** Mean daily spend used for the projection. */
  mu: number;
  /** Projection and 95% interval j days after today. */
  at: (j: number) => { expected: number; lower: number; upper: number };
  /** How many sample days were capped at the Tukey upper fence. */
  capped: number;
}

/**
 * @param dailySoFar daily totals of completed days in this period (today excluded), recurring bills excluded
 * @param spentSoFar total spent so far including today
 * @param daysRemaining days left after today
 * @param historyDaily recent daily totals before this period, used to pad a young period
 * @param knownUpcoming bills already scheduled for the rest of the period (added, not modelled)
 */
export function forecastPeriod(
  dailySoFar: number[],
  spentSoFar: number,
  daysRemaining: number,
  historyDaily: number[] = [],
  knownUpcoming = 0,
): Forecast | null {
  // Use this period's days, padded with recent history when the period is young.
  const raw = dailySoFar.length >= 7 ? dailySoFar : [...historyDaily.slice(-(14 - dailySoFar.length)), ...dailySoFar];
  const n = raw.length;
  if (n < 3) return null;
  // Winsorize: cap splurge days at Q3 + 1.5·IQR so one outlier doesn't drive the whole projection.
  const sorted = [...raw].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const cap = q3 + 1.5 * (q3 - q1);
  const sample = raw.map((v) => Math.min(v, cap));
  const capped = raw.filter((v) => v > cap).length;
  const mu = ssMean(sample);
  const sd = sampleStandardDeviation(sample);
  const crit = tCritical(n - 1);
  const r = daysRemaining;
  // Var(sum of j future days) + uncertainty in mu
  const at = (j: number) => {
    const e = spentSoFar + mu * j + (r > 0 ? (knownUpcoming * j) / r : 0);
    const s = sd * Math.sqrt(j + (j * j) / n);
    return { expected: e, lower: Math.max(spentSoFar, e - crit * s), upper: e + crit * s };
  };
  const end = at(r);
  const last7 = sample.slice(-7);
  const reg = linearRegression(sample.map((v, i) => [i, v]));
  return {
    ...end,
    movingAvg: spentSoFar + ssMean(last7) * r + knownUpcoming,
    trendSlope: reg.m,
    daysObserved: n,
    daysRemaining: r,
    se: sd * Math.sqrt(r + (r * r) / n),
    mu,
    at,
    capped,
  };
}

/** Plain-language reading of a p-value. */
export function explainP(p: number): string {
  if (p < 0.01) return "very strong evidence of a real difference";
  if (p < 0.05) return "a statistically significant difference (p < 0.05)";
  if (p < 0.1) return "weak evidence – could be a real difference, could be chance";
  return "no real evidence of a difference – likely just random variation";
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
