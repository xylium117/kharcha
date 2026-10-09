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
import { db, TABLE_NAMES, type TableName } from "./db";

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

export function useCloudAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isNewDevice, setIsNewDevice] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
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
      setUser(null);
      setIsNewDevice(false);
      setLastSync(null);
    } catch (err) {
      console.error("Logout error:", err);
      throw err;
    }
  }, []);

  const syncWithCloud = useCallback(async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    setSyncing(true);
    setIsNewDevice(false);

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

      setLastSync(new Date());
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Auto-sync on sign-in; detect new device (no local data)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const localCount = await countAllLocalRecords();
      if (localCount === 0) {
        setIsNewDevice(true);
      } else {
        syncWithCloud();
      }
    })();
  }, [user, syncWithCloud]);

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
