import { db, TABLE_NAMES, type TableName } from "./db";

export interface BackupFile {
  app: "kharcha" | "paisa-pal";
  version: 1;
  exportedAt: string;
  data: Partial<Record<TableName, unknown[]>>;
}

export async function exportBackup(): Promise<BackupFile> {
  const data: BackupFile["data"] = {};
  for (const name of TABLE_NAMES) {
    data[name] = await db.table(name).toArray();
  }
  return { app: "kharcha", version: 1, exportedAt: new Date().toISOString(), data };
}

export function isBackupFile(x: unknown): x is BackupFile {
  if (!x || typeof x !== "object") return false;
  const b = x as BackupFile;
  return (b.app === "kharcha" || b.app === "paisa-pal") && b.version === 1 && typeof b.data === "object" && b.data !== null;
}

/** Replaces everything on this device with the backup's contents. */
export async function importBackup(file: BackupFile): Promise<void> {
  const tables = TABLE_NAMES.map((n) => db.table(n));
  await db.transaction("rw", tables, async () => {
    for (const name of TABLE_NAMES) {
      const t = db.table(name);
      await t.clear();
      const rows = file.data[name];
      if (Array.isArray(rows) && rows.length) await t.bulkAdd(rows);
    }
  });
}

export async function clearAll(): Promise<void> {
  const tables = [...TABLE_NAMES.map((n) => db.table(n)), db.deletedRecords];
  await db.transaction("rw", tables, async () => {
    for (const t of tables) await t.clear();
  });
}

export function downloadJSON(obj: unknown, filename: string) {
  downloadText(JSON.stringify(obj, null, 2), filename, "application/json");
}

export function downloadText(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads a backup file and remembers when, for the "last backup" note and weekly reminder. */
export async function backupNow(): Promise<void> {
  const b = await exportBackup();
  downloadJSON(b, `kharcha-backup-${b.exportedAt.slice(0, 10)}.json`);
  await db.settings.update("me", { lastBackupAt: Date.now(), backupSnoozeUntil: undefined });
}

/** True when a backup is overdue: app used for a week+, no backup in 7 days, reminder not snoozed. */
export function backupDue(s: { createdAt: number; lastBackupAt?: number; backupSnoozeUntil?: number }, now: number): boolean {
  const week = 7 * 24 * 60 * 60 * 1000;
  if (now - s.createdAt < week) return false;
  if (s.lastBackupAt && now - s.lastBackupAt < week) return false;
  if (s.backupSnoozeUntil && now < s.backupSnoozeUntil) return false;
  return true;
}
