/**
 * popup/popup.js — Entry point for popup.html and sidepanel.html
 *
 * Imports all panel modules (triggering their self-registration) then wires up
 * the main action buttons, settings, preferences, and cross-panel tab listeners.
 */

// ── Panel imports (self-register via registerPanel on module load) ─────────────
import "./panels/quick-copy.js";
import "./panels/runs.js";
import "./panels/env-vars.js";
import "./panels/variables.js";
import "./panels/expressions.js";
import "./panels/lint.js";
import "./panels/child-flow-nav.js";
import "./panels/flow-diff.js";

// Panels that export helpers needed below
import { invalidatePickerCache } from "./panels/picker.js";
import { refreshPastePanel, getPasteState } from "./panels/paste.js";
import { invalidateQuickCache } from "./panels/quick-copy.js";

// ── Shared utilities ──────────────────────────────────────────────────────────
import { countActions, normalizeToSolutionFormat, normalizeAuth } from "../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl, setLastPaTabId } from "./context.js";
import {
  closeAllPanels, showStatus, hideStatus, applyTheme,
  updateFlowStrip, fetchAndCacheEnvName, flashBtnSuccess,
  getActivePanelBtn, getLoadedFlowId, showContextBanner, setFlowStripRefreshing,
} from "./ui.js";
import { initPrefs, getRegion, setRegion, getMode, setMode, getTheme, setTheme } from "./prefs.js";

// ── DOM references ────────────────────────────────────────────────────────────
const copyBtn           = document.getElementById("copyBtn");
const connRefBtn        = document.getElementById("connRefBtn");
const triggerBtn        = document.getElementById("triggerBtn");
const exportJsonBtn     = document.getElementById("exportJsonBtn");
const themeToggle       = document.getElementById("themeToggle");
const settingsBtn       = document.getElementById("settingsBtn");
const settingsOverlay   = document.getElementById("settingsOverlay");
const dockBtn           = document.getElementById("dockBtn");    // popup only — null in sidepanel
const undockBtn         = document.getElementById("undockBtn");  // sidepanel only — null in popup
const regionBtns        = document.querySelectorAll(".seg-btn[data-region]");
const modeBtns          = document.querySelectorAll(".mode-seg-btn");
const toastClose        = document.getElementById("toastClose");
const toastReload       = document.getElementById("toastReload");
const kofiBtn           = document.getElementById("kofiBtn");
const linkedinBtn       = document.getElementById("linkedinBtn");
const feedbackBtn       = document.getElementById("feedbackBtn");
const footerVersion     = document.getElementById("footerVersion");
const refreshContextBtn = document.getElementById("refreshContextBtn");
const pastePanel        = document.getElementById("pastePanel");
const pasteBtn          = document.getElementById("pasteBtn");
const debugCopyBtn      = document.getElementById("debugCopyBtn");

// ── Button HTML constants ─────────────────────────────────────────────────────
const COPY_BTN_HTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0">
  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
