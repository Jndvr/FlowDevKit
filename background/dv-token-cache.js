/**
 * background/dv-token-cache.js
 *
 * Passively intercepts outgoing authenticated requests and caches Bearer tokens
 * so they can be reused without DOM injection or MSAL storage access.
 *
 * Two caches:
 *   _dvCache  — Dataverse / Dynamics 365 tokens, keyed by hostname
 *   _paTokens — Power Automate / Power Platform API tokens, stored by value
 *
 * Both listeners are registered synchronously as module side-effects so they
 * are active the moment the service worker boots — before any message handler
 * runs.
 *
 * All intercepted host patterns are already in manifest host_permissions.
 */

// ── Dataverse cache ───────────────────────────────────────────────────────────
const _dvCache = {}; // hostname (lowercase) → { token: string, ts: number }

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    try {
      const auth = details.requestHeaders?.find(
        h => h.name.toLowerCase() === "authorization"
      );
      if (!auth?.value?.startsWith("Bearer ")) return;
      const token = auth.value.slice(7);
      const hostname = new URL(details.url).hostname.toLowerCase();
      // Only cache tokens for Dataverse org URLs (*.crm*.dynamics.com), not
      // generic Azure AD or other *.dynamics.com sub-services.
      if (!hostname.endsWith(".dynamics.com")) return;
      const prev = _dvCache[hostname];
      if (!prev || prev.token !== token) {
        _dvCache[hostname] = { token, ts: Date.now() };
      }
    } catch { }
  },
  { urls: ["https://*.dynamics.com/*"] },
  ["requestHeaders", "extraHeaders"]  // extraHeaders needed for Authorization
);

/**
 * Returns a cached Dataverse Bearer token for the given hostname, or null if
 * none is cached or the cached entry is older than 50 minutes.
 *
 * @param {string} hostname  e.g. "org7ec5c000.crm4.dynamics.com"
 */
export function getCachedDvToken(hostname) {
  const entry = _dvCache[hostname.toLowerCase()];
  if (!entry) return null;
  // Discard entries older than 50 min — well within the standard 1-hour OAuth expiry
  if (Date.now() - entry.ts > 50 * 60 * 1000) return null;
  return entry.token;
}

// ── Power Automate / Power Platform token cache ───────────────────────────────
// Intercepts outgoing requests to PA/PP API endpoints and caches any Bearer
// tokens seen. This is more reliable than MSAL localStorage scraping because
// it is format-agnostic — it works regardless of MSAL version or storage backend
// (localStorage, sessionStorage, or IndexedDB).
//
// Power Automate's own page makes authenticated API calls on load; by the time
// the user opens the extension the cache is already populated.
const _paTokens = new Map(); // token (string) → ts (number)

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    try {
      const auth = details.requestHeaders?.find(
        h => h.name.toLowerCase() === "authorization"
      );
      if (!auth?.value?.startsWith("Bearer ")) return;
      const token = auth.value.slice(7);
      if (token.split(".").length < 3) return; // must be a JWT
      _paTokens.set(token, Date.now());
    } catch { }
  },
  {
    urls: [
      "https://*.api.flow.microsoft.com/*",
      "https://*.environment.api.powerplatform.com/*",
      "https://api.powerplatform.com/*",
      "https://api.bap.microsoft.com/*",
      "https://api.powerapps.com/*",
    ],
  },
  ["requestHeaders", "extraHeaders"]
);

/**
 * Returns all cached Power Automate / Power Platform Bearer tokens that are
 * less than 50 minutes old, evicting stale entries as a side-effect.
 *
 * @returns {string[]}
 */
export function getCachedPaTokens() {
  const cutoff = Date.now() - 50 * 60 * 1000;
  const result = [];
  for (const [token, ts] of _paTokens) {
    if (ts < cutoff) { _paTokens.delete(token); continue; }
    result.push(token);
  }
  return result;
}
