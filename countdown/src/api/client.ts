import axios from "axios";
import type { AxiosInstance, AxiosResponse } from "axios";
import { createApiClient } from "@mobius-modules/api-client";
import type {
  AssignmentUuids,
  AuthUser,
  Category,
  DocumentItem,
  Group,
  Paginated,
  Person,
  Summary,
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
const MODULE = "/api/countdown";

/** localStorage is shared across *.mobiusboxing.com — namespace every key. */
export const TOKEN_KEY = "countdown_token";
export const USER_KEY = "countdown_user";

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
    return new ApiError(
      error.response?.status ?? 0,
      messageFrom(error.response?.data) ?? fallback,
    );
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
  tokenStorageKey: TOKEN_KEY,
  selfHandled401Paths: [`${HOST}/auth/login`],
  onSessionExpired: () => {
    localStorage.removeItem(USER_KEY);
    if (window.location.pathname !== "/login") window.location.assign("/login");
  },
});

/**
 * The company a superAdmin is operating as, taken from the tenant hostname.
 *
 * SuperAdmins belong to no company, so their JWT carries neither a `companyId`
 * nor an enabled-modules list. On `{client}.vencimientos.…` the company is the
 * one in the address, and the API already accommodates exactly this: both
 * `requireModule` and the countdown controllers let a superAdmin name the target
 * company explicitly. Without it every module call answers
 * 400 "SuperAdmin must specify a company" — or, before this existed, the shell
 * refused to load at all.
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

export interface DocumentListParams {
  page?: number;
  limit?: number;
  /** Host reserved params — the shared query builder reads these names. */
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  status?: "pending" | "resolved" | "overdue" | "all";
  /** Rubro uuid. */
  category?: string;
  /** Calendar range, 'YYYY-MM-DD' — what the calendar view loads by. */
  dueFrom?: string;
  dueTo?: string;
}

/** Empty strings are "no filter", not a filter for "" — drop them. */
function toParams(params: DocumentListParams): Record<string, string | number> {
  const clean: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    clean[key] = value;
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

  // ---- documents ----

  summary(): Promise<Summary> {
    return unwrap(http.get<{ data: Summary }>(`${MODULE}/documents/summary`));
  },

  listDocuments(params: DocumentListParams = {}): Promise<Paginated<DocumentItem>> {
    return body(
      http.get<Paginated<DocumentItem>>(`${MODULE}/documents`, { params: toParams(params) }),
    );
  },

  getDocument(uuid: string): Promise<DocumentItem> {
    return unwrap(http.get<{ data: DocumentItem }>(`${MODULE}/documents/${uuid}`));
  },

  createDocument(payload: Record<string, unknown>): Promise<DocumentItem> {
    return unwrap(http.post<{ data: DocumentItem }>(`${MODULE}/documents`, payload));
  },

  updateDocument(uuid: string, patch: Record<string, unknown>): Promise<DocumentItem> {
    return unwrap(http.patch<{ data: DocumentItem }>(`${MODULE}/documents/${uuid}`, patch));
  },

  /**
   * Resolving may also create the next occurrence, so this always answers with
   * both: `renewed` is null unless a renewal was asked for and happened.
   */
  setStatus(
    uuid: string,
    status: "pending" | "resolved",
    renewal?: { renew: true; nextDueDate?: string },
  ): Promise<{ document: DocumentItem; renewed: DocumentItem | null }> {
    return unwrap(
      http.patch<{ data: { document: DocumentItem; renewed: DocumentItem | null } }>(
        `${MODULE}/documents/${uuid}/status`,
        { status, ...renewal },
      ),
    );
  },

  deleteDocument(uuid: string): Promise<void> {
    return send(http.delete(`${MODULE}/documents/${uuid}`));
  },

  setAssignments(uuid: string, assignments: AssignmentUuids): Promise<DocumentItem> {
    return unwrap(
      http.put<{ data: DocumentItem }>(`${MODULE}/documents/${uuid}/assignments`, assignments),
    );
  },

  // ---- rubros (readable by everyone, managed by admins) ----

  listCategories(): Promise<Category[]> {
    return unwrap(http.get<{ data: Category[] }>(`${MODULE}/categories`));
  },

  createCategory(name: string): Promise<Category> {
    return unwrap(http.post<{ data: Category }>(`${MODULE}/categories`, { name }));
  },

  renameCategory(uuid: string, name: string): Promise<Category> {
    return unwrap(http.patch<{ data: Category }>(`${MODULE}/categories/${uuid}`, { name }));
  },

  deleteCategory(uuid: string): Promise<void> {
    return send(http.delete(`${MODULE}/categories/${uuid}`));
  },

  createSubcategory(categoryUuid: string, name: string): Promise<Category> {
    return unwrap(
      http.post<{ data: Category }>(`${MODULE}/categories/${categoryUuid}/subcategories`, { name }),
    );
  },

  renameSubcategory(uuid: string, name: string): Promise<Category> {
    return unwrap(http.patch<{ data: Category }>(`${MODULE}/subcategories/${uuid}`, { name }));
  },

  deleteSubcategory(uuid: string): Promise<void> {
    return send(http.delete(`${MODULE}/subcategories/${uuid}`));
  },

  // ---- people and groups ----

  /**
   * The company's active users. A module member is not allowed to read
   * `GET /api/users` (admin-only), so the module publishes its own thin list.
   */
  listPeople(): Promise<Person[]> {
    return unwrap(http.get<{ data: Person[] }>(`${MODULE}/people`));
  },

  listGroups(): Promise<Group[]> {
    return unwrap(http.get<{ data: Group[] }>(`${MODULE}/groups`));
  },

  createGroup(name: string): Promise<Group> {
    return unwrap(http.post<{ data: Group }>(`${MODULE}/groups`, { name }));
  },

  renameGroup(uuid: string, name: string): Promise<Group> {
    return unwrap(http.patch<{ data: Group }>(`${MODULE}/groups/${uuid}`, { name }));
  },

  setGroupMembers(uuid: string, members: string[]): Promise<Group> {
    return unwrap(http.put<{ data: Group }>(`${MODULE}/groups/${uuid}/members`, { members }));
  },

  deleteGroup(uuid: string): Promise<void> {
    return send(http.delete(`${MODULE}/groups/${uuid}`));
  },

  // ---- export ----

  /**
   * The export needs the Authorization header, so it cannot be a plain <a href>.
   * Fetch it as a blob and hand the browser an object URL to save.
   *
   * The API caps the sheet and says so in `X-Export-Truncated`; the caller
   * warns that the file is partial.
   */
  async exportDocuments(params: DocumentListParams = {}): Promise<{ truncated: boolean }> {
    let response: AxiosResponse<Blob>;
    try {
      response = await http.get<Blob>(`${MODULE}/documents/export`, {
        params: toParams(params),
        responseType: "blob",
      });
    } catch (error) {
      // The error body is a Blob here, so there is no message to read out of it.
      throw toApiError(error, "No se pudo generar el archivo de Excel");
    }

    // The API names the file; fall back only if the header is missing.
    const disposition = String(response.headers["content-disposition"] ?? "");
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const fileName = match?.[1] ? decodeURIComponent(match[1]) : "vencimientos.xlsx";

    const blobUrl = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

    return { truncated: String(response.headers["x-export-truncated"] ?? "") === "true" };
  },
};
