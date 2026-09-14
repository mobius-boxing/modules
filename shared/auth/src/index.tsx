import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { deviceNotApprovedCopy } from "./session";

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
   * `null` on its own is ambiguous between an admin/superAdmin (never gated,
   * this is their permanent value) and a member with no row yet — the role is
   * not carried on the session type. `role` below resolves that.
   */
  device?: DeviceSession | null;
  /**
   * From /api/auth/me, so `device === null` can be read correctly: for a
   * `member` it means "no row yet" (gate amendment 3 registers one via
   * `requestDevice`); for anyone else `null` is permanent and passes through.
   * Omit it and a `member`'s `null` passes through too, matching this
   * component's behaviour before gate amendment 3.
   */
  role?: "member" | "admin" | "superAdmin";
  /**
   * `POST /api/auth/device`, wired to the caller's own client (this package
   * has no axios dependency — see `requestDevice`'s own doc). Required to
   * register a member's browser automatically or to offer the waiting page's
   * retry button; without it the page still renders but neither can happen.
   */
  requestDevice?: () => Promise<DeviceSession | null>;
}

/** Boot gate: renders the module only when it is enabled for the company. */
export function ModuleGate({
  status,
  children,
  fallback = null,
  device,
  role,
  requestDevice: requestDeviceFn,
}: ModuleGateProps) {
  if (status === "loading") return <>{fallback}</>;
  if (status === "disabled") return <NotEnabledPage />;
  if (role === "member" && device === null) {
    return <DeviceNotApprovedPage device={null} requestDevice={requestDeviceFn} />;
  }
  if (device != null && device.status !== "approved") {
    return <DeviceNotApprovedPage device={device} requestDevice={requestDeviceFn} />;
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
 * This browser is waiting for an admin to approve it, has been revoked, has no
 * row at all yet (`device === null`), or failed to register.
 *
 * Approval itself happens in the Mobius backoffice, not here or in the web
 * app (D-231) — one queue, one place to look — so this page never polls and
 * offers no approve control, which a member could not use anyway. What it
 * does do, since gate amendment 3 (D-230): a `null` device means nothing has
 * ever asked the API to create a row for this browser, so it asks once on
 * mount, and the "Solicitar aprobación" button repeats that same call — the
 * only way out of `revoked` too (I-19's revoked → pending re-request), since a
 * module has no login page of its own to force a re-login through.
 */
export function DeviceNotApprovedPage({
  device,
  requestDevice: requestDeviceFn,
}: {
  device: DeviceSession | null;
  requestDevice?: () => Promise<DeviceSession | null>;
}) {
  const [session, setSession] = useState<DeviceSession | null>(device);
  const [requestFailed, setRequestFailed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  // Guards the auto-request on mount independently of `session`: the request
  // always resolves to a session (case 3 mints one), so gating on "session is
  // still null" would look identical to "never asked" and can't tell a slow
  // response apart from one worth retrying automatically.
  const autoRequested = useRef(false);

  const request = useCallback(() => {
    if (!requestDeviceFn) return;
    setRequestFailed(false);
    setRequesting(true);
    requestDeviceFn()
      .then(setSession)
      .catch(() => setRequestFailed(true))
      .finally(() => setRequesting(false));
  }, [requestDeviceFn]);

  useEffect(() => {
    if (device === null && !autoRequested.current) {
      autoRequested.current = true;
      request();
    }
  }, [device, request]);

  const copy = deviceNotApprovedCopy(session, requestFailed, requesting);
  if (copy === "loading") {
    return (
      <main style={SHELL_STYLE}>
        <p>Solicitando aprobación…</p>
      </main>
    );
  }

  return (
    <main style={SHELL_STYLE}>
      <div style={{ textAlign: "center" }}>
        <h1>{copy.heading}</h1>
        <p>{copy.description}</p>
        {requestFailed ? <p>No se pudo solicitar la aprobación. Intenta de nuevo.</p> : null}
        {requestDeviceFn ? (
          <button type="button" onClick={request}>
            Solicitar aprobación
          </button>
        ) : (
          <>
            <button type="button" disabled>
              Solicitar aprobación
            </button>
            <p>Abre la aplicación principal de Mobius para continuar.</p>
          </>
        )}
        <p>
          La aprobación la hace un administrador desde el backoffice de Mobius. Luego recarga
          esta página.
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
