"use client";

import { db } from "./db";
import type { PaymentMode, Tag } from "./types";

export interface AIStatus {
  ai: boolean;
  provider: "gemini" | "claude" | null;
  /** Send only numbers to the AI (Gemini free tier). */
  trimSnapshot: boolean;
  passcodeRequired: boolean;
}

let statusCache: Promise<AIStatus> | null = null;
export function getAIStatus(): Promise<AIStatus> {
  statusCache ??= fetch("/api/status")
    .then((r) => r.json() as Promise<AIStatus>)
    .catch((): AIStatus => ({ ai: false, provider: null, trimSnapshot: true, passcodeRequired: false }));
  return statusCache;
}

async function headers(): Promise<HeadersInit> {
  const s = await db.settings.get("me");
  return {
    "Content-Type": "application/json",
    ...(s?.appPasscode ? { "x-app-passcode": s.appPasscode } : {}),
  };
}

/** An error from the app's AI routes; `status` 401 means the app passcode is missing or wrong. */
export class AIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<AIError> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return new AIError(data?.error ?? `Request failed (${res.status})`, res.status);
}

export async function streamChat(
  messages: { role: "user" | "assistant"; content: string }[],
  snapshot: string,
  onText: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ messages, snapshot }),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onText(full);
  }
  return full;
}

export { splitVerdict } from "./verdict";

export interface ParsedExpense {
  amount: number;
  title: string;
  categoryId: string;
  place: string | null;
  paymentMode: PaymentMode;
  tag: Tag;
  date: string;
  time: string | null;
}

export async function parseExpenseText(
  text: string,
  categories: { id: string; name: string }[],
  now = new Date(),
): Promise<ParsedExpense> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const res = await fetch("/api/parse-expense", {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({
      text,
      categories,
      today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      weekday: now.toLocaleDateString("en-IN", { weekday: "long" }),
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export interface AIReport {
  grade: string;
  headline: string;
  wins: string[];
  tip: string;
  funLine: string;
}

export async function fetchWeeklyReport(name: string, summary: string, suggestedGrade: string): Promise<AIReport> {
  const res = await fetch("/api/weekly-report", {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({ name, summary, suggestedGrade }),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}
