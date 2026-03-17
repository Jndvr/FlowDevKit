import { fetchWithTokens } from "./fetch-utils.js";
import { getCachedDvToken } from "./dv-token-cache.js";

const API_VERSION = "2016-11-01";

export async function handleFetchFlowList(message, sendResponse) {
  const { listUrl, tokens = [] } = message;
  try {
    const result = await fetchWithTokens(listUrl, tokens);
    if (result.failed) {
      sendResponse({ flows: [], error: `HTTP ${result.res?.status}: ${result.body?.slice(0, 200)}` });
      return;
    }
    const data = await result.res.json();
    sendResponse({ flows: data.value || [] });
  } catch (e) {
    sendResponse({ flows: [], error: e.message });
  }
}

export async function handleFetchFlow(message, sendResponse) {
  const { apiUrl, ppApiUrl, previewApiUrl, token, tokens = [], mode = "definition", environmentId, flowId } = message;

  const globalPpUrl = (environmentId && flowId)
    ? `https://api.powerplatform.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=${API_VERSION}`
    : null;

  const urlsToTry = [apiUrl, ppApiUrl, globalPpUrl, previewApiUrl].filter(Boolean);
  const tokenList = tokens.length ? tokens : (token ? [token] : []);

  let lastError = null;
  for (const url of urlsToTry) {
    try {
      const result = await fetchWithTokens(url, tokenList);
      if (result.failed) { lastError = `HTTP ${result.res?.status}${result.body ? ": " + result.body.slice(0, 200) : ""}`; continue; }
      const data = await result.res.json();
      const displayName = data?.properties?.displayName || data?.name || "Unknown";
      const definition = data?.properties?.definition;
      if (!definition) { sendResponse({ error: "API response did not contain a flow definition." }); return; }
      if (mode === "full") {
        const payload = {
          properties: {
            ...(data.properties.connectionReferences ? { connectionReferences: data.properties.connectionReferences } : {}),
            definition,
            ...(data.properties.templateName ? { templateName: data.properties.templateName } : {}),
          },
          ...(data.schemaVersion ? { schemaVersion: data.schemaVersion } : {}),
        };
        sendResponse({ definition: payload, displayName, mode: "full" });
      } else {
        sendResponse({ definition, displayName, mode: "definition" });
      }
      return;
    } catch (err) {
      lastError = err.message;
    }
  }
  sendResponse({ error: lastError || "All API endpoints failed." });
}

export async function handlePatchFlow(message, sendResponse) {
  const { tokens = [], patchBodies, patchUrls, patchUrl } = message;
  const candidates = [...new Set(tokens.filter(Boolean))];
  if (!candidates.length) candidates.push(null);

  const urlsToTry = patchUrls || (patchUrl ? [patchUrl] : []);
  const methods = ["PATCH", "PUT"];
  const bodiesToTry = patchBodies || (message.body ? [message.body] : [{}]);

  const attempts = [];
  let lastStatus = null;
  let lastBody = "";

  for (const url of urlsToTry) {
    let urlDead = false;
    for (const method of methods) {
      if (urlDead) break;
      for (const body of bodiesToTry) {
        if (urlDead) break;
        const bodyJson = JSON.stringify(body);
        const shape = Object.keys(body).join(",");
        let bodyRejected = false;
        for (const tok of candidates) {
          if (bodyRejected) break;
          try {
            const res = await fetch(url, {
              method,
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                ...(tok ? { "Authorization": `Bearer ${tok}` } : {}),
              },
              body: bodyJson,
            });
            lastStatus = res.status;
            lastBody = await res.text().catch(() => "");
            const entry = { method, url: url.slice(0, 90), shape, status: res.status, resp: lastBody.slice(0, 800) || "(empty)" };
            attempts.push(entry);
            if (res.ok) { sendResponse({ ok: true }); return; }

            if (res.status === 400) {
              bodyRejected = true;
            } else if (res.status === 404 || res.status === 405) {
              urlDead = true;
              break;
            } else if (res.status !== 401 && res.status !== 403) {
              break;
            }
          } catch (e) {
            lastBody = e.message;
            attempts.push({ method, url: url.slice(0, 90), shape, status: "ERR", resp: e.message });
            urlDead = true;
            break;
          }
        }
      }
    }
  }
  sendResponse({ ok: false, error: `HTTP ${lastStatus}: ${lastBody || "(empty response)"}`, attempts });
}

