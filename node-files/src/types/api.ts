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
  hint?: string;
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

export interface Workflow {
  uuid: string;
  name: string;
  description: string | null;
  requireReview: boolean;
  status: WorkflowStatus;
  fields: WorkflowField[];
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
}

// ---- runs ----

/**
 * `nf_runs.status`. `queued` → `extracting` → `pending_review` (when the
 * workflow demands review) → `succeeded`, or `failed` with a reason.
 */
export type RunStatus = "queued" | "extracting" | "pending_review" | "succeeded" | "failed";

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
  /** What the reviewer confirmed, same keys. Null until reviewed. */
  reviewedValues: Record<string, FieldValue> | null;
  reviewedByName: string | null;
  /**
   * The field schema the run was extracted with. Optional: when the API answers
   * without it the detail screen falls back to the keys in `extracted`.
   */
  fields?: WorkflowField[];
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
