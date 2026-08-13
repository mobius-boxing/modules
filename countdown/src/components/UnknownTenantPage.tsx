/**
 * The address resolved to a client the API does not know (404). Deliberately
 * vague, exactly like the API's answer: it must not confirm which slugs exist
 * to anyone typing hostnames.
 */
export function UnknownTenantPage() {
  return (
    <main className="login">
      <div className="login__card" role="alert" data-testid="unknown-tenant">
        <h1 className="login__brand">Dirección no reconocida</h1>
        <p className="login__sub">
          Esta dirección no corresponde a ningún cliente. Revisá el enlace o escribile a la persona
          que te lo compartió.
        </p>
      </div>
    </main>
  );
}
