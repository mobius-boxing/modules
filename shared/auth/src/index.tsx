import { ReactNode } from "react";

/*
 * Who logs into a module (modules.md Q1) is settled: internal mobius users.
 * A module has no user table of its own — it authenticates against the host's
 * /api/auth/login and rides the ecosystem-wide session in ./session.
 */
export * from "./session";
export * from "./tenant";

export type ModuleEnablement = "enabled" | "disabled" | "loading";

export interface ModuleGateProps {
  /** Resolved from the `modules` list on /api/auth/me. */
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

const SHELL_STYLE = {
  display: "grid",
  placeItems: "center",
  minHeight: "100vh",
  fontFamily: "sans-serif",
} as const;

/**
 * Generic "module not enabled" page. Deliberately says nothing about WHY
 * (the API answers a generic 401 for disabled modules — don't leak more
 * here than it does).
 */
export function NotEnabledPage() {
  return (
    <main style={SHELL_STYLE}>
      <div style={{ textAlign: "center" }}>
        <h1>Módulo no disponible</h1>
        <p>Este módulo no está habilitado para tu empresa. Contacta a tu administrador.</p>
      </div>
    </main>
  );
}

/**
 * The session belongs to a different company than the tenant in the address.
 *
 * Only reachable because the session is shared across the whole domain: before
 * that, another company's tenant simply showed a login form. Signing out is the
 * only way forward from here, so this page offers it — otherwise the visitor is
 * stuck on a screen with no controls.
 */
export function WrongWorkspacePage({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <main style={SHELL_STYLE}>
      <div style={{ textAlign: "center" }}>
        <h1>Espacio de otra empresa</h1>
        <p>
          Tu sesión pertenece a otra empresa. Cierra sesión para entrar con una cuenta de este
          espacio.
        </p>
        {onSignOut ? (
          <button type="button" onClick={onSignOut}>
            Cerrar sesión
          </button>
        ) : null}
      </div>
    </main>
  );
}
