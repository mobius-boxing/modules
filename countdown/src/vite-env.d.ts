/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute API base for a bundle hosted somewhere other than the API itself
   * (see src/api/client.ts). Unset — the normal case — means same-origin /api.
   */
  readonly VITE_API_URL?: string;
  /**
   * Dev/preview only: pretend the app is served from
   * `{VITE_TENANT}.vencimientos.mobiusboxing.com` so branding can be exercised
   * on localhost. `?tenant=<slug>` in the URL wins over it. Never set in a
   * production build — the hostname is the source of truth there.
   */
  readonly VITE_TENANT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
