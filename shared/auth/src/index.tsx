import { ReactNode } from "react";

/*
 * Who logs into a module (modules.md Q1) is settled: internal mobius users.
 * A module has no user table of its own — it authenticates against the host's
 * /api/auth/login and rides the ecosystem-wide session in ./session.
 */
export * from "./session";
export * from "./tenant";

export type ModuleEnablement = "enabled" | "disabled" | "loading";

export type DeviceStatus = "pending" | "approved" | "revoked";

/**
 * The caller's own browser, as `/api/auth/login` and `/api/auth/me` return it
 * (`device`). Field-for-field the web app's `DeviceSession` — the API contract is
 * one contract, and a module that invents a field here drifts from it. `token`
 * arrives only on the response that issues the secret; the API keeps the hash
 * and cannot produce it again.
 */
export interface DeviceSession {
  uuid: string;
  status: DeviceStatus;
  requestedAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  token?: string;
}

export interface ModuleGateProps {
  /** Resolved from the `modules` list on /api/auth/me. */
  status: ModuleEnablement;
  children: ReactNode;
  /** Rendered while status is "loading"; defaults to nothing. */
  fallback?: ReactNode;
  /**
   * The caller's device from /api/auth/me. A device that exists but is not
   * approved replaces the module with the waiting page: every other call would
   * answer 403, so the shell would otherwise render a screen of errors.
   *
   * `null` passes straight through, and that is deliberate: it is what an admin
   * and a superAdmin always get (neither is ever gated), and this component
   * cannot tell them apart from a member whose browser the API does not
   * recognise (DEVICE_UNKNOWN) — the role is not here. Nothing this component
   * renders can recover it: only a fresh login mints a secret (the module's own
   * login page does), and the web app drives that by dropping the session on
   * DEVICE_UNKNOWN.
   */
  device?: DeviceSession | null;
}

/** Boot gate: renders the module only when it is enabled for the company. */
export function ModuleGate({ status, children, fallback = null, device }: ModuleGateProps) {
  if (status === "loading") return <>{fallback}</>;
  if (status === "disabled") return <NotEnabledPage />;
  if (device != null && device.status !== "approved") {
    return <DeviceNotApprovedPage device={device} />;
  }
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
 * This browser is waiting for an admin to approve it (or has been revoked).
 *
 * Approval happens in the web app only (one queue, one place to look), so this
 * page says where to go and stops there: no polling — the member reloads once
 * the admin says go — and no approve control, which a member could not use
 * anyway.
 */
export function DeviceNotApprovedPage({ device }: { device: DeviceSession }) {
  const revoked = device.status === "revoked";
  return (
    <main style={SHELL_STYLE}>
      <div style={{ textAlign: "center" }}>
        <h1>{revoked ? "Dispositivo revocado" : "Dispositivo pendiente de aprobación"}</h1>
        <p>
          {revoked
            ? "Un administrador revocó el acceso de este navegador. Pide que lo aprueben de " +
              "nuevo para volver a entrar."
            : "Un administrador de tu empresa debe aprobar este navegador antes de que puedas " +
              "usar el módulo."}
        </p>
        <p>
          La aprobación se hace desde la aplicación principal de Mobius. Luego recarga esta
          página.
        </p>
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
