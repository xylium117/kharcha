import { addDays, format } from "date-fns";
import { categoryTotals, computeBudget, goalPerDay, goalSaved, inRange, tagTotals } from "./budget";
import { db } from "./db";
import { round } from "./format";
import { buildDayMap, loggingStreak } from "./streaks";

const SEASON_LABEL = {
  normal: "Normal days",
  exam: "Exam season (prioritise food, notes, transport; go easy on fun)",
  fest: "Fest mode (extra fun budget this month)",
  home: "Home trip (expect lower daily spending)",
} as const;

/**
 * Plain-text summary of the user's finances for the AI guide. Reads straight from the local database.
 * `trimmed` leaves out anything personal beyond numbers: no name, item titles, places, notes or friends' names.
 */
export async function buildSnapshot(now = new Date(), { trimmed = false } = {}): Promise<string> {
  const [settings, expenses, recurring, goals, contributions, ious, categories, wishlist, income] = await Promise.all([
    db.settings.get("me"),
    db.expenses.toArray(),
    db.recurring.toArray(),
    db.goals.toArray(),
    db.goalContributions.toArray(),
    db.ious.toArray(),
    db.categories.toArray(),
    db.wishlist.toArray(),
    db.income.toArray(),
  ]);
  if (!settings) return "No data yet.";
  const b = computeBudget({ settings, expenses, recurring, goals, contributions, income, ious, now });
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const pe = expenses.filter((e) => inRange(e.ts, b.period.start, b.period.nextStart));
  const cats = [...categoryTotals(pe).entries()].sort((a, b2) => b2[1] - a[1]);
  const tags = tagTotals(pe);
  const recent = [...expenses].sort((a, b2) => b2.ts - a.ts).slice(0, 15);
  const days = buildDayMap(expenses, settings.noSpendDays);
  const openIous = ious.filter((i) => !i.settled);
  const r = (n: number) => `₹${round(n)}`;
  const cat = (id: string) => catName.get(id) ?? id;
  const owedToMe = openIous.filter((i) => i.direction === "theyOwe");
  const iOwe = openIous.filter((i) => i.direction === "iOwe");
  const waiting = wishlist.filter((w) => w.status === "waiting");

  const lines = [
    trimmed ? `Now: ${format(now, "EEE d MMM yyyy, h:mm a")}.` : `Name: ${settings.name}. Now: ${format(now, "EEE d MMM yyyy, h:mm a")}.`,
    `Season mode: ${SEASON_LABEL[settings.seasonMode]}.`,
    `Budget period: ${format(b.period.start, "d MMM")} – ${format(addDays(b.period.nextStart, -1), "d MMM")} (day ${b.period.dayIndex} of ${b.period.daysInPeriod}, ${b.period.daysLeft} days left incl. today).`,
    `Monthly budget (pocket money): ${r(b.budget)}. Spent so far: ${r(b.spent)}. Moved to savings goals: ${r(b.savedThisPeriod)}. Remaining: ${r(b.remaining)}.`,
    `Money in this period (gifts, refunds, friends paying back): ${r(b.incomeThisPeriod)}. Paid for friends who still owe me (out of my wallet until repaid): ${r(b.lentThisPeriod)}.`,
    `Upcoming recurring this period: ${r(b.upcomingRecurring)}. Reserved for goals for rest of period: ${r(b.goalReserve)}.`,
    `Daily allowance today: ${r(b.dailyAllowance)}. Spent today: ${r(b.spentToday)}. SAFE TO SPEND TODAY: ${r(b.safeToday)}.`,
    `Pace: projected period total ${r(b.projectedEnd)} vs budget ${r(b.budget)} (health: ${b.health}).`,
    `Logging streak: ${loggingStreak(days, now)} days.`,
    `This period by category: ${cats.map(([id, v]) => `${catName.get(id) ?? id} ${r(v)}`).join(", ") || "none"}.`,
    `Need/Want/Waste this period: need ${r(tags.need)}, want ${r(tags.want)}, waste ${r(tags.waste)}.`,
    `Recent expenses:`,
    ...recent.map((e) =>
      trimmed
        ? `- ${format(e.ts, "d MMM h:mma")}: ${r(e.amount)} (${cat(e.categoryId)}, ${e.tag})`
        : `- ${format(e.ts, "d MMM h:mma")}: ${e.title} ${r(e.amount)} (${cat(e.categoryId)}, ${e.tag}${e.place ? `, at ${e.place}` : ""})`,
    ),
    `Savings goals:`,
    ...(goals.length
      ? goals.map((g, i) => {
          const saved = goalSaved(g.id, contributions);
          const label = trimmed ? `Goal ${i + 1} ${g.emoji}` : g.title;
          return `- ${label}: ${r(saved)} of ${r(g.target)} saved, deadline ${g.deadline}${g.completedAt ? " (DONE)" : `, needs ${r(goalPerDay(g, saved, now))}/day`}`;
        })
      : ["- none"]),
    `Recurring: ${
      recurring
        .filter((x) => x.active)
        .map((x) => `${trimmed ? cat(x.categoryId) : x.title} ${r(x.amount)} ${x.frequency}, next ${x.nextDate}`)
        .join("; ") || "none"
    }.`,
    trimmed
      ? `Open IOUs: friends owe me ${r(owedToMe.reduce((s, i) => s + i.amount, 0))} (${owedToMe.length} items); I owe ${r(iOwe.reduce((s, i) => s + i.amount, 0))} (${iOwe.length} items).`
      : `Open IOUs: ${openIous.map((i) => (i.direction === "theyOwe" ? `${i.person} owes me ${r(i.amount)}` : `I owe ${i.person} ${r(i.amount)}`)).join("; ") || "none"}.`,
    `Cool-off wishlist: ${waiting.map((w) => (trimmed ? `${cat(w.categoryId)} item ${r(w.price)}` : `${w.title} ${r(w.price)}`)).join("; ") || "empty"}.`,
  ];
  return lines.join("\n");
}
