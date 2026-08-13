# mobius modules monorepo

Frontends only — module backends live in `mobius-api` under `/api/<slug>/`
behind `requireModule(slug)`. Plan + open questions: `mobius/modules.md`
(workspace root). Adding a module: follow the README checklist.

## Commands
- `npm install` at the repo root (npm workspaces)
- `npm run dev` — template app (port 3030); `npm run dev -w <slug>` for a module
- `npm run build` — all apps; `npm run format` — prettier

## Rules
- Copy `_template/`, don't hand-roll module apps; register the dev port in
  the README table (never 3000–3010).
- Workspace-wide conventions apply (root CLAUDE.md, code-style skill,
  lessons index): namespaced localStorage keys, Spanish-first UI, inputs
  with name/type/data-testid, ConfirmModal over native dialogs.
- Auth is Mobius SSO (modules.md Q1, answered 2026-08-12): a module logs in
  against the host's `POST /api/auth/login`, keeps the token under
  `<slug>_token`, and gates its shell on the `modules` claim from
  `GET /api/auth/me` via `ModuleGate`. `countdown/` is the reference
  implementation — copy its `api/client.ts` + `context/AuthContext.tsx`
  rather than inventing a second session model.
- Branding is per company through the whitelabel layer; never ship a
  client's logo as a module asset.
