/**
 * background/background.js — Service Worker (Manifest V3, ES module)
 */
// Must be imported before any async work so the webRequest listener is
// registered synchronously at service-worker boot time.
import "./dv-token-cache.js";

import {
  handleFetchFlowList,
  handleFetchFlow,
  handlePatchFlow,
  handleFetchEnv,
  handleFetchRuns,
  handleFetchRunDetail,
  handleFetchRunIO,
  handleFetchConnections,
  handleFetchEnvVars,
} from "./api-handlers.js";
import { getLog } from "./debug-log.js";

// ── Side panel: open on toolbar icon click ────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });

// ── SPA navigation cache ──────────────────────────────────────────────────────
const flowNavCache = {};

const GUID_RE_BG = /\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const ENV_RE_BG = /\/environments\/([^/?#]+)/i;

function cacheFlowFromUrl(tabId, url) {
  const flowMatch = url.match(GUID_RE_BG);
  const envMatch = url.match(ENV_RE_BG);
  if (flowMatch && envMatch) {
    flowNavCache[tabId] = { environmentId: envMatch[1], flowId: flowMatch[1] };
  }
}

for (const event of ["onCommitted", "onHistoryStateUpdated"]) {
  chrome.webNavigation[event].addListener(details => {
    cacheFlowFromUrl(details.tabId, details.url || "");
    const cached = flowNavCache[details.tabId];
    if (cached) {
      chrome.runtime.sendMessage({ type: "TAB_FLOW_CHANGED", flowId: cached.flowId, environmentId: cached.environmentId }).catch(() => {});
    }
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const cached = flowNavCache[tabId];
  if (cached) {
    chrome.runtime.sendMessage({ type: "TAB_FLOW_CHANGED", flowId: cached.flowId, environmentId: cached.environmentId }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_CACHED_FLOW") {
    sendResponse({ cached: flowNavCache[message.tabId] || null });
    return false;
  }
  if (message.type === "OPEN_SIDE_PANEL") {
    chrome.sidePanel.open({ tabId: message.tabId })
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (message.type === "GET_DEBUG_LOG")   { sendResponse({ log: getLog() }); return false; }
  if (message.type === "FETCH_FLOW_LIST") { handleFetchFlowList(message, sendResponse); return true; }
  if (message.type === "FETCH_FLOW")     { handleFetchFlow(message, sendResponse);     return true; }
  if (message.type === "FETCH_ENV")      { handleFetchEnv(message, sendResponse);      return true; }
  if (message.type === "FETCH_CONNECTIONS") { handleFetchConnections(message, sendResponse); return true; }
  if (message.type === "FETCH_ENV_VARS")    { handleFetchEnvVars(message, sendResponse);    return true; }
  if (message.type === "PATCH_FLOW")     { handlePatchFlow(message, sendResponse);     return true; }
  if (message.type === "FETCH_RUNS")     { handleFetchRuns(message, sendResponse);     return true; }
  if (message.type === "FETCH_RUN_DETAIL") { handleFetchRunDetail(message, sendResponse); return true; }
  if (message.type === "FETCH_RUN_IO")   { handleFetchRunIO(message, sendResponse);   return true; }
  if (message.type === "OPEN_DIFF_VIEW") {
    chrome.storage.local.set({ diffViewData: message.diffData }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("diff-view.html"), active: true },
        () => sendResponse({ ok: true }));
    });
    return true;
  }
  return false;
});
