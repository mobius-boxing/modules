import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useBranding } from "../context/BrandingContext";
import { displayName } from "../types/api";

/**
 * Two screens, two entries. Every destination here must exist in the router
 * (App.tsx) — lesson L-011, a nav link with no route shipped once and went
 * unnoticed for months.
 *
 * There is no "Usuarios" entry: mobius owns identity, and the profile lives in
 * the main mobius app.
 */
const NAV = [
  { to: "/flujos", label: "Flujos" },
  { to: "/ejecuciones", label: "Ejecuciones" },
];

export function Layout() {
  const { user, logout } = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <span className="brand brand--with-nav">
            {/* The client's own logo carries the branding once they are inside
                the app. The wordmark is the fallback when a tenant has no logo
                (or there is no tenant at all), so the bar is never empty. */}
            {branding?.logoUrl ? (
              <img
                className="brand__logo"
                src={branding.logoUrl}
                alt={branding.displayName ?? "Node Files"}
              />
            ) : (
              <span className="brand__wordmark">{branding?.displayName ?? "Node Files"}</span>
            )}
          </span>

          <nav className="topbar__nav" aria-label="Navegación">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={`nav-${item.to.slice(1)}`}
                className={({ isActive }) => (isActive ? "navlink navlink--active" : "navlink")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <span className="topbar__user">{user ? displayName(user) : ""}</span>
          <button
            type="button"
            className="btn btn--quiet"
            data-testid="logout"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            Salir
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
