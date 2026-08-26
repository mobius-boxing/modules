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

/** Call AFTER `setToken` on login — the stamp is read from the current cookie. */
export function writeCachedUser<T>(key: string, user: T): void {
  const token = getToken();
  if (token === null) return;
  localStorage.setItem(key, JSON.stringify({ token: fingerprint(token), user }));
}

export function clearCachedUser(key: string): void {
  localStorage.removeItem(key);
}
