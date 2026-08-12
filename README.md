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
- `shared/whitelabel` — `{client}.{module}.mobiusboxing.com` hostname → client
  slug + branding fetch (backend endpoint pending)
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
   (us-east-1) covering `<slug>.mobiusboxing.com` + `*.<slug>.mobiusboxing.com`,
   Porkbun wildcard CNAME `*.<slug>` → the distribution. Deploy = build
   locally → sync from the EC2 box → **re-upload index.html with
   `Cache-Control: no-cache, must-revalidate`** (lesson L-001) → invalidate.
6. **Whitelabel** (layer on top, pending Q3/Q4): branding from
   `company_modules.config` via `GET /api/public/whitelabel/:module/:client`;
   needs the `companies.slug` migration. Hostname is presentation only —
   authorization always from the JWT.
