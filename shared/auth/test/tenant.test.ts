/*
 * Run with `npm test -w @mobius-modules/auth`.
 *
 * The rule that keeps one shared session from becoming "signed in to every
 * company's workspace". Its two exemptions are the easy things to get wrong,
 * so they are pinned here rather than left to each module's App.tsx.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isTenantMismatch } from "../src/tenant.ts";

const ACME = "b265e478-16d8-47f3-8a6c-9860bd31b4e0";
const OTHER = "00000000-0000-4000-8000-000000000001";

const member = (companyId?: string) => ({ role: "member", companyId });

test("another company's tenant is a mismatch", () => {
  assert.equal(isTenantMismatch(member(OTHER), ACME), true);
});

test("your own company's tenant is not", () => {
  assert.equal(isTenantMismatch(member(ACME), ACME), false);
});

test("a user with no company cannot pass for a tenant's own", () => {
  // An undefined companyId must not compare equal to "no tenant" by accident.
  assert.equal(isTenantMismatch(member(undefined), ACME), true);
});

test("no tenant in the address is nothing to disagree with", () => {
  // localhost and the bare module domain; the API still scopes to the JWT.
  assert.equal(isTenantMismatch(member(OTHER), null), false);
});

test("a signed-out visitor is not a mismatch — they are a login", () => {
  assert.equal(isTenantMismatch(null, ACME), false);
});

test("superAdmin is exempt: operating as the tenant is the point", () => {
  assert.equal(isTenantMismatch({ role: "superAdmin" }, ACME), false);
  assert.equal(isTenantMismatch({ role: "superAdmin", companyId: OTHER }, ACME), false);
});

test("admin is not exempt — only superAdmin is", () => {
  assert.equal(isTenantMismatch({ role: "admin", companyId: OTHER }, ACME), true);
});
