/*
 * Run with `npm test -w @mobius-modules/whitelabel` (node's built-in test
 * runner + native TS type stripping — no jest, no dependencies, and nothing
 * to typecheck since @types/node is not installed in this monorepo).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveBrandRamp, fetchBranding, parseTenantFromHostname } from "../src/index.ts";

/** countdown's real configuration: the domain label is NOT the module slug. */
const OPTS = { domainLabel: "vencimientos", search: "" };

test("returns the client label for a tenant hostname", () => {
  assert.equal(parseTenantFromHostname("acme.vencimientos.mobiusboxing.com", OPTS), "acme");
  assert.equal(parseTenantFromHostname("acme-2.vencimientos.mobiusboxing.com", OPTS), "acme-2");
  assert.equal(parseTenantFromHostname("ACME.Vencimientos.MobiusBoxing.com", OPTS), "acme");
  assert.equal(parseTenantFromHostname("acme.vencimientos.mobiusboxing.com.", OPTS), "acme");
  assert.equal(parseTenantFromHostname("acme.vencimientos.mobiusboxing.com:443", OPTS), "acme");
});

test("returns null for the bare module domain", () => {
  assert.equal(parseTenantFromHostname("vencimientos.mobiusboxing.com", OPTS), null);
  assert.equal(parseTenantFromHostname("mobiusboxing.com", OPTS), null);
});

test("returns null for localhost and loopback", () => {
  assert.equal(parseTenantFromHostname("localhost", OPTS), null);
  assert.equal(parseTenantFromHostname("localhost:3040", OPTS), null);
  assert.equal(parseTenantFromHostname("127.0.0.1", OPTS), null);
  assert.equal(parseTenantFromHostname("127.0.0.1:3040", OPTS), null);
});

test("returns null when an extra label precedes the module domain", () => {
  assert.equal(parseTenantFromHostname("a.b.vencimientos.mobiusboxing.com", OPTS), null);
  assert.equal(parseTenantFromHostname(".vencimientos.mobiusboxing.com", OPTS), null);
});

test("the domain label is not the module slug", () => {
  // The old signature took the module slug and matched `{client}.countdown.…`,
  // which is not where this module is published.
  assert.equal(parseTenantFromHostname("acme.countdown.mobiusboxing.com", OPTS), null);
  assert.equal(
    parseTenantFromHostname("acme.countdown.mobiusboxing.com", {
      domainLabel: "countdown",
      search: "",
    }),
    "acme",
  );
});

test("honours a custom base domain", () => {
  assert.equal(
    parseTenantFromHostname("acme.vencimientos.example.test", {
      ...OPTS,
      baseDomain: "example.test",
    }),
    "acme",
  );
  assert.equal(parseTenantFromHostname("acme.vencimientos.example.test", OPTS), null);
});

test("rejects labels that are not DNS-safe", () => {
  assert.equal(parseTenantFromHostname("ac_me.vencimientos.mobiusboxing.com", OPTS), null);
  assert.equal(parseTenantFromHostname("-acme.vencimientos.mobiusboxing.com", OPTS), null);
  assert.equal(parseTenantFromHostname("acme-.vencimientos.mobiusboxing.com", OPTS), null);
  assert.equal(
    parseTenantFromHostname(`${"a".repeat(64)}.vencimientos.mobiusboxing.com`, OPTS),
    null,
  );
  assert.equal(
    parseTenantFromHostname(`${"a".repeat(63)}.vencimientos.mobiusboxing.com`, OPTS),
    "a".repeat(63),
  );
});

test("the ?tenant= override wins over the hostname", () => {
  assert.equal(parseTenantFromHostname("localhost", { ...OPTS, search: "?tenant=acme" }), "acme");
  assert.equal(
    parseTenantFromHostname("other.vencimientos.mobiusboxing.com", {
      ...OPTS,
      search: "?foo=1&tenant=acme",
    }),
    "acme",
  );
  // Present but unusable: explicit intent that failed, not a fallback.
  assert.equal(
    parseTenantFromHostname("acme.vencimientos.mobiusboxing.com", {
      ...OPTS,
      search: "?tenant=not%20a%20label",
    }),
    null,
  );
  // Absent or empty: fall through to the hostname.
  assert.equal(
    parseTenantFromHostname("acme.vencimientos.mobiusboxing.com", { ...OPTS, search: "?tenant=" }),
    "acme",
  );
});

