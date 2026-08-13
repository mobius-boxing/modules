# Mobius modules

One monorepo for every Mobius module **frontend** (npm workspaces, React + TS
+ Vite). Module **backends stay in `mobius-api`** under `/api/<slug>/...`,
gated by the existing `requireModule(slug)` — one DB, one auth stack, one
RBAC/audit pipeline. A module that needs real isolation gets spun out
standalone (the rolpel treatment); that's the escape hatch, not the default.

Design/plan: `mobius/modules.md` (workspace root — Modules v2). Open
questions Q1–Q7 live there; **Q1 (who logs into the first module) is
unresolved** and blocks everything session-shaped in `shared/auth`.

## Layout
- `shared/api-client` — axios instance factory (token header, namespaced
  localStorage key, self-handled-401 paths)
- `shared/auth` — module boot gate + "not enabled" page (session plumbing
  pending Q1)
- `shared/whitelabel` — `{client}.{domain label}.mobiusboxing.com` hostname →
  client slug + branding fetch + `applyBranding` (see "Whitelabel" below).
  Dependency-free, no React; `npm test -w @mobius-modules/whitelabel`
- `_template/` — copy me to start a module

## Commands
- `npm install` (root) — installs all workspaces
- `npm run dev` — template app on port 3030
- `npm run dev -w <slug>` — a specific module
- `npm run build` — build all apps

## Dev port registry (one per module; workspace rule: never 3000–3010)
| Port | Module |
|------|--------|
| 3030 | _template |
| 3040 | countdown |

## Add a module (checklist)
1. **Frontend**: copy `_template/` to `<slug>/`; set the package `name` to
   `@mobius-modules/<slug>`, `MODULE_SLUG`, and a fresh dev port (table
   above); add `"<slug>"` to root `package.json` `workspaces`.
2. **Seed**: migration in `mobius-api` inserting the `modules` row
   (slug, name, description). Modules are seeded by migration only — never
   edited by hand.
3. **API**: mount routes under `/api/<slug>/` wrapped in
   `requireModule(slug)` (mobius-api conventions apply: BaseCrudController,
   query builder, requirePermission — see `repos/docs/` guides).
4. **Boot gate**: resolve enablement per Q1 (JWT/`me` modules list for
   internal users; module-own auth for external) and feed `<ModuleGate>`.
5. **Infra** (when it ships — see `repos/docs/infra.md`): S3 bucket
   `mobius-<slug>-538311878550`, CloudFront distribution + ACM cert
   (us-east-1) covering `<label>.mobiusboxing.com` + `*.<label>.mobiusboxing.com`,
   Porkbun wildcard CNAME `*.<label>` → the distribution, where `<label>` is
   the module's **public domain label** (below). Deploy = build locally → sync
   from the EC2 box → **re-upload index.html with
   `Cache-Control: no-cache, must-revalidate`** (lesson L-001) → invalidate.
6. **Whitelabel**: wire `shared/whitelabel` into the module's boot — below.

## Whitelabel (per-customer branding)

One bundle, one distribution, branding resolved at runtime from the hostname.

**The public domain label is not the module slug.** countdown is published as
`{client}.vencimientos.mobiusboxing.com` (the label is what the customer reads)
while its slug — API path `/api/countdown`, token key `countdown_token`, the
`modules` row — stays `countdown`. `parseTenantFromHostname()` takes the label,
never the slug; a module whose two names happen to match still passes both.

**Resolution order** (`parseTenantFromHostname(hostname, opts)` → client slug or
null): `?tenant=<slug>` in the query string → `VITE_TENANT` (passed in by the
app as `opts.envTenant`) → the hostname. The first two are the dev/preview
override — that is how branding is exercised on localhost, and they are never
set on a production build. Null for the bare module domain, localhost/loopback,
two labels in front of the domain (`a.b.vencimientos…`), another module's
domain, and anything that is not a DNS-safe label (lowercase alnum + hyphens,
≤63 chars).

**Branding endpoint** (public, unauthenticated, no cookies):

```
GET {API}/api/public/whitelabel/{module-slug}/{client}
 → 200 {success:true, data:{companyUuid, slug, displayName, brandColor, logoUrl, loginMessage}}
 → 404 for an unknown or disabled tenant (generic — it confirms nothing)
```

`fetchBranding()` returns `{status:"ok"|"unknown"|"error"}` with an 8 s abort,
and the three are **not** interchangeable: `unknown` is the address being wrong
(show the unknown-tenant page instead of the app), `error` is the API being
unreachable (load the app with default branding — a branding blip must not
brick the SPA). No tenant in the address at all is also just default branding.

**Colours.** The API sends ONE colour (`brandColor`, `#rrggbb`);
`applyBranding()` derives the hover/press/soft/tint ramp from it in JS and sets
`--brand*` as inline custom properties on `<html>`, which override the
`:root { … }` defaults the module's stylesheet ships. It also sets
`document.title` and the `theme-color` meta. Consequence for module CSS: every
brand-coloured rule reads `var(--brand…)` — a hardcoded brand literal is a rule
the whitelabel layer cannot reach. Semantic colours (status bands, alerts) are
deliberately NOT derived from the brand.

**Logos** come from the API as absolute URLs. Never ship a client's logo as a
module asset.

**Trust boundary:** the hostname is presentation only. Every API request is
authorized from the JWT (`companyId` + module enabled). A spoofed Host header
gets you someone's logo, never their data.

Reference implementation: `countdown/src/context/BrandingContext.tsx` (boot
above the router) + `countdown/src/components/UnknownTenantPage.tsx`.

**Deploying a whitelabeled module:** the SPA sits on
`*.<label>.mobiusboxing.com` and the API on `api.mobiusboxing.com`, so the
deployed bundle is built with `VITE_API_URL=https://api.mobiusboxing.com` and
that wildcard origin must be in the API's CORS allowlist — the branding call is
cross-origin like every other request. Adding a client is DNS-free (the
wildcard already resolves): give the company a `slug`, enable the module, fill
its branding.
