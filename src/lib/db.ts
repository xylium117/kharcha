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

export class PaisaDB extends Dexie {
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

  constructor() {
    super("paisa-pal");
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
    // v2: IOUs are listed newest-first, so index their timestamp.
    this.version(2).stores({ ious: "id, person, settled, ts" });
    // v3: money coming in (gifts, refunds, IOU repayments).
    this.version(3).stores({ income: "id, ts, iouId" });
  }
}

export const db = new PaisaDB();

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
