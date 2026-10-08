import { startOfDay } from "date-fns";
import { stepRecurring } from "./budget";
import { db, uid } from "./db";
import { dayKey, parseDayKey } from "./format";
import type { Expense } from "./types";

/** Posts every recurring expense whose date has arrived, then moves its next date forward. Returns how many were posted. */
export async function postDueRecurring(now = new Date()): Promise<number> {
  const today = startOfDay(now);
  return db.transaction("rw", db.recurring, db.expenses, async () => {
    let posted = 0;
    const due = await db.recurring.where("nextDate").belowOrEqual(dayKey(today)).toArray();
    for (const r of due) {
      if (!r.active) continue;
      let d = parseDayKey(r.nextDate);
      const toAdd: Expense[] = [];
      let guard = 0;
      while (d <= today && guard++ < 60) {
        toAdd.push({
          id: uid(),
          amount: r.amount,
          categoryId: r.categoryId,
          title: r.title,
          paymentMode: "UPI",
          tag: "need",
          ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0).getTime(),
          source: "recurring",
          recurringId: r.id,
        });
        d = stepRecurring(d, r.frequency);
      }
      await db.expenses.bulkAdd(toAdd);
      await db.recurring.update(r.id, { nextDate: dayKey(d) });
      posted += toAdd.length;
    }
    return posted;
  });
}
