import { describe, it, expect } from "vitest";
import {
  statusMeta, nextStatus, daysUntilDate, splitEvents, recordsByMember,
  isAttended, memberSummary, headcount,
  occurrencesForSeries, seriesLabel, formatTime12, WEEKDAYS,
  chunkIds, MAX_BOUND_PARAMS, searchableFields,
  buildCalendarEvents, CALENDAR_EXPORT_MAX_EVENTS, CALENDAR_EXPORT_HORIZON_DAYS,
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

// The prune set is decided in SQL now (pruneSeriesFutureEvents), not from the
// page's truncated caches. What stays testable is the slicing every `IN (…)`
// over that set needs: D1 rejects a statement with more than 100 bound params.
describe("chunkIds", () => {
  const ids = Array.from({ length: 205 }, (_, i) => `e${i}`);

  it("never exceeds D1's bound-parameter budget", () => {
    const chunks = chunkIds(ids);
    expect(chunks.every((c) => c.length <= MAX_BOUND_PARAMS)).toBe(true);
    expect(chunks).toHaveLength(3);
  });
  it("preserves every id exactly once, in order", () => {
    expect(chunkIds(ids).flat()).toEqual(ids);
  });
  it("returns nothing for an empty list", () => {
    expect(chunkIds([])).toEqual([]);
  });
});

describe("searchableFields", () => {
  it("matches on location and notes, not just the event title", () => {
    const fields = searchableFields({ title: "July pack meeting", location: "Scout hut", notes: "bring badges", kind: "meeting" });
    expect(fields).toContain("Scout hut");
    expect(fields).toContain("bring badges");
  });
});

describe("buildCalendarEvents", () => {
  const TODAY = "2026-09-07";
  const ev = (over) => ({
    id: "e1", title: "Pack meeting", kind: "meeting", event_date: "2026-09-08",
    start_time: "18:30", location: "Scout hut", notes: "bring badges", ...over,
  });

  it("emits a timed entry the hub can parse", () => {
    const [out] = buildCalendarEvents([ev()], TODAY);
    expect(out.id).toBe("e1");
    expect(out.title).toBe("Pack meeting");
    expect(out.start).toBe("2026-09-08T18:30");
    // No end column exists, so the entry is a point in the day, not a range.
    expect(out.end).toBe("2026-09-08T18:30");
    expect(out.all_day).toBe(false);
    expect(out.location).toBe("Scout hut");
    expect(out.description).toBe("Meeting");
    // A session belongs to the whole org, not to one member, and the roll is
    // exactly the part that must not travel with it.
    expect(out.member_ids).toEqual([]);
    expect(out.source_label).toBe("Attendance");
  });

  it("degrades a session with no time to an all-day entry", () => {
    const [out] = buildCalendarEvents([ev({ start_time: "" })], TODAY);
    expect(out.start).toBe("2026-09-08");
    expect(out.end).toBe("2026-09-08");
    expect(out.all_day).toBe(true);
  });

  it("includes today, and drops yesterday and anything past the horizon", () => {
    const beyond = plusDays(TODAY, CALENDAR_EXPORT_HORIZON_DAYS + 1);
    const edge = plusDays(TODAY, CALENDAR_EXPORT_HORIZON_DAYS);
    const ids = buildCalendarEvents([
      ev({ id: "yesterday", event_date: plusDays(TODAY, -1) }),
      ev({ id: "today", event_date: TODAY }),
      ev({ id: "edge", event_date: edge }),
      ev({ id: "beyond", event_date: beyond }),
    ], TODAY).map((e) => e.id);
    expect(ids).toEqual(["today", "edge"]);
  });

  it("never leaks the leader's notes into the payload", () => {
    // This blob reaches the ICS feed, which external calendar services fetch.
    const json = JSON.stringify(buildCalendarEvents([ev()], TODAY));
    expect(json).not.toContain("bring badges");
    expect(json).not.toContain("notes");
  });

  it("caps at the hub's per-app ceiling, keeping the nearest sessions", () => {
    const many = [];
    for (let i = 0; i < CALENDAR_EXPORT_MAX_EVENTS + 20; i++) {
      many.push(ev({ id: `e${i}`, event_date: plusDays(TODAY, i + 1) }));
    }
    // Shuffled in reverse so the cap can only survive by sorting first.
    const out = buildCalendarEvents(many.reverse(), TODAY);
    expect(out).toHaveLength(CALENDAR_EXPORT_MAX_EVENTS);
    expect(out[0].id).toBe("e0");
    expect(out[out.length - 1].id).toBe(`e${CALENDAR_EXPORT_MAX_EVENTS - 1}`);
  });

  it("labels an unknown or missing kind rather than shipping an empty one", () => {
    expect(buildCalendarEvents([ev({ kind: "" })], TODAY)[0].description).toBe("Session");
    expect(buildCalendarEvents([ev({ kind: "service" })], TODAY)[0].description).toBe("Service");
  });

  it("publishes nothing when the household day is unreadable", () => {
    expect(buildCalendarEvents([ev()], "")).toEqual([]);
  });
});
