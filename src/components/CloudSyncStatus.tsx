"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useCloudAuth } from "@/lib/sync";
import { Cloud, CloudCheck, CloudDownload, LogIn, LogOut, RefreshCw } from "lucide-react";

export function CloudSyncStatus() {
  const {
    user,
    loading,
    syncing,
    lastSync,
    syncError,
    isNewDevice,
    loginWithGoogle,
    logout,
    syncWithCloud,
  } = useCloudAuth();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const updateOnlineStatus = () => setOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-card p-3 shadow-soft">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Cloud size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-ink">Cloud Backup</div>
            <div className="text-[10px] text-muted">Sync across devices</div>
          </div>
        </div>
        <button
          onClick={loginWithGoogle}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-1.5 text-xs font-bold text-white shadow-soft transition hover:opacity-90 active:scale-[0.99] dark:text-[#15142a]"
        >
          <LogIn size={13} />
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-3 shadow-soft">
      <div className="flex items-center gap-2">
        {/* Avatar */}
        {user.photoURL ? (
          <Image
            src={user.photoURL}
            alt={user.displayName || "User"}
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-full border border-line object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-500/10 font-bold text-xs text-emerald-500">
            {user.displayName?.[0] || "U"}
          </div>
        )}

        {/* Badge + time */}
        <div className="min-w-0 flex-1">
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
              !online
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : syncError
                ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {!online || syncError ? <Cloud size={9} /> : <CloudCheck size={9} />}
            {!online ? "Offline" : syncError ? "Sync issue" : "Synced"}
          </span>
          <div className="mt-0.5 text-[10px] text-muted">
            {!online
              ? "Offline · will sync when online"
              : syncing
              ? "Syncing…"
              : syncError
                ? "Sync failed · tap to retry"
              : lastSync
                ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "Not synced yet"}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={syncWithCloud}
            disabled={syncing || !online}
            title={syncError ?? "Sync now"}
            aria-label="Sync now"
            className="grid size-8 place-items-center rounded-xl text-muted transition hover:bg-bg-soft hover:text-ink disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={syncing && online ? "animate-spin text-accent" : ""}
            />
          </button>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="grid size-8 place-items-center rounded-xl text-muted transition hover:bg-bg-soft hover:text-ink"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {isNewDevice && !syncing && online && (
        <button
          onClick={syncWithCloud}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20"
        >
          <CloudDownload size={14} />
          Restore my data from cloud
        </button>
      )}
    </div>
  );
}
