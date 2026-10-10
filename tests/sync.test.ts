import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import Dexie from "dexie";
import { KharchaDB } from "../src/lib/db";

describe("Tombstone and Transaction Deletion Safety", () => {
  let testDb: KharchaDB;

  beforeEach(async () => {
    testDb = new KharchaDB();
    await testDb.open();
    await testDb.goals.clear();
    await testDb.goalContributions.clear();
    await testDb.deletedRecords.clear();
  });

  it("safely records a tombstone when a goal is deleted inside a transaction", async () => {
    // Attach hook using Dexie.ignoreTransaction as implemented in sync.ts
    testDb.goals.hook("deleting", (primKey: any, obj: any) => {
      const rawId = String(obj?.id || primKey || "");
      if (rawId) {
        const key = `goals:${rawId}`;
        Dexie.ignoreTransaction(() => {
          testDb.deletedRecords.put({
            id: key,
            table: "goals",
            deletedAt: Date.now(),
          });
        });
      }
    });

    testDb.goalContributions.hook("deleting", (primKey: any, obj: any) => {
      const rawId = String(obj?.id || primKey || "");
      if (rawId) {
        const key = `goalContributions:${rawId}`;
        Dexie.ignoreTransaction(() => {
          testDb.deletedRecords.put({
            id: key,
            table: "goalContributions",
            deletedAt: Date.now(),
          });
        });
      }
    });

    // 1. Add goal and contribution
    await testDb.goals.add({
      id: "goal-1",
      title: "Headphones",
      emoji: "🎧",
      target: 2000,
      deadline: "2026-11-01",
      createdAt: Date.now(),
    });
    await testDb.goalContributions.add({
      id: "contrib-1",
      goalId: "goal-1",
      amount: 500,
      ts: Date.now(),
    });

    expect(await testDb.goals.count()).toBe(1);
    expect(await testDb.goalContributions.count()).toBe(1);
    expect(await testDb.deletedRecords.count()).toBe(0);

    // 2. Perform deletion inside transaction (identical to remove() in GoalsPage)
    await testDb.transaction("rw", testDb.goals, testDb.goalContributions, async () => {
      await testDb.goals.delete("goal-1");
      await testDb.goalContributions.bulkDelete(["contrib-1"]);
    });

    // 3. Verify that both records were deleted and tombstones were recorded
    expect(await testDb.goals.count()).toBe(0);
    expect(await testDb.goalContributions.count()).toBe(0);

    const tombstones = await testDb.deletedRecords.toArray();
    expect(tombstones.length).toBe(2);

    const tombstoneKeys = new Set(tombstones.map((t) => t.id));
    expect(tombstoneKeys.has("goals:goal-1")).toBe(true);
    expect(tombstoneKeys.has("goalContributions:contrib-1")).toBe(true);
  });

  it("clears tombstone when a goal is restored (Undo action)", async () => {
    testDb.goals.hook("creating", (primKey: any, obj: any) => {
      const rawId = String(obj?.id || primKey || "");
      if (rawId) {
        const key = `goals:${rawId}`;
        Dexie.ignoreTransaction(() => {
          testDb.deletedRecords.delete(key);
        });
      }
    });

    // Prepopulate tombstone
    await testDb.deletedRecords.put({
      id: "goals:goal-undo",
      table: "goals",
      deletedAt: Date.now(),
    });
    expect(await testDb.deletedRecords.count()).toBe(1);

    // Undo action restores goal
    await testDb.goals.add({
      id: "goal-undo",
      title: "Trip",
      emoji: "🏖️",
      target: 5000,
      deadline: "2026-12-01",
      createdAt: Date.now(),
    });

    expect(await testDb.deletedRecords.count()).toBe(0);
  });
});
