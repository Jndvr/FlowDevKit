/**
 * popup/context.js — Flow context resolution, token extraction, URL parsing, API URL building
 */
import { REGION_HOSTS, API_VERSION } from "../shared/constants.js";
import { getRegion } from "./prefs.js";

// ── Last known Power Automate tab ID ─────────────────────────────────────────
// Exported so toast reload handler and tab listeners in popup.js can use it.
export let lastPaTabId = null;
export function setLastPaTabId(id) { lastPaTabId = id; }

// ── API URL builder ───────────────────────────────────────────────────────────
export function getApiHost() {
  const customHost = document.getElementById("customHost");
  const custom = customHost?.value.trim();
  if (custom) {
    const stripped = custom.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    // Validate: must be a well-formed hostname (letters, digits, dots, hyphens only).
    // Rejects javascript: URIs, path-only strings, and other non-hostname input.
    if (/^[a-z0-9]([a-z0-9.\-]*[a-z0-9])?$/i.test(stripped) && stripped.includes(".")) {
      return stripped;
    }
    console.warn("[FlowKit] Custom host is not a valid hostname, ignoring:", custom);
  }
  return REGION_HOSTS[getRegion()] || REGION_HOSTS.emea;
}

export function buildApiUrl(flowId, environmentId) {
  const host = getApiHost();
  const ppHost = `${environmentId}.environment.api.powerplatform.com`;
  return {
    apiUrl: `https://${host}/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=${API_VERSION}`,
    ppApiUrl: `https://${ppHost}/flow/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=${API_VERSION}`,
    previewApiUrl: `https://make.preview.powerapps.com/api/v1/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=${API_VERSION}`,
  };
}

