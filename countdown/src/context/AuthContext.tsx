import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  clearCachedUser,
  readCachedUser,
  writeCachedUser,
} from "@mobius-modules/auth";
import type { ModuleEnablement } from "@mobius-modules/auth";
import { api, USER_KEY } from "../api/client";
import type { AuthUser } from "../types/api";

/** Matches the `modules` row seeded by mobius-api and the /api/countdown mount. */
export const MODULE_SLUG = "countdown";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /**
   * admin or superAdmin. UI only — the API gates every write with
   * requirePermission("countdown.manage") no matter what this says.
   */
  isAdmin: boolean;
  /** Fed to <ModuleGate>: is countdown enabled for this user's company? */
  moduleStatus: ModuleEnablement;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Mobius SSO: the module has no users of its own. The token comes from the
 * host's /api/auth/login and carries the company plus its enabled modules, so
 * both the session and the module gate are answered by the same round trip.
 *
 * That token IS the ecosystem session — the `mobius_session` cookie on
 * `.mobiusboxing.com`, the same one the web app and the backoffice read. Signing
 * in here signs you in everywhere; signing out here signs you out everywhere.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readCachedUser<AuthUser>(USER_KEY));
  const [loading, setLoading] = useState(true);

  // Trust the cached user for the first paint, then confirm with the server. The access
  // token is memory-only, so the refresh cookie is traded for one first: a dead session
  // must not leave a ghost user, and the module list may have changed while the tab was closed.
  useEffect(() => {
    let cancelled = false;
    api
      .restoreSession()
      .then((restored) => (restored ? api.me() : null))
      .then((fresh) => {
        if (cancelled) return;
        if (fresh === null) {
          clearCachedUser(USER_KEY);
          setUser(null);
        } else {
          writeCachedUser(USER_KEY, fresh);
          setUser(fresh);
        }
      })
      .catch(() => {
        // A 401 is already handled by the api client. Anything else is a blip (offline,
        // CORS, an API restarting) and must NOT sign the user out: keep what is painted.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One session, many apps: the login may have happened in another tab, on another
  // subdomain. A signed-out tab coming back to the front tries to adopt it. A logout
  // elsewhere surfaces on this tab's next request, whose refresh 401s.
  useEffect(() => {
    if (loading) return;
    const sync = () => {
      if (user) return;
      api
        .restoreSession()
        .then((restored) => (restored ? api.me() : null))
        .then((fresh) => {
          if (fresh === null) return;
          writeCachedUser(USER_KEY, fresh);
          setUser(fresh);
        })
        .catch(() => {});
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [user, loading]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    writeCachedUser(USER_KEY, result.user);
    setUser(result.user);
  }, []);

  // Ends the session for every Mobius app on the domain, which is the other
  // half of one login: a shared sign-in with a per-app sign-out would leave
  // the user logged in somewhere they thought they had left.
  const logout = useCallback(() => {
    clearCachedUser(USER_KEY);
    setUser(null);
    void api.logout();
  }, []);

  const value = useMemo<AuthState>(() => {
    const modules = user?.modules ?? [];
    return {
      user,
      loading,
      isAdmin: user?.role === "admin" || user?.role === "superAdmin",
      moduleStatus: loading
        ? "loading"
        : modules.includes(MODULE_SLUG)
          ? "enabled"
          : "disabled",
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
