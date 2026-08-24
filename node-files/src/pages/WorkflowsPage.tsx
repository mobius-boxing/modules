import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { UploadDialog } from "../components/UploadDialog";
import { countLabel, workflowStatusLabel } from "../lib/format";
import type { Workflow } from "../types/api";

/** The API's maximum page size; a company's workflow list is far below it. */
const PAGE_LIMIT = 100;

/**
 * The workflows a company has declared. Each row is a name, its status, whether
 * it demands human review and — when the API counts them — how many runs it has
 * produced.
 *
 * The search box lives in the URL so a filtered list can be sent as a link and
 * the back button behaves.
 */
export function WorkflowsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Workflow | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const search = params.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(search);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          const value = searchInput.trim();
          if (value === "") next.delete("q");
          else next.set("q", value);
          return next;
        },
        { replace: true },
      );
    }, 260);
    return () => clearTimeout(timer);
  }, [searchInput, setParams]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await api.listWorkflows({ search, limit: PAGE_LIMIT, sortBy: "name" });
      setWorkflows(page.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista de flujos.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (workflow: Workflow) => {
    setActionError(null);
    setBusyUuid(workflow.uuid);
    try {
      await api.deleteWorkflow(workflow.uuid);
      await load();
    } catch (err) {
      // 409 means the workflow still has runs, and the API's message names how
      // many — show it verbatim rather than inventing a softer one.
      setActionError(err instanceof ApiError ? err.message : "No se pudo eliminar el flujo.");
    } finally {
      setBusyUuid(null);
    }
  };

  const upload = async (file: File) => {
    if (!uploading) return;
    setUploadError(null);
    setUploadBusy(true);
    try {
      const { runUuid } = await api.uploadDocument(uploading.uuid, file);
      setUploading(null);
      navigate(`/ejecuciones/${runUuid}`);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "No se pudo subir el documento.");
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <>
      <div className="page__head">
        <h1 className="page__title">Flujos</h1>
        <span className="page__count" data-testid="workflow-count">
          {loading ? "" : countLabel(workflows.length, "flujo", "flujos")}
        </span>
        <Link className="btn btn--primary" to="/flujos/nuevo" data-testid="workflow-new">
          Nuevo flujo
        </Link>
      </div>
      <p className="page__lead">
        Un flujo declara qué campos hay que extraer de un documento. Subís el archivo y la
        extracción queda registrada como una ejecución.
      </p>

      <div className="toolbar">
        <div className="field">
          <label className="field__label sr-only" htmlFor="workflow-search">
            Buscar
          </label>
          <input
            id="workflow-search"
            className="input"
            type="search"
            name="search"
            data-testid="workflow-search"
            placeholder="Buscar por nombre…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>
      </div>

      {error ? (
        <p className="notice" role="alert" data-testid="workflows-error">
          {error}
        </p>
      ) : null}
      {actionError ? (
        <p className="notice" role="alert" data-testid="workflow-action-error">
          {actionError}
        </p>
      ) : null}

      {loading ? (
        <ul className="rows rows--spaced" data-testid="workflows-loading">
          <li className="skeleton" />
          <li className="skeleton" />
          <li className="skeleton" />
        </ul>
      ) : workflows.length === 0 && !error ? (
        <div className="empty" data-testid="workflows-empty">
          <h2 className="empty__title">Todavía no hay flujos</h2>
          <p className="empty__hint">
            Creá el primero: ponele un nombre y declará los campos que querés extraer de cada
            documento.
          </p>
          <Link className="btn btn--primary" to="/flujos/nuevo" data-testid="workflow-new-empty">
            Crear el primero
          </Link>
        </div>
      ) : (
        <ul className="rows rows--spaced" data-testid="workflows-list">
          {workflows.map((workflow) => {
            const armed = confirming === workflow.uuid;
            const fieldCount = workflow.fields?.length ?? 0;
            return (
              <li className="row row--plain row--stacked" key={workflow.uuid}>
                <span className="row__main">
                  <span className="row__name">
                    {workflow.name}
                    <span className="row__tag">{workflowStatusLabel(workflow.status)}</span>
                  </span>
                  <span className="row__meta">
                    {countLabel(fieldCount, "campo", "campos")} ·{" "}
                    {workflow.requireReview ? "Con revisión humana" : "Sin revisión"}
                    {typeof workflow.runCount === "number"
                      ? ` · ${countLabel(workflow.runCount, "ejecución", "ejecuciones")}`
                      : ""}
                  </span>
                </span>

                <span className="row__actions row__actions--always">
                  {armed ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--quiet btn--danger is-armed"
                        data-testid={`workflow-delete-confirm-${workflow.uuid}`}
                        disabled={busyUuid === workflow.uuid}
                        onClick={() => {
                          setConfirming(null);
                          void remove(workflow);
                        }}
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        className="btn btn--quiet"
                        data-testid={`workflow-delete-cancel-${workflow.uuid}`}
                        onClick={() => setConfirming(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn--quiet"
                        data-testid={`workflow-upload-${workflow.uuid}`}
                        onClick={() => {
                          setUploadError(null);
                          setUploading(workflow);
                        }}
                      >
                        Subir documento
                      </button>
                      <Link
                        className="btn btn--quiet"
                        to={`/ejecuciones?workflow=${workflow.uuid}`}
                        data-testid={`workflow-runs-${workflow.uuid}`}
                      >
                        Ejecuciones
                      </Link>
                      <Link
                        className="btn btn--quiet"
                        to={`/flujos/${workflow.uuid}`}
                        data-testid={`workflow-edit-${workflow.uuid}`}
                      >
                        Editar
                      </Link>
                      <button
                        type="button"
                        className="btn btn--quiet btn--danger"
                        data-testid={`workflow-delete-${workflow.uuid}`}
                        onClick={() => {
                          setActionError(null);
                          setConfirming(workflow.uuid);
                        }}
                      >
                        Eliminar
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <UploadDialog
        workflow={uploading}
        busy={uploadBusy}
        error={uploadError}
        onCancel={() => setUploading(null)}
        onUpload={(file) => void upload(file)}
      />
    </>
  );
}
