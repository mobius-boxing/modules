/*
 * Whitelabel plumbing for module SPAs published as
 * `{client}.{domainLabel}.mobiusboxing.com`.
 *
 * The domain label is NOT the module slug. countdown is published as
 * `{client}.vencimientos.mobiusboxing.com` (the product name the client sees)
 * while its API path (`/api/countdown`) and token key (`countdown_token`) stay
 * on the internal slug. Callers pass both, and never assume they match.
 *
 * The hostname is PRESENTATION ONLY — authorization always comes from the JWT
 * (companyId + module enabled). A spoofed Host header gets a logo, never data.
 *
 * No React, no dependencies: this runs before the app does.
 */

/** Branding for one tenant, as returned by the public endpoint. */
export interface WhitelabelBranding {
  companyUuid: string;
  /** The client slug the branding was resolved for. */
  slug: string;
  displayName: string;
  /** `#rrggbb`, or null when the tenant has no colour (CSS defaults stand). */
  brandColor: string | null;
  /**
   * Secondary `#rrggbb` driving the `--accent*` ramp. A tenant that never
   * picked one gets `brandColor` here, so the accent ramp collapses onto the
   * brand ramp and nothing changes visually (D-3). Null only when the brand
   * colour is null too, and then the CSS defaults stand for both.
   */
  accentColor: string | null;
  /** Absolute URL, or null. */
  logoUrl: string | null;
  /** Extra line for the login screen, or null. */
  loginMessage: string | null;
}

/**
 * The three outcomes a caller must tell apart:
 * - `ok`      → brand the app with this.
 * - `unknown` → the ADDRESS is wrong (404): show the unknown-tenant page.
 * - `error`   → the API is unreachable/broken: load the app with defaults.
 *
 * Collapsing the last two (one bare catch returning null) turns every API blip
 * into "this client does not exist", which is a lie and bricks the SPA.
 */
export type TenantResolution =
  | { status: "ok"; branding: WhitelabelBranding }
  | { status: "unknown" }
  | { status: "error" };

export interface TenantParseOptions {
  /** Domain label carrying the module, e.g. "vencimientos" — not the slug. */
  domainLabel: string;
  /** Defaults to "mobiusboxing.com". */
  baseDomain?: string;
  /**
   * Query string the `?tenant=` dev/preview override is read from. Defaults to
   * the browser's current one; pass "" to disable it.
   */
  search?: string;
  /**
   * Build-time override — the caller passes `import.meta.env.VITE_TENANT`, so
   * this package stays free of bundler-specific globals.
   */
  envTenant?: string;
}

const DEFAULT_BASE_DOMAIN = "mobiusboxing.com";
const FETCH_TIMEOUT_MS = 8_000;

/** A DNS label: lowercase alphanumerics and inner hyphens, 1–63 chars. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_LABEL_LENGTH = 63;

/** Hostnames are case-insensitive, so the client slug is normalized to lower. */
function toClientSlug(raw: string): string | null {
  const label = raw.trim().toLowerCase();
  if (label === "" || label.length > MAX_LABEL_LENGTH) return null;
  return DNS_LABEL.test(label) ? label : null;
}

function readTenantParam(search: string): string | null {
  if (search === "") return null;
  const value = new URLSearchParams(search).get("tenant");
  return value !== null && value.trim() !== "" ? value : null;
}

function currentSearch(): string {
  return typeof globalThis.location === "undefined" ? "" : globalThis.location.search;
}

/**
 * Extract the client slug from `{client}.{domainLabel}.{baseDomain}`.
 *
 * Precedence: `?tenant=acme` (dev/preview, and how this is exercised locally)
 * → `VITE_TENANT` (passed in by the caller) → the hostname. An override that
 * is present but not DNS-safe resolves to null rather than silently falling
 * back to the hostname: the intent was explicit, and it failed.
 *
 * Returns null for the bare module domain, localhost/127.0.0.1, an extra label
 * (`a.b.vencimientos…`), a different module's domain, and anything that is not
 * a valid DNS label.
 */
