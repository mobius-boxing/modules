import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useBranding } from "../context/BrandingContext";
import { displayName } from "../types/api";

/**
 * For everyone who just files documents there is still one screen and no
 * navigation. Admins additionally get the two management screens, so the links
 * only appear for them — the daily user's view stays as simple as it was.
 *
 * Every destination here must exist in the router (App.tsx) — lesson L-011.
 * There is no "Usuarios" entry: mobius owns identity, and the profile lives in
 * the main mobius app.
 */
const ADMIN_NAV = [
  { to: "/", label: "Vencimientos", end: true },
  { to: "/rubros", label: "Rubros", end: false },
  { to: "/grupos", label: "Grupos", end: false },
];

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();

  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <span className={isAdmin ? "brand brand--with-nav" : "brand"}>
            {/* The client's own logo carries the branding once they are inside
                the app, not just on the login screen — the header is the one
                thing on every page. The wordmark is the fallback when a tenant
                has no logo (or none at all), so the bar is never empty. */}
            {branding?.logoUrl ? (
              <img
                className="brand__logo"
                src={branding.logoUrl}
                alt={branding.displayName ?? "Countdown"}
              />
            ) : (
              <span className="brand__wordmark">{branding?.displayName ?? "Countdown"}</span>
            )}
          </span>

          {isAdmin ? (
            <nav className="topbar__nav" aria-label="Navegación">
              {ADMIN_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? "navlink navlink--active" : "navlink")}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : null}

          <span className="topbar__user">{user ? displayName(user) : ""}</span>
          <button
            type="button"
            className="btn btn--quiet"
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
