import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { FieldSchemaEditor } from "../components/FieldSchemaEditor";
import { NodeConfigPanel } from "../components/NodeConfigPanel";
import { WorkflowCanvas } from "../components/WorkflowCanvas";
import { validateFields } from "../lib/fields";
import {
  EMPTY_DEFINITION,
  definitionForSave,
  normalizeDefinition,
  patchNodeConfig,
  removeNode,
  validateDefinition,
} from "../lib/graph";
import { findDescriptor, normalizeNodeTypes } from "../lib/nodeTypes";
import { countLabel } from "../lib/format";
import type {
  Credential,
  NodeTypeDescriptor,
  WorkflowDefinition,
  WorkflowField,
  WorkflowPayload,
  WorkflowStatus,
} from "../types/api";

/**
 * While it is being edited the graph is always a real definition, even when it
 * is empty; `definition: null` is a wire value, not an editing state, and it is
 * produced once at save time by `definitionForSave`.
 */
type EditorForm = Omit<WorkflowPayload, "definition"> & { definition: WorkflowDefinition };

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

const BLANK: EditorForm = {
  name: "",
  description: null,
  requireReview: true,
  status: "draft",
  fields: [],
  definition: EMPTY_DEFINITION,
};

/**
 * Create and edit are one screen: the only difference is whether a uuid was
 * given, and a flow is small enough that splitting them would duplicate the
 * whole form.
 *
 * Two halves, both saved by the one Guardar: the field schema (what to extract)
 * and the node graph (what to do with it). The form is not replaced by the
 * canvas — a flow that only extracts fields is still a flow, and its graph is
 * simply empty.
 */
export function WorkflowEditorPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const isNew = uuid === undefined;

  const [form, setForm] = useState<EditorForm>(BLANK);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descriptors, setDescriptors] = useState<NodeTypeDescriptor[]>([]);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);

  /**
   * The registry drives the palette and every config form, so the editor asks
   * for it once per visit. It is loaded independently of the workflow: an API
   * that does not publish `/node-types` yet must still let someone edit the
   * fields of an existing flow, so this failure is a message beside the canvas
   * and never a failed screen.
   */
  useEffect(() => {
    let cancelled = false;
    api
      .listNodeTypes()
      .then((types) => {
        if (cancelled) return;
        setDescriptors(normalizeNodeTypes(types));
        setRegistryError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDescriptors([]);
        setRegistryError(
          err instanceof ApiError && err.status === 404
            ? "Este servidor todavía no publica los tipos de nodo, así que no se pueden agregar nodos."
            : err instanceof ApiError
              ? err.message
              : "No se pudieron cargar los tipos de nodo.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A `credential` input is a picker over the company's credentials, so the
   * editor needs the list. Same rule as the registry: a failure here is a line
   * under that one control, never a failed screen — every other node type still
   * configures.
   */
  useEffect(() => {
    let cancelled = false;
    api
      .listCredentials()
      .then((page) => {
        if (cancelled) return;
        setCredentials(page.data);
        setCredentialsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCredentials([]);
        setCredentialsError(
          err instanceof ApiError && err.status === 404
            ? "Este servidor todavía no publica las credenciales."
            : err instanceof ApiError
              ? err.message
              : "No se pudieron cargar las credenciales.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          // jsonb straight from the column: read defensively, so a graph this
          // build cannot make sense of opens as an empty canvas instead of
          // taking the screen down.
          definition: normalizeDefinition(workflow.definition),
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

  const setDefinition = (definition: WorkflowDefinition) =>
    setForm((current) => ({ ...current, definition }));

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
    // The API validates the graph too and is the authority; this only saves the
    // round trip for the three rules a browser can check on its own.
    const graphError = validateDefinition(form.definition);
    if (graphError) {
      setError(graphError);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      // Hints are optional; an empty box is "no hint", not an empty string.
      const payload: WorkflowPayload = {
        ...form,
        // `null`, not an empty graph: the API refuses a definition with zero
        // nodes and only skips parsing when the key is null.
        definition: definitionForSave(form.definition),
        name: form.name.trim(),
        description: form.description?.trim() === "" ? null : (form.description?.trim() ?? null),
        fields: form.fields.map((field) => ({
          ...field,
          key: field.key.trim(),
          label: field.label.trim(),
          description:
            field.description?.trim() === "" ? undefined : field.description?.trim(),
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

  /** The node the panel is editing; null when the selection points nowhere. */
  const selected = form.definition.nodes.find((node) => node.nodeId === selectedId) ?? null;

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

      <div className="schema">
        <div className="schema__head">
          <h2 className="schema__title">Diagrama</h2>
          <span className="page__count" data-testid="node-count">
            {countLabel(form.definition.nodes.length, "nodo", "nodos")}
          </span>
        </div>
        <p className="field__hint">
          Arrastrá los nodos para acomodarlos y uní un borde con otro para encadenarlos. El nodo
          seleccionado se configura en el panel de la derecha.
        </p>

        {registryError ? (
          <p className="notice" role="alert" data-testid="node-types-error">
            {registryError}
          </p>
        ) : null}

        <div className="graph-shell">
          <WorkflowCanvas
            definition={form.definition}
            descriptors={descriptors}
            registryError={registryError}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={setDefinition}
            disabled={saving}
          />
          <NodeConfigPanel
            node={selected}
            descriptor={selected === null ? null : findDescriptor(descriptors, selected.type)}
            registryError={registryError}
            workflowFields={form.fields}
            credentials={credentials}
            credentialsError={credentialsError}
            disabled={saving}
            onChange={(config) => {
              if (selected === null) return;
              setDefinition(patchNodeConfig(form.definition, selected.nodeId, config));
            }}
            onRemove={() => {
              if (selected === null) return;
              setDefinition(removeNode(form.definition, selected.nodeId));
              setSelectedId(null);
            }}
          />
        </div>
      </div>
    </form>
  );
}
