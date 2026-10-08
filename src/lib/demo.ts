import { addDays, addMonths, startOfDay } from "date-fns";
import { clearAll } from "./backup";
import { db, uid } from "./db";
import { DEFAULT_CATEGORIES, DEFAULT_QUICK_BUTTONS, defaultSettings } from "./defaults";
import { dayKey } from "./format";
import type { Expense, PaymentMode, Tag } from "./types";

/** Small seeded RNG so demo data looks the same every time. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tpl {
  title: string;
  cat: string;
  min: number;
  max: number;
  tag: Tag;
  place?: string;
  pay: PaymentMode;
  hours: [number, number];
  weight: number;
  weekendBoost?: number;
}

const TEMPLATES: Tpl[] = [
  { title: "Tea", cat: "chai", min: 10, max: 20, tag: "need", place: "College canteen", pay: "Cash", hours: [9, 17], weight: 10 },
  { title: "Bus fare", cat: "transport", min: 10, max: 25, tag: "need", pay: "Cash", hours: [8, 10], weight: 7, weekendBoost: 0.3 },
  { title: "Lunch thali", cat: "food", min: 50, max: 90, tag: "need", place: "Canteen", pay: "UPI", hours: [12, 14], weight: 7 },
  { title: "Momos", cat: "food", min: 60, max: 120, tag: "want", place: "Dey's stall", pay: "UPI", hours: [16, 19], weight: 3 },
  { title: "Xerox notes", cat: "books", min: 10, max: 60, tag: "need", place: "Xerox shop", pay: "Cash", hours: [10, 16], weight: 4, weekendBoost: 0.2 },
  { title: "Cold drink", cat: "chai", min: 20, max: 40, tag: "want", pay: "UPI", hours: [13, 18], weight: 3 },
  { title: "Metro", cat: "transport", min: 20, max: 50, tag: "need", pay: "UPI", hours: [8, 20], weight: 3 },
  { title: "Biryani", cat: "food", min: 150, max: 250, tag: "want", place: "Arsalan", pay: "UPI", hours: [19, 22], weight: 1, weekendBoost: 3 },
  { title: "Zomato order", cat: "food", min: 180, max: 350, tag: "waste", place: "Zomato", pay: "UPI", hours: [21, 23], weight: 0.5, weekendBoost: 1.6 },
  { title: "Movie ticket", cat: "fun", min: 150, max: 250, tag: "want", place: "INOX", pay: "UPI", hours: [15, 21], weight: 0.4, weekendBoost: 4 },
  { title: "Stationery", cat: "books", min: 30, max: 120, tag: "need", place: "Stationery shop", pay: "Cash", hours: [10, 18], weight: 1 },
  { title: "Chips & snacks", cat: "chai", min: 20, max: 50, tag: "waste", pay: "Cash", hours: [15, 23], weight: 1.2 },
  { title: "Medicines", cat: "health", min: 50, max: 200, tag: "need", place: "Pharmacy", pay: "UPI", hours: [10, 20], weight: 0.3 },
  { title: "T-shirt", cat: "shopping", min: 300, max: 700, tag: "want", place: "Myntra", pay: "UPI", hours: [20, 23], weight: 0.15, weekendBoost: 2 },
];

export async function loadDemoData(name = "Sinchan", budget = 6000): Promise<void> {
  await clearAll();
  const rand = mulberry32(42);
  const now = new Date();
  const today = startOfDay(now);
  const startDay = addDays(today, -80);

  const pick = (weekend: boolean) => {
    const weights = TEMPLATES.map((t) => t.weight * (weekend ? (t.weekendBoost ?? 1) : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < TEMPLATES.length; i++) {
      r -= weights[i];
      if (r <= 0) return TEMPLATES[i];
    }
    return TEMPLATES[0];
  };

  const expenses: Expense[] = [];
  for (let d = startDay; d <= today; d = addDays(d, 1)) {
    const isToday = d.getTime() === today.getTime();
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const recent = (today.getTime() - d.getTime()) / 86400000 < 10;
    if (!recent && rand() < 0.08) continue; // occasional unlogged day
    const count = isToday ? 2 : weekend ? 1 + Math.floor(rand() * 3) : 2 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const t = pick(weekend);
      const hour = t.hours[0] + Math.floor(rand() * (t.hours[1] - t.hours[0] + 1));
      const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(rand() * 60)).getTime();
      if (ts > now.getTime()) continue;
      const amount = Math.round((t.min + rand() * (t.max - t.min)) / 5) * 5;
      expenses.push({
        id: uid(),
        amount,
        categoryId: t.cat,
        title: t.title,
        place: t.place,
        paymentMode: t.pay,
        tag: t.tag,
        ts,
        source: rand() < 0.5 ? "quick" : "form",
      });
    }
  }
  // A couple of memorable outliers for the Stats Lab
  const splurge = addDays(today, -23);
  expenses.push({
    id: uid(), amount: 1299, categoryId: "shopping", title: "Sneakers (sale!)", place: "Puma store",
    paymentMode: "Card", tag: "want", ts: new Date(splurge.getFullYear(), splurge.getMonth(), splurge.getDate(), 18, 30).getTime(),
    source: "form", mood: "😄",
  });
  const fest = addDays(today, -9);
  expenses.push({
    id: uid(), amount: 650, categoryId: "fun", title: "College fest pass + food", place: "Fest ground",
    paymentMode: "UPI", tag: "want", ts: new Date(fest.getFullYear(), fest.getMonth(), fest.getDate(), 17, 0).getTime(),
    source: "form", mood: "😄",
  });

  // Recurring charges (posted history + next dates)
  const rechargeDay = 5;
  const rechargeId = uid();
  const ottId = uid();
  let rDate = new Date(startDay.getFullYear(), startDay.getMonth(), rechargeDay);
  if (rDate < startDay) rDate = addMonths(rDate, 1);
  while (rDate <= today) {
    expenses.push({ id: uid(), amount: 299, categoryId: "mobile", title: "Jio recharge", paymentMode: "UPI", tag: "need", ts: new Date(rDate.getFullYear(), rDate.getMonth(), rDate.getDate(), 9).getTime(), source: "recurring", recurringId: rechargeId });
    expenses.push({ id: uid(), amount: 59, categoryId: "fun", title: "Spotify student", paymentMode: "UPI", tag: "want", ts: new Date(rDate.getFullYear(), rDate.getMonth(), rDate.getDate(), 9).getTime(), source: "recurring", recurringId: ottId });
    rDate = addMonths(rDate, 1);
  }

  const settings = defaultSettings(name, budget);
  settings.createdAt = startDay.getTime();
  settings.noSpendDays = [dayKey(addDays(today, -40))];
  settings.statsVisits = 0;

  const g1 = uid();
  const g2 = uid();
  await db.transaction("rw", [db.settings, db.categories, db.quickButtons, db.expenses, db.recurring, db.goals, db.goalContributions, db.ious, db.wishlist], async () => {
    await db.settings.put(settings);
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
    await db.quickButtons.bulkAdd(DEFAULT_QUICK_BUTTONS);
    await db.expenses.bulkAdd(expenses);
    await db.recurring.bulkAdd([
      { id: rechargeId, title: "Jio recharge", amount: 299, categoryId: "mobile", frequency: "monthly", nextDate: dayKey(rDate), active: true },
      { id: ottId, title: "Spotify student", amount: 59, categoryId: "fun", frequency: "monthly", nextDate: dayKey(rDate), active: true },
    ]);
    await db.goals.bulkAdd([
      { id: g1, title: "Wireless headphones", emoji: "🎧", target: 2500, deadline: dayKey(addDays(today, 70)), createdAt: addDays(today, -30).getTime() },
      { id: g2, title: "Puri trip with friends", emoji: "🏖️", target: 3000, deadline: dayKey(addDays(today, 110)), createdAt: addDays(today, -15).getTime() },
    ]);
    await db.goalContributions.bulkAdd([
      { id: uid(), goalId: g1, amount: 500, ts: addDays(today, -28).getTime() },
      { id: uid(), goalId: g1, amount: 300, ts: addDays(today, -6).getTime() },
      { id: uid(), goalId: g2, amount: 400, ts: addDays(today, -12).getTime() },
    ]);
    await db.ious.bulkAdd([
      { id: uid(), person: "Rahul", amount: 120, direction: "theyOwe", reason: "Canteen lunch", ts: addDays(today, -3).getTime(), settled: false },
      { id: uid(), person: "Priya", amount: 80, direction: "iOwe", reason: "Xerox of her notes", ts: addDays(today, -2).getTime(), settled: false },
      { id: uid(), person: "Arka", amount: 250, direction: "theyOwe", reason: "Movie ticket", ts: addDays(today, -20).getTime(), settled: true, settledAt: addDays(today, -14).getTime() },
    ]);
    await db.wishlist.bulkAdd([
      { id: uid(), title: "Oversized hoodie", price: 899, categoryId: "shopping", addedAt: addDays(today, -2).getTime(), status: "waiting" },
    ]);
  });
}
