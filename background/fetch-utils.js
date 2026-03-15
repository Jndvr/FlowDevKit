export function makeHeaders(token) {
  const h = { "Accept": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// Try a GET request with each token in order; return first successful response.
// Stops at the first 2xx. Returns { res, tok } on success, or { res, body, failed:true } on failure.
export async function fetchWithTokens(url, tokenList, extraOpts = {}) {
  const candidates = [...new Set(tokenList.filter(Boolean))];
  if (!candidates.length) candidates.push(null); // try once with no token (will likely 401)
  let lastRes = null;
  let lastBody = "";
  for (const tok of candidates) {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: makeHeaders(tok),
      ...extraOpts,
    });
    if (res.ok) return { res, tok };
    lastRes = res;
    lastBody = await res.text().catch(() => "");
    // Retry on any auth/forbidden error
    if (res.status !== 401 && res.status !== 403 && res.status !== 400) break;
  }
  return { res: lastRes, body: lastBody, failed: true };
}
