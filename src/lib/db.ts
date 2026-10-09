import Dexie, { type EntityTable } from "dexie";
import type {
  Badge,
  Category,
  ChatMessage,
  Expense,
  Goal,
  GoalContribution,
  Income,
  IOU,
  QuickButton,
  Recurring,
  Settings,
  WeeklyReport,
  WishItem,
} from "./types";

export class KharchaDB extends Dexie {
  settings!: EntityTable<Settings, "id">;
  categories!: EntityTable<Category, "id">;
  expenses!: EntityTable<Expense, "id">;
  recurring!: EntityTable<Recurring, "id">;
  quickButtons!: EntityTable<QuickButton, "id">;
  goals!: EntityTable<Goal, "id">;
  goalContributions!: EntityTable<GoalContribution, "id">;
  ious!: EntityTable<IOU, "id">;
  badges!: EntityTable<Badge, "id">;
  chatMessages!: EntityTable<ChatMessage, "id">;
  wishlist!: EntityTable<WishItem, "id">;
  reports!: EntityTable<WeeklyReport, "weekStart">;
  income!: EntityTable<Income, "id">;
  deletedRecords!: EntityTable<{ id: string; table: string; deletedAt: number }, "id">;

  constructor() {
    super("kharcha");
    this.version(1).stores({
      settings: "id",
      categories: "id",
      expenses: "id, ts, categoryId, tag, recurringId",
      recurring: "id, nextDate",
      quickButtons: "id, order",
      goals: "id",
      goalContributions: "id, goalId, ts",
      ious: "id, person, settled",
      badges: "id",
      chatMessages: "id, createdAt",
      wishlist: "id, status",
      reports: "weekStart",
    });
    this.version(2).stores({ ious: "id, person, settled, ts" });
    this.version(3).stores({ income: "id, ts, iouId" });
    this.version(4).stores({ deletedRecords: "id, table, deletedAt" });
  }
}

export const db = new KharchaDB();

export const TABLE_NAMES = [
  "settings",
  "categories",
  "expenses",
  "recurring",
  "quickButtons",
  "goals",
  "goalContributions",
  "ious",
  "badges",
  "chatMessages",
  "wishlist",
  "reports",
  "income",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

export function uid(): string {
  return crypto.randomUUID();
}
