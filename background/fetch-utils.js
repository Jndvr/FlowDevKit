import { logEntry, inferOp, tokenAudience } from "./debug-log.js";

export function makeHeaders(token) {
  const h = { "Accept": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// Try a GET request with each token in order; return first successful response.
// Stops at the first 2xx. Returns { res, tok } on success, or { res, body, failed:true } on failure.
// Each attempt is capped at FETCH_TIMEOUT_MS to prevent hung requests from
// blocking indefinitely (the browser's default can be several minutes).
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchWithTokens(url, tokenList, extraOpts = {}) {
  const candidates = [...new Set(tokenList.filter(Boolean))];
  if (!candidates.length) candidates.push(null); // try once with no token (will likely 401)
  let lastRes = null;
  let lastBody = "";
  // Strip query string from logged URL to avoid leaking api-version or other params
  const urlForLog = url.split("?")[0].slice(0, 90);
  const op = inferOp(url);
  for (const tok of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: makeHeaders(tok),
        signal: controller.signal,
        ...extraOpts,
      });
      clearTimeout(timer);
      const ms = Date.now() - t0;
      logEntry({ op, url: urlForLog, status: res.status, ms, scope: tokenAudience(tok) });
      if (res.ok) {
        // Guard against endpoints that return 200 with an HTML login/redirect page
        // instead of a proper 401. If Content-Type is not JSON, treat as failure.
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json") || ct.includes("application/octet-stream")) {
          return { res, tok };
        }
        // HTML or unexpected content type — read body for diagnostics and fall through
        lastRes = res;
        lastBody = await res.text().catch(() => "");
        logEntry({ op, url: urlForLog, status: res.status, ms, scope: tokenAudience(tok), note: `non-json ct: ${ct.slice(0, 60)}` });
        break; // different tokens won't fix a content-type mismatch
      }
      lastRes = res;
      lastBody = await res.text().catch(() => "");
      // Retry on any auth/forbidden error
      if (res.status !== 401 && res.status !== 403 && res.status !== 400) break;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        logEntry({ op, url: urlForLog, status: 408, ms: FETCH_TIMEOUT_MS, scope: tokenAudience(tok), note: "timeout" });
        lastBody = `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
        lastRes = { status: 408, statusText: "Timeout" };
        break; // no point retrying with other tokens on a timeout
      }
      throw err;
    }
  }
  return { res: lastRes, body: lastBody, failed: true };
}
