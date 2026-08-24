import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { FieldSchemaEditor } from "../components/FieldSchemaEditor";
import { validateFields } from "../lib/fields";
import type { WorkflowField, WorkflowPayload, WorkflowStatus } from "../types/api";

/**
 * `nf_workflows.status` is a text column with default 'draft'. A draft is a
 * flow still being written; an active one is the one people upload to; a
 * disabled one is kept for its run history but refuses new uploads (the API
 * enforces that in node-files.service.ts).
 *
 * Every member of `WorkflowStatus` must appear here. The type is a union, not
 * an exhaustiveness-checked map, so adding a member elsewhere will NOT fail
 * this file at compile time — it just silently becomes unselectable.
 */
const STATUSES: { value: WorkflowStatus; label: string }[] = [
  { value: "draft", label: "Borrador" },
  { value: "active", label: "Activo" },
  { value: "disabled", label: "Deshabilitado" },
];

const BLANK: WorkflowPayload = {
  name: "",
  description: null,
  requireReview: true,
  status: "draft",
  fields: [],
};

/**
 * Create and edit are one screen: the only difference is whether a uuid was
 * given, and a flow is small enough that splitting them would duplicate the
 * whole form.
 *
 * No canvas, no nodes — Phase 1 is "declare the fields to extract".
 */
export function WorkflowEditorPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const isNew = uuid === undefined;

  const [form, setForm] = useState<WorkflowPayload>(BLANK);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (uuid === undefined) {
      setForm({ ...BLANK });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getWorkflow(uuid)
      .then((workflow) => {
        if (cancelled) return;
        setForm({
          name: workflow.name,
          description: workflow.description,
          requireReview: workflow.requireReview,
          status: workflow.status,
          fields: workflow.fields ?? [],
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el flujo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  const setFields = (fields: WorkflowField[]) => setForm((current) => ({ ...current, fields }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.name.trim() === "") {
      setError("El flujo necesita un nombre.");
      return;
    }
    const fieldError = validateFields(form.fields);
    if (fieldError) {
      setError(fieldError);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      // Hints are optional; an empty box is "no hint", not an empty string.
      const payload: WorkflowPayload = {
        ...form,
        name: form.name.trim(),
        description: form.description?.trim() === "" ? null : (form.description?.trim() ?? null),
        fields: form.fields.map((field) => ({
          ...field,
          key: field.key.trim(),
          label: field.label.trim(),
          hint: field.hint?.trim() === "" ? undefined : field.hint?.trim(),
        })),
      };
      if (uuid === undefined) await api.createWorkflow(payload);
      else await api.updateWorkflow(uuid, payload);
      navigate("/flujos");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el flujo.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="page__lead" data-testid="workflow-loading">
        Cargando…
      </p>
    );
  }

  if (loadError) {
    return (
      <>
        <p className="notice" role="alert" data-testid="workflow-load-error">
          {loadError}
        </p>
        <p className="page__lead">
          <Link to="/flujos" data-testid="workflow-back">
            Volver a los flujos
          </Link>
        </p>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="page__head">
        <h1 className="page__title" data-testid="workflow-editor-title">
          {isNew ? "Nuevo flujo" : "Editar flujo"}
        </h1>
        <Link className="btn" to="/flujos" data-testid="workflow-cancel">
          Cancelar
        </Link>
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="workflow-save"
          disabled={saving}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {error ? (
        <p className="notice" role="alert" data-testid="workflow-error">
          {error}
        </p>
      ) : null}

      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="workflow-name">
            Nombre
          </label>
          <input
            id="workflow-name"
            className="input"
            type="text"
            name="name"
            data-testid="workflow-name"
            required
            value={form.name}
            disabled={saving}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="workflow-description">
            Descripción <span className="field__optional">(opcional)</span>
          </label>
          <textarea
            id="workflow-description"
            className="input"
            name="description"
            data-testid="workflow-description"
            rows={3}
            value={form.description ?? ""}
            disabled={saving}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>

        <div className="field-row">
          <div className="field field--narrow">
            <label className="field__label" htmlFor="workflow-status">
              Estado
            </label>
            <select
              id="workflow-status"
              className="input"
              name="status"
              data-testid="workflow-status"
              value={form.status}
              disabled={saving}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as WorkflowStatus })
              }
            >
              {STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <label className="schema__check" htmlFor="workflow-require-review">
            <input
              id="workflow-require-review"
              type="checkbox"
              name="requireReview"
              data-testid="workflow-require-review"
              checked={form.requireReview}
              disabled={saving}
              onChange={(event) => setForm({ ...form, requireReview: event.target.checked })}
            />
            Revisar los valores antes de darlos por buenos
          </label>
        </div>
      </div>

      <FieldSchemaEditor fields={form.fields} onChange={setFields} disabled={saving} />
    </form>
  );
}
