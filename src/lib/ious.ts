import { db, uid } from "./db";
import type { IOU } from "./types";

/**
 * Marks IOUs settled. A friend paying me back ("they owe me") is money coming in, so it is recorded
 * as income and raises the current budget. Returns an undo function.
 */
export async function settleIous(items: IOU[], ts = Date.now()): Promise<() => Promise<void>> {
  const open = items.filter((i) => !i.settled);
  const repayments = open
    .filter((i) => i.direction === "theyOwe")
    .map((i) => ({ id: uid(), amount: i.amount, source: "repayment" as const, note: `${i.person}: ${i.reason}`.trim(), ts, iouId: i.id }));
  await db.transaction("rw", db.ious, db.income, async () => {
    await db.ious.bulkUpdate(open.map((i) => ({ key: i.id, changes: { settled: true, settledAt: ts } })));
    await db.income.bulkAdd(repayments);
  });
  return async () => {
    await db.transaction("rw", db.ious, db.income, async () => {
      await db.ious.bulkUpdate(open.map((i) => ({ key: i.id, changes: { settled: false, settledAt: undefined } })));
      await db.income.bulkDelete(repayments.map((r) => r.id));
    });
  };
}
