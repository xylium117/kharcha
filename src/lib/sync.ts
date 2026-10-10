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
let isNewDeviceState = false;
let isPullingFromCloud = false;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
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
  triggerDebouncedAutoSync(500);
}

/** Core bidirectional sync logic */
export async function syncWithCloudCore(): Promise<void> {
  if (!auth.currentUser) return;
  if (isSyncing) {
    hasPendingSync = true;
    return;
  }
  const uid = auth.currentUser.uid;
  isSyncing = true;
  isNewDeviceState = false;
  notifySubscribers();

  try {
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
      }
    } catch (delErr) {
      console.warn("Could not sync remote tombstones:", delErr);
    }

    // 2. Push local data to cloud (skip if no local data, and never push deleted items)
    const localTombstonesList = await db.deletedRecords.toArray();
    const activeTombstoneKeys = new Set<string>();
    for (const t of localTombstonesList) {
      const recId = t.id.includes(":") ? t.id.split(":").slice(1).join(":") : t.id;
      activeTombstoneKeys.add(`${t.table}:${recId}`);
      activeTombstoneKeys.add(t.id);
    }

    const localCount = await countAllLocalRecords();
    if (localCount > 0) {
      for (const table of TABLE_NAMES) {
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
          await batch.commit();
        }
      }
    }

    // 3. Pull remote data down into local Dexie in an atomic transaction
    isPullingFromCloud = true;
    try {
      const refreshedTombstones = await db.deletedRecords.toArray();
      const pullFilterKeys = new Set<string>();
      for (const t of refreshedTombstones) {
        const recId = t.id.includes(":") ? t.id.split(":").slice(1).join(":") : t.id;
        pullFilterKeys.add(`${t.table}:${recId}`);
        pullFilterKeys.add(t.id);
      }

      const pulledData: { table: string; items: any[] }[] = [];
      for (const table of TABLE_NAMES) {
        const colRef = collection(firestore, "users", uid, table);
        const snapshot = await getDocs(colRef);
        if (!snapshot.empty) {
          const validItems: any[] = [];
          for (const d of snapshot.docs) {
            const item = d.data();
            const docId = String(item.id || item.weekStart || (item as any).key || d.id || "record");
            if (
              pullFilterKeys.has(`${table}:${docId}`) ||
              pullFilterKeys.has(`${table}:${d.id}`) ||
              pullFilterKeys.has(docId) ||
              pullFilterKeys.has(d.id)
            ) {
              // Deleted item found lingering in remote Firestore — delete it
              try {
                const lingerRef = doc(firestore, "users", uid, table, d.id);
                deleteDoc(lingerRef).catch(() => {});
              } catch {}
              continue;
            }
            validItems.push(item);
          }
          if (validItems.length > 0) {
            pulledData.push({ table, items: validItems });
          }
        }
      }

      if (pulledData.length > 0) {
        const tablesToLock = TABLE_NAMES.map((n) => db.table(n));
        await db.transaction("rw", tablesToLock, async () => {
          for (const { table, items } of pulledData) {
            const dexieTable = (db as any)[table];
            if (dexieTable) {
              await dexieTable.bulkPut(items);
            }
          }
        });
      }
    } finally {
      isPullingFromCloud = false;
    }

    lastSyncTime = new Date();
  } catch (err) {
    console.error("AutoSync error:", err);
  } finally {
    isSyncing = false;
    notifySubscribers();
    if (hasPendingSync) {
      hasPendingSync = false;
      triggerDebouncedAutoSync(500);
    }
  }
}

/** Schedules an automatic sync debounced by 2.5 seconds */
export function triggerDebouncedAutoSync(delayMs = 2500) {
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

  // 2. Background recurring timer: Sync every 2.5 minutes
  setInterval(() => {
    if (auth.currentUser && !isSyncing && typeof navigator !== "undefined" && navigator.onLine) {
      syncWithCloudCore();
    }
  }, 150000);

  // 3. Tab Visibility / Window Focus: Sync when user switches back to the tab
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && auth.currentUser && !isSyncing) {
      const now = Date.now();
      if (!lastSyncTime || now - lastSyncTime.getTime() > 45000) {
        syncWithCloudCore();
      }
    }
  });

  // 4. Network recovery: Sync immediately when regaining connectivity
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
  const [isNewDevice, setIsNewDevice] = useState(isNewDeviceState);

  useEffect(() => {
    const update = () => {
      setUser(currentUser);
      setSyncing(isSyncing);
      setLastSync(lastSyncTime);
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
        const localCount = await countAllLocalRecords();
        if (localCount === 0) {
          isNewDeviceState = true;
          setIsNewDevice(true);
          notifySubscribers();
        } else {
          syncWithCloudCore();
        }
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
      notifySubscribers();
    } catch (err) {
      console.error("Logout error:", err);
      throw err;
    }
  }, []);

  const syncWithCloud = useCallback(async () => {
    await syncWithCloudCore();
  }, []);

  return {
    user,
    loading,
    syncing,
    lastSync,
    isNewDevice,
    loginWithGoogle,
    logout,
    syncWithCloud,
  };
}
