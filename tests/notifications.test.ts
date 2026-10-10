import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { KharchaDB, db } from "../src/lib/db";
import { dayKey } from "../src/lib/format";
import {
  isNotificationSupported,
  getNotificationPermission,
  hasLoggedExpenseToday,
  checkAndDeliverDailyReminder,
} from "../src/lib/notifications";
import type { Settings } from "../src/lib/types";

describe("Notifications module", () => {
  beforeEach(async () => {
    await db.expenses.clear();
  });

  it("identifies notification support environment gracefully", () => {
    // In node test environment without window.Notification
    const supported = isNotificationSupported();
    expect(typeof supported).toBe("boolean");
    const perm = getNotificationPermission();
    expect(["granted", "denied", "default", "unsupported"]).toContain(perm);
  });

  it("checks whether an expense was logged today", async () => {
    const today = dayKey(new Date());
    expect(await hasLoggedExpenseToday(today)).toBe(false);

    await db.expenses.add({
      id: "exp-1",
      amount: 120,
      title: "Chai and samosa",
      categoryId: "chai",
      paymentMode: "UPI",
      tag: "need",
      source: "form",
      ts: Date.now(),
    });

    expect(await hasLoggedExpenseToday(today)).toBe(true);
  });

  it("skips reminder if already notified today", async () => {
    const today = dayKey(new Date());
    const mockSettings: Settings = {
      id: "me",
      name: "Aayush",
      monthlyBudget: 5000,
      monthStartDay: 1,
      budgetOverrides: {},
      seasonMode: "normal",
      academicStartMonth: 7,
      noSpendDays: [],
      statsVisits: 0,
      guruQuestions: 0,
      reminderTime: "21:00",
      notificationsEnabled: true,
      lastNotifiedDate: today, // already notified today
      createdAt: Date.now(),
    };

    const sent = await checkAndDeliverDailyReminder(mockSettings, false);
    expect(sent).toBe(false);
  });
});
