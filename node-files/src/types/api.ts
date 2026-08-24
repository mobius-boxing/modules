/**
 * Response shapes, duplicated from mobius-api on purpose — no shared types
 * package at this size. Keep in sync by hand with the node-files interfaces in
 * mobius-api and with the host envelopes (`{success, data}` for one thing, an
 * unwrapped paginator for a list, `{success:false, message}` for an error).
 *
 * The endpoint set is the one frozen by the Phase 1 brief; nothing here invents
 * a route the API does not publish.
 */

/** Mobius roles. The module has no roles of its own — identity is the host's. */
export type UserRole = "member" | "admin" | "superAdmin";

/** The signed-in mobius user, as `/api/auth/login` and `/api/auth/me` return it. */
export interface AuthUser {
  uuid: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** Company UUID — the numeric id never leaves the API. */
  companyId?: string;
  companyName?: string;
  /** Module slugs enabled for the user's company; gates the whole app. */
  modules: string[];
  /** RBAC permission codes. Advisory: the server re-checks every write. */
  permissions: string[];
}

/** What the topbar prints. Falls back to the email for a nameless account. */
export function displayName(user: AuthUser): string {
  const full = `${user.firstName} ${user.lastName}`.trim();
  return full === "" ? user.email : full;
}

/**
 * The host's paginator, returned unwrapped by every list endpoint. The row
 * count for the whole filter is `totalCount` — `count` is only this page.
 */
export interface Paginated<T> {
  success: boolean;
  data: T[];
  page: number;
  limit: number;
  count: number;
  totalCount: number;
  totalPages: number;
}

// ---- workflows ----

/** The declared type of one extracted field. */
export type FieldType = "string" | "number" | "date" | "currency" | "boolean" | "list";

/** One row of a workflow's field schema (`nf_workflows.fields`, jsonb). */
export interface WorkflowField {
  /** Identifier used as the key of the extracted object. */
  key: string;
  /** What the person reviewing the run reads. */
  label: string;
  type: FieldType;
  required: boolean;
  /** Optional guidance handed to the extractor. */
  /**
   * The guidance handed to the extractor. MUST be `description` — that is what
   * `INodeFilesField` declares and what the DTO reads (`source.description`).
   * It was `hint` until 2026-08-24, so every hint typed since Phase 1 shipped
   * was silently dropped on save.
   */
  description?: string | null;
}

/**
 * `nf_workflows.status` is `varchar(20) NOT NULL default 'draft'` — a text
 * status column, never a PG enum, so the set can grow. An unknown value still
 * renders (see `workflowStatusLabel`).
 */
export type WorkflowStatus = "draft" | "active" | "disabled";

/**
 * What `POST /workflows/:uuid/documents` answers: the stored document plus the
 * uuid of the run it queued. Deliberately not a `Run` — the run does not exist
 * in a readable state yet, only its uuid does.
 */
export interface UploadResult {
  document: {
    uuid: string;
    originalName: string;
    contentType: string | null;
    sizeBytes: number | null;
    checksum: string | null;
  };
  runUuid: string;
}

// ---- the node graph ----
//
// EVERY SHAPE BELOW IS A MIRROR of mobius-api
// `src/interfaces/node-files/node-files.interfaces.ts`. It was written by hand
// (no shared types package at this size) and diffed against that file field by
// field. Two rules keep it honest:
//
//  1. `nodeId`/`edgeId`, never `id`. `sanitizeResponse` is global middleware
//     that RECURSIVELY DELETES every `id` key from every response body — it is
//     the UUID-only guarantee and it cannot tell a numeric primary key from a
//     canvas node's name. A definition keyed by `id` would arrive with every
//     node anonymous. String keys ending in `Id` survive by design.
//  2. React Flow's own `id` never appears here. The two vocabularies meet in
//     exactly one place, `components/WorkflowCanvas.tsx`, and nowhere else.

/**
 * The node types the registry ships (`NODE_FILES_NODE_TYPES`). The set is
 * closed on the API today, but nothing in this app switches on it: the palette
 * is the registry and the config panel is generated from each type's schema, so
 * a type added on the backend needs no change here.
 */
export type NodeType = "trigger" | "condition" | "email" | "http";

/**
 * Where an edge leaves a node (`NODE_FILES_HANDLES`). Only the condition node
 * has two; everything else has `out`. Never null — the API defaults a missing
 * handle to `out` and rejects any other value.
 */
export type NodeHandle = "out" | "true" | "false";

/** Canvas coordinates. Stored and validated; the executor ignores them. */
export interface NodePosition {
  x: number;
  y: number;
}

/** One node of `nf_workflows.definition` (jsonb). */
export interface GraphNode {
  /**
   * Unique inside the definition and the SAME value that lands in
   * `nf_node_runs.nodeId`. The API constrains it to `[A-Za-z0-9_-]{1,64}`.
   */
  nodeId: string;
  /** Widened to `string` on purpose: an unknown type renders, it never crashes. */
  type: string;
  /** Whatever the type's `configSchema` declares; opaque to this layer. */
  config: Record<string, unknown>;
  position: NodePosition;
}

/** One edge. `source`/`target` hold nodeIds, never indices. */
export interface GraphEdge {
  /** Same `Id`-suffix reasoning as `nodeId`, same `[A-Za-z0-9_-]{1,64}` rule. */
  edgeId: string;
  source: string;
  target: string;
  sourceHandle: NodeHandle;
}

