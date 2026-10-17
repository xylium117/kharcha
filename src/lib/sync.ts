import { useEffect, useState, useCallback } from "react";
import Dexie from "dexie";
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";
import { auth, googleProvider, firestore } from "./firebase";
import { db, TABLE_NAMES } from "./db";

function sanitizeForFirestore(val: any): any {
  if (val === null || val === undefined) return null;
  if (typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(sanitizeForFirestore).filter((v) => v !== undefined);
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    if (v !== undefined) {
      clean[k] = sanitizeForFirestore(v);
    }
  }
  return clean;
}

async function countAllLocalRecords(): Promise<number> {
  let total = 0;
  for (const table of TABLE_NAMES) {
    const t = (db as any)[table];
    if (t) total += await t.count();
  }
  return total;
}

/**
 * Firebase Firestore Spark (Free / Base Plan) Safe Timing Constraints:
 * Quotas (per 24 hours):
 *   - 50,000 Reads / day
 *   - 20,000 Writes / day
 *   - 20,000 Deletes / day
 *
 * Configured timings protect against quota exhaustion while providing smooth sync:
 * - DEBOUNCE_MS (20s): Batches rapid sequential edits into a single batch write.
 * - MAX_WAIT_MS (60s): Caps debounce so pending edits sync within 1 minute even under active use.
 * - MIN_COOLDOWN_MS (60s): Minimum spacing between automatic sync operations.
 * - VISIBILITY_COOLDOWN_MS (5 min): Prevents full Firestore scans on every app switch/alt-tab.
 * - ONLINE_RECONNECT_DELAY_MS (5s): Gentle backoff when network is restored.
 * - PERIODIC_SYNC_INTERVAL_MS (15 min): Conservative background refresh when tab stays open.
 */
export const AUTOSYNC_CONFIG = {
  DEBOUNCE_MS: 20_000,
  MAX_WAIT_MS: 60_000,
  MIN_COOLDOWN_MS: 60_000,
  VISIBILITY_COOLDOWN_MS: 5 * 60_000,
  ONLINE_RECONNECT_DELAY_MS: 5_000,
  PERIODIC_SYNC_INTERVAL_MS: 15 * 60_000,
} as const;

// Module-level coordinated state across all hook consumers
let currentUser: User | null = null;
let isSyncing = false;
let hasPendingSync = false;
let lastSyncTime: Date | null = null;
let lastSyncError: string | null = null;
let isNewDeviceState = false;
let isPullingFromCloud = false;
let cloudPullDepth = 0;
const localTablesChangedDuringSync = new Set<string>();
const tablesPendingUpload = new Set<string>();
const dirtyRecordKeys = new Map<string, Set<string>>();
const tableChangeVersions = new Map<string, number>();
let cloudRefreshStartedForUid: string | null = null;
let cloudRefreshCompletedForUid: string | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let autoSyncFirstChangeTime: number | null = null;
let cloudListenerUnsubscribers: (() => void)[] = [];
let activeSyncPromise: Promise<void> | null = null;
const clientInstanceId = crypto.randomUUID();
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
}

function beginCloudPull() {
  cloudPullDepth += 1;
  isPullingFromCloud = true;
}

function endCloudPull() {
  cloudPullDepth = Math.max(0, cloudPullDepth - 1);
  isPullingFromCloud = cloudPullDepth > 0;
}

function markRecordPendingUpload(table: string, id?: string) {
  tablesPendingUpload.add(table);
  tableChangeVersions.set(table, (tableChangeVersions.get(table) ?? 0) + 1);
  if (id) {
    if (!dirtyRecordKeys.has(table)) {
      dirtyRecordKeys.set(table, new Set());
    }
    dirtyRecordKeys.get(table)!.add(id);
  }
  if (isSyncing) {
    localTablesChangedDuringSync.add(table);
    hasPendingSync = true;
  }
}

function markTablePendingUpload(table: string) {
  markRecordPendingUpload(table);
}

function stopCloudListeners() {
  cloudListenerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  cloudListenerUnsubscribers = [];
}

