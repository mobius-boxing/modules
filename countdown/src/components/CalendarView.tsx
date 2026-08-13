import { useMemo, useState } from "react";
import { buildCalendar, CalendarMode, weekdayLabels } from "../lib/calendar";
import { dueLabel, urgency } from "../lib/format";
import type { DocumentItem } from "../types/api";

interface Props {
  documents: DocumentItem[];
  anchor: Date;
  mode: CalendarMode;
}

/** Three, then a button — a cell that grows without limit breaks the grid. */
const VISIBLE_PER_DAY = 3;

/** Most urgent first inside a day, so the truncated ones are the calm ones. */
const BAND_ORDER = { overdue: 0, week: 1, month: 2, later: 3, done: 4 } as const;

export function CalendarView({ documents, anchor, mode }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { days } = useMemo(() => buildCalendar(anchor, mode), [anchor, mode]);

  const byDay = useMemo(() => {
    const map = new Map<string, DocumentItem[]>();
    for (const document of documents) {
      const list = map.get(document.dueDate);
      if (list) list.push(document);
      else map.set(document.dueDate, [document]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          BAND_ORDER[urgency(a.daysUntilDue, a.status)] -
            BAND_ORDER[urgency(b.daysUntilDue, b.status)] || a.title.localeCompare(b.title, "es"),
      );
    }
    return map;
  }, [documents]);

  return (
    <div className={`calendar calendar--${mode}`}>
      {/* The weekday strip belongs to the month grid; a week view labels each
          day in its own header, because on a phone the days are stacked. */}
      {mode === "month" ? (
        <div className="calendar__weekdays" aria-hidden="true">
          {weekdayLabels().map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      ) : null}

      <div className="calendar__grid">
        {days.map((day) => {
          const items = byDay.get(day.key) ?? [];
          const isOpen = expanded === day.key;
          const visible = isOpen ? items : items.slice(0, VISIBLE_PER_DAY);
          const hidden = items.length - visible.length;

          return (
            <div
              key={day.key}
              className={`day${day.inRange ? "" : " day--outside"}${day.isToday ? " day--today" : ""}`}
            >
              <div className="day__head">
                <span className="day__weekday">
                  {new Intl.DateTimeFormat("es-AR", { weekday: "short" }).format(day.date)}
                </span>
                <span className="day__number tabular">{day.dayOfMonth}</span>
              </div>

              <ul className="day__items">
                {visible.map((document) => {
                  const band = urgency(document.daysUntilDue, document.status);
                  return (
                    <li className={`pill band--${band}`} key={document.uuid}>
                      <span className="pill__title" title={document.title}>
                        {document.title}
                      </span>
                      <span className="pill__meta">
                        {document.category?.name ?? dueLabel(document.daysUntilDue, document.status)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {hidden > 0 || isOpen ? (
                <button
                  type="button"
                  className="day__more"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : day.key)}
                >
                  {isOpen ? "Ver menos" : `+${hidden} más`}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
