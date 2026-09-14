/*
 * Run with `npm test -w @mobius-modules/auth` (node's built-in test runner +
 * native TS type stripping — no jest, no dependencies).
 *
 * Mostly the pure half of session.ts: the cookie the browser is asked to write.
 * It is the half that decides whether one login reaches every app, and the half
 * a wrong answer breaks silently — a host-only cookie looks exactly like a
 * working session until you open a second subdomain. The device cookie and the
 * user cache need a browser, so the last three cases run against the stubs
 * below.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSessionCookie,
  clearToken,
  getDeviceToken,
  getToken,
  readCachedUser,
  requestDevice,
  sessionCookieDomain,
  setDeviceToken,
  setToken,
  writeCachedUser,
} from "../src/session.ts";

const HTTPS = { protocol: "https:" };

const jar = new Map<string, string>();
let lastCookieWrite = "";
const storage = new Map<string, string>();

globalThis.document = {
  get cookie() {
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  },
  set cookie(written: string) {
    lastCookieWrite = written;
    const [name, value] = written.split(";")[0].split("=");
    // A browser deletes on max-age=0, which is how clearToken works.
    if (/max-age=0(;|$)/.test(written)) jar.delete(name);
    else jar.set(name, value);
  },
} as unknown as Document;

globalThis.window = {
  location: { hostname: "acme.vencimientos.mobiusboxing.com", protocol: "https:" },
} as unknown as Window & typeof globalThis;

globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
} as unknown as Storage;

test("every Mobius host shares one parent-domain cookie", () => {
  for (const host of [
    "app.mobiusboxing.com",
    "backoffice.mobiusboxing.com",
    "acme.vencimientos.mobiusboxing.com",
    "acme.flujos.mobiusboxing.com",
    "mobiusboxing.com",
  ]) {
    assert.equal(sessionCookieDomain(host), ".mobiusboxing.com", host);
  }
});

test("hostname case does not change the scope", () => {
  assert.equal(sessionCookieDomain("ACME.Vencimientos.MobiusBoxing.com"), ".mobiusboxing.com");
});

test("a look-alike domain gets no parent-domain cookie", () => {
  // Suffix matching must be on a label boundary, or `mobiusboxing.com.evil.com`
  // and `notmobiusboxing.com` would both be handed the session.
  assert.equal(sessionCookieDomain("mobiusboxing.com.evil.com"), null);
  assert.equal(sessionCookieDomain("notmobiusboxing.com"), null);
});

test("localhost and previews fall back to a host-only cookie", () => {
  // Browsers ignore the port in cookie scope, so host-only still means the dev
  // servers on :3000/:3002/:3040/:3050 share one session.
  assert.equal(sessionCookieDomain("localhost"), null);
  assert.equal(sessionCookieDomain("d17vukx1m83rn3.cloudfront.net"), null);
});

test("the production cookie is domain-scoped and secure", () => {
  const cookie = buildSessionCookie("mobius_session=abc", 604800, {
    hostname: "acme.vencimientos.mobiusboxing.com",
    ...HTTPS,
  });
  assert.match(cookie, /^mobius_session=abc; /);
  assert.ok(cookie.includes("domain=.mobiusboxing.com"), cookie);
  assert.ok(cookie.includes("path=/"), cookie);
  assert.ok(cookie.includes("max-age=604800"), cookie);
  assert.ok(cookie.includes("samesite=lax"), cookie);
  assert.ok(cookie.includes("secure"), cookie);
});

test("http dev drops secure and the domain, nothing else", () => {
  const cookie = buildSessionCookie("mobius_session=abc", 604800, {
    hostname: "localhost",
    protocol: "http:",
  });
  assert.ok(!cookie.includes("secure"), cookie);
  assert.ok(!cookie.includes("domain="), cookie);
  assert.ok(cookie.includes("samesite=lax"), cookie);
});

test("clearing uses the same scope as writing, or the cookie survives", () => {
  const at = { hostname: "app.mobiusboxing.com", ...HTTPS };
  const written = buildSessionCookie("mobius_session=abc", 604800, at);
  const cleared = buildSessionCookie("mobius_session=", 0, at);
  const scope = (c: string) =>
    c
      .split("; ")
      .filter((p) => !p.startsWith("max-age="))
      .slice(1);
  assert.deepEqual(scope(cleared), scope(written));
  assert.ok(cleared.includes("max-age=0"), cleared);
});

test("the device cookie lasts a year on the shared parent domain", () => {
  setDeviceToken("a".repeat(64));
  assert.equal(
    lastCookieWrite,
    `mobius_device=${"a".repeat(64)}; path=/; max-age=31536000; ` +
      "samesite=lax; domain=.mobiusboxing.com; secure",
  );
});

test("a session ending does not end the browser's approval", () => {
  setToken("jwt.header.payload");
  setDeviceToken("b".repeat(64));
  // Two cookies, two readers: neither helper may answer with the other's value.
  assert.equal(getDeviceToken(), "b".repeat(64));
  assert.equal(getToken(), "jwt.header.payload");

  clearToken();
  assert.equal(getToken(), null);
  assert.equal(getDeviceToken(), "b".repeat(64));
});

test("the cached user never carries the device session", () => {
  setToken("jwt.header.payload");
  writeCachedUser("countdown_user", {
    uuid: "u1",
    email: "ana@acme.test",
    device: { uuid: "d1", status: "pending", token: "c".repeat(64) },
  });

  // On login the session carries the raw device secret — the credential itself —
  // and an admin flips the status without this tab knowing. Neither belongs in
  // storage.
  const stored = storage.get("countdown_user") ?? "";
  assert.doesNotMatch(stored, /device|c{64}/);
  assert.deepEqual(readCachedUser("countdown_user"), { uuid: "u1", email: "ana@acme.test" });
});

test("requestDevice stores a token it is handed and never returns it", async () => {
  const pending = {
    uuid: "d1",
    status: "pending" as const,
    requestedAt: "2026-09-14T09:12:40.000Z",
    approvedAt: null,
    revokedAt: null,
    token: "e".repeat(64),
  };
  const session = await requestDevice(async () => ({ data: { data: pending } }));

  assert.equal(getDeviceToken(), "e".repeat(64));
  assert.equal(session?.token, undefined);
  assert.deepEqual(session, { ...pending, token: undefined });
});

test("requestDevice touches no cookie on a repeat call that mints no secret", async () => {
  // Case 1 of the registration procedure: a known, still-pending row is
  // returned unchanged and carries no `token` at all.
  const before = getDeviceToken();
  const pending = {
    uuid: "d1",
    status: "pending" as const,
    requestedAt: "2026-09-14T09:12:40.000Z",
    approvedAt: null,
    revokedAt: null,
  };
  const session = await requestDevice(async () => ({ data: { data: pending } }));

  assert.equal(getDeviceToken(), before);
  // `token` is always spread onto the result (even as `undefined`), matching
  // the same strip used after login (D-134) — asserted explicitly here so a
  // future refactor can't quietly start omitting the key instead.
  assert.deepEqual(session, { ...pending, token: undefined });
});

test("requestDevice passes an admin's null straight through", async () => {
  const session = await requestDevice(async () => ({ data: { data: null } }));
  assert.equal(session, null);
});
