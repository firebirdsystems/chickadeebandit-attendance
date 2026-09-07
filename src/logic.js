/**
 * Pure business logic for the Attendance app.
 * No DOM, no fetch — importable in both browser and test environments.
 */

export const STATUSES = [
  { value: "present", label: "Present", icon: "✅" },
  { value: "late",    label: "Late",    icon: "🕐" },
  { value: "excused", label: "Excused", icon: "📝" },
  { value: "absent",  label: "Absent",  icon: "❌" },
];

const STATUS_BY_VALUE = new Map(STATUSES.map((s) => [s.value, s]));

export function statusMeta(v) {
  return STATUS_BY_VALUE.get(v) ?? { value: "absent", label: "Absent", icon: "❌" };
}

/** The next status in the tap-to-cycle order (unmarked → present → late → excused → absent → present…). */
export function nextStatus(current) {
  if (!current) return "present";
  const order = STATUSES.map((s) => s.value);
  const i = order.indexOf(current);
  return order[(i + 1) % order.length];
}

function atMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Whole days until an ISO date; negative = past, null = invalid. */
export function daysUntilDate(iso, from = new Date()) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((atMidnight(d) - atMidnight(from)) / 86400000);
}

/** Events split into { upcoming (soonest first), past (newest first) }. */
export function splitEvents(events, from = new Date()) {
  const upcoming = [];
  const past = [];
  for (const e of events) {
    const days = daysUntilDate(e.event_date, from);
    if (days != null && days >= 0) upcoming.push({ ...e, _days: days });
    else past.push({ ...e, _days: days });
  }
  upcoming.sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)) || String(a.start_time).localeCompare(String(b.start_time)));
  past.sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
  return { upcoming, past };
}

/** Record lookup for one event: member_id → record. */
export function recordsByMember(records, eventId) {
  const map = new Map();
  for (const r of records) if (r.event_id === eventId) map.set(r.member_id, r);
  return map;
}

/** Attended = present or late (they showed up). */
export function isAttended(status) {
  return status === "present" || status === "late";
}

/**
 * Per-member attendance summary over PAST events that have at least one mark:
 * [{ member_id, attended, marked, rate }] sorted lowest rate first (so
 * drifting members surface). Members with no marks at all are skipped.
 */
