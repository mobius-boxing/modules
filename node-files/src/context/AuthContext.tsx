import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ModuleEnablement } from "@mobius-modules/auth";
import { api, TOKEN_KEY, USER_KEY } from "../api/client";
import type { AuthUser } from "../types/api";

/** Matches the `modules` row seeded by mobius-api and the /api/node-files mount. */
export const MODULE_SLUG = "node-files";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /**
   * admin or superAdmin. UI only — the API gates the destructive writes with
   * requirePermission("node-files.manage") no matter what this says.
   */
  isAdmin: boolean;
  /** Fed to <ModuleGate>: is node-files enabled for this user's company? */
  moduleStatus: ModuleEnablement;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

/**
 * Mobius SSO: the module has no users of its own. The token comes from the
 * host's /api/auth/login and carries the company plus its enabled modules, so
 * both the session and the module gate are answered by the same round trip.
 *
 * (The "Q1 unresolved" comments still sitting in shared/auth are stale — the
 * question was answered on 2026-08-12 and this is the answer, copied from
 * countdown rather than invented a second time.)
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);
  const [loading, setLoading] = useState(true);

  // Trust localStorage for the first paint, then confirm with the server — a
  // token expired since last visit must not leave a ghost session, and the
  // module list may have changed while the tab was closed.
  useEffect(() => {
    let cancelled = false;
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((fresh) => {
        if (cancelled) return;
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        setUser(fresh);
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(() => {
    const modules = user?.modules ?? [];
    return {
      user,
      loading,
      isAdmin: user?.role === "admin" || user?.role === "superAdmin",
      moduleStatus: loading ? "loading" : modules.includes(MODULE_SLUG) ? "enabled" : "disabled",
      login,
      logout,
    };
  }, [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return context;
}
