import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { countLabel, formatDateTime, runStatusLabel } from "../lib/format";
import type { RunStatus, RunSummary } from "../types/api";

const PAGE_LIMIT = 100;

/**
 * The chips over the list. "all" is the absence of the param, not a value the
 * API is asked to filter by — the query builder rejects anything its Filter
 * config does not declare (L-007), so an invented status must never be sent.
 */
const FILTERS: { key: "all" | RunStatus; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "queued", label: "En cola" },
  { key: "extracting", label: "Procesando" },
  { key: "pending_review", label: "Para revisar" },
  { key: "succeeded", label: "Completadas" },
  { key: "failed", label: "Fallidas" },
];

const KNOWN_STATUSES = new Set<string>(FILTERS.map((filter) => filter.key));

/**
 * Every extraction that has been asked for, newest first. The filter lives in
 * the URL, so "todo lo que está para revisar" is a link a colleague can open.
 */
export function RunsPage() {
  const [params, setParams] = useSearchParams();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // An unknown status in the URL is treated as no filter rather than passed on.
  const rawStatus = params.get("status") ?? "all";
  const status = KNOWN_STATUSES.has(rawStatus) ? rawStatus : "all";
  const workflowUuid = params.get("workflow") ?? "";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await api.listRuns({
        status: status === "all" ? undefined : status,
        workflowUuid: workflowUuid || undefined,
        limit: PAGE_LIMIT,
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      setRuns(page.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "No se pudo cargar la lista de ejecuciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [status, workflowUuid]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Ejecuciones</h1>
        <span className="page__count" data-testid="run-count">
          {loading ? "" : countLabel(runs.length, "ejecución", "ejecuciones")}
        </span>
        <button
          type="button"
          className="btn"
          data-testid="runs-refresh"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Actualizar
        </button>
      </div>

      <div className="filters">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className={filter.key === status ? "filter is-active" : "filter"}
            data-testid={`run-filter-${filter.key}`}
            aria-pressed={filter.key === status}
            onClick={() => setParam("status", filter.key === "all" ? null : filter.key)}
          >
            {filter.label}
          </button>
        ))}
        {workflowUuid ? (
          <button
            type="button"
            className="filter is-active"
            data-testid="run-filter-workflow-clear"
            onClick={() => setParam("workflow", null)}
          >
            Sólo un flujo ✕
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="notice" role="alert" data-testid="runs-error">
          {error}
        </p>
      ) : null}

      {loading ? (
        <ul className="rows rows--spaced" data-testid="runs-loading">
          <li className="skeleton" />
          <li className="skeleton" />
          <li className="skeleton" />
        </ul>
      ) : runs.length === 0 && !error ? (
        <div className="empty" data-testid="runs-empty">
          <h2 className="empty__title">No hay ejecuciones</h2>
          <p className="empty__hint">
            Subí un documento desde un flujo y la extracción aparece acá con su resultado.
          </p>
          <Link className="btn btn--primary" to="/flujos" data-testid="runs-empty-workflows">
            Ir a los flujos
          </Link>
        </div>
      ) : (
        <ul className="rows rows--spaced" data-testid="runs-list">
          {runs.map((run) => (
            <li className="row row--plain" key={run.uuid}>
              <span className="row__main">
                <span className="row__name">
                  {run.documentName}
                  <span className="row__tag">{run.workflowName}</span>
                </span>
                <span className="row__meta">
                  {formatDateTime(run.createdAt)}
                  {run.error ? ` · ${run.error}` : ""}
                </span>
              </span>
              <span className={`state state--${run.status}`} data-testid={`run-status-${run.uuid}`}>
                {runStatusLabel(run.status)}
              </span>
              <span className="row__actions row__actions--always">
                <Link
                  className="btn btn--quiet"
                  to={`/ejecuciones/${run.uuid}`}
                  data-testid={`run-open-${run.uuid}`}
                >
                  Ver
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