export function parseTenantFromHostname(hostname: string, opts: TenantParseOptions): string | null {
  const override =
    readTenantParam(opts.search ?? currentSearch()) ??
    (opts.envTenant !== undefined && opts.envTenant.trim() !== "" ? opts.envTenant : null);
  if (override !== null) return toClientSlug(override);

  // Strip the port and the (legal, rare) trailing root dot before matching.
  const host = hostname.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = `.${opts.domainLabel}.${opts.baseDomain ?? DEFAULT_BASE_DOMAIN}`.toLowerCase();
  if (!host.endsWith(suffix)) return null;

  const client = host.slice(0, -suffix.length);
  // `a.b.vencimientos…` is not a tenant: exactly one label may precede the
  // module domain (the wildcard cert covers exactly one label anyway).
  if (client.includes(".")) return null;
  return toClientSlug(client);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** `{success:true, data:{…}}` or nothing — anything else is a broken API. */
function readBranding(body: unknown): WhitelabelBranding | null {
  if (typeof body !== "object" || body === null) return null;
  const { success, data } = body as { success?: unknown; data?: unknown };
  if (success !== true || typeof data !== "object" || data === null) return null;

  const record = data as Record<string, unknown>;
  const companyUuid = readString(record.companyUuid);
  const displayName = readString(record.displayName);
  if (companyUuid === null || displayName === null) return null;

  const brandColor = readString(record.brandColor);
  const brand = brandColor !== null && parseHex(brandColor) !== null ? brandColor : null;

  // D-5 re-checked client-side: an older API that sends no accent, or a
  // malformed one, degrades to today's appearance rather than to an unstyled
  // one, because the accent below falls back to `brand` — which the line above
  // has already validated.
  const accentColor = readString(record.accentColor);
  return {
    companyUuid,
    slug: readString(record.slug) ?? "",
    displayName,
    brandColor: brand,
    accentColor: accentColor !== null && parseHex(accentColor) !== null ? accentColor : brand,
    logoUrl: readString(record.logoUrl),
    loginMessage: readString(record.loginMessage),
  };
}

/**
 * Fetch a tenant's branding. Public endpoint: no Authorization header and no
 * cookies — it must work before anybody has logged in.
 *
 * Anything that is not a clean 200 with a well-formed body is an `error`,
 * except 404 which is the one thing the API states about the tenant.
 */
export async function fetchBranding(
  apiBaseUrl: string,
  moduleSlug: string,
  client: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<TenantResolution> {
  const path = `/api/public/whitelabel/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(client)}`;
  // A hung API must not hold the whole SPA on a blank screen.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      signal: controller.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return { status: "unknown" };
    if (!response.ok) return { status: "error" };
    const branding = readBranding((await response.json()) as unknown);
    return branding === null ? { status: "error" } : { status: "ok", branding };
  } catch {
    // Offline, DNS, CORS, malformed JSON or our own abort — all "the API is
    // not answering", which is emphatically not "this client does not exist".
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** The brand ramp a stylesheet needs, derived from one colour. */
export interface BrandRamp {
  /** `--brand` */
  brand: string;
  /** `--brand-strong` — hover. */
  strong: string;
  /** `--brand-press` — active. */
  press: string;
  /** `--brand-soft` — tinted backgrounds. */
  soft: string;
  /** `--brand-tint` — text/pips sitting ON the brand colour. */
  tint: string;
  /** `--brand-ink` — primary text/icon colour on the brand colour. */
  ink: string;
}

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function scale(rgb: [number, number, number], factor: number): [number, number, number] {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor];
}

/** `amount` = how much of the brand survives; the rest is white. */
function mixWithWhite(rgb: [number, number, number], amount: number): [number, number, number] {
  return [
    rgb[0] * amount + 255 * (1 - amount),
    rgb[1] * amount + 255 * (1 - amount),
    rgb[2] * amount + 255 * (1 - amount),
  ];
}

/**
 * One colour in, five out — the API sends `brandColor` and nothing else.
 *
 * Deliberately naive: scale the sRGB channels down for the pressed states and
 * mix toward white for the tints. It is not perceptually uniform the way the
 * hand-tuned oklch defaults in global.css are, but on the module green
 * (#018445) it lands within a couple of percent of them, and it cannot fail on
 * an arbitrary client colour the way a hue-rotation table would. Returns null
 * for anything that is not a hex colour.
 */
/**
 * Relative luminance, WCAG 2.x §relativeluminancedef. Used to decide whether
 * text on the brand colour should be white or near-black.
 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function deriveBrandRamp(brandColor: string): BrandRamp | null {
  const rgb = parseHex(brandColor);
  if (rgb === null) return null;
  return {
    brand: toHex(rgb),
    strong: toHex(scale(rgb, 0.88)),
    press: toHex(scale(rgb, 0.78)),
    soft: toHex(mixWithWhite(rgb, 0.08)),
    tint: toHex(mixWithWhite(rgb, 0.2)),
    /**
     * Foreground for text and icons sitting ON the brand colour. The module's
     * own green is dark, so the stylesheet hardcoded white — but a tenant is
     * free to pick a pale yellow, and white-on-pale-yellow is unreadable. The
     * 0.5 threshold is the usual crossover for "is this a light background".
     */
    ink: relativeLuminance(rgb) > 0.5 ? "#1a1a1a" : "#ffffff",
  };
}

