import { format } from "date-fns";
import { db, TABLE_NAMES, type TableName } from "./db";
import type { Category, Expense } from "./types";

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

// ─── CSV Export ───────────────────────────────────────────────────────────────

function escCsv(v: unknown): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exports all expenses + category names to a CSV file. */
export async function exportExpensesCSV(): Promise<void> {
  const [expenses, categories] = await Promise.all([
    db.expenses.orderBy("ts").toArray(),
    db.categories.toArray(),
  ]);
  const catMap = new Map<string, Category>(categories.map((c) => [c.id, c]));

  const header = ["Date", "Time", "Title", "Amount", "Category", "Tag", "Payment Mode", "Note", "Mood"];
  const rows = expenses.map((e) => [
    format(e.ts, "yyyy-MM-dd"),
    format(e.ts, "HH:mm"),
    e.title,
    e.amount,
    catMap.get(e.categoryId)?.name ?? e.categoryId,
    e.tag,
    e.paymentMode,
    e.note ?? "",
    e.mood ?? "",
  ]);

  const csv = [header, ...rows].map((r) => r.map(escCsv).join(",")).join("\n");
  downloadText(csv, `kharcha-expenses-${format(new Date(), "yyyy-MM-dd")}.csv`, "text/csv");
}

// ─── PDF / Print Export ───────────────────────────────────────────────────────

/** Opens a print-to-PDF dialog with a styled monthly expense statement. */
export async function exportMonthPDF(
  monthLabel: string,
  expenses: Expense[],
  categoryMap: Map<string, Category>,
  currency = "INR",
  totalBudget = 0,
): Promise<void> {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const byTag = { need: 0, want: 0, waste: 0 };
  for (const e of expenses) byTag[e.tag] += e.amount;

  // Build category breakdown
  const byCat = new Map<string, number>();
  for (const e of expenses) byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amount);
  const catRows = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, amt]) => {
      const cat = categoryMap.get(id);
      return `<tr><td>${cat?.emoji ?? ""} ${cat?.name ?? id}</td><td class="num">${amt.toLocaleString()}</td></tr>`;
    })
    .join("");

  const expRows = expenses
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map(
      (e) => `<tr>
      <td>${format(e.ts, "d MMM")}</td>
      <td>${e.title}</td>
      <td>${categoryMap.get(e.categoryId)?.name ?? e.categoryId}</td>
      <td class="tag ${e.tag}">${e.tag}</td>
      <td class="num">${e.amount.toLocaleString()}</td>
    </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Kharcha – ${monthLabel}</title>
<style>
  body { font-family: system-ui, sans-serif; color: #1a1a2e; margin: 0; padding: 24px; font-size: 13px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #6c3fc5; }
  .sub { color: #888; margin: 0 0 20px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
  .card-label { font-size: 11px; color: #888; margin: 0 0 4px; }
  .card-value { font-size: 20px; font-weight: 700; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; font-size: 11px; color: #888; border-bottom: 2px solid #e2e8f0; padding: 6px 4px; }
  td { padding: 5px 4px; border-bottom: 1px solid #f1f5f9; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag { font-size: 11px; padding: 2px 6px; border-radius: 99px; text-align: center; }
  .need { background: #d1fae5; color: #065f46; }
  .want { background: #fef3c7; color: #92400e; }
  .waste { background: #fee2e2; color: #991b1b; }
  @media print { body { padding: 0; } }
</style></head><body>
<h1>Kharcha – ${monthLabel}</h1>
<p class="sub">Monthly expense statement · Generated ${format(new Date(), "d MMM yyyy, h:mm a")}</p>
<div class="grid">
  <div class="card"><p class="card-label">Total Spent</p><p class="card-value">${total.toLocaleString()}</p></div>
  <div class="card"><p class="card-label">Budget</p><p class="card-value">${totalBudget.toLocaleString()}</p></div>
  <div class="card"><p class="card-label">Remaining</p><p class="card-value" style="color:${totalBudget - total >= 0 ? "#059669" : "#dc2626"}">${(totalBudget - total).toLocaleString()}</p></div>
</div>
<table><thead><tr><th>Tag</th><th class="num">Amount</th></tr></thead><tbody>
<tr><td>✅ Need</td><td class="num">${byTag.need.toLocaleString()}</td></tr>
<tr><td>💭 Want</td><td class="num">${byTag.want.toLocaleString()}</td></tr>
<tr><td>🗑️ Waste</td><td class="num">${byTag.waste.toLocaleString()}</td></tr>
</tbody></table>
<table><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${catRows}</tbody></table>
<table><thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Tag</th><th class="num">Amount</th></tr></thead><tbody>${expRows}</tbody></table>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

