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

/**
 * Ids of a series' future events that have no attendance record — the set that
 * is safe to drop when a series rule changes or is stopped. "Future" means
 * event_date >= fromIso (an ISO date string, compared lexically). An event is
 * kept if any record references it. Pure so both the DB delete and the local
 * state filter can share one definition (the DB delete can't express this as a
 * subquery: the hub's row-policy rewriter rejects referencing the governed
 * records table inside a subquery of a statement targeting events).
 */
export function pruneableSeriesEventIds(events, records, seriesId, fromIso) {
  const marked = new Set(records.map((r) => r.event_id));
  return events
    .filter((e) => e.series_id === seriesId && String(e.event_date) >= fromIso && !marked.has(e.id))
    .map((e) => e.id);
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
