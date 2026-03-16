/**
 * background/debug-log.js — Circular buffer for recent API call diagnostics.
 *
 * Each entry records: operation type, URL (query-string stripped), HTTP status,
 * elapsed ms, token audience (scope), and a wall-clock timestamp.
 * The buffer is capped at MAX_ENTRIES; oldest entries are dropped automatically.
 *
 * Entries are exposed via the GET_DEBUG_LOG message and surfaced to the user
 * through the "Copy debug log" button in the Settings overlay.
 */

const MAX_ENTRIES = 30;
const _log = [];

/** Append one diagnostic entry. Automatically trims the buffer. */
export function logEntry(entry) {
  _log.push({ ...entry, ts: new Date().toISOString().slice(11, 19) }); // HH:MM:SS
  if (_log.length > MAX_ENTRIES) _log.shift();
}

/** Return a snapshot of all buffered entries (oldest first). */
export function getLog() {
  return [..._log];
}

/**
 * Safely decode the `aud` claim from a JWT without importing a full JWT library.
 * Returns only the audience hostname (e.g. "service.flow.microsoft.com"),
 * never any sensitive payload data.
 */
export function tokenAudience(token) {
  if (!token) return "no-token";
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    return String(aud || "").replace(/^https?:\/\//, "").split("/")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Infer a short operation label from the request URL so callers don't need
 * to pass an explicit op name.
 */
export function inferOp(url) {
  if (/\/runs\/[^/?]+/.test(url))              return "RUN_DETAIL";
  if (/\/runs/.test(url))                      return "FETCH_RUNS";
  if (/\/flows\/[^/?]+/.test(url))             return "FETCH_FLOW";
  if (/\/flows/.test(url))                     return "FLOW_LIST";
  if (/usermanagement|BusinessAppPlatform|\.environment\.api\.powerplatform\.com\/[^f]/.test(url)) return "FETCH_ENV";
  if (/connections/.test(url))                 return "CONNECTIONS";
  return "API";
}
