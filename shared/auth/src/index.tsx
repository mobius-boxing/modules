import { ReactNode } from "react";

/*
 * ⚠ Q1 (modules.md) is UNRESOLVED: who logs into the first module —
 * internal users (SSO with mobius users + JWT `modules` claim) or an
 * external population (own user table + auth, like the store had)?
 * Everything session-shaped in this package waits on that answer.
 * What's here now is only the module gate, which both paths need.
 */

export type ModuleEnablement = "enabled" | "disabled" | "loading";

export interface ModuleGateProps {
  /**
   * Resolve from the JWT/`me` modules list (internal users) or the
   * module's own session endpoint (external users) — per Q1.
   */
  status: ModuleEnablement;
  children: ReactNode;
  /** Rendered while status is "loading"; defaults to nothing. */
  fallback?: ReactNode;
}

/** Boot gate: renders the module only when it is enabled for the company. */
export function ModuleGate({ status, children, fallback = null }: ModuleGateProps) {
  if (status === "loading") return <>{fallback}</>;
  if (status === "disabled") return <NotEnabledPage />;
  return <>{children}</>;
}

/**
 * Generic "module not enabled" page. Deliberately says nothing about WHY
 * (the API answers a generic 401 for disabled modules — don't leak more
 * here than it does).
 */
export function NotEnabledPage() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1>Módulo no disponible</h1>
        <p>Este módulo no está habilitado para tu empresa. Contacta a tu administrador.</p>
      </div>
    </main>
  );
}