</svg>Copy JSON`;
const CONNREF_BTN_HTML  = `<div class="tool-btn-icon"><i class="bi bi-plug"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Copy Connection Refs</span><span class="tool-btn-desc">Extract connection reference keys</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;
const EXPORT_BTN_HTML   = `<i class="bi bi-download"></i>Export JSON`;
const TRIGGER_BTN_HTML  = `<div class="tool-btn-icon"><i class="bi bi-lightning-charge"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Copy Trigger</span><span class="tool-btn-desc">Copy the trigger configuration</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;

// ── Theme (apply immediately from cached pref) ────────────────────────────────
applyTheme(getTheme());
themeToggle.addEventListener("click", () => {
  const t = getTheme() === "dark" ? "light" : "dark";
  setTheme(t);
  applyTheme(t);
});

// ── Sync prefs from chrome.storage.sync ──────────────────────────────────────
initPrefs({
  onRegion: r => regionBtns.forEach(b => b.classList.toggle("active", b.dataset.region === r)),
  onMode:   m => modeBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === m)),
  onTheme:  t => applyTheme(t),
});

// ── Settings overlay toggle ───────────────────────────────────────────────────
settingsBtn.addEventListener("click", () => {
  const open = settingsOverlay.classList.toggle("show");
  settingsBtn.classList.toggle("active", open);
});

// ── Region buttons ────────────────────────────────────────────────────────────
regionBtns.forEach(btn => {
  btn.classList.toggle("active", btn.dataset.region === getRegion());
  btn.addEventListener("click", () => {
    setRegion(btn.dataset.region);
    regionBtns.forEach(b => b.classList.toggle("active", b.dataset.region === getRegion()));
    const customHost = document.getElementById("customHost");
    if (customHost) customHost.value = "";
  });
});

// ── Mode buttons ──────────────────────────────────────────────────────────────
modeBtns.forEach(btn => {
  btn.classList.toggle("active", btn.dataset.mode === getMode());
  btn.addEventListener("click", () => {
    setMode(btn.dataset.mode);
    modeBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === getMode()));
  });
});

// ── Dock / undock ─────────────────────────────────────────────────────────────
if (dockBtn) {
  dockBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.storage.session.set({ dockedFromPopup: true }).catch(() => {});
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL", tabId: tab.id });
    window.close();
  });
}

if (undockBtn) {
  chrome.storage.session.get("dockedFromPopup").then(res => {
    if (res?.dockedFromPopup) undockBtn.style.display = "";
  }).catch(() => {});
  undockBtn.addEventListener("click", async () => {
    await chrome.storage.session.remove("dockedFromPopup").catch(() => {});
    window.close();
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
toastClose?.addEventListener("click", hideStatus);
toastReload?.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => location.reload() });
  } catch (_) {}
  hideStatus();
});

// ── Footer ────────────────────────────────────────────────────────────────────
if (footerVersion) footerVersion.textContent = `v${chrome.runtime.getManifest().version}`;

kofiBtn?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://ko-fi.com/jndvr" });
});
linkedinBtn?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.linkedin.com/in/janduever/" });
});
feedbackBtn?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://tally.so/r/yPD40B" });
});

// ── Debug log copy ────────────────────────────────────────────────────────────
debugCopyBtn?.addEventListener("click", async () => {
  const { log = [] } = await chrome.runtime.sendMessage({ type: "GET_DEBUG_LOG" }) ?? {};
  const manifest = chrome.runtime.getManifest();
  const customHostEl = document.getElementById("customHost");

  const header = [
    `FlowDevKit v${manifest.version}`,
    `Region: ${getRegion()}  Mode: ${getMode()}  Theme: ${getTheme()}`,
    customHostEl?.value.trim() ? `Custom host: ${customHostEl.value.trim()}` : null,
    `Logged at: ${new Date().toISOString()}`,
    "─".repeat(60),
  ].filter(Boolean).join("\n");

  const lines = log.length
    ? log.map(e => {
        const note = e.note ? ` [${e.note}]` : "";
        const ok   = e.status >= 200 && e.status < 300 ? "✓" : "✗";
        return `${ok} [${e.ts}] ${e.op.padEnd(12)} HTTP ${e.status}  ${e.ms}ms  scope:${e.scope}  ${e.url}${note}`;
      }).join("\n")
    : "(no API calls recorded yet — perform an action first)";

  await navigator.clipboard.writeText(`${header}\n${lines}`);

  debugCopyBtn.textContent = "✓ Copied!";
  debugCopyBtn.classList.add("copied");
  setTimeout(() => {
    debugCopyBtn.textContent = "Copy debug log";
    debugCopyBtn.classList.remove("copied");
  }, 1800);
});

// ── Refresh context banner ────────────────────────────────────────────────────
refreshContextBtn?.addEventListener("click", () => {
  showContextBanner(false);
  copyBtn?.click();
});

// ── Main Copy JSON button ─────────────────────────────────────────────────────
function setLoading(loading) {
  copyBtn.disabled = loading;
  copyBtn.innerHTML = loading ? `<div class="spinner" style="width:14px;height:14px"></div> Fetching…` : COPY_BTN_HTML;
}

copyBtn.addEventListener("click", async () => {
  hideStatus();
  setLoading(true);
  let success = false;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: getMode(), environmentId, flowId,
    });

    if (!result) { showStatus("error", "No response from background.", "Try reloading the extension."); return; }
    if (result.error) { showStatus("error", "API error", result.error); return; }

    const { definition, displayName } = result;
    updateFlowStrip(displayName, tab.url);
    fetchAndCacheEnvName(environmentId, tokens);
    await navigator.clipboard.writeText(JSON.stringify(normalizeToSolutionFormat(definition, getMode()), null, 2));

    const innerDef    = getMode() === "full" ? definition?.properties?.definition : definition;
    const actionCount = countActions(innerDef?.actions);
    const triggerName = innerDef?.triggers ? Object.keys(innerDef.triggers)[0] : "—";
    const modeLabel   = getMode() === "full" ? " · full export" : " · definition only";

    success = true;
    flashBtnSuccess(copyBtn, COPY_BTN_HTML);
    showStatus("success", "Copied to clipboard!",
      `"${displayName}" · ${actionCount} action${actionCount !== 1 ? "s" : ""} · trigger: ${triggerName}${modeLabel}`);

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    if (!success) setLoading(false);
  }
});

// ── Copy Connection Refs button ───────────────────────────────────────────────
function setConnRefLoading(loading) {
  connRefBtn.disabled = loading;
  connRefBtn.innerHTML = loading ? `<div class="spinner"></div> Fetching…` : CONNREF_BTN_HTML;
}

connRefBtn.addEventListener("click", async () => {
  hideStatus();
  setConnRefLoading(true);
  let success = false;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: "full", environmentId, flowId,
    });
    if (!result) { showStatus("error", "No response from background.", "Try reloading the extension."); return; }
    if (result.error) { showStatus("error", "API error", result.error); return; }

    const connRefs = result.definition?.properties?.connectionReferences;
    if (!connRefs || Object.keys(connRefs).length === 0) {
      showStatus("info", "No connection references found.",
        "This flow may not use any connectors, or the API didn't return them.");
      return;
    }

    const debugOutput = {};
    for (const [key, ref] of Object.entries(connRefs)) {
      debugOutput[key] = {
        connectionName: ref.connectionName || null,
        id:             ref.id             || null,
        connectorId:    ref.api?.id        || null,
        displayName:    ref.displayName    || null,
        _raw: ref,
      };
    }
    await navigator.clipboard.writeText(JSON.stringify(debugOutput, null, 2));

    const n = Object.keys(connRefs).length;
    updateFlowStrip(result.displayName, tab.url);
    fetchAndCacheEnvName(environmentId, tokens);
    success = true;
    flashBtnSuccess(connRefBtn, CONNREF_BTN_HTML);
    showStatus("success", "Connection refs copied!",
      `"${result.displayName}" · ${n} connection reference${n !== 1 ? "s" : ""}`);

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    if (!success) setConnRefLoading(false);
  }
});

// ── Copy Trigger button ───────────────────────────────────────────────────────
triggerBtn.addEventListener("click", async () => {
  closeAllPanels();
  hideStatus();
  triggerBtn.disabled = true;
  triggerBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Fetching…</span></div>`;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: "full", environmentId, flowId,
    });
    if (!result || result.error) { showStatus("error", "API error", result?.error || ""); return; }

    updateFlowStrip(result.displayName, tab.url);
    fetchAndCacheEnvName(environmentId, tokens);

    const innerDef   = result.definition?.properties?.definition;
    const triggers   = innerDef?.triggers || {};
    const triggerKeys = Object.keys(triggers);
    if (!triggerKeys.length) { showStatus("info", "No trigger found in this flow."); return; }

    await navigator.clipboard.writeText(JSON.stringify(normalizeAuth(triggers), null, 2));

    const triggerName = triggerKeys[0];
    triggerBtn.disabled = false;
    flashBtnSuccess(triggerBtn, TRIGGER_BTN_HTML, "Copied!");
    showStatus("success", "Trigger copied!", `"${triggerName}" · ${triggers[triggerName]?.type || ""}`);

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    if (triggerBtn.disabled) {
      triggerBtn.disabled = false;
      triggerBtn.innerHTML = TRIGGER_BTN_HTML;
    }
  }
});