export async function handleFetchEnv(message, sendResponse) {
  const { environmentId, tokens = [] } = message;
  const urls = [
    `https://${environmentId}.environment.api.powerplatform.com/usermanagement/environments/${environmentId}?api-version=2022-03-01-preview`,
    `https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments/${environmentId}?api-version=2021-04-01`,
    `https://emea.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}?api-version=2016-11-01`,
  ];
  for (const url of urls) {
    try {
      const result = await fetchWithTokens(url, tokens);
      if (result.failed || !result.res?.ok) continue;
      const body = await result.res.text();
      const data = JSON.parse(body);
      const name = data?.properties?.displayName || data?.displayName || data?.name || null;
      if (name) { sendResponse({ ok: true, name }); return; }
    } catch { }
  }
  sendResponse({ ok: false, name: null });
}

export async function handleFetchRuns(message, sendResponse) {
  const { runsUrl, token, tokens = [] } = message;
  const tokenList = tokens.length ? tokens : (token ? [token] : []);
  try {
    const result = await fetchWithTokens(runsUrl, tokenList);
    if (result.failed) {
      const body = result.body || "";
      sendResponse({ error: `HTTP ${result.res?.status} ${result.res?.statusText}${body ? ": " + body.slice(0, 200) : ""}` });
      return;
    }
    const data = await result.res.json();
    sendResponse({ runs: data.value || [] });
  } catch (err) {
    sendResponse({ error: err.message || "Fetch failed." });
  }
}

export async function handleFetchRunDetail(message, sendResponse) {
  const { runUrl, token, tokens = [] } = message;
  const tokenList = tokens.length ? tokens : (token ? [token] : []);
  try {
    const result = await fetchWithTokens(runUrl, tokenList);
    if (result.failed) {
      const body = result.body || "";
      sendResponse({ error: `HTTP ${result.res?.status} ${result.res?.statusText}${body ? ": " + body.slice(0, 200) : ""}` });
      return;
    }
    const data = await result.res.json();
    sendResponse({ run: data });
  } catch (err) {
    sendResponse({ error: err.message || "Fetch failed." });
  }
}

export async function handleFetchRunIO(message, sendResponse) {
  const { ioUrl } = message;
  try {
    // SAS-signed URLs: auth is in the query string.
    // Must NOT send credentials or Authorization — server returns ACAO: *
    // which is incompatible with credentials: "include".
    const res = await fetch(ioUrl, { method: "GET" });
    if (!res.ok) { sendResponse({ error: `HTTP ${res.status}` }); return; }
    const data = await res.json();
    sendResponse({ data });
  } catch (err) {
    sendResponse({ error: err.message || "Fetch failed." });
  }
}

