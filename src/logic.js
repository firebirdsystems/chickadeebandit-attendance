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