// ── Export JSON button ────────────────────────────────────────────────────────
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9_\-. ]/gi, "_").replace(/\s+/g, "_").slice(0, 80);
}
function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

exportJsonBtn.addEventListener("click", async () => {
  hideStatus();
  exportJsonBtn.disabled = true;
  exportJsonBtn.innerHTML = `<div class="spinner"></div> Exporting…`;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);
    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: getMode(), environmentId, flowId,
    });
    if (!result || result.error) throw new Error(result?.error || "Fetch failed.");
    updateFlowStrip(result.displayName, tab.url);
    const normalized = normalizeToSolutionFormat(result.definition, getMode());
    const json       = JSON.stringify(normalized, null, 2);
    const safeName   = sanitizeFilename(result.displayName || "flow");
    downloadBlob(`${safeName}.json`, json, "application/json");
    exportJsonBtn.disabled = false;
    exportJsonBtn.innerHTML = `<i class="bi bi-check2" style="font-size:14px"></i>Saved!`;
    exportJsonBtn.style.borderColor = "var(--success)";
    exportJsonBtn.style.color       = "var(--success)";
    setTimeout(() => {
      exportJsonBtn.innerHTML = EXPORT_BTN_HTML;
      exportJsonBtn.style.borderColor = "";
      exportJsonBtn.style.color       = "";
    }, 1800);
    showStatus("success", "JSON exported!", `${safeName}.json · ${getMode() === "full" ? "full export" : "definition only"}`);
  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
    exportJsonBtn.disabled = false;
    exportJsonBtn.innerHTML = EXPORT_BTN_HTML;
  }
});