test("VITE_TENANT is honoured, and the query string beats it", () => {
  assert.equal(parseTenantFromHostname("localhost", { ...OPTS, envTenant: "acme" }), "acme");
  assert.equal(
    parseTenantFromHostname("localhost", { ...OPTS, search: "?tenant=beta", envTenant: "acme" }),
    "beta",
  );
  assert.equal(parseTenantFromHostname("localhost", { ...OPTS, envTenant: "" }), null);
  assert.equal(parseTenantFromHostname("localhost", { ...OPTS, envTenant: "no_way" }), null);
});

test("derives a ramp from one hex colour", () => {
  // The module green: the derived ramp must stay in the same family as the
  // hand-tuned oklch defaults it replaces at runtime.
  assert.deepEqual(deriveBrandRamp("#018445"), {
    brand: "#018445",
    strong: "#01743d",
    press: "#016736",
    soft: "#ebf5f0",
    tint: "#cce6da",
    ink: "#ffffff",
  });
  assert.deepEqual(deriveBrandRamp("#fff"), deriveBrandRamp("#ffffff"));
  assert.equal(deriveBrandRamp("rebeccapurple"), null);
  assert.equal(deriveBrandRamp("#12345"), null);
  assert.equal(deriveBrandRamp(""), null);
});

test("picks a readable foreground for the tenant's brand colour", () => {
  // White on a pale brand is the failure this exists to prevent: a customer is
  // free to choose yellow, and "Guardar" must stay legible.
  assert.equal(deriveBrandRamp("#018445")?.ink, "#ffffff"); // dark green
  assert.equal(deriveBrandRamp("#7a1fa2")?.ink, "#ffffff"); // purple
  assert.equal(deriveBrandRamp("#000000")?.ink, "#ffffff");
  assert.equal(deriveBrandRamp("#ffd400")?.ink, "#1a1a1a"); // yellow
  assert.equal(deriveBrandRamp("#ffffff")?.ink, "#1a1a1a");
  assert.equal(deriveBrandRamp("#b8e986")?.ink, "#1a1a1a"); // pale green
});

/** The three outcomes the boot sequence branches on. */
function stubFetch(handler: () => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const BODY = {
  success: true,
  data: {
    companyUuid: "c0ffee00-0000-4000-8000-000000000001",
    slug: "acme",
    displayName: "Acme",
    brandColor: "#018445",
    logoUrl: "https://cdn.example.test/acme.png",
    loginMessage: "Bienvenido",
  },
};

test("fetchBranding: 200 → ok", async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify(BODY), { status: 200 }));
  try {
    const result = await fetchBranding("", "countdown", "acme");
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" ? result.branding.displayName : null, "Acme");
  } finally {
    restore();
  }
});

test("fetchBranding: 404 → unknown, 500 → error, network failure → error", async () => {
  let restore = stubFetch(async () => new Response("{}", { status: 404 }));
  try {
    assert.equal((await fetchBranding("", "countdown", "nope")).status, "unknown");
  } finally {
    restore();
  }

  restore = stubFetch(async () => new Response("{}", { status: 500 }));
  try {
    assert.equal((await fetchBranding("", "countdown", "acme")).status, "error");
  } finally {
    restore();
  }

  restore = stubFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  try {
    assert.equal((await fetchBranding("", "countdown", "acme")).status, "error");
  } finally {
    restore();
  }
});

test("fetchBranding: a 200 with a broken body is an error, not a tenant", async () => {
  const restore = stubFetch(async () => new Response(JSON.stringify({ success: true }), {}));
  try {
    assert.equal((await fetchBranding("", "countdown", "acme")).status, "error");
  } finally {
    restore();
  }
});

test("fetchBranding: calls the public path with the module slug, no auth", async () => {
  let seen = "";
  let init: RequestInit | undefined;
  const restore = stubFetch((async (url: string, options: RequestInit) => {
    seen = url;
    init = options;
    return new Response(JSON.stringify(BODY), { status: 200 });
  }) as unknown as () => Promise<Response>);
  try {
    await fetchBranding("https://api.mobiusboxing.com", "countdown", "acme");
    assert.equal(seen, "https://api.mobiusboxing.com/api/public/whitelabel/countdown/acme");
    assert.equal(init?.credentials, "omit");
    assert.equal(Object.keys(init?.headers ?? {}).includes("Authorization"), false);
  } finally {
    restore();
  }
});
