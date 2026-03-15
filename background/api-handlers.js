import { fetchWithTokens } from "./fetch-utils.js";

const API_VERSION = "2016-11-01";

export async function handleFetchFlowList(message, sendResponse) {
  const { listUrl, tokens = [] } = message;
  try {
    const result = await fetchWithTokens(listUrl, tokens);
    if (result.failed) {
      console.warn("[FlowKit bg] Flow list fetch failed:", result.res?.status, result.body?.slice(0, 200));
      sendResponse({ flows: [], error: `HTTP ${result.res?.status}: ${result.body?.slice(0, 200)}` });
      return;
    }
    const data = await result.res.json();
    sendResponse({ flows: data.value || [] });
  } catch (e) {
    console.warn("[FlowKit bg] Flow list exception:", e.message);
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
        console.log(`[FlowDevKit PATCH] trying: ${method} ${url}`);
        console.log(`[FlowDevKit PATCH] body shape: ${shape} | size: ${bodyJson.length} bytes`);
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
            console.log("[FlowDevKit PATCH] response:", entry);
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
            console.log("[FlowDevKit PATCH] threw:", e.message);
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
      console.log("[FlowDevKit ENV]", url, "→", result.res?.status, body?.slice(0, 200));
      const data = JSON.parse(body);
      const name = data?.properties?.displayName || data?.displayName || data?.name || null;
      if (name) { sendResponse({ ok: true, name }); return; }
    } catch (e) { console.log("[FlowDevKit ENV] threw:", url, e.message); }
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
      console.log("[FlowDevKit CONN]", url.slice(0, 80), "→", result.res?.status);
      if (result.failed || !result.res?.ok) continue;
      const data = await result.res.json();
      const connections = data?.value || [];
      if (!connections.length) continue;
      const valid = connections.find(c =>
        c.properties?.statuses?.some(s => s.status === "Connected")
      );
      if (valid) {
        console.log("[FlowDevKit CONN] Found connected:", valid.name);
        sendResponse({ ok: true, connectionName: valid.name, connectionId: valid.id || "" });
        return;
      }
      console.log("[FlowDevKit CONN] Fallback to first:", connections[0].name);
      sendResponse({ ok: true, connectionName: connections[0].name, connectionId: connections[0].id || "" });
      return;
    } catch (e) {
      console.log("[FlowDevKit CONN]", url.slice(0, 60), "threw:", e.message);
    }
  }
  console.warn("[FlowDevKit CONN] No connections found for", connectorName);
  sendResponse({ ok: false, connectionName: null });
}
