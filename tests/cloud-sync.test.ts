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
}));

const { syncWithCloudCore } = await import("../src/lib/sync");

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

  it("loads cloud settings locally before uploading them", async () => {
    const localSettings = defaultSettings("Local", 6000);
    const cloudSettings = {
      ...defaultSettings("Cloud", 9000),
      seasonMode: "exam",
    };
    await db.settings.put(localSettings);
    mockState.cloudSettings = cloudSettings;

    await syncWithCloudCore({ preferCloud: true });

    expect(await db.settings.get("me")).toEqual(cloudSettings);
    expect(mockState.writes).toContainEqual({
      path: "users/user-123/settings/me",
      data: cloudSettings,
    });
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
});
