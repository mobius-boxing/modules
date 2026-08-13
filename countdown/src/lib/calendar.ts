import { toCalendarDate } from "./format";

export type CalendarMode = "month" | "week";

export interface CalendarDay {
  /** 'YYYY-MM-DD' — the key documents are grouped by. */
  key: string;
  date: Date;
  dayOfMonth: number;
  /** False for the leading and trailing days a month grid borrows from its
   *  neighbours, which are shown greyed rather than blank. */
  inRange: boolean;
  isToday: boolean;
}

export interface CalendarRange {
  days: CalendarDay[];
  /** Inclusive bounds for the API's dueFrom / dueTo. */
  from: string;
  to: string;
  title: string;
}

/** Monday-first, as every Argentine wall calendar is. */
const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export function weekdayLabels(): string[] {
  return WEEKDAY_LABELS;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is 0 for Sunday; shift so Monday is 0.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const monthTitle = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/**
 * The grid for a month or a week, anchored on any date inside it.
 *
 * A month always yields six rows so the grid does not change height as you page
 * through the year — a calendar that reflows on every click is hard to scan.
 */
export function buildCalendar(anchor: Date, mode: CalendarMode): CalendarRange {
  const today = new Date();

  if (mode === "week") {
    const start = startOfWeek(anchor);
    const days: CalendarDay[] = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return {
        key: toCalendarDate(date),
        date,
        dayOfMonth: date.getDate(),
        inRange: true,
        isToday: sameDay(date, today),
      };
    });
    const first = days[0]!;
    const last = days[6]!;
    return {
      days,
      from: first.key,
      to: last.key,
      title: `${dayTitle.format(first.date)} – ${dayTitle.format(last.date)}`,
    };
  }

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const days: CalendarDay[] = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return {
      key: toCalendarDate(date),
      date,
      dayOfMonth: date.getDate(),
      inRange: date.getMonth() === anchor.getMonth(),
      isToday: sameDay(date, today),
    };
  });

  return {
    days,
    from: days[0]!.key,
    to: days[41]!.key,
    title: monthTitle.format(monthStart),
  };
}

/** Step the anchor by one month or one week, in either direction. */
export function stepAnchor(anchor: Date, mode: CalendarMode, direction: 1 | -1): Date {
  if (mode === "week") {
    return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * direction);
  }
  // Day 1 avoids the 31st-of-January problem when stepping into a short month.
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}