export function memberSummary(records, pastEvents) {
  const pastIds = new Set(pastEvents.map((e) => e.id));
  const perMember = new Map();
  for (const r of records) {
    if (!pastIds.has(r.event_id)) continue;
    const cur = perMember.get(r.member_id) ?? { member_id: r.member_id, attended: 0, marked: 0 };
    cur.marked += 1;
    if (isAttended(r.status)) cur.attended += 1;
    perMember.set(r.member_id, cur);
  }
  return [...perMember.values()]
    .map((m) => ({ ...m, rate: m.marked ? Math.round((m.attended / m.marked) * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate || b.marked - a.marked);
}

/** Headcount for one event: { present, late, excused, absent, marked }. */
export function headcount(records, eventId) {
  const out = { present: 0, late: 0, excused: 0, absent: 0, marked: 0 };
  for (const r of records) {
    if (r.event_id !== eventId) continue;
    out.marked += 1;
    if (out[r.status] != null) out[r.status] += 1;
  }
  return out;
}

// `pruneableSeriesEventIds` lived here: it decided which of a series' future
// events to DELETE by asking whether the PAGE'S CACHE held a record for them.
// That cache is loaded with `LIMIT 300` on events and an UNORDERED `LIMIT 3000`
// on records, so an event whose attendance records fell outside the truncated
// window read as unmarked — and was deleted, taking the records that proved
// otherwise with it. Both sides are now queried from the DB scoped to the one
// series (see pruneSeriesFutureEvents in index.html), which is authoritative and
// leaves nothing pure to share.

/** D1 rejects a statement with more than 100 bound parameters, so every
 *  `IN (…)` built from a variable-length id list has to be issued in slices. A
 *  weekly series over a couple of years easily clears the ceiling. */
export const MAX_BOUND_PARAMS = 90;

/** Split a list into chunks of at most `size` (default: D1's safe parameter budget). */
export function chunkIds(ids, size = MAX_BOUND_PARAMS) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/* ── Recurring series ─────────────────────────────────────────────────────── */

/** Weekday options for the series form; value matches JS Date.getDay() (0=Sun). */
export const WEEKDAYS = [
  { value: 0, label: "Sunday",    short: "Sun" },
  { value: 1, label: "Monday",    short: "Mon" },
  { value: 2, label: "Tuesday",   short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday",  short: "Thu" },
  { value: 5, label: "Friday",    short: "Fri" },
  { value: 6, label: "Saturday",  short: "Sat" },
];

function isoToNoon(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function noonToIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A new noon Date `n` days from `d`, rebuilt from components so DST can't drift it. */
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0, 0);
}

/** "6:00 PM" from "18:00"; "" if unparseable/empty. */
export function formatTime12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** Human summary of a series rule, e.g. "Every 2 weeks · Tuesday · 6:00 PM". */
export function seriesLabel(series) {
  const wd = WEEKDAYS.find((w) => w.value === Number(series.weekday))?.label ?? "";
  const n = Math.max(1, Number(series.interval_weeks) || 1);
  const cadence = n === 1 ? "Weekly" : `Every ${n} weeks`;
  const time = series.start_time ? ` · ${formatTime12(series.start_time)}` : "";
  return `${cadence} · ${wd}${time}`;
}

/**
 * ISO dates a weekly series lands on within [fromIso, toIso] (inclusive).
 * Occurrences are phase-locked to `start_date` (so "every 2 weeks" keeps the
 * same alternating weeks no matter the window), stepping interval_weeks*7 days
 * from the first matching weekday on/after start_date, capped at end_date.
 */
export function occurrencesForSeries(series, fromIso, toIso) {
  const out = [];
  if (!series) return out;
  const weekday = Number(series.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return out;
  const start = isoToNoon(series.start_date);
  const from = isoToNoon(fromIso);
  const to = isoToNoon(toIso);
  if (start == null || from == null || to == null) return out;

  const interval = Math.max(1, Math.trunc(Number(series.interval_weeks) || 1));
  const stepDays = interval * 7;
  const end = series.end_date ? isoToNoon(series.end_date) : null;
  const hardEnd = end != null && end < to ? end : to;

  // Phase anchor: first date on/after start_date whose weekday matches.
  const anchor = addDays(start, (weekday - start.getDay() + 7) % 7);

  // Jump straight to the first occurrence >= from (start may be far in the past).
  let cur = anchor;
  if (cur < from) {
    const dayGap = Math.round((from - cur) / 86400000);
    cur = addDays(cur, Math.ceil(dayGap / stepDays) * stepDays);
  }
  for (let guard = 0; cur <= hardEnd && guard < 500; guard++) {
    if (cur >= from) out.push(noonToIso(cur));
    cur = addDays(cur, stepDays);
  }
  return out;
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * Location and notes count as well as the title. Past events are
 * capped at 20 on screen, so search is the only way to reach an older
 * one at all.
 */
export function searchableFields(item) {
  return [item.title, item.location, item.notes, item.kind];
}

/* ── Calendar export ───────────────────────────────────────────────────────── */

export const CALENDAR_EXPORT_HORIZON_DAYS = 180;
export const CALENDAR_EXPORT_MAX_EVENTS = 100;

/** "Meeting" from "meeting" — the short label a calendar entry carries. */
export function eventKindLabel(kind) {
  const k = String(kind ?? "").trim();
  if (!k) return "Session";
  return `${k[0].toUpperCase()}${k.slice(1)}`;
}

/**
 * Build the `calendar_events` payload from upcoming sessions.
 *
 * Shape matches what the hub's cross-app aggregation consumes — see
 * `normalizeExportedEvent` in packages/hub/src/cloudflare/calendar-feed.ts.
 * An event with no `start_time` becomes an all-day entry: the hub derives
 * `allDay` from the absence of a `T` in `start`, so a date-only session
 * degrades on its own rather than being dropped. There is no end column, so
 * `end` equals `start` and the calendar draws a point in the day.
 *
 * ONLY the events table is exported. The store blob this feeds is scope-wide —
 * every member of the household, and in a shared space every household in it,
 * reads the same bytes, and row policies do not filter it. `events` is
 * `adult_writable`, so the whole scope already reads every row: safe. The
 * `records` table carries `member_read_column: "member_id"`, meaning a mark is
 * readable only by the member it is about and their supervisor — a record must
 * NEVER reach this payload, and no headcount derived from one may either.
 *
 * `notes` is deliberately NOT exported. This payload reaches the household's
 * ICS feed, which external calendar services fetch, and a note is free text a
 * leader wrote for the group. Location IS exported because telling you where to
 * show up is what a calendar entry is FOR.
 *
 * `member_ids` is always empty: an attendance session is the org's schedule,
 * not one person's appointment, and the roll is exactly the part we withhold.
 *
 * The horizon is measured from `todayIso` — the HOUSEHOLD's day, supplied by
 * the caller — rather than from a device clock, so every viewer publishes the
 * same window.
 */
export function buildCalendarEvents(events, todayIso) {
  const today = isoToNoon(todayIso);
  if (today == null) return [];
  const horizon = noonToIso(addDays(today, CALENDAR_EXPORT_HORIZON_DAYS));
  return events
    .filter((e) => e.event_date >= todayIso && e.event_date <= horizon)
    .map((e) => {
      const start = e.start_time ? `${e.event_date}T${e.start_time}` : e.event_date;
      return {
        id: e.id,
        title: e.title,
        description: eventKindLabel(e.kind),
        location: e.location || "",
        start,
        end: start,
        all_day: !e.start_time,
        member_ids: [],
        source_label: "Attendance",
      };
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, CALENDAR_EXPORT_MAX_EVENTS);
}
