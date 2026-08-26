import axios, { AxiosInstance } from "axios";

export interface ApiClientOptions {
  /** e.g. import.meta.env.VITE_API_URL — http://localhost:3001 in dev */
  baseUrl: string;
  /**
   * Reads the ecosystem-wide session token. Pass `getToken` from
   * `@mobius-modules/auth`: the session is a cookie on the parent domain, NOT
   * a per-module localStorage key — a namespaced key is per-origin, which is
   * precisely what stopped one login from reaching every app.
   */
  getToken: () => string | null;
  /** Ends that session locally. Pass `clearToken` from `@mobius-modules/auth`. */
  clearToken: () => void;
  /**
   * Paths whose 401s are an inline result (login, password endpoints),
   * NOT session expiry — the caller renders them; the client must not
   * clear auth for these.
   */
  selfHandled401Paths?: string[];
  /** Called when a non-self-handled 401 arrives (session expired). */
  onSessionExpired?: () => void;
}

export function createApiClient(options: ApiClientOptions): AxiosInstance {
  const { baseUrl, getToken, clearToken, selfHandled401Paths = [], onSessionExpired } = options;

  const client = axios.create({ baseURL: baseUrl });

  client.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      const status: number | undefined = error?.response?.status;
      const url: string = error?.config?.url ?? "";
      const selfHandled = selfHandled401Paths.some((p) => url.includes(p));
      if (status === 401 && !selfHandled) {
        // Ends the session for every app on the domain, which is correct: the
        // server has just said this token is no longer good anywhere.
        clearToken();
        onSessionExpired?.();
      }
      return Promise.reject(error);
    },
  );

  return client;
}
