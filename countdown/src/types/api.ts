/**
 * Response shapes, duplicated from mobius-api on purpose — no shared types
 * package at this size. Keep in sync by hand with
 * `mobius-api/src/interfaces/countdown/countdown.interfaces.ts` and the host
 * envelopes (`{success, data}` for one thing, an unwrapped paginator for a
 * list, `{success:false, message}` for an error).
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

export type DocumentStatus = "pending" | "resolved";

/** "cada 2 meses" — a count and a unit, not a fixed set of named periods. */
export type RecurrenceUnit = "day" | "month" | "year";

export interface Recurrence {
  count: number;
  unit: RecurrenceUnit;
}

export interface NamedRef {
  uuid: string;
  name: string;
}

export interface DocumentItem {
  uuid: string;
  title: string;
  issuer: string | null;
  referenceNumber: string | null;
  category: NamedRef | null;
  subcategory: NamedRef | null;
  notes: string | null;
  amountCents: number | null;
  currency: string;
  /** 'YYYY-MM-DD' — a calendar date, never parsed as an instant. */
  dueDate: string;
  status: DocumentStatus;
  /** null when the document does not repeat. */
  recurrence: Recurrence | null;
  /**
   * Days of anticipation: the document is reported from `dueDate - reminderDays`
   * onward and keeps being reported after the due date until it is resolved.
   */
  reminderDays: number;
  overdue: boolean;
  daysUntilDue: number;
  resolvedAt: string | null;
  resolvedByName: string | null;
  uploadedBy: NamedRef | null;
  createdAt: string;
  updatedAt: string;
  /** Who may resolve it; empty means anyone. */
  resolvers: { users: NamedRef[]; groups: NamedRef[] };
  /** Who gets the reminders; empty means whoever uploaded it. */
  watchers: { users: NamedRef[]; groups: NamedRef[] };
  /** Whether the signed-in user may resolve it. Advisory: the server re-checks. */
  canResolve: boolean;
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

export interface Summary {
  pendingCount: number;
  overdueCount: number;
  dueTodayCount: number;
  dueIn7Count: number;
  dueIn30Count: number;
  resolvedCount: number;
  pendingAmountCents: number;
  overdueAmountCents: number;
}

/** The host's error envelope. */
export interface ApiErrorBody {
  success: false;
  message: string;
}

export const RECURRENCE_UNIT_LABELS: Record<RecurrenceUnit, [string, string]> = {
  day: ["día", "días"],
  month: ["mes", "meses"],
  year: ["año", "años"],
};

/** "cada mes" / "cada 2 meses" — mirrors describeRecurrence on the API. */
export function describeRecurrence(recurrence: Recurrence): string {
  const [one, many] = RECURRENCE_UNIT_LABELS[recurrence.unit];
  return recurrence.count === 1 ? `cada ${one}` : `cada ${recurrence.count} ${many}`;
}

// ---- rubros ----

export interface Subcategory {
  uuid: string;
  name: string;
  documentCount: number;
}

export interface Category {
  uuid: string;
  name: string;
  subcategories: Subcategory[];
  documentCount: number;
  createdAt: string;
}

// ---- people and groups ----

/** A company user as the module sees them: a uuid and something to print. */
export interface Person {
  uuid: string;
  name: string;
}

export interface Group {
  uuid: string;
  name: string;
  members: Person[];
  createdAt: string;
}

export interface AssignmentUuids {
  resolverUsers?: string[];
  resolverGroups?: string[];
  watcherUsers?: string[];
  watcherGroups?: string[];
}