// ── Shared: load flow context and update UI ───────────────────────────────────
async function loadFlowContext({ invalidateCaches = false } = {}) {
  if (invalidateCaches) {
    invalidateQuickCache();
    invalidatePickerCache();
  }
  setFlowStripRefreshing(true);
  try {
    const ctx = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(ctx.flowId, ctx.environmentId);
    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token: ctx.token, tokens: ctx.tokens, mode: "definition",
      environmentId: ctx.environmentId, flowId: ctx.flowId,
    });
    if (result?.displayName) {
      updateFlowStrip(result.displayName, ctx.tab?.url || "", ctx.environmentId);
      fetchAndCacheEnvName(ctx.environmentId, ctx.tokens);
      showContextBanner(false);
    }
  } catch {
    const flowStrip = document.getElementById("flowStrip");
    if (flowStrip) flowStrip.style.display = "none";
  } finally {
    setFlowStripRefreshing(false);
  }
}

// ── Init: load context immediately when extension opens ───────────────────────
loadFlowContext();

// ── Tab flow changed (background push notification) ───────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "TAB_FLOW_CHANGED") return;
  const loadedFlowId = getLoadedFlowId();
  if (loadedFlowId && msg.flowId !== loadedFlowId) {
    showContextBanner(true);
    invalidateQuickCache();
    if (pastePanel?.classList.contains("show")) {
      const existingItems = getPasteState()?.pastedItems || null;
      refreshPastePanel(existingItems);
    }
  }
});

// ── Tab activation listener (user switches tabs) ──────────────────────────────
// Debounced to 300 ms — rapid tab switching would otherwise fire many
// concurrent context-resolution + API requests.
let _tabActivateTimer = null;
chrome.tabs.onActivated?.addListener((activeInfo) => {
  clearTimeout(_tabActivateTimer);
  _tabActivateTimer = setTimeout(async () => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      const isWeb = tab?.url?.startsWith("http://") || tab?.url?.startsWith("https://");
      if (!isWeb) return;
      setLastPaTabId(activeInfo.tabId);
    } catch { return; }

    await loadFlowContext({ invalidateCaches: true });

    // Refresh the currently open panel
    const activeBtn = getActivePanelBtn();
    if (!activeBtn) return;

    if (activeBtn === pasteBtn) {
      const existingItems = getPasteState()?.pastedItems || null;
      refreshPastePanel(existingItems);
    } else {
      closeAllPanels();
      activeBtn.click();
    }
  }, 300);
});
