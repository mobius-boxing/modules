import axios from "axios";
import type { AxiosInstance, AxiosResponse } from "axios";
import { createApiClient } from "@mobius-modules/api-client";
import { clearCachedUser, clearToken, dropLegacyToken, getToken } from "@mobius-modules/auth";
import type {
  AuthUser,
  Credential,
  FieldValue,
  NodeTypeDescriptor,
  Paginated,
  Run,
  UploadResult,
  RunSummary,
  Workflow,
  WorkflowPayload,
} from "../types/api";

/**
 * Relative by default: same origin through CloudFront in production, through
 * the Vite dev proxy (→ mobius-api on :3001) in dev. Never an EC2 IP or a
 * *.cloudfront.net host in app code.
 *
 * `VITE_API_URL` overrides it at build time, and only for a bundle hosted off
 * our own domain — that origin has to be in the API's CORS allowlist.
 */
const BASE = import.meta.env.VITE_API_URL ?? "";

/** Identity lives in the host, not in the module. */
const HOST = "/api";
/** Everything the module owns hangs off its slug, behind requireModule(). */
const MODULE = "/api/node-files";

/**
 * The session is NOT here: it is the `mobius_session` cookie on
 * `.mobiusboxing.com` (see @mobius-modules/auth), shared with the web app, the
 * backoffice and every other module. Only the first-paint user cache is
 * per-origin — and localStorage is shared across *.mobiusboxing.com, so its key
 * stays namespaced.
 */
export const USER_KEY = "node-files_user";

/** Where the token lived before SSO. Dropped on load, never adopted. */
dropLegacyToken("node-files_token");

const FALLBACK_MESSAGE = "Error de conexión con el servidor";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** The host answers errors as `{success:false, message}`; nothing else. */
function messageFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("message" in body)) return null;
  const { message } = body as { message: unknown };
  return typeof message === "string" && message !== "" ? message : null;
}

function toApiError(error: unknown, fallback = FALLBACK_MESSAGE): ApiError {
  if (axios.isAxiosError(error)) {
    // status 0: the request never reached the API (offline, CORS, DNS).
    return new ApiError(error.response?.status ?? 0, messageFrom(error.response?.data) ?? fallback);
  }
  return new ApiError(0, fallback);
}

/**
 * A 401 from the login call is a wrong password, not an expired session — the
 * screen renders it. Every other 401 means the token is gone: the shared client
 * drops it, and this sends the tab to the login screen (a full navigation, so
 * no half-authenticated component keeps polling).
 */
const http: AxiosInstance = createApiClient({
  baseUrl: BASE,
  getToken,
  clearToken,
  selfHandled401Paths: [`${HOST}/auth/login`],
  onSessionExpired: () => {
    clearCachedUser(USER_KEY);
    if (window.location.pathname !== "/login") window.location.assign("/login");
  },
});

/**
 * The company a superAdmin is operating as, taken from the tenant hostname.
 *
 * SuperAdmins belong to no company, so their JWT carries neither a `companyId`
 * nor an enabled-modules list, and every module call would answer
 * 400 "SuperAdmin must specify a company". On `{client}.<label>.…` the company
 * is the one in the address.
 *
 * Set for superAdmins only. For anyone else the server forces the JWT company
 * and ignores this parameter, so sending it would be noise at best.
 */
let operatingCompanyUuid: string | null = null;

export function setOperatingCompanyUuid(uuid: string | null): void {
  operatingCompanyUuid = uuid;
}

http.interceptors.request.use((config) => {
  if (operatingCompanyUuid !== null && (config.url ?? "").startsWith(MODULE)) {
    config.params = { ...(config.params ?? {}), companyId: operatingCompanyUuid };
  }
  return config;
});

