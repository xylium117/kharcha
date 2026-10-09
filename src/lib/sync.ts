import { useEffect, useState, useCallback } from "react";
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
let lastSyncTime: Date | null = null;
let isNewDeviceState = false;
let isPullingFromCloud = false;
let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  subscribers.forEach((cb) => cb());
}

/** Core bidirectional sync logic */
export async function syncWithCloudCore(): Promise<void> {
  if (!auth.currentUser || isSyncing) return;
  const uid = auth.currentUser.uid;
  isSyncing = true;
  isNewDeviceState = false;
  notifySubscribers();

  try {
    // 1. Push local data to cloud (skip if no local data)
    const localCount = await countAllLocalRecords();
    if (localCount > 0) {
      for (const table of TABLE_NAMES) {
        const dexieTable = (db as any)[table];
        if (!dexieTable) continue;
        const localItems = await dexieTable.toArray();
        if (localItems.length === 0) continue;

        const chunkSize = 400;
        for (let i = 0; i < localItems.length; i += chunkSize) {
          const chunk = localItems.slice(i, i + chunkSize);
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

    // 2. Pull remote data down into local Dexie
    isPullingFromCloud = true;
    try {
      for (const table of TABLE_NAMES) {
        const colRef = collection(firestore, "users", uid, table);
        const snapshot = await getDocs(colRef);
        if (!snapshot.empty) {
          const remoteItems = snapshot.docs.map((d) => d.data());
          const dexieTable = (db as any)[table];
          if (dexieTable) {
            await dexieTable.bulkPut(remoteItems);
          }
        }
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
      table.hook("creating", () => {
        if (!isPullingFromCloud) triggerDebouncedAutoSync();
      });
      table.hook("updating", () => {
        if (!isPullingFromCloud) triggerDebouncedAutoSync();
      });
      table.hook("deleting", () => {
        if (!isPullingFromCloud) triggerDebouncedAutoSync();
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
