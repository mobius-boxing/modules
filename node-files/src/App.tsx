import { useEffect } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ModuleGate } from "@mobius-modules/auth";
import { setOperatingCompanyUuid } from "./api/client";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useBranding } from "./context/BrandingContext";
import { LoginPage } from "./pages/LoginPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { WorkflowEditorPage } from "./pages/WorkflowEditorPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";

/**
 * Signed in, but is node-files enabled for this company? For a company user the
 * answer rides on the session (`modules` from /api/auth/me), so it costs no
 * extra request.
 *
 * A superAdmin is the exception, and the reason this component is not a
 * one-liner: superAdmins belong to no company, so `/me` always returns
 * `modules: []` and the plain check locks them out of EVERY tenant — including
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

  const status = isSuperAdmin && tenantCompanyUuid !== null ? "enabled" : moduleStatus;

  return (
    <ModuleGate status={status} fallback={<div className="page-loading">Cargando…</div>}>
      {children}
    </ModuleGate>
  );
}

/**
 * Every path linked from the nav (components/Layout) appears here — a nav entry
 * without a route is a dead link (lesson L-011). "/" is not a screen of its own:
 * the workflows list is the home of the module.
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
            <Route path="/" element={<Navigate to="/flujos" replace />} />
            <Route path="/flujos" element={<WorkflowsPage />} />
            <Route path="/flujos/nuevo" element={<WorkflowEditorPage />} />
            <Route path="/flujos/:uuid" element={<WorkflowEditorPage />} />
            <Route path="/ejecuciones" element={<RunsPage />} />
            <Route path="/ejecuciones/:uuid" element={<RunDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/flujos" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
