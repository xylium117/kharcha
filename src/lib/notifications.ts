import { useEffect } from "react";
import { db } from "./db";
import { dayKey } from "./format";
import { nextAt } from "./reminder";
import type { Settings } from "./types";

/** Checks if the Web Notification API is supported by the current environment. */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export type NotificationPermissionState = NotificationPermission | "unsupported";

/** Gets current notification permission status. */
export function getNotificationPermission(): NotificationPermissionState {
  if (!isNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/** Requests permission to show notifications from the browser/OS. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNotificationSupported()) return "unsupported";
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (err) {
    console.error("Failed to request notification permission:", err);
    return Notification.permission;
  }
}

/** Delivers a system / PWA notification using ServiceWorker or standard Notification API. */
export async function showDailyReminderNotification(
  title = "Kharcha 🦉 · Log your expenses",
  body = "Did you spend anything today? Log it in seconds."
): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== "granted") return false;

  const options: NotificationOptions & Record<string, any> = {
    body,
    icon: "/pwa-icon/192",
    badge: "/pwa-icon/192",
    tag: "kharcha-daily-reminder",
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: "/" },
  };

  // Try Service Worker registration first (standard for PWAs, persists in OS notification tray)
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && "showNotification" in reg) {
        await reg.showNotification(title, options);
        return true;
      }
    } catch (e) {
      console.warn("ServiceWorker showNotification failed, falling back to Notification constructor:", e);
    }
  }

  // Fallback to Window Notification constructor
  try {
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    return true;
  } catch (e) {
    console.error("Failed to show notification:", e);
    return false;
  }
}

/** Checks whether the user has logged any expenses for the given date (yyyy-MM-dd). */
export async function hasLoggedExpenseToday(dateStr = dayKey(new Date())): Promise<boolean> {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    const count = await db.expenses.where("ts").between(start, end, true, true).count();
    return count > 0;
  } catch {
    return false;
  }
}

/**
 * Evaluates whether a daily reminder should be triggered right now, and sends it if due.
 * Returns true if a notification was delivered.
 */
export async function checkAndDeliverDailyReminder(settings?: Settings | null, force = false): Promise<boolean> {
  if (!settings && !force) return false;
  if (!isNotificationSupported() || Notification.permission !== "granted") return false;
  if (!force && settings && settings.notificationsEnabled === false) return false;

  const now = new Date();
  const today = dayKey(now);

  if (!force && settings?.lastNotifiedDate === today) {
    return false; // Already notified today
  }

  const timeStr = settings?.reminderTime ?? "21:00";
  const [h, m] = timeStr.split(":").map(Number);
  const targetToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 21, m || 0);

  // If not forcing, only notify if we have passed the target reminder time today
  if (!force && now < targetToday) {
    return false;
  }

  const alreadyLogged = await hasLoggedExpenseToday(today);
  const title = "Kharcha 🦉 · Time to log your day!";
  const body = alreadyLogged
    ? "All set for today? Tap if you had any last-minute spends."
    : "Don't forget to log today's expenses! Tap to record in seconds.";

  const sent = await showDailyReminderNotification(title, body);
  if (sent && !force) {
    await db.settings.update("me", { lastNotifiedDate: today }).catch(() => {});
  }
  return sent;
}

/**
 * React hook attached at the top-level (AppShell) that maintains the daily reminder schedule.
 * Accurately schedules timer to the target hour:minute (e.g., 21:00 IST) and re-checks on tab resume.
 */
export function useDailyReminderWatcher(settings: Settings | null | undefined) {
  useEffect(() => {
    if (!settings || !settings.notificationsEnabled || !isNotificationSupported()) return;
    if (Notification.permission !== "granted") return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    function planNextNotification() {
      if (timer) clearTimeout(timer);
      const timeStr = settings?.reminderTime ?? "21:00";
      const now = new Date();
      const nextOccurrence = nextAt(timeStr, now);
      const msUntil = Math.max(1000, nextOccurrence.getTime() - now.getTime());

      timer = setTimeout(async () => {
        await checkAndDeliverDailyReminder(settings);
        planNextNotification();
      }, msUntil);
    }

    // 1. Initial check (in case user opened the app after the notification time today)
    checkAndDeliverDailyReminder(settings);

    // 2. Schedule for the exact target time
    planNextNotification();

    // 3. Re-check on visibility change (device wake-up / tab switch)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        checkAndDeliverDailyReminder(settings);
        planNextNotification();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [settings?.reminderTime, settings?.notificationsEnabled, settings?.lastNotifiedDate]);
}
