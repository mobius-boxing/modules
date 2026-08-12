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
- Q1 in `mobius/modules.md` is unresolved — do not build session/auth
  plumbing in `shared/auth` until it's answered.