/** One thing: `{success:true, data}` — the caller only ever wants `data`. */
async function unwrap<T>(request: Promise<AxiosResponse<{ data: T }>>): Promise<T> {
  try {
    const response = await request;
    return response.data.data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** A list: the paginator comes back unwrapped, so the body IS the answer. */
async function body<T>(request: Promise<AxiosResponse<T>>): Promise<T> {
  try {
    const response = await request;
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

/** A write with nothing to read back (DELETE answers `{success, message}`). */
async function send(request: Promise<AxiosResponse<unknown>>): Promise<void> {
  try {
    await request;
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Only the params the API's Filter config declares. L-007 cuts both ways: the
 * API rejects an unknown param, so the client must never send one hoping it
 * will be honoured.
 */
export interface WorkflowListParams {
  page?: number;
  limit?: number;
  /** Host reserved params — the shared query builder reads these names. */
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  status?: string;
}

export interface RunListParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: string;
  workflowUuid?: string;
}

/** Empty strings are "no filter", not a filter for "" — drop them. */
function toParams(
  params: WorkflowListParams | RunListParams,
): Record<string, string | number> {
  const clean: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    clean[key] = value as string | number;
  }
  return clean;
}

export const api = {
  // ---- identity (host endpoints, not the module's) ----

  login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    return unwrap(
      http.post<{ data: { user: AuthUser; token: string } }>(`${HOST}/auth/login`, {
        email,
        password,
      }),
    );
  },

  me(): Promise<AuthUser> {
    return unwrap(http.get<{ data: AuthUser }>(`${HOST}/auth/me`));
  },

  // ---- node registry ----

  /**
   * The node types the engine can run, with the schema each one's config
   * follows. The editor generates its panel from this, so a type added on the
   * backend appears here with no frontend change.
   *
   * Answers `unknown` on purpose: `lib/nodeTypes.ts` normalises it. A 404 (an
   * API that has not shipped the registry yet) surfaces as an ApiError the
   * editor turns into a message, never into a blank canvas.
   */
  listNodeTypes(): Promise<NodeTypeDescriptor[]> {
    return unwrap(http.get<{ data: NodeTypeDescriptor[] }>(`${MODULE}/node-types`));
  },

  /**
   * The company's credentials, for the `credential` picker in the config panel.
   * Secrets are write-only and never come back — not even masked — so this is
   * only ever a list of names and uuids.
   */
  listCredentials(): Promise<Paginated<Credential>> {
    return body(
      http.get<Paginated<Credential>>(`${MODULE}/credentials`, { params: { limit: 100 } }),
    );
  },

  // ---- workflows ----

  listWorkflows(params: WorkflowListParams = {}): Promise<Paginated<Workflow>> {
    return body(http.get<Paginated<Workflow>>(`${MODULE}/workflows`, { params: toParams(params) }));
  },

  getWorkflow(uuid: string): Promise<Workflow> {
    return unwrap(http.get<{ data: Workflow }>(`${MODULE}/workflows/${uuid}`));
  },

  createWorkflow(payload: WorkflowPayload): Promise<Workflow> {
    return unwrap(http.post<{ data: Workflow }>(`${MODULE}/workflows`, payload));
  },

  updateWorkflow(uuid: string, payload: WorkflowPayload): Promise<Workflow> {
    return unwrap(http.patch<{ data: Workflow }>(`${MODULE}/workflows/${uuid}`, payload));
  },

  /** 409 when runs exist — the message names how many, and the caller shows it. */
  deleteWorkflow(uuid: string): Promise<void> {
    return send(http.delete(`${MODULE}/workflows/${uuid}`));
  },

  /**
   * multipart, field name "file". The browser sets the multipart boundary
   * itself, so the Content-Type header is deliberately left alone.
   *
   * The API answers `{document, runUuid}` — the created document plus the uuid
   * of the run it queued — NOT a full run object. Typing this as `Run` made
   * `result.uuid` undefined and navigated to `/ejecuciones/undefined`.
   */
  uploadDocument(workflowUuid: string, file: File): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    return unwrap(
      http.post<{ data: UploadResult }>(
        `${MODULE}/workflows/${workflowUuid}/documents`,
        form,
      ),
    );
  },

  // ---- runs ----

  listRuns(params: RunListParams = {}): Promise<Paginated<RunSummary>> {
    return body(http.get<Paginated<RunSummary>>(`${MODULE}/runs`, { params: toParams(params) }));
  },

  getRun(uuid: string): Promise<Run> {
    return unwrap(http.get<{ data: Run }>(`${MODULE}/runs/${uuid}`));
  },

  /** The reviewer's corrections; moves a `pending_review` run to `succeeded`. */
  reviewRun(uuid: string, values: Record<string, FieldValue>): Promise<Run> {
    return unwrap(http.post<{ data: Run }>(`${MODULE}/runs/${uuid}/review`, { values }));
  },

  /** A failed run back to `queued` — the worker picks it up again. */
  retryRun(uuid: string): Promise<Run> {
    return unwrap(http.post<{ data: Run }>(`${MODULE}/runs/${uuid}/retry`, {}));
  },

  /**
   * Abandon a run the reviewer does not want to finish.
   *
   * The API allows this from `queued` and `pending_review` ONLY, and 409s
   * during `extracting`/`running` on purpose: a node that has already sent an
   * email cannot be un-sent by a status change, so a run marked cancelled whose
   * email arrived anyway would be the UI telling a lie.
   */
  cancelRun(uuid: string): Promise<Run> {
    return unwrap(http.post<{ data: Run }>(`${MODULE}/runs/${uuid}/cancel`, {}));
  },
};