function startCloudListeners(uid: string) {
  stopCloudListeners();
  const unsubscribe = onSnapshot(
    doc(firestore, "users", uid, "_meta", "sync"),
    async (snapshot) => {
      if (!snapshot.exists()) return;
      const state = snapshot.data();
      if (state.origin === clientInstanceId) return;

      const changedTables = Array.isArray(state.tables)
        ? state.tables.filter((table: unknown): table is string =>
            typeof table === "string" && TABLE_NAMES.includes(table as (typeof TABLE_NAMES)[number]),
          )
        : [];
      const tablesToPull = changedTables.filter((table) => !tablesPendingUpload.has(table));
      if (tablesToPull.length === 0 && !state.deletions) return;

      try {
        if (state.deletions) {
          const deletedSnapshot = await getDocs(collection(firestore, "users", uid, "_deleted"));
          const deleted = deletedSnapshot.docs
            .map((document) => document.data())
            .filter((item) => typeof item.table === "string" && typeof item.recordId === "string");
          beginCloudPull();
          try {
            await Dexie.ignoreTransaction(async () => {
              await db.deletedRecords.bulkPut(
                deleted.map((item) => ({
                  id: `${item.table}:${item.recordId}`,
                  table: item.table,
                  deletedAt: item.deletedAt || Date.now(),
                  syncedAt: item.deletedAt || Date.now(),
                })),
              );
            });
            await Promise.all(
              deleted.map(async (item) => {
                const localTable = (db as any)[item.table];
                if (localTable) await localTable.delete(item.recordId);
              }),
            );
          } finally {
            endCloudPull();
          }
        }

        if (tablesToPull.length > 0) {
          await pullCloudData(uid, false, state.deletions === true, tablesToPull);
        }
        lastSyncError = null;
        lastSyncTime = new Date();
        notifySubscribers();
      } catch (err) {
        console.error("Failed to apply remote sync changes:", err);
        lastSyncError = err instanceof Error ? err.message : String(err);
        notifySubscribers();
      }
    },
    (err) => {
      console.error("Cloud sync listener failed:", err);
      lastSyncError = err.message;
      notifySubscribers();
    },
  );
  cloudListenerUnsubscribers.push(unsubscribe);
}

async function pullCloudData(
  uid: string,
  replaceLocal: boolean,
  remoteHasTombstones: boolean,
  tables: readonly string[] = TABLE_NAMES,
): Promise<boolean> {
  const refreshedTombstones = await db.deletedRecords.toArray();
  const pullFilterKeys = new Set<string>();
  for (const tombstone of refreshedTombstones) {
    const recordId = tombstone.id.includes(":")
      ? tombstone.id.split(":").slice(1).join(":")
      : tombstone.id;
    pullFilterKeys.add(`${tombstone.table}:${recordId}`);
    pullFilterKeys.add(tombstone.id);
  }

  const snapshots = await Promise.all(
    tables.map((table) => getDocs(collection(firestore, "users", uid, table))),
  );
  const pulledData = new Map<string, any[]>();
  const cloudHasData = remoteHasTombstones || snapshots.some((snapshot) => !snapshot.empty);
  for (const [index, table] of tables.entries()) {
    const snapshot = snapshots[index];
    const validItems: any[] = [];
    for (const document of snapshot.docs) {
      const item = document.data();
      const docId = String(item.id || item.weekStart || item.key || document.id || "record");
      if (
        pullFilterKeys.has(`${table}:${docId}`) ||
        pullFilterKeys.has(`${table}:${document.id}`) ||
        pullFilterKeys.has(docId) ||
        pullFilterKeys.has(document.id)
      ) {
        const lingerRef = doc(firestore, "users", uid, table, document.id);
        deleteDoc(lingerRef).catch((err) => {
          console.error("Failed to remove remotely deleted record:", err);
        });
        continue;
      }
      validItems.push(item);
    }
    pulledData.set(table, validItems);
  }

  if (!cloudHasData) return false;

  beginCloudPull();
  try {
    const tablesToLock = tables.map((name) => db.table(name));
    await db.transaction("rw", tablesToLock, async () => {
      for (const table of tables) {
        if (localTablesChangedDuringSync.has(table)) continue;
        const dexieTable = (db as any)[table];
        if (!dexieTable) continue;
        const items = pulledData.get(table) ?? [];
        if (replaceLocal) await dexieTable.clear();
        if (items.length > 0) await dexieTable.bulkPut(items);
      }
    });
  } finally {
    endCloudPull();
  }
  return true;
}

