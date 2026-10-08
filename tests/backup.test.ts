import { describe, expect, it } from "vitest";
import { backupDue } from "@/lib/backup";

const day = 24 * 60 * 60 * 1000;
const now = new Date(2026, 9, 20).getTime();

describe("backupDue", () => {
  it("waits until the app has been used for a week", () => {
    expect(backupDue({ createdAt: now - 3 * day }, now)).toBe(false);
    expect(backupDue({ createdAt: now - 8 * day }, now)).toBe(true);
  });

  it("is quiet for a week after a backup, and while snoozed", () => {
    expect(backupDue({ createdAt: now - 30 * day, lastBackupAt: now - 2 * day }, now)).toBe(false);
    expect(backupDue({ createdAt: now - 30 * day, lastBackupAt: now - 9 * day }, now)).toBe(true);
    expect(backupDue({ createdAt: now - 30 * day, backupSnoozeUntil: now + day }, now)).toBe(false);
  });
});
