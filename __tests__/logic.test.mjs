import { describe, it, expect } from "vitest";
import {
  statusMeta, nextStatus, daysUntilDate, splitEvents, recordsByMember,
  isAttended, memberSummary, headcount,
  occurrencesForSeries, seriesLabel, formatTime12, WEEKDAYS,
  pruneableSeriesEventIds,
} from "../src/logic.js";

const FROM = new Date(2026, 6, 12, 9, 0, 0); // July 12, 2026 local

/** ISO date `n` days from `iso` — mirrors the app's noon-anchored arithmetic. */
function plusDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekdayOf(iso) {
  return new Date(`${iso}T12:00:00`).getDay();
}

describe("nextStatus cycle", () => {
  it("cycles unmarked → present → late → excused → absent → present", () => {
    expect(nextStatus(null)).toBe("present");
    expect(nextStatus("present")).toBe("late");
    expect(nextStatus("late")).toBe("excused");
    expect(nextStatus("excused")).toBe("absent");
    expect(nextStatus("absent")).toBe("present");
  });
});

describe("splitEvents", () => {
  const events = [
    { id: "past", event_date: "2026-07-08", start_time: "18:30" },
    { id: "today", event_date: "2026-07-12", start_time: "09:00" },
    { id: "later", event_date: "2026-07-19", start_time: "09:00" },
  ];
  it("puts today in upcoming; sorts each side correctly", () => {
    const { upcoming, past } = splitEvents(events, FROM);
    expect(upcoming.map((e) => e.id)).toEqual(["today", "later"]);
    expect(past.map((e) => e.id)).toEqual(["past"]);
  });
});

describe("memberSummary", () => {
  const pastEvents = [{ id: "e1" }, { id: "e2" }];
  const records = [
    { event_id: "e1", member_id: "a", status: "present" },
    { event_id: "e2", member_id: "a", status: "absent" },
    { event_id: "e1", member_id: "b", status: "late" },
    { event_id: "future", member_id: "a", status: "present" }, // not a past event
  ];
  it("computes rates over past events only, lowest first", () => {
    const rows = memberSummary(records, pastEvents);
    expect(rows).toEqual([
      { member_id: "a", attended: 1, marked: 2, rate: 50 },
      { member_id: "b", attended: 1, marked: 1, rate: 100 },
    ]);
  });
  it("counts late as attended", () => {
    expect(isAttended("late")).toBe(true);
    expect(isAttended("excused")).toBe(false);
  });
});

describe("headcount / recordsByMember", () => {
  const records = [
    { event_id: "e1", member_id: "a", status: "present" },
    { event_id: "e1", member_id: "b", status: "absent" },
    { event_id: "e2", member_id: "a", status: "late" },
  ];
  it("tallies one event", () => {
    expect(headcount(records, "e1")).toEqual({ present: 1, late: 0, excused: 0, absent: 1, marked: 2 });
  });
  it("indexes by member for one event", () => {
    const map = recordsByMember(records, "e1");
    expect(map.get("a")?.status).toBe("present");
    expect(map.has("c")).toBe(false);
  });
});

describe("occurrencesForSeries", () => {
  const START = "2026-07-07";
  const startDow = weekdayOf(START);

  it("emits weekly occurrences when start_date is already on the weekday", () => {
    const s = { weekday: startDow, interval_weeks: 1, start_date: START };
    expect(occurrencesForSeries(s, START, plusDays(START, 14)))
      .toEqual([START, plusDays(START, 7), plusDays(START, 14)]);
  });

  it("snaps the first occurrence forward to the chosen weekday", () => {
    const s = { weekday: (startDow + 2) % 7, interval_weeks: 1, start_date: START };
    const first = occurrencesForSeries(s, START, plusDays(START, 6))[0];
    expect(first).toBe(plusDays(START, 2));
  });

  it("phase-locks 'every 2 weeks' to start_date, not to the window", () => {
    const s = { weekday: startDow, interval_weeks: 2, start_date: START };
    // Window opens one week in — the off week must be skipped, next is +14.
    const from = plusDays(START, 7);
    expect(occurrencesForSeries(s, from, plusDays(START, 21)))
      .toEqual([plusDays(START, 14)]);
  });

  it("respects end_date and window bounds (inclusive)", () => {
    const s = { weekday: startDow, interval_weeks: 1, start_date: START, end_date: plusDays(START, 7) };
    expect(occurrencesForSeries(s, START, plusDays(START, 60)))
      .toEqual([START, plusDays(START, 7)]);
  });

  it("formats dates correctly across a year rollover", () => {
    const start = "2026-12-29";
    const s = { weekday: weekdayOf(start), interval_weeks: 1, start_date: start };
    expect(occurrencesForSeries(s, start, "2027-01-19"))
      .toEqual(["2026-12-29", "2027-01-05", "2027-01-12", "2027-01-19"]);
  });

  it("returns [] for invalid input", () => {
    expect(occurrencesForSeries(null, START, START)).toEqual([]);
    expect(occurrencesForSeries({ weekday: 9, interval_weeks: 1, start_date: START }, START, START)).toEqual([]);
    expect(occurrencesForSeries({ weekday: 0, interval_weeks: 1, start_date: "" }, START, START)).toEqual([]);
  });
});

describe("seriesLabel / formatTime12", () => {
  it("labels weekly and every-N series", () => {
    expect(seriesLabel({ weekday: 2, interval_weeks: 1, start_time: "18:00" })).toBe("Weekly · Tuesday · 6:00 PM");
    expect(seriesLabel({ weekday: 4, interval_weeks: 2, start_time: "" })).toBe("Every 2 weeks · Thursday");
    expect(WEEKDAYS[2].label).toBe("Tuesday");
  });
  it("formats 24h times to 12h", () => {
    expect(formatTime12("18:00")).toBe("6:00 PM");
    expect(formatTime12("09:00")).toBe("9:00 AM");
    expect(formatTime12("00:30")).toBe("12:30 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
    expect(formatTime12("")).toBe("");
  });
});

describe("misc", () => {
  it("statusMeta falls back to absent", () => expect(statusMeta("bogus").value).toBe("absent"));
  it("daysUntilDate handles invalid input", () => expect(daysUntilDate("", FROM)).toBeNull());
});

describe("pruneableSeriesEventIds", () => {
  const events = [
    { id: "e1", series_id: "s1", event_date: "2026-07-01" }, // past
    { id: "e2", series_id: "s1", event_date: "2026-07-20" }, // future, unmarked -> prune
    { id: "e3", series_id: "s1", event_date: "2026-07-21" }, // future, marked -> keep
    { id: "e4", series_id: "s2", event_date: "2026-07-20" }, // other series -> ignore
    { id: "e5", series_id: "s1", event_date: "2026-07-15" }, // == today boundary, unmarked -> prune
  ];
  const records = [{ event_id: "e3", member_id: "m1", status: "present" }];

  it("returns future, unmarked events for the series (today inclusive)", () => {
    expect(pruneableSeriesEventIds(events, records, "s1", "2026-07-15").sort()).toEqual(["e2", "e5"]);
  });
  it("excludes marked future events", () => {
    expect(pruneableSeriesEventIds(events, records, "s1", "2026-07-15")).not.toContain("e3");
  });
  it("excludes past events and other series", () => {
    const ids = pruneableSeriesEventIds(events, records, "s1", "2026-07-15");
    expect(ids).not.toContain("e1");
    expect(ids).not.toContain("e4");
  });
  it("returns empty when nothing qualifies", () => {
    expect(pruneableSeriesEventIds(events, records, "s1", "2026-08-01")).toEqual([]);
  });
});
