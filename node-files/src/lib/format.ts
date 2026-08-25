import type { NodeRunStatus, RunStatus, WorkflowStatus } from "../types/api";

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
  running: "Ejecutando",
  succeeded: "Completada",
  failed: "Fallida",
};

/**
 * The statuses where the server is still going to change this run on its own.
 *
 * `pending_review` is deliberately NOT one of them: at that point the run is
 * waiting for a PERSON, and the detail screen has a draft the reviewer is
 * typing into that is re-seeded whenever the run object changes. Polling then
 * would silently wipe their edits mid-keystroke. Poll while the machine owns
 * the run; stop the moment the human does.
 */
const IN_FLIGHT_RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "extracting",
  "running",
];

/**
 * Where the API permits cancelling: `queued` and `pending_review` ONLY
 * (node-files.service.ts cancelRun). It refuses mid-execution on purpose — a
 * node that has already sent an email cannot be un-sent by a status change.
 *
 * This MUST mirror the server. Offering the button anywhere else produces a
 * 409 the user cannot act on, which reads as the app being broken.
 */
const CANCELLABLE_RUN_STATUSES: readonly RunStatus[] = [
  "queued",
  "pending_review",
];

export function isRunCancellable(status: string): boolean {
  return CANCELLABLE_RUN_STATUSES.includes(status as RunStatus);
}

export function isRunInFlight(status: string): boolean {
  return IN_FLIGHT_RUN_STATUSES.includes(status as RunStatus);
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status as RunStatus] ?? status;
}

/**
 * A node's outcome. Three words, not five: the row is written once, when the
 * node is over, so there is no `pending` and no `running` node run. `skipped` is
 * the branch a condition did not take.
 */
const NODE_RUN_STATUS_LABELS: Record<NodeRunStatus, string> = {
  succeeded: "Completado",
  failed: "Fallido",
  skipped: "Omitido",
};

export function nodeRunStatusLabel(status: string): string {
  return NODE_RUN_STATUS_LABELS[status as NodeRunStatus] ?? status;
}

/**
 * "1,4 s" — how long a node took. The API sends `durationMs`; a skipped node
 * never ran and has none, which prints as an em dash rather than as "0 ms".
 */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s`;
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
