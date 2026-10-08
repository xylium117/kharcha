export type PaymentMode = "UPI" | "Cash" | "Card" | "Other";
export type Tag = "need" | "want" | "waste";
export type ExpenseSource = "quick" | "form" | "ai" | "recurring" | "split" | "wishlist";
export type SeasonMode = "normal" | "exam" | "fest" | "home";
export type ThemePref = "light" | "dark" | "system";

export interface Settings {
  id: "me";
  name: string;
  monthlyBudget: number;
  /** Day of month when pocket money arrives; the budget period starts here. */
  monthStartDay: number;
  /** Per-period budget overrides keyed by period key (yyyy-MM of period start). */
  budgetOverrides: Record<string, number>;
  seasonMode: SeasonMode;
  /** Month (1-12) the academic year starts, used for semester views. */
  academicStartMonth: number;
  noSpendDays: string[]; // yyyy-MM-dd
  statsVisits: number;
  guruQuestions: number;
  appPasscode?: string;
  createdAt: number;
  /** When a backup file was last exported. */
  lastBackupAt?: number;
  /** "Back up now?" reminder hidden until this time. */
  backupSnoozeUntil?: number;
  /** Daily reminder time (HH:mm) used for the calendar reminder. */
  reminderTime?: string;
  /** Last weekly feedback check-in week handled (answered or skipped). */
  feedbackWeekDone?: number;
}

export type IncomeSource = "gift" | "refund" | "repayment" | "other";

/** Money coming in on top of pocket money. Repayments are created when a "they owe me" IOU is settled. */
export interface Income {
  id: string;
  amount: number;
  source: IncomeSource;
  note?: string;
  ts: number;
  iouId?: string;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  isDefault?: boolean;
}

export interface Expense {
  id: string;
  amount: number;
  categoryId: string;
  title: string;
  place?: string;
  paymentMode: PaymentMode;
  tag: Tag;
  note?: string;
  mood?: string;
  ts: number;
  source: ExpenseSource;
  recurringId?: string;
}

export interface Recurring {
  id: string;
  title: string;
  amount: number;
  categoryId: string;
  frequency: "monthly" | "weekly";
  nextDate: string; // yyyy-MM-dd
  active: boolean;
}

export interface QuickButton {
  id: string;
  label: string;
  emoji: string;
  amount: number;
  categoryId: string;
  order: number;
  /** Defaults to "need" / "UPI" for buttons saved before these existed. */
  tag?: Tag;
  paymentMode?: PaymentMode;
}

export interface Goal {
  id: string;
  title: string;
  emoji: string;
  target: number;
  deadline: string; // yyyy-MM-dd
  createdAt: number;
  completedAt?: number;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amount: number;
  ts: number;
}

export interface IOU {
  id: string;
  person: string;
  amount: number;
  direction: "theyOwe" | "iOwe";
  reason: string;
  ts: number;
  settled: boolean;
  settledAt?: number;
}

export interface Badge {
  id: string;
  unlockedAt: number;
}

export type Verdict = "go" | "think" | "skip";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  verdict?: Verdict;
  createdAt: number;
}

export interface WishItem {
  id: string;
  title: string;
  price: number;
  categoryId: string;
  addedAt: number;
  status: "waiting" | "bought" | "skipped";
  decidedAt?: number;
}

export interface WeeklyReport {
  weekStart: string; // yyyy-MM-dd (Monday)
  grade: string;
  headline: string;
  wins: string[];
  tip: string;
  funLine: string;
  createdAt: number;
  byAI: boolean;
}
