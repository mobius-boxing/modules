import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { applyBranding, fetchBranding, parseTenantFromHostname } from "@mobius-modules/whitelabel";
import type { WhitelabelBranding } from "@mobius-modules/whitelabel";
import { UnknownTenantPage } from "../components/UnknownTenantPage";

/**
 * The public hostname is `{client}.{DOMAIN_LABEL}.mobiusboxing.com`. The label
 * is NOT necessarily the module slug (countdown is published as `vencimientos`)
 * — the API path (/api/node-files), the token key (node-files_token) and the
 * whitelabel endpoint all stay on the slug.
 *
 * node-files has no public domain yet (its bucket, distribution and DNS are out
 * of Phase 1's scope), so the label is provisionally the slug. When the product
 * name is chosen, this constant is the only thing that changes.
 */
const DOMAIN_LABEL = "node-files";
const MODULE_SLUG = "node-files";

/**
 * Same base as api/client.ts. In production the SPA and the API sit on
 * different origins, so this fetch is cross-origin too and VITE_API_URL has to
 * reach it.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** What the tab says after the tenant name. */
const TITLE_SUFFIX = "Extracción de documentos";

/** Resolved once per load: the hostname cannot change under a running SPA. */
const TENANT = parseTenantFromHostname(window.location.hostname, {
  domainLabel: DOMAIN_LABEL,
  envTenant: import.meta.env.VITE_TENANT,
});

type BootState =
  | { phase: "loading" }
  | { phase: "ready"; branding: WhitelabelBranding | null }
  | { phase: "unknown" };

const BrandingContext = createContext<WhitelabelBranding | null>(null);

/** null = no tenant in the address, or branding could not be loaded. */
export function useBranding(): WhitelabelBranding | null {
  return useContext(BrandingContext);
}

/**
 * Boot step, above the router: resolve the tenant, fetch its branding, paint
 * it, and only then render the app.
 *
 * Three outcomes, three behaviours:
 * - no tenant in the address (localhost, the bare module domain) → default
 *   branding, app loads. Nothing to look up.
 * - 404 → the address is wrong: the unknown-tenant page INSTEAD of the app.
 * - API unreachable → default branding, app loads. A branding blip must never
 *   brick the SPA, and it is not evidence that the client does not exist.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootState>(
    TENANT === null ? { phase: "ready", branding: null } : { phase: "loading" },
  );

  useEffect(() => {
    if (TENANT === null) return;
    let cancelled = false;

    void fetchBranding(API_BASE, MODULE_SLUG, TENANT).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        applyBranding(result.branding, { titleSuffix: TITLE_SUFFIX });
        setState({ phase: "ready", branding: result.branding });
        return;
      }
      setState(
        result.status === "unknown" ? { phase: "unknown" } : { phase: "ready", branding: null },
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing rather than a spinner or a flash of the default green: the wait is
  // one request against a cached public endpoint, and re-painting the whole
  // chrome a moment later is the jarring option.
  if (state.phase === "loading") return null;
  if (state.phase === "unknown") return <UnknownTenantPage />;

  return <BrandingContext.Provider value={state.branding}>{children}</BrandingContext.Provider>;
}
