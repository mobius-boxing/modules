import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { CalendarView } from "../components/CalendarView";
import { DocumentDialog } from "../components/DocumentDialog";
import { DocumentRow } from "../components/DocumentRow";
import { RenewDialog } from "../components/RenewDialog";
import { useAuth } from "../context/AuthContext";
import { buildCalendar, CalendarMode, stepAnchor } from "../lib/calendar";
import { toCalendarDate, urgency } from "../lib/format";
import type { Urgency } from "../lib/format";
import type { Category, DocumentItem, Summary } from "../types/api";

const PAGE_LIMIT = 100; // the API's maximum
const SEARCH_VISIBLE_FROM = 8;
/** Below this the month grid is unreadable, so the calendar is week-only. */
const MONTH_VIEW_MIN_WIDTH = 700;

/**
 * The four due-date bands, in urgency order — the same four the dots colour.
 * Labels double as the group headings and as the filter chips, so a chip and
 * the section it jumps to can never say different things.
 */
const BANDS: { key: Exclude<Urgency, "done">; label: string }[] = [
  { key: "overdue", label: "Vencidos" },
  { key: "week", label: "Esta semana" },
  { key: "month", label: "Este mes" },
  { key: "later", label: "Más adelante" },
];

type FilterKey = "all" | Urgency;
type ViewKey = "column" | "calendar";

interface Group {
  key: Exclude<Urgency, "done">;
  label: string;
  items: DocumentItem[];
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < MONTH_VIEW_MIN_WIDTH,
  );
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MONTH_VIEW_MIN_WIDTH - 1}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/**
 * The whole application. Counts live in the group headings rather than in a
 * separate row of stat cards, so a number can never disagree with the rows it
 * claims to count.
 *
 * Every filter lives in the URL: a colleague can be sent "everything overdue in
 * Servicios" as a link, and the back button behaves.
 */
