/**
 * A dueDate is 'YYYY-MM-DD'. `new Date("2026-08-05")` parses as UTC midnight,
 * which renders as the 4th anywhere west of Greenwich — exactly the off-by-one
 * day this app must never show. Build the date from its parts instead.
 */
export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

const shortDate = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short" });
const fullDate = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** "05 ago" — compact, for rows where the group already gives the context. */
export function formatDate(value: string): string {
  return shortDate.format(parseCalendarDate(value)).replace(".", "");
}

export function formatFullDate(value: string): string {
  return fullDate.format(parseCalendarDate(value));
}

/** Timestamps are real instants, so these parse normally. */
export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short" }).format(new Date(value));
}

/** 'YYYY-MM-DD' from a Date's *local* parts — never toISOString, which is UTC
 *  and rolls the calendar day back for anyone west of Greenwich. */
export function toCalendarDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type RecurrenceUnitValue = "day" | "month" | "year";

/**
 * The next due date, mirroring nextDueDate() in the API's lib/recurrence.ts.
 * Duplicated on purpose: the dialog pre-fills the date before anything is sent,
 * and the server recomputes it anyway. Month steps clamp to the end of the
 * target month — 31 January plus a month is 28 February, not 3 March.
 */
export function nextDueDate(dueDate: string, count: number, unit: RecurrenceUnitValue): string {
  const [year, month, day] = dueDate.split("-").map(Number) as [number, number, number];

  if (unit === "day") return toCalendarDate(new Date(year, month - 1, day + count));

  const months = unit === "year" ? count * 12 : count;
  const absolute = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = absolute - targetYear * 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return toCalendarDate(new Date(targetYear, targetMonth, Math.min(day, lastDay)));
}

export type Urgency = "overdue" | "week" | "month" | "later" | "done";

/**
 * Four bands, agreed with the client: red (and blinking) once overdue, orange
 * inside a week, yellow inside a month, green beyond that. The boundaries live
 * here alone — the groups, the dots and the filter chips all read them from
 * this function so they cannot drift apart.
 */
export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;

export function urgency(days: number, status: string): Urgency {
  if (status === "resolved") return "done";
  if (days < 0) return "overdue";
  if (days <= WEEK_DAYS) return "week";
  if (days <= MONTH_DAYS) return "month";
  return "later";
}

/**
 * Terse on purpose: the group heading above the row already says "Vencidos" or
 * "Esta semana", so the row only has to say how far.
 */
export function dueLabel(days: number, status: string): string {
  if (status === "resolved") return "resuelto";
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  if (days === -1) return "ayer";
  if (days < -1) return `hace ${Math.abs(days)} días`;
  return `en ${days} días`;
}
