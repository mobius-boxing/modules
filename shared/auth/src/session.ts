/*
 * The Mobius session — one login for the whole ecosystem.
 *
 * The access token lives in memory only. The durable half of the session is an
 * HttpOnly refresh cookie that mobius-api sets on its own host: every app on
 * `*.mobiusboxing.com` reaches it with `withCredentials`, trades it for a fresh
 * access token on load (see `createSessionRefresher` in
 * `@mobius-modules/api-client`), and one logout ends it for all of them.
 *
 * The only cookie JS still writes is the device-approval secret below, scoped
 * to the parent domain so a browser approved in the web app is approved here
 * too. It is the module-side twin of `src/utils/session.ts` in mobius-web-app
 * and mobius-backoffice-app: separate git repos, so the VALUES must not drift.
 */

/**
 * `DeviceSession` lives in `./index.tsx` (it is also `ModuleGate`'s prop
 * type). A type-only import costs nothing at runtime — this file stays
 * importable by node's native TypeScript runner, which only strips types and
 * cannot parse the JSX elsewhere in that file.
 */
import type { DeviceSession } from "./index.tsx";

/**
 * Build-time config, read defensively: this file is also loaded by node's
 * native TypeScript runner (tests), where `import.meta.env` does not exist.
 */
const BUILD_ENV = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** Dev builds set VITE_COOKIE_PREFIX=mobius_dev so a prod cookie is never read as a dev session. */
const COOKIE_PREFIX = BUILD_ENV.VITE_COOKIE_PREFIX || "mobius";

export const SESSION_COOKIE = `${COOKIE_PREFIX}_session`;

/**
 * The one domain the ecosystem lives on — every customer-facing host is a
 * subdomain of it, and the backoffice composes module URLs from the same
 * constant (`utils/moduleUrl.ts`).
 *
 * Build-time (`VITE_BASE_DOMAIN`) so a dev build scopes its cookie to
 * `.dev.mobiusboxing.com`; unset means production's domain, so a prod build
 * needs no extra config.
 */
const ROOT_DOMAIN = BUILD_ENV.VITE_BASE_DOMAIN || "mobiusboxing.com";

/**
 * `.${ROOT_DOMAIN}` on any Mobius host; null anywhere else (localhost, a
 * `*.cloudfront.net` preview) — a host-only cookie. Browsers ignore the port in
 * cookie scope, so host-only still shares one session across the dev servers.
 */
export function sessionCookieDomain(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)) return `.${ROOT_DOMAIN}`;
  return null;
}

/** Pure so it can be asserted on directly; the callers below supply `window.location`. */
export function buildSessionCookie(
  nameValue: string,
  maxAge: number,
  location: { hostname: string; protocol: string },
): string {
  const parts = [nameValue, "path=/", `max-age=${maxAge}`, "samesite=lax"];
  const domain = sessionCookieDomain(location.hostname);
  if (domain !== null) parts.push(`domain=${domain}`);
  if (location.protocol === "https:") parts.push("secure");
  return parts.join("; ");
}

let accessToken: string | null = null;

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string): void {
  accessToken = token;
}

export function clearToken(): void {
  accessToken = null;
}

/**
 * Older builds kept the JWT in a JS-readable `${prefix}_session` cookie. It is
 * expired with the attributes it was written with, or the browser keeps it
 * beside the new cookies. Guarded because node's test runner has no `document`
 * when this module loads.
 */
if (typeof document !== "undefined") {
  document.cookie = buildSessionCookie(`${SESSION_COOKIE}=`, 0, window.location);
}

/**
 * Drop a pre-SSO per-module token. It must be REMOVED, never adopted into the
 * cookie: logging out elsewhere clears the cookie but cannot reach another
 * origin's localStorage, so adopting would resurrect a session the user had
 * just ended.
 */
export function dropLegacyToken(key: string): void {
  localStorage.removeItem(key);
}

/*
 * The device-approval secret. A member's browser is unknown to the API until an
 * admin approves it (in the web app, /devices); every request carries this value
 * as X-Device-Token so the API can tell which browser is asking.
 *
 * Same cookie scope as the session above, deliberately: one browser is one
 * device for every Mobius origin, so a member approved in the web app is not
 * pending again on `{client}.vencimientos.…`. It is NOT cleared on logout —
 * signing out does not turn this into a different browser — and for the reason
 * at the top of this file it is not a localStorage key either.
 */
