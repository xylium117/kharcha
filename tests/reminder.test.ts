import { describe, expect, it } from "vitest";
import { googleCalendarUrl, nextAt, reminderIcs } from "@/lib/reminder";

describe("daily reminder", () => {
  it("schedules today if the time is still ahead, else tomorrow", () => {
    expect(nextAt("21:00", new Date(2026, 9, 8, 19, 0)).getDate()).toBe(8);
    expect(nextAt("21:00", new Date(2026, 9, 8, 22, 0)).getDate()).toBe(9);
  });

  it("builds a daily repeating Google Calendar event", () => {
    const url = new URL(googleCalendarUrl("21:30", "https://kharcha.example", new Date(2026, 9, 8, 10, 0)));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("recur")).toBe("RRULE:FREQ=DAILY");
    expect(url.searchParams.get("dates")).toBe("20261008T213000/20261008T213500");
    expect(url.searchParams.get("details")).toContain("https://kharcha.example");
  });

  it("writes a valid .ics with CRLF lines and an alarm", () => {
    const ics = reminderIcs("21:00", "https://kharcha.example", new Date(2026, 9, 8, 22, 0));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261009T210000");
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("BEGIN:VALARM");
  });
});