export function WorkspacePage() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const narrow = useIsNarrow();

  const [items, setItems] = useState<DocumentItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState(() => params.get("q") ?? "");
  const [showResolved, setShowResolved] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [renewing, setRenewing] = useState<DocumentItem | null>(null);
  const [newUuid, setNewUuid] = useState<string | null>(null);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // ---- URL-backed state ----
  const search = params.get("q") ?? "";
  const filter = (params.get("band") ?? "all") as FilterKey;
  const category = params.get("category") ?? "";
  const view: ViewKey = params.get("view") === "calendar" ? "calendar" : "column";
  const storedMode = params.get("mode") === "week" ? "week" : "month";
  const mode: CalendarMode = narrow ? "week" : storedMode;
  const anchor = useMemo(() => {
    const raw = params.get("date");
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split("-").map(Number) as [number, number, number];
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [params]);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setParam({ q: searchInput.trim() || null }), 260);
    return () => clearTimeout(timer);
  }, [searchInput, setParam]);

  const range = useMemo(() => buildCalendar(anchor, mode), [anchor, mode]);

  const listParams = useMemo(
    () => ({
      status: "all" as const,
      search,
      category,
      limit: PAGE_LIMIT,
      sortBy: "dueDate",
      sortOrder: "asc" as const,
      // The calendar only ever needs the window on screen.
      ...(view === "calendar" ? { dueFrom: range.from, dueTo: range.to } : {}),
    }),
    [search, category, view, range.from, range.to],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, totals] = await Promise.all([api.listDocuments(listParams), api.summary()]);
      setItems(list.data);
      setTotal(list.totalCount);
      setSummary(totals);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los documentos.");
    } finally {
      setLoading(false);
    }
  }, [listParams]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api
      .listCategories()
      .then((list) => setCategories(list))
      .catch(() => setError("No se pudieron cargar los rubros."));
  }, []);

  const { groups, resolved } = useMemo(() => {
    const pending = items.filter((doc) => doc.status === "pending");
    const buckets: Group[] = BANDS.map((band) => ({
      key: band.key,
      label: band.label,
      items: pending.filter((doc) => urgency(doc.daysUntilDue, doc.status) === band.key),
    }));
    return {
      groups: buckets.filter((group) => group.items.length > 0),
      resolved: items.filter((doc) => doc.status === "resolved"),
    };
  }, [items]);

  /**
   * Chip counts are derived from the same rows the list renders, never from the
   * summary endpoint: a chip that says 4 above three visible rows is worse than
   * no chip at all.
   */
  const counts = useMemo(() => {
    const byBand = Object.fromEntries(groups.map((group) => [group.key, group.items.length]));
    return {
      all: items.length - resolved.length,
      overdue: byBand.overdue ?? 0,
      week: byBand.week ?? 0,
      month: byBand.month ?? 0,
      later: byBand.later ?? 0,
      done: resolved.length,
    } satisfies Record<FilterKey, number>;
  }, [groups, items.length, resolved.length]);

  const visibleGroups = filter === "all" ? groups : groups.filter((g) => g.key === filter);
  const showResolvedList = filter === "done" || (filter === "all" && showResolved);

  /**
   * Show who filed a document only once the queue is genuinely shared. With one
   * uploader it is the same name under every row: pure noise.
   */
  const sharedQueue = useMemo(
    () => new Set(items.map((doc) => doc.uploadedBy?.uuid ?? "?")).size > 1,
    [items],
  );

  const runAction = async (uuid: string, action: () => Promise<void>) => {
    setBusyUuid(uuid);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "La acción no se pudo completar.");
    } finally {
      setBusyUuid(null);
    }
  };

  /** Recurring documents ask first; everything else resolves in one click. */
  const handleToggle = (doc: DocumentItem) => {
    if (doc.status === "pending" && doc.recurrence) {
      setRenewing(doc);
      return;
    }
    return runAction(doc.uuid, async () => {
      await api.setStatus(doc.uuid, doc.status === "resolved" ? "pending" : "resolved");
      await load();
    });
  };

  const handleResolveRenew = (nextDue: string | null) => {
    const doc = renewing;
    if (!doc) return;
    void runAction(doc.uuid, async () => {
      const result = await api.setStatus(
        doc.uuid,
        "resolved",
        nextDue ? { renew: true, nextDueDate: nextDue } : undefined,
      );
      setRenewing(null);
      if (result.renewed) setNewUuid(result.renewed.uuid);
      await load();
    });
  };

  const handleDelete = (doc: DocumentItem) =>
    runAction(doc.uuid, async () => {
      await api.deleteDocument(doc.uuid);
      setItems((current) => current.filter((item) => item.uuid !== doc.uuid));
      setTotal((current) => Math.max(0, current - 1));
      setSummary(await api.summary());
    });

  const handleCreated = (doc: DocumentItem) => {
    setNewUuid(doc.uuid);
    void load();
  };

  /** The same dialog, opened over the list — no route of its own. */
  const handleEdit = (doc: DocumentItem) => setEditing(doc);

  /**
   * Replaced in place rather than reloaded: the edited row keeps its position
   * and the list does not blink. A due date that moved to another band is
   * regrouped by the memo above from the same items array — but the header
   * counters come from the summary endpoint, so that one is re-fetched or an
   * edited due date leaves "8 pendientes" disagreeing with the rows.
   */
  const handleSaved = (doc: DocumentItem) => {
    setItems((current) => current.map((item) => (item.uuid === doc.uuid ? doc : item)));
    setEditing(null);
    void api
      .summary()
      .then((totals) => setSummary(totals))
      .catch(() => setError("No se pudieron actualizar los totales."));
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      // The API caps the sheet; say so rather than let a partial file pass for
      // the whole list.
      const { truncated } = await api.exportDocuments({ status: "all", search, category });
      if (truncated) {
        setError("El archivo quedó incompleto: se exportaron sólo los primeros registros.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo exportar.");
    } finally {
      setExporting(false);
    }
  };

  const pendingCount = summary?.pendingCount ?? 0;
  const showSearch = total > SEARCH_VISIBLE_FROM || search !== "";
  const nothingAtAll = !loading && items.length === 0 && search === "" && category === "";

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Vencimientos</h1>
        <span className="page__count tabular" aria-live="polite">
          {pendingCount === 1 ? "1 pendiente" : `${pendingCount} pendientes`}
        </span>
        <button
          type="button"
          className="btn"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? "Generando…" : "Exportar a Excel"}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => setDialogOpen(true)}>
          Nuevo vencimiento
        </button>
      </div>

      <div className="viewbar">
        <div className="switch" role="group" aria-label="Modo de vista">
          <button
            type="button"
            className={`switch__btn${view === "column" ? " is-active" : ""}`}
            aria-pressed={view === "column"}
            onClick={() => setParam({ view: null })}
          >
            Columna
          </button>
          <button
            type="button"
            className={`switch__btn${view === "calendar" ? " is-active" : ""}`}
            aria-pressed={view === "calendar"}
            onClick={() => setParam({ view: "calendar" })}
          >
            Calendario
          </button>
        </div>

        {view === "calendar" ? (
          <div className="calbar">
            <button
              type="button"
              className="btn btn--quiet"
              aria-label="Período anterior"
              onClick={() =>
                setParam({ date: toCalendarDate(stepAnchor(anchor, mode, -1)) })
              }
            >
              ‹
            </button>
            <span className="calbar__title">{range.title}</span>
            <button
              type="button"
              className="btn btn--quiet"
              aria-label="Período siguiente"
              onClick={() => setParam({ date: toCalendarDate(stepAnchor(anchor, mode, 1)) })}
            >
              ›
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setParam({ date: null })}>
              Hoy
            </button>

            {/* A month grid at phone width is unreadable, so below 700px the
                calendar is week-only and the choice disappears rather than
                offering something that does not work. */}
            {narrow ? null : (
              <div className="switch switch--small" role="group" aria-label="Período">
                <button
                  type="button"
                  className={`switch__btn${mode === "month" ? " is-active" : ""}`}
                  aria-pressed={mode === "month"}
                  onClick={() => setParam({ mode: null })}
                >
                  Mes
                </button>
                <button
                  type="button"
                  className={`switch__btn${mode === "week" ? " is-active" : ""}`}
                  aria-pressed={mode === "week"}
                  onClick={() => setParam({ mode: "week" })}
                >
                  Semana
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="toolbar toolbar--split">
        <div className="field field--inline">
          <label className="sr-only" htmlFor="filter-category">
            Filtrar por rubro
          </label>
          <select
            id="filter-category"
            className="input"
            name="category"
            value={category}
            onChange={(event) => setParam({ category: event.target.value || null })}
          >
            <option value="">Todos los rubros</option>
            {categories.map((option) => (
              <option key={option.uuid} value={option.uuid}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        {showSearch ? (
          <div className="field field--grow">
            <label className="sr-only" htmlFor="search">
              Buscar documentos
            </label>
            <input
              id="search"
              className="input"
              type="search"
              name="search"
              placeholder="Buscar por nombre"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
        ) : null}
      </div>

      {/* The bands are a property of the list. In the calendar the colours are
          already on the grid, and a chip count scoped to one month would not
          agree with the heading above it. */}
      {view === "column" && !loading && items.length > 0 ? (
        <div className="filters" role="group" aria-label="Filtrar por vencimiento">
          <button
            type="button"
            className={`filter${filter === "all" ? " is-active" : ""}`}
            aria-pressed={filter === "all"}
            onClick={() => setParam({ band: null })}
          >
            Todos
            <span className="filter__count">{counts.all}</span>
          </button>
          {BANDS.map((band) => (
            <button
              key={band.key}
              type="button"
              className={`filter${filter === band.key ? " is-active" : ""}`}
              aria-pressed={filter === band.key}
              onClick={() => setParam({ band: band.key })}
            >
              <span className={`filter__pip filter__pip--${band.key}`} aria-hidden="true" />
              {band.label}
              <span className="filter__count">{counts[band.key]}</span>
            </button>
          ))}
          <button
            type="button"
            className={`filter${filter === "done" ? " is-active" : ""}`}
            aria-pressed={filter === "done"}
            onClick={() => setParam({ band: "done" })}
          >
            <span className="filter__pip filter__pip--done" aria-hidden="true" />
            Resueltos
            <span className="filter__count">{counts.done}</span>
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="group" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : view === "calendar" ? (
        <CalendarView documents={items} anchor={anchor} mode={mode} />
      ) : nothingAtAll ? (
        <div className="empty">
          <p className="empty__title">Todavía no hay vencimientos</p>
          <p className="empty__hint">
            Cargá una factura con su rubro y su fecha de vencimiento y aparecerá acá, ordenada por
            urgencia.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setDialogOpen(true)}>
            Cargar el primero
          </button>
        </div>
      ) : groups.length === 0 && resolved.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Sin resultados</p>
          <p className="empty__hint">Ningún documento coincide con este filtro.</p>
        </div>
      ) : filter !== "all" && visibleGroups.length === 0 && !showResolvedList ? (
        <div className="empty">
          <p className="empty__title">Nada en esta franja</p>
          <p className="empty__hint">
            Ningún documento pendiente vence en este plazo.{" "}
            <button type="button" className="disclosure--link" onClick={() => setParam({ band: null })}>
              Ver todos
            </button>
          </p>
        </div>
      ) : (
        <>
          {visibleGroups.map((group) => (
            <section className="group" key={group.key}>
              <div className={`group__head band--${group.key}`}>
                <h2 className="group__label">{group.label}</h2>
                <span className="group__count tabular">{group.items.length}</span>
              </div>
              <ul className="rows rows--banded">
                {group.items.map((doc) => (
                  <DocumentRow
                    key={doc.uuid}
                    doc={doc}
                    canDelete={isAdmin}
                    showUploader={sharedQueue}
                    isNew={doc.uuid === newUuid}
                    busy={busyUuid === doc.uuid}
                    onToggleStatus={handleToggle}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            </section>
          ))}

          {filter === "all" && groups.length === 0 && resolved.length > 0 ? (
            <div className="empty">
              <p className="empty__title">Nada pendiente</p>
              <p className="empty__hint">Todo lo que cargaste está resuelto.</p>
            </div>
          ) : null}

          {/* Under "Resueltos" the list is the whole point of the filter, so it
              opens without the disclosure standing in front of it. */}
          {filter === "all" && resolved.length > 0 ? (
            <button
              type="button"
              className="disclosure"
              aria-expanded={showResolved}
              onClick={() => setShowResolved((value) => !value)}
            >
              {showResolved ? "Ocultar" : "Mostrar"} resueltos ({resolved.length})
            </button>
          ) : null}

          {filter === "done" && resolved.length > 0 ? (
            <div className="group__head" style={{ marginTop: 40 }}>
              <h2 className="group__label">Resueltos</h2>
              <span className="group__count tabular">{resolved.length}</span>
            </div>
          ) : null}

          {showResolvedList && resolved.length > 0 ? (
            <ul className="rows">
              {resolved.map((doc) => (
                <DocumentRow
                  key={doc.uuid}
                  doc={doc}
                  canDelete={isAdmin}
                  showUploader={sharedQueue}
                  isNew={false}
                  busy={busyUuid === doc.uuid}
                  onToggleStatus={handleToggle}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          ) : null}

          {filter === "done" && resolved.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Nada resuelto todavía</p>
              <p className="empty__hint">Los documentos que marques como resueltos aparecen acá.</p>
            </div>
          ) : null}

          {total > items.length ? (
            <p className="row__meta" style={{ marginTop: 24 }}>
              Mostrando {items.length} de {total}. Usá la búsqueda para acotar.
            </p>
          ) : null}
        </>
      )}

      <DocumentDialog
        open={dialogOpen || editing !== null}
        categories={categories}
        document={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onCreated={handleCreated}
        onSaved={handleSaved}
      />

      <RenewDialog
        document={renewing}
        busy={busyUuid === renewing?.uuid}
        onCancel={() => setRenewing(null)}
        onResolve={handleResolveRenew}
      />
    </>
  );
}
