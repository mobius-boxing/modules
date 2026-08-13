import { useEffect } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ModuleGate } from "@mobius-modules/auth";
import { setOperatingCompanyUuid } from "./api/client";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useBranding } from "./context/BrandingContext";
import { CategoriesPage } from "./pages/CategoriesPage";
import { GroupsPage } from "./pages/GroupsPage";
import { LoginPage } from "./pages/LoginPage";
import { WorkspacePage } from "./pages/WorkspacePage";

/**
 * Signed in, but is countdown enabled for this company? For a company user the
 * answer rides on the session (`modules` from /api/auth/me), so it costs no
 * extra request.
 *
 * A superAdmin is the exception, and the reason this component is not a
 * one-liner: superAdmins belong to no company, so `/me` always returns
 * `modules: []` and the plain check locked them out of EVERY tenant — including
 * the ones they had just configured. On a tenant hostname the company is the one
 * in the address, and the tenant having resolved at all is itself proof of
 * enablement: `GET /api/public/whitelabel/:module/:client` 404s (→ the
 * unknown-tenant page, never here) unless that module is enabled for that
 * company. So for a superAdmin we trust the resolved tenant and tell the API
 * client which company to operate as.
 *
 * This grants no new access: a superAdmin can already reach any company, and
 * every request is still authorized server-side from the JWT.
 */
function ModuleBoundary({ children }: { children: ReactNode }) {
  const { moduleStatus, user } = useAuth();
  const branding = useBranding();
  const isSuperAdmin = user?.role === "superAdmin";
  const tenantCompanyUuid = branding?.companyUuid ?? null;

  useEffect(() => {
    setOperatingCompanyUuid(isSuperAdmin ? tenantCompanyUuid : null);
    return () => setOperatingCompanyUuid(null);
  }, [isSuperAdmin, tenantCompanyUuid]);

  const status =
    isSuperAdmin && tenantCompanyUuid !== null ? "enabled" : moduleStatus;

  return (
    <ModuleGate status={status} fallback={<div className="page-loading">Cargando…</div>}>
      {children}
    </ModuleGate>
  );
}

/**
 * Every path linked from the nav (components/Layout) appears here — a nav entry
 * without a route is a dead link (lesson L-011). The admin screens sit behind
 * ProtectedRoute like everything else; the API enforces the admin check itself,
 * so a member who types the URL gets an error rather than data.
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <ModuleBoundary>
                  <Layout />
                </ModuleBoundary>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<WorkspacePage />} />
            <Route path="/rubros" element={<CategoriesPage />} />
            <Route path="/grupos" element={<GroupsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