/** Record a deletion tombstone locally in a transaction-safe manner */
export async function recordLocalDeletion(table: string, id: string): Promise<void> {
  if (!id) return;
  const key = `${table}:${id}`;
  await Dexie.ignoreTransaction(async () => {
    await db.deletedRecords.put({
      id: key,
      table,
      deletedAt: Date.now(),
    });
  });
  dirtyRecordKeys.get(table)?.delete(id);
  markTablePendingUpload(table);
  triggerDebouncedAutoSync();
}

export interface SyncOptions {
  preferCloud?: boolean;
  uploadAll?: boolean;
  refreshCloud?: boolean;
  isAutoUpload?: boolean;
}

/** Core bidirectional sync logic */
async function performSyncWithCloud(options: SyncOptions = {}): Promise<void> {
  if (!auth.currentUser) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const uid = auth.currentUser.uid;
  const preferCloud = options.preferCloud ?? (cloudRefreshCompletedForUid !== uid);
  isSyncing = true;
  if (preferCloud) {
    tablesPendingUpload.clear();
    dirtyRecordKeys.clear();
    hasPendingSync = false;
  }
  localTablesChangedDuringSync.clear();
  lastSyncError = null;
  notifySubscribers();

  try {
    let remoteTombstones: Array<{ id: string; table: string; recordId: string; deletedAt: number }> = [];

    // Pull from cloud if full refresh or initial sync is requested, but NOT on pure local auto-uploads (saves reads)
    if (!options.isAutoUpload) {
      const delSnapshot = await getDocs(collection(firestore, "users", uid, "_deleted"));
      remoteTombstones = delSnapshot.docs
        .map((document) => document.data())
        .filter((item) => typeof item.table === "string" && typeof item.recordId === "string")
        .map((item) => ({
          id: `${item.table}:${item.recordId}`,
          table: item.table as string,
          recordId: item.recordId as string,
          deletedAt: item.deletedAt || Date.now(),
        }));

      beginCloudPull();
      try {
        await Dexie.ignoreTransaction(async () => {
          if (preferCloud) await db.deletedRecords.clear();
          if (remoteTombstones.length > 0) {
            await db.deletedRecords.bulkPut(
              remoteTombstones.map(({ id, table, deletedAt }) => ({ id, table, deletedAt })),
            );
          }
        });
        await Promise.all(
          remoteTombstones.map(async ({ table, recordId }) => {
            const localTable = (db as any)[table];
            if (localTable) await localTable.delete(recordId);
          }),
        );
      } finally {
        endCloudPull();
      }

      const replaceLocal = preferCloud || options.refreshCloud === true;
      const cloudHasData = await pullCloudData(uid, replaceLocal, remoteTombstones.length > 0);
      if ((preferCloud && !cloudHasData) || (options.uploadAll && !preferCloud)) {
        TABLE_NAMES.forEach((table) => tablesPendingUpload.add(table));
      }
    }

    // 2. Push local data to cloud (skip if no local data, and never push deleted items)
    const localTombstonesList = await db.deletedRecords.toArray();
    const activeTombstoneKeys = new Set<string>();
    for (const t of localTombstonesList) {
      const recId = t.id.includes(":") ? t.id.split(":").slice(1).join(":") : t.id;
      activeTombstoneKeys.add(`${t.table}:${recId}`);
      activeTombstoneKeys.add(t.id);
    }

    // Only upload tombstones that haven't been pushed yet to save writes & deletes
    const unsyncedTombstones = localTombstonesList.filter(
      (item) => !item.syncedAt || item.deletedAt > item.syncedAt,
    );

    const tombstoneChunks = [];
    const tombstoneChunkSize = 400;
    for (let i = 0; i < unsyncedTombstones.length; i += tombstoneChunkSize) {
      tombstoneChunks.push(unsyncedTombstones.slice(i, i + tombstoneChunkSize));
    }
    for (const chunk of tombstoneChunks) {
      const batch = writeBatch(firestore);
      for (const item of chunk) {
        const recordId = item.id.includes(":") ? item.id.split(":").slice(1).join(":") : item.id;
        batch.delete(doc(firestore, "users", uid, item.table, recordId));
        batch.set(doc(firestore, "users", uid, "_deleted", `${item.table}__${recordId}`), {
          table: item.table,
          recordId,
          deletedAt: item.deletedAt || Date.now(),
        });
      }
      await batch.commit();
    }

    if (unsyncedTombstones.length > 0) {
      const syncTs = Date.now();
      await Dexie.ignoreTransaction(async () => {
        await db.deletedRecords.bulkPut(
          unsyncedTombstones.map((t) => ({ ...t, syncedAt: syncTs })),
        );
      });
    }

    if (!preferCloud && localTombstonesList.length > 0) {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      await Dexie.ignoreTransaction(async () => {
        await db.deletedRecords.where("deletedAt").below(thirtyDaysAgo).delete();
      });
    }

    const uploadVersions = new Map(
      [...tablesPendingUpload].map((table) => [table, tableChangeVersions.get(table) ?? 0]),
    );
    const uploadedTableNames: string[] = [];

    if (uploadVersions.size > 0) {
      for (const table of uploadVersions.keys()) {
        const dexieTable = (db as any)[table];
        if (!dexieTable) continue;

        let itemsToPush: any[] = [];
        const dirtyIds = dirtyRecordKeys.get(table);

        if (options.uploadAll || !dirtyIds || dirtyIds.size === 0) {
          itemsToPush = await dexieTable.toArray();
        } else {
          // Push only the specific dirty records that were modified
          const fetched = await Promise.all(
            Array.from(dirtyIds).map((id) => dexieTable.get(id)),
          );
          itemsToPush = fetched.filter((item): item is any => Boolean(item));
        }

        // Filter out any locally deleted records
        itemsToPush = itemsToPush.filter((item: any) => {
          const docId = String(item.id || item.weekStart || item.key || "record");
          return !activeTombstoneKeys.has(`${table}:${docId}`) && !activeTombstoneKeys.has(docId);
        });

        if (itemsToPush.length > 0) {
          const chunkSize = 400;
          for (let i = 0; i < itemsToPush.length; i += chunkSize) {
            const chunk = itemsToPush.slice(i, i + chunkSize);
            const batch = writeBatch(firestore);
            for (const item of chunk) {
              const docId = String(
                item.id || item.weekStart || (item as any).key || "record",
              );
              const docRef = doc(firestore, "users", uid, table, docId);
              batch.set(docRef, sanitizeForFirestore(item), { merge: true });
            }
            await batch.commit();
          }
          uploadedTableNames.push(table);
        }

        if (dirtyIds) {
          dirtyIds.clear();
        }

        for (const [t, version] of uploadVersions) {
          if ((tableChangeVersions.get(t) ?? 0) === version) {
            tablesPendingUpload.delete(t);
          }
        }
      }
    }

    // Notify other clients via _meta/sync doc with origin tracking
    if (uploadedTableNames.length > 0 || unsyncedTombstones.length > 0) {
      try {
        await setDoc(
          doc(firestore, "users", uid, "_meta", "sync"),
          {
            origin: clientInstanceId,
            tables: uploadedTableNames,
            deletions: unsyncedTombstones.length > 0,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      } catch (metaErr) {
        console.warn("Could not write sync metadata:", metaErr);
      }
    }

    isNewDeviceState = (await countAllLocalRecords()) === 0;
    lastSyncTime = new Date();
    if (preferCloud) cloudRefreshCompletedForUid = uid;
  } catch (err) {
    console.error("AutoSync error:", err);
    lastSyncError = err instanceof Error ? err.message : String(err);
  } finally {
    isSyncing = false;
    localTablesChangedDuringSync.clear();
    notifySubscribers();
    if (hasPendingSync) {
      hasPendingSync = false;
      triggerDebouncedAutoSync(AUTOSYNC_CONFIG.DEBOUNCE_MS);
    }
  }
}

export function syncWithCloudCore(options: SyncOptions = {}): Promise<void> {
  if (activeSyncPromise) {
    if (options.refreshCloud) {
      return activeSyncPromise.then(() => syncWithCloudCore(options));
    }
    return activeSyncPromise;
  }

  activeSyncPromise = performSyncWithCloud(options).finally(() => {
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}

/** Schedules an automatic sync with conservative batching to conserve Firestore read/write quota. */
export function triggerDebouncedAutoSync(delayMs: number = AUTOSYNC_CONFIG.DEBOUNCE_MS) {
  if (isPullingFromCloud || !auth.currentUser) return;
  const now = Date.now();
  if (!autoSyncFirstChangeTime) {
    autoSyncFirstChangeTime = now;
  }

  // Force sync if changes have been buffered beyond MAX_WAIT_MS
  const elapsed = now - autoSyncFirstChangeTime;
  if (elapsed >= AUTOSYNC_CONFIG.MAX_WAIT_MS) {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
    autoSyncFirstChangeTime = null;
    syncWithCloudCore({ isAutoUpload: true });
    return;
  }

  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  const effectiveDelay = Math.min(
    delayMs,
    Math.max(1000, AUTOSYNC_CONFIG.MAX_WAIT_MS - elapsed),
  );
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    autoSyncFirstChangeTime = null;
    syncWithCloudCore({ isAutoUpload: true });
  }, effectiveDelay);
}

// Attach automatic sync triggers in browser environment
if (typeof window !== "undefined") {
  // 1. Local Database Changes: Listen to all Dexie table mutations
  TABLE_NAMES.forEach((tableName) => {
    const table = (db as any)[tableName];
    if (table?.hook) {
      table.hook("creating", (primKey: any, obj: any) => {
        if (!isPullingFromCloud) {
          const rawId = String(obj?.id || obj?.weekStart || (obj as any)?.key || primKey || "");
          markRecordPendingUpload(tableName, rawId);
          if (rawId) {
            const tombstoneKey = `${tableName}:${rawId}`;
            Dexie.ignoreTransaction(() => {
              db.deletedRecords.delete(tombstoneKey).catch(() => {});
              db.deletedRecords.delete(rawId).catch(() => {});
            });
          }
          triggerDebouncedAutoSync();
        }
      });
      table.hook("updating", (mods: any, primKey: any, obj: any) => {
        if (!isPullingFromCloud) {
          const rawId = String(obj?.id || obj?.weekStart || (obj as any)?.key || primKey || "");
          markRecordPendingUpload(tableName, rawId);
          if (rawId) {
            const tombstoneKey = `${tableName}:${rawId}`;
            Dexie.ignoreTransaction(() => {
              db.deletedRecords.delete(tombstoneKey).catch(() => {});
              db.deletedRecords.delete(rawId).catch(() => {});
            });
          }
          triggerDebouncedAutoSync();
        }
      });
      table.hook("deleting", (primKey: any, obj: any) => {
        if (!isPullingFromCloud) {
          markTablePendingUpload(tableName);
          const rawId = String(obj?.id || obj?.weekStart || (obj as any)?.key || primKey || "");
          if (rawId) {
            const tombstoneKey = `${tableName}:${rawId}`;
            Dexie.ignoreTransaction(() => {
              db.deletedRecords
                .put({ id: tombstoneKey, table: tableName, deletedAt: Date.now() })
                .catch((err) => {
                  console.error("Failed to record deletion tombstone:", err);
                });
            });
          }
          triggerDebouncedAutoSync();
        }
      });
    }
  });

  // Push local edits or check remote sync when returning to foreground
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && auth.currentUser && !isSyncing) {
      const now = Date.now();
      const timeSinceLastSync = lastSyncTime ? now - lastSyncTime.getTime() : Infinity;
      const hasPendingUploads = tablesPendingUpload.size > 0;

      if (hasPendingUploads) {
        // Fast flush with short buffer (2s) if returning with pending local changes
        triggerDebouncedAutoSync(2000);
      } else if (timeSinceLastSync >= AUTOSYNC_CONFIG.VISIBILITY_COOLDOWN_MS) {
        // Only trigger full remote pull if at least 5 minutes have elapsed since last sync
        syncWithCloudCore();
      }
    }
  });

  // Reconnection handler with backoff
  window.addEventListener("online", () => {
    if (auth.currentUser && !isSyncing) {
      const now = Date.now();
      const timeSinceLastSync = lastSyncTime ? now - lastSyncTime.getTime() : Infinity;
      if (tablesPendingUpload.size > 0 || timeSinceLastSync >= AUTOSYNC_CONFIG.MIN_COOLDOWN_MS) {
        triggerDebouncedAutoSync(AUTOSYNC_CONFIG.ONLINE_RECONNECT_DELAY_MS);
      }
    }
  });

  // Periodic heartbeat timer (checks if app was kept open for 15+ minutes)
  setInterval(() => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      auth.currentUser &&
      !isSyncing
    ) {
      const now = Date.now();
      const timeSinceLastSync = lastSyncTime ? now - lastSyncTime.getTime() : Infinity;
      if (tablesPendingUpload.size > 0) {
        triggerDebouncedAutoSync(2000);
      } else if (timeSinceLastSync >= AUTOSYNC_CONFIG.PERIODIC_SYNC_INTERVAL_MS) {
        syncWithCloudCore();
      }
    }
  }, 60_000);
}

