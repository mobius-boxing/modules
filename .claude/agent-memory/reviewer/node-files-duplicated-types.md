---
name: node-files-duplicated-types
description: modules/* frontends hand-duplicate mobius-api response interfaces (no shared types package) — enum/shape drift is easy to reintroduce and easy to half-fix
metadata:
  type: project
---

`repos/modules/<slug>/src/types/api.ts` is a hand-maintained copy of the
corresponding `mobius-api` interfaces (see `repos/mobius-api/src/interfaces/<slug>/`).
There is no shared package, by design (noted in the file header), so nothing
forces the two to agree — tsc and tests stay green even when a field is
renamed, flattened, or an enum grows a new value on one side only.

**Why:** node-files phase 1 shipped with `Run`/`RunSummary` nested
(`workflow: {uuid,name}`) while the API sent flat `workflowUuid`/`workflowName`
— hidden by optional chaining, caught only in a later review cycle. Same
review cycle also caught a `WorkflowStatus` enum that had `active`/`disabled`
on the API but `active` only (missing `disabled`) on the frontend.

**How to apply:** when reviewing a fix to one of these duplicated-type
mismatches, don't stop at "type now matches type." An enum fix must be
verified across every place that enumerates its values: the type union, the
label map (`lib/format.ts`-style), AND any `<select>`/filter-chip list that
hardcodes the option set (e.g. `WorkflowEditorPage.tsx`'s `STATUSES` const) —
these lists don't get a compile error when a new enum member is added
elsewhere, so they're the ones most likely to be missed. Grep for the enum's
literal string values across the whole module, not just the types file.