// ── URL parsing ───────────────────────────────────────────────────────────────
export function parseFlowUrl(url) {
  const paMatch = url.match(
    /make\.powerautomate\.com\/environments\/([^/?#]+)\/flows\/([^/?#]+)/i
  );
  if (paMatch) return { environmentId: paMatch[1], flowId: paMatch[2] };

  const paSolutionMatch = url.match(
    /make\.powerautomate\.com\/environments\/([^/?#]+)\/solutions\/[^/?#]+\/flows\/([^/?#]+)/i
  );
  if (paSolutionMatch) return { environmentId: paSolutionMatch[1], flowId: paSolutionMatch[2] };

  const appsMatch = url.match(
    /make\.powerapps\.com\/environments\/([^/?#]+)\/solutions\/[^/?#]+\/objects\/cloudflows\/([^/?#]+)/i
  );
  if (appsMatch) return { environmentId: appsMatch[1], flowId: appsMatch[2] };

  const appsPreviewMatch = url.match(
    /make\.preview\.powerapps\.com\/environments\/([^/?#]+)\/solutions\/[^/?#]+\/objects\/cloudflows\/([^/?#]+)/i
  );
  if (appsPreviewMatch) return { environmentId: appsPreviewMatch[1], flowId: appsPreviewMatch[2] };

  const appsPreviewBareMatch = url.match(
    /make\.preview\.powerapps\.com\/environments\/([^/?#]+)/i
  );
  if (appsPreviewBareMatch) return { environmentId: appsPreviewBareMatch[1], flowId: null, needsScrapedFlowId: true };

  const previewWidgetMatch = url.match(
    /make\.preview\.powerapps\.com\/widget\/environments\/([^/?#]+)\/projects\/[^/?#]+\/objects\/cloudflows\/([^/?#]+)/i
  );
  if (previewWidgetMatch) return { environmentId: previewWidgetMatch[1], flowId: previewWidgetMatch[2] };

  const previewWidgetBareMatch = url.match(
    /make\.preview\.powerapps\.com\/widget\/environments\/([^/?#]+)/i
  );
  if (previewWidgetBareMatch) return { environmentId: previewWidgetBareMatch[1], flowId: null, needsScrapedFlowId: true };

  const csMatch = url.match(
    /copilotstudio\.microsoft\.com\/environments\/([^/?#]+)\/flows\/([^/?#]+)/i
  );
  if (csMatch) return { environmentId: csMatch[1], flowId: csMatch[2] };

  const csPreviewMatch = url.match(
    /copilotstudio\.preview\.microsoft\.com\/environments\/([^/?#]+)\/solutions\/[^/?#]+\/objects\/cloudflows\/([^/?#]+)/i
  );
  if (csPreviewMatch) return { environmentId: csPreviewMatch[1], flowId: csPreviewMatch[2] };

  const csPreviewBareMatch = url.match(
    /copilotstudio\.preview\.microsoft\.com\/environments\/([^/?#]+)\/solutions\/([^/?#]+)/i
  );
  if (csPreviewBareMatch) return { environmentId: csPreviewBareMatch[1], solutionId: csPreviewBareMatch[2], flowId: null, needsScrapedFlowId: true };

  const csPreviewEnvMatch = url.match(
    /copilotstudio\.preview\.microsoft\.com\/environments\/([^/?#]+)/i
  );
  if (csPreviewEnvMatch) return { environmentId: csPreviewEnvMatch[1], flowId: null, needsScrapedFlowId: true };

  return null;
}

// ── Injected page functions (must be self-contained — serialized via toString) ─
export function extractBearerToken() {
  const SCOPE_PRIORITY = [
    "service.flow.microsoft.com",
    "api.powerplatform.com",
    "service.powerapps.com",
    "powerplatform.com",
    "management.azure.com",
    "graph.microsoft.com",
  ];
  const stores = [sessionStorage, localStorage];
  const buckets = {};

  for (const store of stores) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      const keyLower = key.toLowerCase();
      const looksLikeToken = keyLower.includes("accesstoken") ||
        keyLower.includes("idtoken") ||
        /^[0-9a-f-]{36}\.[0-9a-f-]{36}/.test(key);
      if (!looksLikeToken) continue;
      try {
        const raw = store.getItem(key) || "{}";
        const entry = JSON.parse(raw);
        const candidates = Array.isArray(entry) ? entry : [entry];
        for (const e of candidates) {
          const secret = e.secret || e.access_token || e.credential || e.token;
          if (!secret || typeof secret !== "string" || secret.split(".").length < 3) continue;
          const target = (e.target || e.scope || e.resource || "").toLowerCase();
          const credType = (e.credentialType || e.token_type || "").toLowerCase();
          if (credType && !credType.includes("access")) continue;
          const exp = parseInt(e.expiresOn || e.extended_expires_on || e.expires_on || "0", 10);
          const valid = exp === 0 || exp * 1000 > Date.now();
          if (!valid) continue;
          const idx = SCOPE_PRIORITY.findIndex(s => target.includes(s));
          if (idx !== -1 && !(idx in buckets)) buckets[idx] = secret;
          if (idx === -1 && !buckets[-1] && target && secret.length > 100) {
            buckets[-1] = secret;
          }
        }
      } catch { }
    }
  }

  const tokens = [
    ...SCOPE_PRIORITY.map((_, i) => buckets[i]),
    buckets[-1]
  ].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i);

  let scrapedFlowId = null;
  const _debug = { perfEntries: [], storageKeys: [], iframeCount: 0, frameUrl: location.href.slice(0, 120), reactRootKeys: [], tokenCount: tokens.length };
  try {
    const GUID_RE = /\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const GUID_BARE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

    const entries = performance.getEntriesByType("resource");
    _debug.perfEntries = entries.map(e => e.name).filter(n =>
      n.includes("flow") || n.includes("ProcessSimple") || n.includes("powerautomate") || n.includes("powerplatform")
    ).slice(0, 20);
    for (const e of entries) {
      const m = e.name.match(GUID_RE);
      if (m) { scrapedFlowId = m[1]; break; }
    }

    if (!scrapedFlowId) {
      for (const store of [sessionStorage, localStorage]) {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const val = store.getItem(key) || "";
          _debug.storageKeys.push(key.slice(0, 60));
          const m = val.match(GUID_RE);
          if (m) { scrapedFlowId = m[1]; break; }
        }
        if (scrapedFlowId) break;
      }
    }

    if (!scrapedFlowId) {
      const scripts = Array.from(document.querySelectorAll("script:not([src])"));
      for (const s of scripts) {
        const m = s.textContent.match(GUID_RE);
        if (m) { scrapedFlowId = m[1]; break; }
      }
    }

    if (!scrapedFlowId) {
      try {
        function walkFiber(node, depth, visited) {
          if (!node || depth > 40) return null;
          if (visited.has(node)) return null;
          visited.add(node);
          for (const bag of [node.memoizedState, node.memoizedProps, node.pendingProps]) {
            if (!bag) continue;
            try {
              const s = JSON.stringify(bag);
              if (s && s.includes("/flows/")) {
                const m = s.match(/\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
                if (m) return m[1];
              }
            } catch { }
          }
          return walkFiber(node.child, depth + 1, visited) || walkFiber(node.sibling, depth + 1, visited);
        }
        const rootEl = document.querySelector("#root, #app, [data-reactroot], body > div");
        if (rootEl) {
          const fiberKey = Object.keys(rootEl).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactContainer"));
          if (fiberKey) scrapedFlowId = walkFiber(rootEl[fiberKey], 0, new WeakSet()) || null;
        }
      } catch { }
    }

    if (!scrapedFlowId) {
      try {
        const allText = document.documentElement.innerHTML;
        const jsonPropMatch = allText.match(/["']flow[_\-]?[Ii]d["']\s*[=:]\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/i);
        if (jsonPropMatch) scrapedFlowId = jsonPropMatch[1];
      } catch { }
    }

    if (!scrapedFlowId) {
      for (const key of Object.keys(window)) {
        try {
          const val = JSON.stringify(window[key]);
          if (val && val.includes("/flows/")) {
            const m = val.match(GUID_RE);
            if (m) { scrapedFlowId = m[1]; break; }
          }
        } catch { }
      }
    }

    if (!scrapedFlowId) {
      for (const stateKey of ["__REDUX_STORE__", "__NEXT_DATA__", "__APP_STATE__", "__INITIAL_STATE__"]) {
        try {
          const val = JSON.stringify(window[stateKey]);
          if (val && val.includes("flow")) {
            const m = val.match(GUID_RE);
            if (m) { scrapedFlowId = m[1]; break; }
          }
        } catch { }
      }
    }

    if (!scrapedFlowId) {
      const urlsToCheck = [location.href];
      try { if (history.state) urlsToCheck.push(JSON.stringify(history.state)); } catch { }
      try {
        const navEntries = performance.getEntriesByType("navigation");
        for (const e of navEntries) urlsToCheck.push(e.name || "");
      } catch { }
      for (const u of urlsToCheck) {
        const m = u.match(GUID_RE);
        if (m) { scrapedFlowId = m[1]; break; }
      }
    }

    if (!scrapedFlowId) {
      try {
        const candidates = document.querySelectorAll("[href],[data-flow-id],[data-id],[data-flowid]");
        for (const el of candidates) {
          const check = (el.getAttribute("href") || "") + " " +
            (el.getAttribute("data-flow-id") || "") + " " +
            (el.getAttribute("data-id") || "") + " " +
            (el.getAttribute("data-flowid") || "");
          const m = check.match(GUID_RE) || check.match(GUID_BARE);
          if (m) { scrapedFlowId = m[1]; break; }
        }
      } catch { }
    }

    _debug.iframeCount = document.querySelectorAll("iframe").length;
    try {
      const rootEl = document.querySelector("#root, #app, [data-reactroot], body > div");
      if (rootEl) _debug.reactRootKeys = Object.keys(rootEl).filter(k => k.startsWith("__react")).slice(0, 5);
    } catch { }
  } catch { }

  return { token: tokens[0] || null, tokens, scrapedFlowId, _debug };
}

export function installPostMessageSpy() {
  if (window.__flowkitListening) return;
  window.__flowkitListening = true;
  const FLOW_PATH_RE = /\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  // Only accept messages from trusted Microsoft Power Platform origins.
  const ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*(powerautomate|powerapps|microsoft)\.com$/i;
  window.addEventListener("message", (evt) => {
    if (!evt.origin || !ALLOWED_ORIGIN_RE.test(evt.origin)) return;
    try {
      const raw = typeof evt.data === "string" ? evt.data : JSON.stringify(evt.data);
      if (!raw || !raw.toLowerCase().includes("flow")) return;
      const m = raw.match(FLOW_PATH_RE);
      if (m) { window.__flowkitFlowId = m[1]; window.__flowkitTs = Date.now(); }
    } catch { }
  }, true);
}

export function readPostMessageFlowId() {
  return window.__flowkitFlowId || null;
}

// ── Flow context resolution ───────────────────────────────────────────────────
export async function resolveFlowContext() {
  let tab = null;
  try { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); tab = t; } catch {}

  const isPA = t => t?.url && (t.url.startsWith("http://") || t.url.startsWith("https://"));
  let resolvedTab = isPA(tab) ? tab : null;

  if (!resolvedTab && lastPaTabId) {
    try { const t = await chrome.tabs.get(lastPaTabId); if (isPA(t)) resolvedTab = t; } catch {}
  }
  if (!resolvedTab) {
    try { const tabs = await chrome.tabs.query({ active: true }); resolvedTab = tabs.find(isPA) || null; } catch {}
  }

  if (!resolvedTab?.url) throw new Error("No active tab found.");
  if (isPA(resolvedTab)) lastPaTabId = resolvedTab.id;

  try {
    await chrome.scripting.executeScript({ target: { tabId: resolvedTab.id, frameIds: [0] }, func: installPostMessageSpy });
  } catch { }

  let postMessageFlowId = null;
  try {
    const pmResult = await chrome.scripting.executeScript({ target: { tabId: resolvedTab.id, frameIds: [0] }, func: readPostMessageFlowId });
    postMessageFlowId = pmResult?.[0]?.result || null;
  } catch { }

  let cachedFlow = null;
  try {
    cachedFlow = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "GET_CACHED_FLOW", tabId: resolvedTab.id }, r => resolve(r?.cached || null));
    });
  } catch { }

  let allFrames = [];
  try {
    allFrames = await chrome.webNavigation.getAllFrames({ tabId: resolvedTab.id }) || [];
  } catch (e) {
    console.warn("[FlowKit] webNavigation.getAllFrames failed:", e.message);
    allFrames = [{ frameId: 0, url: resolvedTab.url }];
  }

  let parsed = null;
  let bestFrameId = 0;

  for (const frame of allFrames) {
    const fp = parseFlowUrl(frame.url || "");
    if (!fp) continue;
    if (fp.flowId) { parsed = fp; bestFrameId = frame.frameId; break; }
    if (!parsed && fp.needsScrapedFlowId) { parsed = fp; bestFrameId = frame.frameId; }
  }

  if (!parsed) { parsed = parseFlowUrl(resolvedTab.url); bestFrameId = 0; }

  if (!parsed) {
    const allUrls = allFrames.map(f => f.url || "").join(" ") + " " + (resolvedTab?.url || "");
    const isFlowListPage = /\/flows\b(?!\/)/.test(allUrls) || /\/cloudflows/.test(allUrls);
    const isSolutionPage = /\/solutions\b/.test(allUrls);
    const isKnownPage = isFlowListPage || isSolutionPage;
    // Only warn when on a Power Platform domain — unrelated tabs (tally.so, google.com, etc.) are silently ignored
    const isPowerPlatformDomain = /powerautomate\.com|powerapps\.com|copilotstudio\.(microsoft|preview)/i.test(allUrls);
    if (!isKnownPage && isPowerPlatformDomain) {
      console.warn("[FlowKit] No matching frame. All frame URLs:", allFrames.map(f => f.url).join(", "));
    }
    let hint;
    if (isSolutionPage) {
      hint = "You're on the Solutions page — open a specific flow first (click its name to open the detail view).";
    } else if (isFlowListPage) {
      hint = "You're on the flow list — open a specific flow first (click into it).";
    } else {
      hint = "Supported: make.powerautomate.com, make.powerapps.com, copilotstudio.microsoft.com";
    }
    throw new Error(`Open a Power Automate flow first.\u0000${hint}`);
  }

  let flowNameHint = null;
  if (!parsed.flowId) {
    try {
      const nameResult = await chrome.scripting.executeScript({
        target: { tabId: resolvedTab.id, frameIds: [0] },
        func: () => {
          const candidates = [];
          if (document.title) candidates.push(document.title.split(/[-|–]/)[0].trim());
          Array.from(document.querySelectorAll("h1,h2,h3,[aria-label],[title]")).forEach(el => {
            const t = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
            if (t.length > 2 && t.length < 150) candidates.push(t);
          });
          return [...new Set(candidates)].slice(0, 15);
        }
      });
      const hints = nameResult?.[0]?.result || [];
      const skip = /^(copilot studio|microsoft|cloud flows|objects|solutions|environments|all|agents|apps|cards|tables|new|edit|save|undo|redo|export|delete)$/i;
      flowNameHint = hints.find(h => h && !skip.test(h.trim()) && h.length > 2) || null;
    } catch (e) { console.warn("[FlowKit] Name hint extraction failed:", e.message); }
  }

  let token = null; let tokens = []; let scrapedFlowId = null;
  try {
    const injections = await Promise.allSettled(
      allFrames.map(frame =>
        chrome.scripting.executeScript({
          target: { tabId: resolvedTab.id, frameIds: [frame.frameId] },
          func: extractBearerToken
        }).catch(() => null)
      )
    );
    for (const settled of injections) {
      if (settled.status !== "fulfilled" || !settled.value) continue;
      for (const frameResult of (settled.value || [])) {
        const r = frameResult?.result;
        if (!r) continue;
        if (!scrapedFlowId && r.scrapedFlowId) scrapedFlowId = r.scrapedFlowId;
        if (!token && r.token) token = r.token;
        for (const t of (r.tokens || [])) {
          if (!tokens.includes(t)) tokens.push(t);
        }
        if (!scrapedFlowId && r._debug) {
          console.warn("[FlowKit] Flow ID scrape failed (frame). Debug:", JSON.stringify(r._debug, null, 2));
        }
      }
    }
  } catch (e) { console.warn("Token extraction skipped:", e.message); }

  let { environmentId, flowId } = parsed;

  if (!flowId && postMessageFlowId) flowId = postMessageFlowId;
  if (!flowId && cachedFlow?.flowId) {
    flowId = cachedFlow.flowId;
    if (!environmentId) environmentId = cachedFlow.environmentId;
  }
  if (!flowId && scrapedFlowId) flowId = scrapedFlowId;

  if (!flowId && environmentId && tokens.length) {
    try {
      const host = getApiHost();
      const ppHost = `${environmentId}.environment.api.powerplatform.com`;
      const ppUrl = `https://${ppHost}/flow/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows?api-version=2016-11-01&$top=50`;
      const flowUrl = `https://${host}/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows?api-version=2016-11-01&$top=50`;

      let resp = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: "FETCH_FLOW_LIST", listUrl: ppUrl, tokens }, resolve)
      );
      if (!resp?.flows?.length) {
        resp = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: "FETCH_FLOW_LIST", listUrl: flowUrl, tokens }, resolve)
        );
      }

      if (resp?.flows?.length) {
        if (flowNameHint) {
          const hint = flowNameHint.toLowerCase().trim();
          const match = resp.flows.find(f => {
            const name = (f.properties?.displayName || "").toLowerCase().trim();
            return name === hint || name.includes(hint) || hint.includes(name);
          });
          if (match) flowId = match.name;
          else console.warn("[FlowKit] No name match. Available:", resp.flows.map(f => f.properties?.displayName));
        }
        if (!flowId && resp.flows.length === 1) flowId = resp.flows[0].name;
      }
    } catch (e) { console.warn("[FlowKit] Flow list lookup failed:", e.message); }
  }

  if (!flowId) {
    throw new Error("Could not detect the flow ID.\u0000Try opening the flow in make.powerautomate.com instead, or use the flow detail page (before clicking Edit).");
  }

  return { environmentId, flowId, token, tokens, tab: resolvedTab };
}
