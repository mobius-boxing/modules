import axios, { AxiosInstance } from "axios";

export interface ApiClientOptions {
  /** e.g. import.meta.env.VITE_API_URL — http://localhost:3001 in dev */
  baseUrl: string;
  /**
   * localStorage key for the JWT. Namespaced PER MODULE (e.g.
   * "<slug>_token") — apps share *.mobiusboxing.com, colliding keys have
   * bitten before (lesson: namespaced localStorage keys).
   */
  tokenStorageKey: string;
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
  const { baseUrl, tokenStorageKey, selfHandled401Paths = [], onSessionExpired } = options;

  const client = axios.create({ baseURL: baseUrl });

  client.interceptors.request.use((config) => {
    const token = localStorage.getItem(tokenStorageKey);
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
        localStorage.removeItem(tokenStorageKey);
        onSessionExpired?.();
      }
      return Promise.reject(error);
    },
  );

  return client;
}