export interface ApplyBrandingOptions {
  /** Appended to the tenant name: "Acme — Documentos por vencer". */
  titleSuffix?: string;
}

function setThemeColor(color: string): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta === null) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/**
 * Paint the tenant onto the document: brand ramp, accent ramp, title, theme
 * colour.
 *
 * The custom properties go on `document.documentElement` as INLINE styles, so
 * they beat the `:root { … }` defaults the module's stylesheet ships without
 * needing `!important` or a second stylesheet.
 *
 * The two ramps are painted INDEPENDENTLY of each other's VALIDITY: an unusable
 * brandColor leaves every `--brand*` at its stylesheet default while a usable
 * accentColor still writes the six `--accent*`, and vice versa.
 *
 * Note the asymmetry the fallback creates. A NULL accentColor is replaced by
 * brandColor (D-3), so the accent ramp is painted FROM the brand colour and the
 * `--accent*` defaults are not what you see. A MALFORMED one is not replaced,
 * and leaves those defaults standing.
 *
 * `readBranding` never hands this function a malformed accent (it collapses one
 * onto the brand value first), but it CAN hand it a null brandColor beside a
 * live accentColor, in all four ways the API's brandColor can fail: absent,
 * null, empty or malformed. D-5 makes that a legal tenant state, so both halves
 * are guarded here. With neither colour usable nothing is painted and both sets
 * of defaults stand.
 */
export function applyBranding(
  branding: WhitelabelBranding,
  options: ApplyBrandingOptions = {},
): void {
  if (typeof document === "undefined") return;

  const ramp = branding.brandColor === null ? null : deriveBrandRamp(branding.brandColor);
  if (ramp !== null) {
    const root = document.documentElement;
    root.style.setProperty("--brand", ramp.brand);
    root.style.setProperty("--brand-strong", ramp.strong);
    root.style.setProperty("--brand-press", ramp.press);
    root.style.setProperty("--brand-soft", ramp.soft);
    root.style.setProperty("--brand-tint", ramp.tint);
    root.style.setProperty("--brand-ink", ramp.ink);
    // The BRAND ramp, never the accent: this is the browser chrome colour and
    // it stays the tenant's primary identity.
    setThemeColor(ramp.brand);
  }

  // Unset accent means "same as the brand colour" (D-3), so the same ramp
  // function runs twice on the same input and the twelve properties match
  // value for value until a tenant picks a second colour.
  const accentSource = branding.accentColor ?? branding.brandColor;
  const accentRamp = accentSource === null ? null : deriveBrandRamp(accentSource);
  if (accentRamp !== null) {
    const root = document.documentElement;
    root.style.setProperty("--accent", accentRamp.brand);
    root.style.setProperty("--accent-strong", accentRamp.strong);
    root.style.setProperty("--accent-press", accentRamp.press);
    root.style.setProperty("--accent-soft", accentRamp.soft);
    root.style.setProperty("--accent-tint", accentRamp.tint);
    root.style.setProperty("--accent-ink", accentRamp.ink);
  }

  const name = branding.displayName.trim();
  if (name !== "") {
    document.title =
      options.titleSuffix === undefined ? name : `${name} — ${options.titleSuffix}`;
  }
}
