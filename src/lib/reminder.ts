import { addDays, addMinutes, format } from "date-fns";

/**
 * A web app can't reliably ring a reminder while it's closed (that needs a paid push server),
 * so the daily "log today's kharcha" reminder lives in the user's calendar instead.
 */
const TITLE = "Log today's kharcha 🦉";

/** Next occurrence of HH:mm (today if still ahead, else tomorrow), in local time. */
export function nextAt(time: string, now: Date): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 21, m || 0);
  return d > now ? d : addDays(d, 1);
}

const stamp = (d: Date) => format(d, "yyyyMMdd'T'HHmmss");

/** Opens Google Calendar (web or the Android app) with a daily repeating event filled in. */
export function googleCalendarUrl(time: string, appUrl: string, now: Date): string {
  const start = nextAt(time, now);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: TITLE,
    dates: `${stamp(start)}/${stamp(addMinutes(start, 5))}`,
    recur: "RRULE:FREQ=DAILY",
    details: `Open Kharcha and log today's expenses (or mark a ₹0 day): ${appUrl}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The same reminder as an .ics file, for Samsung Calendar, Apple Calendar, Outlook… */
export function reminderIcs(time: string, appUrl: string, now: Date): string {
  const start = nextAt(time, now);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kharcha//Daily reminder//EN",
    "BEGIN:VEVENT",
    "UID:kharcha-daily-reminder",
    `DTSTAMP:${format(now, "yyyyMMdd'T'HHmmss")}`,
    `DTSTART:${stamp(start)}`,
    "DURATION:PT5M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${TITLE}`,
    `DESCRIPTION:Open Kharcha and log today's expenses: ${appUrl}`,
    `URL:${appUrl}`,
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${TITLE}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
