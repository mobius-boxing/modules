/**
 * May this session use the workspace whose address the browser is on?
 *
 * The question only exists because the session is shared across the whole
 * domain (see ./session): the cookie authenticates on ANY tenant hostname, so
 * a user of company A landing on company B's address now arrives signed in
 * rather than at a login form. The API would then answer for A — it scopes
 * every call to the JWT company — while the address and the branding say B.
 * That is a wrong workspace, not a permitted one.
 *
 * Two deliberate non-answers:
 * - no tenant in the address (localhost, the bare module domain): there is
 *   nothing to disagree with, and the API still scopes to the JWT company.
 * - superAdmin: belongs to no company and operates as the tenant in the
 *   address on purpose — that is what each module's ModuleBoundary sets up.
 */
export function isTenantMismatch(
  user: { role: string; companyId?: string } | null,
  tenantCompanyUuid: string | null,
): boolean {
  if (user === null || tenantCompanyUuid === null) return false;
  if (user.role === "superAdmin") return false;
  return user.companyId !== tenantCompanyUuid;
}
