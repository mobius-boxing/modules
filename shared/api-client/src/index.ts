import axios, { AxiosInstance } from "axios";

const CSRF_HEADERS = { "X-Requested-With": "mobius" };
const MAX_TRANSIENT_RETRIES = 3;
const REFRESH_LEAD_SECONDS = 60;
const REFRESH_JITTER_SECONDS = 30;

/** What login, accept-invitation and refresh all answer with, as far as the session needs. */
export interface RefreshPayload {
  token: string;
  expiresIn: number;
}

/** The refresh cookie is gone, expired or revoked: the user has to sign in again. */
export class SessionEndedError extends Error {}

export interface SessionRefresher<T extends RefreshPayload> {
  /** Single-flight: the timer, the bootstrap and the 401 interceptor share one request per tab. */
  refresh: () => Promise<T>;
  /** Arms the pre-expiry refresh from a login/refresh `expiresIn`. */
  schedule: (expiresIn: number) => void;
  cancel: () => void;
}

export interface SessionRefresherOptions {
  baseUrl: string;
  setToken: (token: string) => void;
  clearToken: () => void;
  /** Called when the background (timer) refresh finds the session ended. */
  onSessionEnded?: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransient = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
};

const retryDelayMs = (error: unknown, attempt: number): number => {
  const retryAfter = axios.isAxiosError(error)
    ? Number(error.response?.headers?.["retry-after"])
    : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 10) * 1000;
  return 500 * 2 ** attempt + Math.random() * 500;
};

export function createSessionRefresher<T extends RefreshPayload>(
  options: SessionRefresherOptions,
): SessionRefresher<T> {
  const { baseUrl, setToken, clearToken, onSessionEnded } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<T> | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const request = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        // Bare axios: a client's interceptors would attach the dead bearer and re-enter this flow.
        const response = await axios.post<{ data: T }>(`${baseUrl}/api/auth/refresh`, undefined, {
          withCredentials: true,
          headers: CSRF_HEADERS,
        });
        return response.data.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          throw new SessionEndedError();
        }
        if (!isTransient(error) || attempt >= MAX_TRANSIENT_RETRIES) throw error;
        await sleep(retryDelayMs(error, attempt));
      }
    }
  };

  const schedule = (expiresIn: number) => {
    cancel();
    const jitter = (Math.random() * 2 - 1) * REFRESH_JITTER_SECONDS;
    const delayMs = Math.max(5, expiresIn - REFRESH_LEAD_SECONDS + jitter) * 1000;
    timer = setTimeout(() => {
      refresh().catch((error) => {
        if (error instanceof SessionEndedError) onSessionEnded?.();
      });
    }, delayMs);
  };

  const refresh = (): Promise<T> => {
    if (inFlight === null) {
      inFlight = request()
        .then((session) => {
          setToken(session.token);
          schedule(session.expiresIn);
          return session;
        })
        .catch((error) => {
          if (error instanceof SessionEndedError) {
            clearToken();
            cancel();
          }
          throw error;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  return { refresh, schedule, cancel };
}

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
  /** Renews the access token on a 401, once per request. See `createSessionRefresher`. */
  refresher: Pick<SessionRefresher<RefreshPayload>, "refresh">;
  /**
   * Reads the device secret an admin approved for this browser. Pass
   * `getDeviceToken` from `@mobius-modules/auth`: without the header the API
   * answers 403 DEVICE_UNKNOWN to every call a member makes, whatever the
   * session says.
   */
  getDeviceToken?: () => string | null;
  /**
   * Paths whose 401s are an inline result (login, password endpoints),
   * NOT session expiry — the caller renders them; the client must not
   * clear auth for these.
   */
  selfHandled401Paths?: string[];
  /** Called when a non-self-handled 401 arrives (session expired). */
  onSessionExpired?: () => void;
}

const NEVER_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/logout"];

export function createApiClient(options: ApiClientOptions): AxiosInstance {
  const {
    baseUrl,
    getToken,
    clearToken,
    refresher,
    getDeviceToken,
    selfHandled401Paths = [],
    onSessionExpired,
  } = options;

  const client = axios.create({
    baseURL: baseUrl,
    withCredentials: true,
    headers: CSRF_HEADERS,
  });

  client.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const deviceToken = getDeviceToken?.();
    if (deviceToken) {
      config.headers["X-Device-Token"] = deviceToken;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status: number | undefined = error?.response?.status;
      const url: string = error?.config?.url ?? "";
      const selfHandled = selfHandled401Paths.some((p) => url.includes(p));
      if (
        status === 401 &&
        error.config &&
        !error.config.retriedAfterRefresh &&
        !NEVER_REFRESH_PATHS.some((p) => url.includes(p))
      ) {
        try {
          const session = await refresher.refresh();
          error.config.retriedAfterRefresh = true;
          error.config.headers.Authorization = `Bearer ${session.token}`;
          return client.request(error.config);
        } catch (refreshError) {
          // Throttled or offline: the session may well be alive, so surface the original failure.
          if (!(refreshError instanceof SessionEndedError)) return Promise.reject(error);
        }
      }
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
