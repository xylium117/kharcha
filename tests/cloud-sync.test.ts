import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/lib/defaults";
import { db, TABLE_NAMES } from "../src/lib/db";

const mockState = vi.hoisted(() => ({
  currentUser: { uid: "user-123" },
  cloudSettings: null as Record<string, unknown> | null,
  writes: [] as { path: string; data: Record<string, unknown> }[],
  deletes: [] as string[],
  reads: 0,
}));

vi.mock("../src/lib/firebase", () => ({
  auth: {
    get currentUser() {
      return mockState.currentUser;
    },
  },
  googleProvider: {},
  firestore: {},
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (...segments: unknown[]) => ({
    path: segments.filter((segment): segment is string => typeof segment === "string").join("/"),
  }),
  doc: (...segments: unknown[]) => ({
    path: segments.filter((segment): segment is string => typeof segment === "string").join("/"),
  }),
  getDocs: vi.fn(async (ref: { path: string }) => {
    mockState.reads += 1;
    const docs =
      ref.path.endsWith("/_deleted")
        ? []
        : ref.path.endsWith("/settings") && mockState.cloudSettings
          ? [{ id: "me", data: () => mockState.cloudSettings }]
          : [];
    return { empty: docs.length === 0, docs };
  }),
  writeBatch: vi.fn(() => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      mockState.writes.push({ path: ref.path, data });
    },
    delete: (ref: { path: string }) => {
      mockState.deletes.push(ref.path);
    },
    commit: vi.fn(async () => {}),
  })),
  deleteDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
}));

const { syncWithCloudCore, AUTOSYNC_CONFIG } = await import("../src/lib/sync");

describe("cloud-first startup sync", () => {
  beforeEach(async () => {
    mockState.currentUser = { uid: "user-123" };
    mockState.cloudSettings = null;
    mockState.writes = [];
    mockState.deletes = [];
    mockState.reads = 0;
    vi.stubGlobal("navigator", { onLine: true });
    await db.open();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it("replaces local records with cloud data without uploading stale local records", async () => {
    const localSettings = defaultSettings("Local", 6000);
    await db.settings.put(localSettings);
    await db.expenses.put({
      id: "stale-local-expense",
      amount: 50,
      title: "Stale",
      categoryId: "food",
      paymentMode: "Cash",
      tag: "need",
      source: "form",
      ts: Date.now(),
    });
    const cloudSettings = {
      ...defaultSettings("Cloud", 9000),
      seasonMode: "exam",
    };
    await db.settings.put(localSettings);
    mockState.cloudSettings = cloudSettings;

    await syncWithCloudCore({ preferCloud: true });

    expect(await db.settings.get("me")).toEqual(cloudSettings);
    expect(await db.expenses.count()).toBe(0);
    expect(mockState.writes).toHaveLength(0);
  });

  it("keeps and uploads local settings when the cloud is empty", async () => {
    const localSettings = defaultSettings("Local", 6000);
    await db.settings.put(localSettings);

    await syncWithCloudCore({ preferCloud: true });

    expect(await db.settings.get("me")).toEqual(localSettings);
    expect(mockState.writes).toContainEqual({
      path: "users/user-123/settings/me",
      data: localSettings,
    });
  });

  it("does not clear local data when the cloud has no records", async () => {
    const localSettings = defaultSettings("Local", 6000);
    await db.settings.put(localSettings);

    await syncWithCloudCore({ preferCloud: true });

    expect(await db.settings.get("me")).toEqual(localSettings);
  });

  it("uploads income records added from the home page", async () => {
    await db.income.add({
      id: "money-in-1",
      amount: 250,
      source: "gift",
      ts: Date.now(),
    });

    await syncWithCloudCore({ uploadAll: true });

    expect(mockState.writes).toContainEqual({
      path: "users/user-123/income/money-in-1",
      data: expect.objectContaining({ amount: 250, source: "gift" }),
    });
  });

  it("propagates home page income removals as cloud tombstones", async () => {
    await db.income.add({
      id: "money-in-2",
      amount: 250,
      source: "gift",
      ts: Date.now(),
    });
    await db.income.delete("money-in-2");
    await db.deletedRecords.put({
      id: "income:money-in-2",
      table: "income",
      deletedAt: Date.now(),
    });

    await syncWithCloudCore({ uploadAll: true });

    expect(mockState.deletes).toContain("users/user-123/income/money-in-2");
    expect(mockState.writes).toContainEqual(
      expect.objectContaining({
        path: "users/user-123/_deleted/income__money-in-2",
        data: expect.objectContaining({ table: "income", recordId: "money-in-2" }),
      }),
    );
  });

  it("does not start a redundant sync for concurrent callers", async () => {
    await Promise.all([
      syncWithCloudCore({ preferCloud: true }),
      syncWithCloudCore({ preferCloud: true }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(mockState.reads).toBe(TABLE_NAMES.length + 1);
  });

  it("defines safe autosync intervals protecting base plan Firestore limits", () => {
    expect(AUTOSYNC_CONFIG.DEBOUNCE_MS).toBeGreaterThanOrEqual(15_000);
    expect(AUTOSYNC_CONFIG.MAX_WAIT_MS).toBeLessThanOrEqual(120_000);
    expect(AUTOSYNC_CONFIG.VISIBILITY_COOLDOWN_MS).toBeGreaterThanOrEqual(180_000);
    expect(AUTOSYNC_CONFIG.PERIODIC_SYNC_INTERVAL_MS).toBeGreaterThanOrEqual(600_000);
  });

  it("conserves Firestore reads during local change auto-upload", async () => {
    mockState.reads = 0;
    await syncWithCloudCore({ isAutoUpload: true });
    // Local auto-upload only pushes modified local records, skipping full cloud table pull
    expect(mockState.reads).toBe(0);
  });
});