export const DEVICE_COOKIE = `${COOKIE_PREFIX}_device`;

/** The approval belongs to the browser, not to the session. */
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function getDeviceToken(): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + DEVICE_COOKIE + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setDeviceToken(token: string): void {
  document.cookie = buildSessionCookie(
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    DEVICE_MAX_AGE_SECONDS,
    window.location,
  );
}

/**
 * The shape of `POST /api/auth/device`'s body, as far as `requestDevice` needs
 * it. Not `AxiosResponse<...>`: this package has no axios dependency (the
 * pattern throughout, see `ApiClientOptions` in `@mobius-modules/api-client`),
 * so callers pass their own client's post call and only the two nested `data`
 * keys of the envelope are asserted on.
 */
interface DeviceEndpointResponse {
  data: { data: DeviceSession | null };
}

/**
 * Registers this browser for the signed-in member without a fresh login (gate
 * amendment 3, D-230) — for a `mobius_session` that survived a deploy with no
 * local device row, nothing else will ever create one. Stores `token`
 * immediately (case 3: the API will not produce it again) and strips it before
 * it reaches a caller that might render or cache the result (D-134 discipline).
 *
 * `admin`/`superAdmin` get `data: null` and this resolves to `null`, same as
 * the login/`me` shapes (I-18).
 */
export async function requestDevice(
  post: () => Promise<DeviceEndpointResponse>,
): Promise<DeviceSession | null> {
  const {
    data: { data: session },
  } = await post();
  if (session === null) return null;
  if (session.token) setDeviceToken(session.token);
  return { ...session, token: undefined };
}

export interface DeviceNotApprovedCopy {
  heading: string;
  description: string;
}

/**
 * Pure decision logic for `DeviceNotApprovedPage`, factored out of the
 * component so it can be tested (and mutation-checked) without mounting
 * anything — this package's tests run through node's native TypeScript
 * runner, which cannot render JSX at all. `"loading"` is deliberately the only
 * state that hides the heading, description and button: a failed auto-request
 * or a caller that never wired `requestDevice` must still land on a real
 * screen with something to read and, where possible, a button to press (M1 —
 * the previous version returned the loading branch whenever `session` was
 * still `null`, which is also true forever in both of those cases).
 */
export function deviceNotApprovedCopy(
  session: DeviceSession | null,
  requestFailed: boolean,
  requesting: boolean,
): "loading" | DeviceNotApprovedCopy {
  if (session === null && !requestFailed && requesting) return "loading";

  const revoked = session?.status === "revoked";
  return {
    heading:
      session === null
        ? "Dispositivo no registrado"
        : revoked
          ? "Dispositivo revocado"
          : "Dispositivo pendiente de aprobación",
    description:
      session === null
        ? "No pudimos registrar este navegador ante Mobius."
        : revoked
          ? "Un administrador revocó el acceso de este navegador. Pide que lo aprueben de " +
            "nuevo para volver a entrar."
          : "Un administrador de tu empresa debe aprobar este navegador antes de que puedas " +
            "usar el módulo.",
  };
}

/*
 * The signed-in user, cached per origin so a reload paints the shell instead of
 * a spinner. It is NOT the session: the access token is memory-only, so the
 * cache is only a first-paint hint that the bootstrap refresh confirms or
 * replaces. It must be cleared whenever the session ends.
 */

interface CachedUser<T> {
  user: T;
}

export function readCachedUser<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;

  try {
    const entry = JSON.parse(raw) as CachedUser<T>;
    // Also catches the pre-SSO shape (a bare user, no `user` key): it is discarded.
    if (entry?.user === undefined) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.user;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/**
 * `GET /api/auth/me` answers with the caller's device session attached. It is
 * live state — an admin approves or revokes the browser without this tab
 * knowing — and on login it carries the raw device secret, so a cached copy
 * would both go stale and park a credential in storage every script on the
 * origin can read. It is dropped before the user is cached.
 */
function withoutDeviceSession<T>(user: T): T {
  if (typeof user !== "object" || user === null || !("device" in user)) return user;
  const cacheable: Record<string, unknown> = { ...(user as Record<string, unknown>) };
  delete cacheable.device;
  return cacheable as T;
}

export function writeCachedUser<T>(key: string, user: T): void {
  localStorage.setItem(key, JSON.stringify({ user: withoutDeviceSession(user) }));
}

export function clearCachedUser(key: string): void {
  localStorage.removeItem(key);
}