// ── Dataverse token harvester ─────────────────────────────────────────────────
// Injected into page context via scripting.executeScript — must be fully
// self-contained (no references to the surrounding module scope).
//
// Previous approach matched MSAL's `target` metadata field against instanceHostname.
// That silently fails when Power Apps stores the token with audience
// "orgXXX.api.crm4.dynamics.com" while BAP returns "orgXXX.crm4.dynamics.com" —
// the substring check is false because ".api." sits between the two parts.
//
// New approach: decode the JWT `aud` claim directly.  This is audience-source-of-truth
// and works regardless of MSAL version or metadata format.  We also return the
// aud-derived base URL so the OData call is made at the same origin the token was
// issued for — the only way to avoid a 401.
function _extractDataverseTokensFromPage(orgId) {
  // orgId: e.g. "org7ec5c000" — the first label of instanceHostname
  const results = [];
  const stores = [sessionStorage, localStorage];
  for (const store of stores) {
    for (let i = 0; i < store.length; i++) {
      try {
        const raw = store.getItem(store.key(i));
        if (!raw) continue;
        const entry = JSON.parse(raw);
        const list = Array.isArray(entry) ? entry : [entry];
        for (const e of list) {
          const secret = e.secret || e.access_token || e.credential || e.token;
          if (!secret || typeof secret !== "string" || secret.split(".").length < 3) continue;
          try {
            // Decode JWT payload (base64url → JSON)
            const b64u = secret.split(".")[1];
            const b64  = b64u.replace(/-/g, "+").replace(/_/g, "/");
            const payload = JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
            // aud can be a string or array; normalise to string
            const rawAud = payload.aud;
            const aud = (Array.isArray(rawAud) ? rawAud[0] : String(rawAud || "")).toLowerCase();
            // Must be for this org and for Dataverse
            if (!aud.includes(orgId)) continue;
            if (!aud.includes("dynamics.com")) continue;
            // Must not be expired
            if (payload.exp && payload.exp * 1000 <= Date.now()) continue;
            // Derive base URL: take the origin of the aud claim so that
            // "https://org.api.crm4.dynamics.com/user_impersonation" → "https://org.api.crm4.dynamics.com"
            let apiBase;
            try { apiBase = new URL(aud).origin; } catch { continue; }
            if (!results.find(r => r.token === secret)) {
              results.push({ token: secret, apiBase });
            }
          } catch { /* malformed JWT — skip */ }
        }
      } catch { /* JSON parse error — skip */ }
    }
  }
  return results;
}

async function findDataverseToken(instanceHostname) {
  const orgId = instanceHostname.split(".")[0].toLowerCase(); // "org7ec5c000"
  const urlPatterns = [
    "https://make.powerapps.com/*",
    "https://make.preview.powerapps.com/*",
    "https://*.dynamics.com/*",
  ];
  const all = [];
  try {
    const tabs = await chrome.tabs.query({ url: urlPatterns });
    for (const tab of tabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          func: _extractDataverseTokensFromPage,
          args: [orgId],
        });
        const pairs = results?.[0]?.result || [];
        for (const p of pairs) {
          if (!all.find(x => x.token === p.token)) all.push(p);
        }
      } catch { }
    }
  } catch { }
  return all; // array of { token, apiBase }
}

