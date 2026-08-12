/*
 * Whitelabel plumbing: {client}.{module}.mobiusboxing.com → client slug →
 * branding. The hostname is PRESENTATION ONLY — authorization always comes
 * from the JWT (companyId + module enabled). A spoofed Host header gets a
 * logo, never data.
 *
 * Depends on backend work that does not exist yet (modules.md §3/Q4):
 * `companies.slug` column and GET /api/public/whitelabel/:module/:client.
 * fetchBranding degrades to null (→ "unknown tenant" / default branding)
 * until then.
 */

export interface WhitelabelBranding {
  companyUuid: string;
  displayName: string;
  logoUrl: string | null;
  colors: Record<string, string>;
}

/**
 * Extract the client slug from a hostname of the form
 * `{client}.{moduleSlug}.mobiusboxing.com`. Returns null for the bare
 * module domain, localhost, or anything that doesn't match.
 */
export function parseTenantFromHostname(hostname: string, moduleSlug: string): string | null {
  const suffix = `.${moduleSlug}.mobiusboxing.com`;
  if (!hostname.endsWith(suffix)) return null;
  const client = hostname.slice(0, -suffix.length);
  if (client === "" || client.includes(".")) return null;
  return client;
}

/**
 * Fetch a tenant's branding from the public endpoint. 404 (unknown tenant)
 * and network errors resolve to null — callers show the unknown-tenant page
 * or default branding.
 */
export async function fetchBranding(
  apiBaseUrl: string,
  moduleSlug: string,
  client: string,
): Promise<WhitelabelBranding | null> {
  try {
    const res = await fetch(
      `${apiBaseUrl}/api/public/whitelabel/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(client)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { success: boolean; data?: WhitelabelBranding };
    return body.success && body.data ? body.data : null;
  } catch {
    return null;
  }
}
