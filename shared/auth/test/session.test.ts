/*
 * Run with `npm test -w @mobius-modules/auth` (node's built-in test runner +
 * native TS type stripping — no jest, no dependencies).
 *
 * Only the pure half of session.ts is covered here: the cookie the browser is
 * asked to write. It is the half that decides whether one login reaches every
 * app, and the half a wrong answer breaks silently — a host-only cookie looks
 * exactly like a working session until you open a second subdomain.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSessionCookie, sessionCookieDomain } from "../src/session.ts";

const HTTPS = { protocol: "https:" };

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