export function useCloudAuth() {
  const [user, setUser] = useState<User | null>(currentUser);
  const [loading, setLoading] = useState(!currentUser);
  const [syncing, setSyncing] = useState(isSyncing);
  const [lastSync, setLastSync] = useState<Date | null>(lastSyncTime);
  const [syncError, setSyncError] = useState<string | null>(lastSyncError);
  const [isNewDevice, setIsNewDevice] = useState(isNewDeviceState);

  useEffect(() => {
    const update = () => {
      setUser(currentUser);
      setSyncing(isSyncing);
      setLastSync(lastSyncTime);
      setSyncError(lastSyncError);
      setIsNewDevice(isNewDeviceState);
    };
    subscribers.add(update);
    return () => {
      subscribers.delete(update);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      currentUser = u;
      setUser(u);
      setLoading(false);
      notifySubscribers();

      if (u) {
        if (cloudRefreshStartedForUid === u.uid) return;
        cloudRefreshStartedForUid = u.uid;
        const localCount = await countAllLocalRecords();
        isNewDeviceState = localCount === 0;
        notifySubscribers();
        await syncWithCloudCore({ preferCloud: true });
        startCloudListeners(u.uid);
      } else {
        stopCloudListeners();
        cloudRefreshStartedForUid = null;
        cloudRefreshCompletedForUid = null;
        tablesPendingUpload.clear();
        tableChangeVersions.clear();
      }
    });
    return () => unsub();
  }, []);

  const loginWithGoogle = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Google sign-in error:", err);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fbSignOut(auth);
      currentUser = null;
      isNewDeviceState = false;
      lastSyncTime = null;
      lastSyncError = null;
      cloudRefreshStartedForUid = null;
      cloudRefreshCompletedForUid = null;
      stopCloudListeners();
      tablesPendingUpload.clear();
      tableChangeVersions.clear();
      notifySubscribers();
    } catch (err) {
      console.error("Logout error:", err);
      throw err;
    }
  }, []);

  const syncWithCloud = useCallback(async () => {
    await syncWithCloudCore({ refreshCloud: true });
  }, []);

  return {
    user,
    loading,
    syncing,
    lastSync,
    syncError,
    isNewDevice,
    loginWithGoogle,
    logout,
    syncWithCloud,
  };
}