export interface WorkflowDefinition {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The control types a node type may declare (`NODE_FILES_CONFIG_INPUT_TYPES`).
 * `fieldKey` and `credential` are pickers the editor fills from data it already
 * has — the workflow's declared fields and `GET /credentials`.
 */
export type ConfigInputType =
  "text" | "textarea" | "number" | "boolean" | "select" | "fieldKey" | "credential" | "keyValue";

export interface ConfigOption {
  value: string;
  label: string;
}

/** One rendered control of the generated config panel. */
export interface ConfigInput {
  key: string;
  label: string;
  input: ConfigInputType;
  required: boolean;
  /** Present for `select`; empty otherwise. */
  options: ConfigOption[];
  /** Whether `{{fields.total}}` substitution applies to this input. */
  templated: boolean;
  placeholder: string | null;
  help: string | null;
  defaultValue: string | number | boolean | null;
}

/**
 * One entry of `GET /node-types` — the whole reason that endpoint exists.
 * `handles` and `acceptsInput` are what the canvas draws from; nothing here is
 * inferred from the type's name.
 */
export interface NodeTypeDescriptor {
  type: string;
  label: string;
  description: string;
  handles: NodeHandle[];
  acceptsInput: boolean;
  configSchema: ConfigInput[];
}

// ---- credentials ----

/** How a credential is applied to an outbound request. */
export type CredentialType = "bearer" | "header";

/**
 * A credential as it leaves the API — which is to say without its secret. There
 * is no `secret`, no mask and no length: the write-only rule is enforced by the
 * shape having nowhere to put one.
 */
export interface Credential {
  uuid: string;
  name: string;
  type: CredentialType;
  headerName: string | null;
  lastUsedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workflow {
  uuid: string;
  name: string;
  description: string | null;
  requireReview: boolean;
  status: WorkflowStatus;
  fields: WorkflowField[];
  /**
   * The node graph. Optional: a Phase 1 workflow has none, and an API that does
   * not publish the column yet simply omits it — the editor starts empty
   * instead of erroring.
   */
  definition?: WorkflowDefinition | null;
  /** Only present when the API counts runs for the list — optional by contract. */
  runCount?: number;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST /workflows and PATCH /workflows/:uuid. */
export interface WorkflowPayload {
  name: string;
  description: string | null;
  requireReview: boolean;
  status: WorkflowStatus;
  fields: WorkflowField[];
  /**
   * `null` means "this flow has no graph". NOT an empty definition: the API
   * refuses one with zero nodes ("El flujo debe tener al menos un nodo"), and
   * only skips parsing altogether when the key is null.
   */
  definition: WorkflowDefinition | null;
}

// ---- runs ----

/**
 * `nf_runs.status`. `queued` → `extracting` → `pending_review` (when the
 * workflow demands review) → `running` (the graph executes) → `succeeded`, or
 * `failed` with a reason.
 */
export type RunStatus =
  "queued" | "extracting" | "pending_review" | "running" | "succeeded" | "failed";

/**
 * `nf_node_runs.status` (`NODE_FILES_NODE_RUN_STATUSES`) — three values, not
 * five. The row is written ONCE, when the node is over, so there is deliberately
 * no `running` row: a row saying "running" that a crashed worker left behind is
 * a lie nobody sweeps. `skipped` is the branch a condition did not take.
 */
export type NodeRunStatus = "succeeded" | "failed" | "skipped";

/** One node's turn in a run, as `GET /runs/:uuid` reports it. */
export interface NodeRun {
  uuid: string;
  /** Matches `GraphNode.nodeId` in the workflow's definition. */
  nodeId: string;
  nodeType: string;
  status: NodeRunStatus;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string | null;
  error: string | null;
  /** How long the node took. The API sends this, never a started/finished pair. */
  durationMs: number | null;
  attempt: number;
  createdAt: string;
}

/** A value as the extractor produced it. `list` arrives as an array. */
export type FieldValue = string | number | boolean | string[] | null;

/**
 * One entry of `nf_runs.extracted`. The confidence is the model's, so it is
 * optional: a corrected value carries none.
 */
export interface ExtractedField {
  value: FieldValue;
  confidence?: number | null;
}

/**
 * FLAT, matching the API's `INodeFilesRun` exactly. These were nested as
 * `workflow: {uuid,name}` / `document: {uuid,originalName}` and the API never
 * sends that shape — every access resolved to undefined behind optional
 * chaining, so tsc and the tests stayed green while every row rendered
 * "Flujo eliminado" / "Documento sin nombre".
 */
export interface RunSummary {
  uuid: string;
  status: RunStatus;
  workflowUuid: string;
  workflowName: string;
  /** The uploaded file this run read. */
  documentUuid: string;
  documentName: string;
  error: string | null;
  createdAt: string;
}

export interface Run extends RunSummary {
  /** Keyed by `WorkflowField.key`; null until the extractor has answered. */
  extracted: Record<string, ExtractedField> | null;
  /**
   * What the reviewer confirmed, same keys AND the same wrapped shape as
   * `extracted` — `coerceReviewValues` stores `{value, confidence: 1}`, not the
   * bare values the review form posts. Typed as bare here until Phase 2, which
   * printed "[object Object]" on every reviewed run.
   */
  reviewedValues: Record<string, ExtractedField> | null;
  reviewedByName: string | null;
  /**
   * The field schema the run was extracted with. Optional: when the API answers
   * without it the detail screen falls back to the keys in `extracted`.
   */
  fields?: WorkflowField[];
  /** The workflow's graph as it was read for this run; null when it has none. */
  definition?: WorkflowDefinition | null;
  /**
   * One row per node the run walked. Optional here rather than required: a run
   * of a workflow with no graph has none, and the timeline stays hidden rather
   * than claiming the run did nothing.
   */
  nodeRuns?: NodeRun[];
  tokensIn: number | null;
  tokensOut: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

/** The host's error envelope. */
export interface ApiErrorBody {
  success: false;
  message: string;
}
