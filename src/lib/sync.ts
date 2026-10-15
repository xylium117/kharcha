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
const tableChangeVersions = new Map<string, number>();
let cloudRefreshStartedForUid: string | null = null;
let cloudRefreshCompletedForUid: string | null = null;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let cloudListenerUnsubscribers: (() => void)[] = [];
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

function markTablePendingUpload(table: string) {
  tablesPendingUpload.add(table);
  tableChangeVersions.set(table, (tableChangeVersions.get(table) ?? 0) + 1);
  if (isSyncing) {
    localTablesChangedDuringSync.add(table);
    hasPendingSync = true;
  }
}

function stopCloudListeners() {
  cloudListenerUnsubscribers.forEach((unsubscribe) => unsubscribe());
  cloudListenerUnsubscribers = [];
}

function startCloudListeners(uid: string) {
  stopCloudListeners();
  for (const table of TABLE_NAMES) {
    const unsubscribe = onSnapshot(
      collection(firestore, "users", uid, table),
      async (snapshot) => {
        if (snapshot.docChanges().length === 0) return;
        beginCloudPull();
        try {
          await db.transaction("rw", db.table(table), async () => {
            const dexieTable = (db as any)[table];
            for (const change of snapshot.docChanges()) {
              if (change.type === "removed") {
                await dexieTable.delete(change.doc.id);
              } else {
                await dexieTable.put(change.doc.data());
              }
            }
          });
          lastSyncError = null;
          lastSyncTime = new Date();
          notifySubscribers();
        } catch (err) {
          console.error(`Failed to apply cloud changes for ${table}:`, err);
          lastSyncError = err instanceof Error ? err.message : String(err);
          notifySubscribers();
        } finally {
          endCloudPull();
        }
      },
      (err) => {
        console.error(`Cloud listener failed for ${table}:`, err);
        lastSyncError = err.message;
        notifySubscribers();
      },
    );
    cloudListenerUnsubscribers.push(unsubscribe);
  }

  const unsubscribeDeletions = onSnapshot(
    collection(firestore, "users", uid, "_deleted"),
    async (snapshot) => {
      const deleted = snapshot.docs.map((document) => document.data())
        .filter((item) => typeof item.table === "string" && typeof item.recordId === "string");
      if (deleted.length === 0) return;

      beginCloudPull();
      try {
        await Dexie.ignoreTransaction(async () => {
          await db.deletedRecords.bulkPut(
            deleted.map((item) => ({
              id: `${item.table}:${item.recordId}`,
              table: item.table,
              deletedAt: item.deletedAt || Date.now(),
            })),
          );
        });
        await Promise.all(
          deleted.map(async (item) => {
            const localTable = (db as any)[item.table];
            if (localTable) await localTable.delete(item.recordId);
          }),
        );
      } catch (err) {
        console.error("Failed to apply cloud deletions:", err);
        lastSyncError = err instanceof Error ? err.message : String(err);
        notifySubscribers();
      } finally {
        endCloudPull();
      }
    },
    (err) => {
      console.error("Cloud deletion listener failed:", err);
      lastSyncError = err.message;
      notifySubscribers();
    },
  );
  cloudListenerUnsubscribers.push(unsubscribeDeletions);
}

async function pullCloudData(uid: string): Promise<void> {
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
    TABLE_NAMES.map((table) => getDocs(collection(firestore, "users", uid, table))),
  );
  const pulledData: { table: string; items: any[] }[] = [];
  for (const [index, table] of TABLE_NAMES.entries()) {
    const snapshot = snapshots[index];
    if (snapshot.empty) continue;

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
    if (validItems.length > 0) pulledData.push({ table, items: validItems });
  }

  if (pulledData.length === 0) return;

  beginCloudPull();
  try {
    const tablesToLock = TABLE_NAMES.map((name) => db.table(name));
    await db.transaction("rw", tablesToLock, async () => {
      for (const { table, items } of pulledData) {
        if (localTablesChangedDuringSync.has(table)) continue;
        const dexieTable = (db as any)[table];
        if (dexieTable) await dexieTable.bulkPut(items);
      }
    });
  } finally {
    endCloudPull();
  }
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
  markTablePendingUpload(table);
  triggerDebouncedAutoSync(500);
}

