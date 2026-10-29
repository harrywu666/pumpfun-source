/** State from physical factories 683826, 4327 and 875429. The archived revision is not current legal authority. */
export const CLICKWRAP_COOKIE = "clickwrap_accepted";
export const CLICKWRAP_LEGACY_KEY = "show-how-it-works";
export const CLICKWRAP_DATE_KEY = "user-tos-accepted-date";
export const CLICKWRAP_ACCEPTED_EVENT = "pump:clickwrap-accepted";
export const CAPTURED_TERMS_REVISION = "2026-10-17";
export const CLICKWRAP_MAX_AGE = 60 * 60 * 24 * 365;
export const CLICKWRAP_COOKIE_VALUE = `${CLICKWRAP_COOKIE}=true; path=/; max-age=${CLICKWRAP_MAX_AGE}; samesite=lax`;
const OUT_OF_SCOPE_PREFIXES = [
  "/docs",
  "/landing",
  "/u",
  "/join",
  "/livechat",
  "/moderation",
  "/blocked",
  "/r",
  "/voice-chat",
  "/coin-share",
  "/c",
];
const OUT_OF_SCOPE_PROFILE =
  "^/([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})(?:/@([^/]+))?/?$";
export function isClickwrapOutOfScope(pathname: string): boolean {
  return (
    OUT_OF_SCOPE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) || new RegExp(OUT_OF_SCOPE_PROFILE).test(pathname)
  );
}
export interface ClickwrapEnvironment {
  getCookie(): string;
  setCookie(value: string): void;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  now(): Date;
  notifyAccepted(): void;
}
function hasCookie(environment: ClickwrapEnvironment): boolean {
  try {
    return environment
      .getCookie()
      .split("; ")
      .includes(`${CLICKWRAP_COOKIE}=true`);
  } catch {
    return false;
  }
}
function writeCookie(environment: ClickwrapEnvironment): void {
  try {
    environment.setCookie(CLICKWRAP_COOKIE_VALUE);
  } catch {
    /* Storage may still be available as an acceptance fallback. */
  }
}
function hasLegacyValue(environment: ClickwrapEnvironment): boolean {
  try {
    return environment.getItem(CLICKWRAP_LEGACY_KEY) !== null;
  } catch {
    return false;
  }
}
export function readClickwrapAccepted(
  environment: ClickwrapEnvironment,
): boolean {
  return hasCookie(environment) || hasLegacyValue(environment);
}
export function clickwrapAcceptedAt(now: Date): string {
  const revision = new Date(CAPTURED_TERMS_REVISION);
  return (now > revision ? now : revision).toISOString();
}
/** Original migration writes only the cookie, not a new acceptance date. */
export function migrateClickwrapLegacy(
  environment: ClickwrapEnvironment,
): void {
  if (!hasCookie(environment) && hasLegacyValue(environment))
    writeCookie(environment);
}
/** Continue, Escape and backdrop Dismiss all use this same captured transition. */
export function acceptClickwrap(environment: ClickwrapEnvironment): void {
  writeCookie(environment);
  try {
    environment.setItem(CLICKWRAP_LEGACY_KEY, "true");
    environment.setItem(
      CLICKWRAP_DATE_KEY,
      clickwrapAcceptedAt(environment.now()),
    );
  } catch {
    /* Original still notifies when storage is unavailable. */
  }
  environment.notifyAccepted();
}
// Independently written pre-paint code from observed predicates; no captured script is evaluated.
export const CLICKWRAP_STATE_SCRIPT = `(() => { try {
 const root = document.documentElement, pathname = location.pathname, prefixes = ${JSON.stringify(OUT_OF_SCOPE_PREFIXES)};
 if (prefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/')) || new RegExp(${JSON.stringify(OUT_OF_SCOPE_PROFILE)}).test(pathname)) { root.setAttribute('data-clickwrap-oos', ''); return; }
 if (document.cookie.split('; ').includes('${CLICKWRAP_COOKIE}=true')) { root.setAttribute('data-clickwrap-accepted', ''); return; }
 if (root.hasAttribute('data-clickwrap-legacy-accepted')) return;
 try { if (localStorage.getItem('${CLICKWRAP_LEGACY_KEY}') !== null) { document.cookie = ${JSON.stringify(CLICKWRAP_COOKIE_VALUE)}; root.setAttribute('data-clickwrap-legacy-accepted', ''); } } catch {}
} catch {} })();`;
export const CLICKWRAP_INERT_SCRIPT = `(() => { try {
 const root = document.documentElement;
 if (['data-clickwrap-oos', 'data-clickwrap-accepted', 'data-clickwrap-legacy-accepted'].some(name => root.hasAttribute(name))) return;
 const protect = () => { const shell = document.querySelector('[data-app-shell]'); if (!shell) return false; shell.setAttribute('inert', ''); return true; };
 if (!protect()) { const observer = new MutationObserver(() => { if (protect()) observer.disconnect(); }); observer.observe(root, { childList: true, subtree: true }); window.__pumpClickwrapShellObserver = observer; }
} catch {} })();`;
declare global {
  interface Window {
    __pumpClickwrapShellObserver?: MutationObserver | null;
  }
}
export function stopClickwrapPrepaintObserver(): void {
  window.__pumpClickwrapShellObserver?.disconnect();
  window.__pumpClickwrapShellObserver = null;
}
