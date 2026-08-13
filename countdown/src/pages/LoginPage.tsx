import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useBranding } from "../context/BrandingContext";

/**
 * The mobius account, not a countdown one: this posts to the host's
 * /api/auth/login. Password recovery lives in the main mobius app, so there is
 * no "olvidé mi contraseña" link here — it would have nowhere to go.
 */
export function LoginPage() {
  const { user, loading, login } = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        {/* The client's own logo, when the whitelabel layer has one. It is
            served from the API's file storage, never bundled with the app. */}
        {branding?.logoUrl ? (
          <img className="login__logo" src={branding.logoUrl} alt={branding.displayName} />
        ) : null}
        <h1 className="login__brand">{branding?.displayName ?? "Countdown"}</h1>
        <p className="login__sub">{branding?.loginMessage ?? "Documentos por vencer"}</p>

        <div className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            name="email"
            data-testid="login-email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            className="input"
            type="password"
            name="password"
            data-testid="login-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? (
          <p className="notice" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="btn btn--primary"
          type="submit"
          data-testid="login-submit"
          disabled={submitting}
        >
          {submitting ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