/** Core bidirectional sync logic */
export async function syncWithCloudCore(
  options: { preferCloud?: boolean; uploadAll?: boolean; refreshCloud?: boolean } = {},
): Promise<void> {
  if (!auth.currentUser) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (isSyncing) return;
  const uid = auth.currentUser.uid;
  const preferCloud = options.preferCloud ?? (cloudRefreshCompletedForUid !== uid);
  isSyncing = true;
  localTablesChangedDuringSync.clear();
  lastSyncError = null;
  notifySubscribers();

  try {
    if (options.uploadAll || preferCloud) {
      TABLE_NAMES.forEach((table) => tablesPendingUpload.add(table));
    }
    const uploadVersions = new Map(
      [...tablesPendingUpload].map((table) => [table, tableChangeVersions.get(table) ?? 0]),
    );

    // 1. Delete records from cloud that were deleted locally
    const tombstones = await db.deletedRecords.toArray();
    if (tombstones.length > 0) {
      const tombstoneChunks = [];
      const cSize = 400;
      for (let i = 0; i < tombstones.length; i += cSize) {
        tombstoneChunks.push(tombstones.slice(i, i + cSize));
      }
      for (const chunk of tombstoneChunks) {
        const batch = writeBatch(firestore);
        for (const item of chunk) {
          const recordId = item.id.includes(":") ? item.id.split(":").slice(1).join(":") : item.id;
          const docRef = doc(firestore, "users", uid, item.table, recordId);
          batch.delete(docRef);

          // Also write to cloud tombstones (_deleted collection) so other devices know
          const tombstoneDocRef = doc(firestore, "users", uid, "_deleted", `${item.table}__${recordId}`);
          batch.set(tombstoneDocRef, {
            table: item.table,
            recordId,
            deletedAt: item.deletedAt || Date.now(),
          });
        }
        await batch.commit();
      }
      // Keep recent tombstones so sync never resurrects them; prune only those older than 30 days
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      await Dexie.ignoreTransaction(async () => {
        await db.deletedRecords.where("deletedAt").below(thirtyDaysAgo).delete().catch(() => {});
      });
    }

    // 1b. Pull remote tombstones from "_deleted" so this device learns of deletions made on other devices
    try {
      const delColRef = collection(firestore, "users", uid, "_deleted");
      const delSnapshot = await getDocs(delColRef);
      if (!delSnapshot.empty) {
        const remoteTombstones: { id: string; table: string; deletedAt: number }[] = [];
        beginCloudPull();
        try {
          for (const docSnap of delSnapshot.docs) {
            const d = docSnap.data();
            if (d.table && d.recordId) {
              const key = `${d.table}:${d.recordId}`;
              remoteTombstones.push({
                id: key,
                table: d.table,
                deletedAt: d.deletedAt || Date.now(),
              });
              // Ensure deleted record is purged locally if still present in local Dexie
              const localTable = (db as any)[d.table];
              if (localTable) {
                await Dexie.ignoreTransaction(async () => {
                  await localTable.delete(d.recordId).catch(() => {});
                });
              }
            }
          }
          if (remoteTombstones.length > 0) {
            await Dexie.ignoreTransaction(async () => {
              await db.deletedRecords.bulkPut(remoteTombstones).catch(() => {});
            });
          }
        } finally {
          endCloudPull();
        }
      }
    } catch (delErr) {
      console.warn("Could not sync remote tombstones:", delErr);
    }

    if (preferCloud) {
      await pullCloudData(uid);
    }

    // 2. Push local data to cloud (skip if no local data, and never push deleted items)
    const localTombstonesList = await db.deletedRecords.toArray();
    const activeTombstoneKeys = new Set<string>();
    for (const t of localTombstonesList) {
      const recId = t.id.includes(":") ? t.id.split(":").slice(1).join(":") : t.id;
      activeTombstoneKeys.add(`${t.table}:${recId}`);
      activeTombstoneKeys.add(t.id);
    }

    if (uploadVersions.size > 0) {
      const commits: Promise<void>[] = [];
      for (const table of uploadVersions.keys()) {
        const dexieTable = (db as any)[table];
        if (!dexieTable) continue;
        const localItems = await dexieTable.toArray();
        if (localItems.length === 0) continue;

        // Filter out any locally deleted records
        const itemsToPush = localItems.filter((item: any) => {
          const docId = String(item.id || item.weekStart || item.key || "record");
          return !activeTombstoneKeys.has(`${table}:${docId}`) && !activeTombstoneKeys.has(docId);
        });
        if (itemsToPush.length === 0) continue;

        const chunkSize = 400;
        for (let i = 0; i < itemsToPush.length; i += chunkSize) {
          const chunk = itemsToPush.slice(i, i + chunkSize);
          const batch = writeBatch(firestore);
          for (const item of chunk) {
            const docId = String(
              item.id || item.weekStart || (item as any).key || "record"
            );
            const docRef = doc(firestore, "users", uid, table, docId);
            batch.set(docRef, sanitizeForFirestore(item), { merge: true });
          }
          commits.push(batch.commit());
        }
      }
      await Promise.all(commits);
      for (const [table, version] of uploadVersions) {
        if ((tableChangeVersions.get(table) ?? 0) === version) {
          tablesPendingUpload.delete(table);
        }
      }
    }

    // 3. Pull remote data down into local Dexie in an atomic transaction
    if (options.refreshCloud && !preferCloud) await pullCloudData(uid);

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
      triggerDebouncedAutoSync(500);
    }
  }
}

/** Schedules an automatic sync shortly after local data changes. */
export function triggerDebouncedAutoSync(delayMs = 500) {
  if (isPullingFromCloud || !auth.currentUser) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    syncWithCloudCore();
  }, delayMs);
}

// Attach automatic sync triggers in browser environment
if (typeof window !== "undefined") {
  // 1. Local Database Changes: Listen to all Dexie table mutations
  TABLE_NAMES.forEach((tableName) => {
    const table = (db as any)[tableName];
    if (table?.hook) {
      table.hook("creating", (primKey: any, obj: any) => {
        if (!isPullingFromCloud) {
          markTablePendingUpload(tableName);
          const rawId = String(obj?.id || obj?.weekStart || (obj as any)?.key || primKey || "");
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
          markTablePendingUpload(tableName);
          const rawId = String(obj?.id || obj?.weekStart || (obj as any)?.key || primKey || "");
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

  // Push local edits when the app returns to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && auth.currentUser && !isSyncing) {
      syncWithCloudCore();
    }
  });

  window.addEventListener("online", () => {
    if (auth.currentUser && !isSyncing) {
      syncWithCloudCore();
    }
  });
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
        await syncWithCloudCore({ preferCloud: true, uploadAll: true });
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