export async function handleFetchEnvVars(message, sendResponse) {
  const { environmentId, tokens = [] } = message;

  // Step 1: Resolve the Dataverse instance URL via BAP / PP environment APIs
  let instanceUrl = null;
  const envMetaUrls = [
    `https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/environments/${environmentId}?api-version=2021-04-01`,
    `https://${environmentId}.environment.api.powerplatform.com/usermanagement/environments/${environmentId}?api-version=2022-03-01-preview`,
    `https://emea.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}?api-version=2016-11-01`,
  ];
  for (const url of envMetaUrls) {
    try {
      // credentials:"omit" — these return ACAO:* which blocks credentialed requests
      const result = await fetchWithTokens(url, tokens, { credentials: "omit" });
      if (result.failed || !result.res?.ok) continue;
      const data = JSON.parse(await result.res.text());
      instanceUrl = data?.properties?.linkedEnvironmentMetadata?.instanceUrl
                 || data?.properties?.instanceUrl
                 || null;
      if (instanceUrl) break;
    } catch { }
  }

  if (!instanceUrl) {
    sendResponse({ ok: false, error: "Could not resolve Dataverse URL — the environment may not have Dataverse provisioned." });
    return;
  }

  instanceUrl = instanceUrl.replace(/\/$/, ""); // strip trailing slash
  const instanceHostname = instanceUrl.replace(/^https?:\/\//, "").split("/")[0];

  const oDataPath = `/api/data/v9.2/environmentvariabledefinitions` +
    `?$select=displayname,schemaname,type,defaultvalue,description` +
    `&$expand=environmentvariabledefinition_environmentvariablevalue($select=value)` +
    `&$orderby=displayname asc`;

  // Step 2: Try tokens in priority order.
  //
  // (a) webRequest cache — captured passively when any tab hits *.dynamics.com
  const cachedToken = getCachedDvToken(instanceHostname);
  if (cachedToken) {
    try {
      const r = await fetchWithTokens(instanceUrl + oDataPath, [cachedToken], { credentials: "omit" });
      if (!r.failed && r.res?.ok) {
        const data = await r.res.json();
        sendResponse({ ok: true, vars: data.value || [], instanceUrl });
        return;
      }
    } catch { /* fall through */ }
  }

  // (b) Storage scan — decode JWT aud directly so we also find tokens stored under
  //     "orgXXX.api.crm4.dynamics.com" (the .api. subdomain Power Apps uses).
  //     Each pair carries its own apiBase so the request URL matches the token audience.
  const scrapedPairs = await findDataverseToken(instanceHostname);
  for (const { token, apiBase } of scrapedPairs) {
    try {
      const r = await fetchWithTokens(apiBase + oDataPath, [token], { credentials: "omit" });
      if (!r.failed && r.res?.ok) {
        const data = await r.res.json();
        sendResponse({ ok: true, vars: data.value || [], instanceUrl: apiBase });
        return;
      }
    } catch { /* try next */ }
  }

  // (c) Last resort: PA-page tokens against the BAP-resolved URL — expected to 401
  //     for most envs, but included so single-tenant setups that share tokens still work.
  try {
    const r = await fetchWithTokens(instanceUrl + oDataPath, tokens, { credentials: "omit" });
    if (!r.failed && r.res?.ok) {
      const data = await r.res.json();
      sendResponse({ ok: true, vars: data.value || [], instanceUrl });
      return;
    }
    const status = r.res?.status;
    const isAuth = status === 401 || status === 403;
    const hint = isAuth
      ? `Dataverse token not found (scanned ${scrapedPairs.length} tab(s), tried ${tokens.length + scrapedPairs.length} token(s)).`
      : `HTTP ${status}: ${(r.body || "").slice(0, 150)}`;
    sendResponse({ ok: false, error: hint, authRequired: isAuth, instanceUrl });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

export async function handleFetchConnections(message, sendResponse) {
  const { environmentId, connectorName, tokens = [] } = message;
  const ppHost = `${environmentId}.environment.api.powerplatform.com`;
  const apiId = `/providers/Microsoft.PowerApps/apis/${connectorName}`;
  const urls = [
    `https://api.powerapps.com/providers/Microsoft.PowerApps/apis/${connectorName}/connections?api-version=2016-11-01&$filter=environment eq '${environmentId}'`,
    `https://emea.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/connections?api-version=2016-11-01&$filter=apiId eq '${apiId}'`,
    `https://unitedstates.api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/connections?api-version=2016-11-01&$filter=apiId eq '${apiId}'`,
    `https://${ppHost}/connectivity/connectors/${connectorName}/connections?api-version=1`,
    `https://api.powerplatform.com/connectivity/environments/${environmentId}/connectors/${connectorName}/connections?api-version=2022-03-01-preview`,
  ];
  for (const url of urls) {
    try {
      const result = await fetchWithTokens(url, tokens);
      if (result.failed || !result.res?.ok) continue;
      const data = await result.res.json();
      const connections = data?.value || [];
      if (!connections.length) continue;
      const valid = connections.find(c =>
        c.properties?.statuses?.some(s => s.status === "Connected")
      );
      if (valid) {
        sendResponse({ ok: true, connectionName: valid.name, connectionId: valid.id || "" });
        return;
      }
      sendResponse({ ok: true, connectionName: connections[0].name, connectionId: connections[0].id || "" });
      return;
    } catch { }
  }
  sendResponse({ ok: false, connectionName: null });
}
