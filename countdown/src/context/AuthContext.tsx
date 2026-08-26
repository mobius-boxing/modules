import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  clearCachedUser,
  clearToken,
  getToken,
  readCachedUser,
  setToken,
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

  // Trust the cached user for the first paint, then confirm with the server — a
  // token expired since last visit must not leave a ghost session, and the
  // module list may have changed while the tab was closed.
  useEffect(() => {
    let cancelled = false;
    if (getToken() === null) {
      setUser(null);
      setLoading(false);
      return;
    }
    api
      .me()
      .then((fresh) => {
        if (cancelled) return;
        writeCachedUser(USER_KEY, fresh);
        setUser(fresh);
      })
      .catch(() => {
        // A 401 is already handled by the api client: it clears the shared
        // session and sends the tab to /login. Anything else is a blip (offline,
        // CORS, an API restarting) and must NOT sign the user out of every
        // Mobius app — so the session is only dropped when the token is gone.
        if (!cancelled && getToken() === null) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One session, many apps: the login or logout may have happened in another
  // tab, on another subdomain. Re-read the cookie whenever this tab comes back
  // to the front — adopt a session started elsewhere, drop one ended elsewhere.
  useEffect(() => {
    if (loading) return;
    const sync = () => {
      const signedIn = getToken() !== null;
      if (signedIn && !user) {
        api
          .me()
          .then((fresh) => {
            writeCachedUser(USER_KEY, fresh);
            setUser(fresh);
          })
          .catch(() => {});
      } else if (!signedIn && user) {
        clearCachedUser(USER_KEY);
        setUser(null);
      }
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
    // Cookie first: the cached user is stamped with the token it belongs to.
    setToken(result.token);
    writeCachedUser(USER_KEY, result.user);
    setUser(result.user);
  }, []);

  // Ends the session for every Mobius app on the domain, which is the other
  // half of one login: a shared sign-in with a per-app sign-out would leave
  // the user logged in somewhere they thought they had left.
  const logout = useCallback(() => {
    clearToken();
    clearCachedUser(USER_KEY);
    setUser(null);
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
