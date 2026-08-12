import { ModuleGate } from "@mobius-modules/auth";
import { parseTenantFromHostname } from "@mobius-modules/whitelabel";

// Copy this app to /<slug>/ to start a real module (see README checklist).
const MODULE_SLUG = "template";

export function App() {
  const client = parseTenantFromHostname(window.location.hostname, MODULE_SLUG);

  // Real modules resolve enablement from the JWT/`me` modules list or the
  // module's own session (Q1 in modules.md); the template is always on.
  return (
    <ModuleGate status="enabled">
      <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
        <h1>Módulo: {MODULE_SLUG}</h1>
        <p>Tenant: {client ?? "(sin subdominio de cliente)"}</p>
      </main>
    </ModuleGate>
  );
}
