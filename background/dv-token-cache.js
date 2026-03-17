/**
 * background/dv-token-cache.js
 *
 * Passively intercepts every request to *.dynamics.com (Dataverse OData,
 * Dynamics 365, model-driven apps) and caches the Bearer token so that
 * handleFetchEnvVars can reuse it without any user interaction.
 *
 * The listener is registered synchronously as a module side-effect so it is
 * active the moment the service worker boots — before any message handler runs.
 *
 * Host-permission requirement (Chrome enforces both sides of a cross-origin
 * request for webRequest since Chrome 72):
 *   *.dynamics.com   — already in manifest host_permissions
 *   make.powerapps.com — already in manifest host_permissions
 */

const _cache = {}; // hostname (lowercase) → { token: string, ts: number }

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
      const prev = _cache[hostname];
      if (!prev || prev.token !== token) {
        _cache[hostname] = { token, ts: Date.now() };
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
  const entry = _cache[hostname.toLowerCase()];
  if (!entry) return null;
  // Discard entries older than 50 min — well within the standard 1-hour OAuth expiry
  if (Date.now() - entry.ts > 50 * 60 * 1000) return null;
  return entry.token;
}
