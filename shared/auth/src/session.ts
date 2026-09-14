/*
 * The Mobius session — one login for the whole ecosystem.
 *
 * `app.mobiusboxing.com`, `backoffice.mobiusboxing.com` and every module tenant
 * (`{client}.vencimientos.mobiusboxing.com`, `{client}.flujos.mobiusboxing.com`)
 * are different ORIGINS, so localStorage cannot carry a session between them.
 * A per-module localStorage key therefore made every module an island: signing
 * into the backoffice and clicking through to a module landed on a login form.
 * The JWT lives in a cookie scoped to the parent domain instead, so one login
 * — and one logout — apply everywhere.
 *
 * This is the module-side twin of `src/utils/session.ts` in mobius-web-app and
 * mobius-backoffice-app: same cookie name, same domain, same max-age. Those are
 * separate git repos so the code cannot literally be shared, but the VALUES
 * must not drift — whichever app wrote the cookie decides how long every other
 * app's session lasts.
 *
 * The cookie is deliberately NOT HttpOnly: mobius-api authenticates only from
 * the `Authorization: Bearer` header and rejects a cookie-only request (its
 * cookie-auth-rejection integration test pins that), so JS has to read it.
 * That is also why widening the cookie to more subdomains grants it no ambient
 * authority it did not already have — a request without the header is still 401.
 */

/**
 * `DeviceSession` lives in `./index.tsx` (it is also `ModuleGate`'s prop
 * type). A type-only import costs nothing at runtime — this file stays
 * importable by node's native TypeScript runner, which only strips types and
 * cannot parse the JSX elsewhere in that file.
 */
import type { DeviceSession } from "./index.tsx";

export const SESSION_COOKIE = "mobius_session";

/** In step with mobius-web-app / mobius-backoffice-app. The API still enforces JWT expiry. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * The one domain the ecosystem lives on — every customer-facing host is a
 * subdomain of it, and the backoffice composes module URLs from the same
 * constant (`utils/moduleUrl.ts`).
 *
 * Derived from the address rather than baked into each module's build on
 * purpose: a module deployed without the right env var would silently fall back
 * to a host-only cookie and reproduce exactly the bug this file fixes.
 */
const ROOT_DOMAIN = "mobiusboxing.com";

/**
 * `.mobiusboxing.com` on any Mobius host; null anywhere else (localhost, a
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

export function getToken(): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + SESSION_COOKIE + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string): void {
  document.cookie = buildSessionCookie(
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    MAX_AGE_SECONDS,
    window.location,
  );
}

export function clearToken(): void {
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
export const DEVICE_COOKIE = "mobius_device";

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

/*
 * The signed-in user, cached per origin so a reload paints the shell instead of
 * a spinner. It is NOT the session — the cookie is — and it is stamped with a
 * fingerprint of the token it was read with, then thrown away when the two
 * disagree. Without that stamp a tab showing user A would paint A's name for a
 * frame after B signed in on another subdomain, because the cache is per-origin
 * and the login was not.
 */

const fingerprint = (token: string): string => token.slice(-24);

interface CachedUser<T> {
  token: string;
  user: T;
}

export function readCachedUser<T>(key: string): T | null {
  const token = getToken();
  if (token === null) return null;

  const raw = localStorage.getItem(key);
  if (raw === null) return null;

  try {
    const entry = JSON.parse(raw) as CachedUser<T>;
    // Also catches the pre-SSO shape (a bare user, no `token`): it is discarded.
    if (entry?.token !== fingerprint(token)) {
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

/** Call AFTER `setToken` on login — the stamp is read from the current cookie. */
export function writeCachedUser<T>(key: string, user: T): void {
  const token = getToken();
  if (token === null) return;
  localStorage.setItem(
    key,
    JSON.stringify({ token: fingerprint(token), user: withoutDeviceSession(user) }),
  );
}

export function clearCachedUser(key: string): void {
  localStorage.removeItem(key);
}
