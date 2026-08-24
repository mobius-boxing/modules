import type { RunStatus, WorkflowStatus } from "../types/api";

/** Dates come from the API as ISO instants; the UI is Argentine and Spanish. */
const DATE_TIME = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME.format(date);
}

const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "Borrador",
  active: "Activo",
  disabled: "Deshabilitado",
};

/**
 * Status columns are text, not PG enums, precisely so the set can grow — so an
 * unknown value prints itself instead of disappearing from the screen.
 */
export function workflowStatusLabel(status: string): string {
  return WORKFLOW_STATUS_LABELS[status as WorkflowStatus] ?? status;
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "En cola",
  extracting: "Procesando",
  pending_review: "Para revisar",
  succeeded: "Completada",
  failed: "Fallida",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status as RunStatus] ?? status;
}

/** Token counts are the cost of a run; both halves matter, so print both. */
export function formatTokens(tokensIn: number | null, tokensOut: number | null): string {
  if (tokensIn === null && tokensOut === null) return "—";
  const entrada = tokensIn === null ? "—" : tokensIn.toLocaleString("es-AR");
  const salida = tokensOut === null ? "—" : tokensOut.toLocaleString("es-AR");
  return `${entrada} entrada / ${salida} salida`;
}

/**
 * "1 ejecución" / "3 ejecuciones". Spanish plurals are not the English suffix
 * trick — "ejecución" loses its accent in the plural — so both forms are spelled
 * out by the caller.
 */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
