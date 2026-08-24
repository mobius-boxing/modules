import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import {
  fieldsForRun,
  formatConfidence,
  formatFieldValue,
  fromEditableValue,
  normalizeExtracted,
  toEditableValue,
} from "../lib/fields";
import { formatDateTime, formatTokens, runStatusLabel } from "../lib/format";
import type { FieldValue, Run, WorkflowField } from "../types/api";

/** The reviewer's boxes hold strings; the type turns them back into values. */
type Draft = Record<string, string>;

function draftFrom(fields: WorkflowField[], values: Record<string, FieldValue>): Draft {
  const draft: Draft = {};
  for (const field of fields) draft[field.key] = toEditableValue(values[field.key] ?? null);
  return draft;
}

/**
 * One extraction: what the model read out of the document, what it cost, and —
 * when the flow demands review — the form where a person confirms or corrects
 * the values before the run is called succeeded.
 */
export function RunDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({});

  const load = useCallback(async () => {
    if (uuid === undefined) return;
    setLoadError(null);
    try {
      setRun(await api.getRun(uuid));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la ejecución.");
    } finally {
      setLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    void load();
  }, [load]);

  const extracted = useMemo(() => normalizeExtracted(run?.extracted), [run]);
  const fields = useMemo(() => fieldsForRun(run?.fields, extracted), [run, extracted]);

  /** What the screen prints per field: the reviewed value wins once there is one. */
  const values = useMemo<Record<string, FieldValue>>(() => {
    const reviewed = run?.reviewedValues ?? null;
    const result: Record<string, FieldValue> = {};
    for (const field of fields) {
      result[field.key] =
        reviewed && field.key in reviewed ? reviewed[field.key] : (extracted[field.key]?.value ?? null);
    }
    return result;
  }, [fields, extracted, run]);

  // The form is seeded from the run, and re-seeded whenever the run changes —
  // the screen is reachable again after a retry, and a stale draft would then
  // be showing the previous attempt's values.
  useEffect(() => {
    setDraft(draftFrom(fields, values));
  }, [fields, values]);

  const submitReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!run) return;
    setActionError(null);
    setBusy(true);
    try {
      const payload: Record<string, FieldValue> = {};
      for (const field of fields) {
        payload[field.key] = fromEditableValue(draft[field.key] ?? "", field.type);
      }
      setRun(await api.reviewRun(run.uuid, payload));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo guardar la revisión.");
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (!run) return;
    setActionError(null);
    setBusy(true);
    try {
      setRun(await api.retryRun(run.uuid));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo reintentar la ejecución.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="page__lead" data-testid="run-loading">
        Cargando…
      </p>
    );
  }

  if (loadError || !run) {
    return (
      <>
        <p className="notice" role="alert" data-testid="run-load-error">
          {loadError ?? "No se encontró la ejecución."}
        </p>
        <p className="page__lead">
          <Link to="/ejecuciones" data-testid="run-back">
            Volver a las ejecuciones
          </Link>
        </p>
      </>
    );
  }

  const reviewing = run.status === "pending_review";

  return (
    <>
      <div className="page__head">
        <h1 className="page__title" data-testid="run-title">
          {run.documentName}
        </h1>
        <span className={`state state--${run.status}`} data-testid="run-status">
          {runStatusLabel(run.status)}
        </span>
        <Link className="btn" to="/ejecuciones" data-testid="run-back">
          Volver
        </Link>
        {run.status === "failed" ? (
          <button
            type="button"
            className="btn btn--primary"
            data-testid="run-retry"
            disabled={busy}
            onClick={() => void retry()}
          >
            {busy ? "Reintentando…" : "Reintentar"}
          </button>
        ) : null}
      </div>

      <dl className="meta" data-testid="run-meta">
        <div className="meta__item">
          <dt className="meta__label">Flujo</dt>
          <dd className="meta__value">{run.workflowName}</dd>
        </div>
        <div className="meta__item">
          <dt className="meta__label">Creada</dt>
          <dd className="meta__value">{formatDateTime(run.createdAt)}</dd>
        </div>
        <div className="meta__item">
          <dt className="meta__label">Terminada</dt>
          <dd className="meta__value">{formatDateTime(run.finishedAt)}</dd>
        </div>
        <div className="meta__item">
          <dt className="meta__label">Tokens</dt>
          <dd className="meta__value tabular" data-testid="run-tokens">
            {formatTokens(run.tokensIn, run.tokensOut)}
          </dd>
        </div>
        {run.reviewedByName ? (
          <div className="meta__item">
            <dt className="meta__label">Revisada por</dt>
            <dd className="meta__value">{run.reviewedByName}</dd>
          </div>
        ) : null}
      </dl>

      {run.error ? (
        <p className="notice" role="alert" data-testid="run-error">
          {run.error}
        </p>
      ) : null}
      {actionError ? (
        <p className="notice" role="alert" data-testid="run-action-error">
          {actionError}
        </p>
      ) : null}

      {fields.length === 0 ? (
        <div className="empty" data-testid="run-values-empty">
          <h2 className="empty__title">Todavía no hay valores</h2>
          <p className="empty__hint">
            La extracción no terminó o no devolvió campos. Actualizá la página en unos segundos.
          </p>
        </div>
      ) : reviewing ? (
        <form onSubmit={submitReview} data-testid="run-review-form">
          <h2 className="section-title">Revisar los valores</h2>
          <p className="page__lead">
            Corregí lo que haga falta y confirmá. Los valores confirmados son los que quedan
            guardados.
          </p>

          <div className="form-grid">
            {fields.map((field) => (
              <div className="field" key={field.key}>
                <label className="field__label" htmlFor={`value-${field.key}`}>
                  {field.label}
                  {field.required ? "" : <span className="field__optional"> (opcional)</span>}
                  <span className="field__optional">
                    {" · "}
                    {formatConfidence(extracted[field.key]?.confidence)}
                  </span>
                </label>
                {field.type === "boolean" ? (
                  <select
                    id={`value-${field.key}`}
                    className="input"
                    name={field.key}
                    data-testid={`review-${field.key}`}
                    value={draft[field.key] ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, [field.key]: event.target.value })
                    }
                  >
                    <option value="">Sin dato</option>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input
                    id={`value-${field.key}`}
                    className="input"
                    type={
                      field.type === "date"
                        ? "date"
                        : field.type === "number" || field.type === "currency"
                          ? "number"
                          : "text"
                    }
                    step={field.type === "currency" ? "0.01" : undefined}
                    name={field.key}
                    data-testid={`review-${field.key}`}
                    value={draft[field.key] ?? ""}
                    disabled={busy}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                )}
                {field.hint ? <span className="field__hint">{field.hint}</span> : null}
                {field.type === "list" ? (
                  <span className="field__hint">Separá los valores con comas.</span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="page__head">
            <span className="page__count">
              {`Flujo: ${run.workflowName}`}
            </span>
            <button
              type="submit"
              className="btn btn--primary"
              data-testid="review-submit"
              disabled={busy}
            >
              {busy ? "Guardando…" : "Confirmar valores"}
            </button>
          </div>
        </form>
      ) : (
        <ul className="rows rows--spaced" data-testid="run-values">
          {fields.map((field) => (
            <li className="row row--plain" key={field.key}>
              <span className="row__main">
                <span className="row__name">{field.label}</span>
                <span className="row__meta">{field.key}</span>
              </span>
              <span className="row__value" data-testid={`run-value-${field.key}`}>
                {formatFieldValue(values[field.key] ?? null) || "—"}
              </span>
              <span className="row__when tabular" data-testid={`run-confidence-${field.key}`}>
                {formatConfidence(extracted[field.key]?.confidence)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
