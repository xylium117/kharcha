import type { Category, QuickButton, Settings } from "./types";

export const PASTELS = [
  "#C8B6FF", // lavender
  "#B8F2E6", // mint
  "#FFD6A5", // peach
  "#FFC6D9", // baby pink
  "#A0C4FF", // sky
  "#FDFFB6", // butter
  "#CAFFBF", // pistachio
  "#FFADAD", // coral
  "#9BF6FF", // aqua
  "#E4C1F9", // lilac
];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "food", name: "Food", emoji: "🍛", color: "#FFD6A5", isDefault: true },
  { id: "chai", name: "Snacks & Chai", emoji: "☕", color: "#FDFFB6", isDefault: true },
  { id: "transport", name: "Transport", emoji: "🚌", color: "#A0C4FF", isDefault: true },
  { id: "books", name: "Books & Xerox", emoji: "📚", color: "#C8B6FF", isDefault: true },
  { id: "mobile", name: "Mobile & Internet", emoji: "📱", color: "#9BF6FF", isDefault: true },
  { id: "fun", name: "Fun & OTT", emoji: "🎬", color: "#FFC6D9", isDefault: true },
  { id: "shopping", name: "Shopping", emoji: "🛍️", color: "#E4C1F9", isDefault: true },
  { id: "health", name: "Health", emoji: "💊", color: "#CAFFBF", isDefault: true },
  { id: "hostel", name: "Mess & Hostel", emoji: "🏠", color: "#B8F2E6", isDefault: true },
  { id: "other", name: "Other", emoji: "✨", color: "#FFADAD", isDefault: true },
];

export const DEFAULT_QUICK_BUTTONS: QuickButton[] = [
  { id: "q-tea", label: "Tea", emoji: "☕", amount: 15, categoryId: "chai", order: 0, tag: "need", paymentMode: "Cash" },
  { id: "q-bus", label: "Bus", emoji: "🚌", amount: 20, categoryId: "transport", order: 1, tag: "need", paymentMode: "Cash" },
  { id: "q-canteen", label: "Canteen", emoji: "🍜", amount: 60, categoryId: "food", order: 2, tag: "need", paymentMode: "UPI" },
  { id: "q-xerox", label: "Xerox", emoji: "📄", amount: 10, categoryId: "books", order: 3, tag: "need", paymentMode: "Cash" },
  { id: "q-snack", label: "Snacks", emoji: "🥪", amount: 30, categoryId: "chai", order: 4, tag: "want", paymentMode: "Cash" },
  { id: "q-auto", label: "Auto", emoji: "🛺", amount: 40, categoryId: "transport", order: 5, tag: "need", paymentMode: "UPI" },
];

export function defaultSettings(name: string, monthlyBudget: number): Settings {
  return {
    id: "me",
    name,
    monthlyBudget,
    monthStartDay: 1,
    budgetOverrides: {},
    seasonMode: "normal",
    academicStartMonth: 7,
    noSpendDays: [],
    statsVisits: 0,
    guruQuestions: 0,
    createdAt: Date.now(),
  };
}

export const PAYMENT_MODES = ["UPI", "Cash", "Card", "Other"] as const;

export const TAGS = [
  { id: "need", label: "Need", emoji: "✅", color: "#B8F2E6" },
  { id: "want", label: "Want", emoji: "💭", color: "#FFD6A5" },
  { id: "waste", label: "Waste", emoji: "🗑️", color: "#FFADAD" },
] as const;

export const MOODS = ["😄", "🙂", "😐", "😕", "😩"];
