import { describe, it, expect } from "vitest";
import {
  statusMeta, nextStatus, daysUntilDate, splitEvents, recordsByMember,
  isAttended, memberSummary, headcount,
} from "../src/logic.js";

const FROM = new Date(2026, 6, 12, 9, 0, 0); // July 12, 2026 local

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

describe("misc", () => {
  it("statusMeta falls back to absent", () => expect(statusMeta("bogus").value).toBe("absent"));
  it("daysUntilDate handles invalid input", () => expect(daysUntilDate("", FROM)).toBeNull());
});
