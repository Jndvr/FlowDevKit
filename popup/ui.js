/**
 * popup/ui.js — Panel registry, toast, shared UI helpers
 */
import { ACTION_TYPE_MAP, ACTION_CAT_STYLE, CONNECTOR_NAMES } from "../shared/constants.js";

// ── Panel registry ─────────────────────────────────────────────────────────────
// Panels call registerPanel() at module load time so closeAllPanels / setActiveBtn
// don't need to import from panel modules (avoids circular deps).
const _panels = [];
const _panelBtns = [];

export function registerPanel(btn, panel) {
  if (btn && !_panelBtns.includes(btn)) _panelBtns.push(btn);
  if (panel && !_panels.includes(panel)) _panels.push(panel);
}

export function closeAllPanels() {
  _panels.forEach(p => p?.classList.remove("show"));
  _panelBtns.forEach(b => b?.classList.remove("active-tool"));
}

export function setActiveBtn(btn) {
  _panelBtns.forEach(b => b?.classList.toggle("active-tool", b === btn));
}

export function getActivePanelBtn() {
  return _panelBtns.find(b => b?.classList.contains("active-tool")) || null;
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let _toastTimer = null;
let _undoPasteBtn = null; // injected by popup.js after DOM is ready

export function setUndoPasteRef(btn) { _undoPasteBtn = btn; }

export function showStatus(type, title, detail = "", showReload = false) {
  const toastEl    = document.getElementById("toast");
  const toastIcon  = document.getElementById("toastIcon");
  const toastTitle = document.getElementById("toastTitle");
  const toastDetail= document.getElementById("toastDetail");
  const toastReload= document.getElementById("toastReload");

  const icons = { success: "bi-check2-circle", error: "bi-x-circle", info: "bi-info-circle" };
  toastIcon.className = `bi ${icons[type] || "bi-info-circle"}`;
  toastTitle.textContent = title;
  toastDetail.textContent = detail;
  toastDetail.style.display = detail ? "" : "none";
  if (toastReload) {
    toastReload.style.display = showReload ? "" : "none";
    toastReload.style.background = type === "error" ? "var(--error)" : "var(--success)";
  }
  toastEl.className = `toast show ${type}`;
  clearTimeout(_toastTimer);
  if (type === "error") return;
  const delay = (_undoPasteBtn && _undoPasteBtn.style.display !== "none") ? 15000 : 4000;
  _toastTimer = setTimeout(() => hideStatus(), delay);
}

export function hideStatus() {
  const toastEl = document.getElementById("toast");
  toastEl.className = "toast";
  clearTimeout(_toastTimer);
}

export function handleApiError(error) {
  const is401 = /401|403|unauthorized|forbidden/i.test(error || "");
  if (is401) {
    showStatus("error", "Session expired — refresh the tab", "Press F5 on the Power Automate tab, then try again");
  } else {
    showStatus("error", "API error", error || "Unknown error");
  }
}

// ── Button success flash ───────────────────────────────────────────────────────
export function flashBtnSuccess(btn, restoreHtml, label = "Copied!") {
  const isPrimary = btn.classList.contains("primary-btn");
  btn.disabled = false;
  btn.innerHTML = `<i class="bi bi-check2" style="font-size:15px"></i>${label}`;
  if (isPrimary) {
    btn.style.background = "var(--success)";
    btn.style.boxShadow = "0 2px 12px rgba(52,211,153,0.35)";
  } else {
    btn.style.borderColor = "var(--success)";
    btn.style.color = "var(--success)";
    btn.style.background = "var(--success-dim)";
  }
  setTimeout(() => {
    btn.style.background = "";
    btn.style.boxShadow = "";
    btn.style.borderColor = "";
    btn.style.color = "";
    btn.innerHTML = restoreHtml;
  }, 1800);
}

// ── Theme ──────────────────────────────────────────────────────────────────────
export function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const themeToggle = document.getElementById("themeToggle");
  const icon = themeToggle?.querySelector("i");
  if (!icon) return;
  if (t === "dark") {
    icon.className = "bi bi-moon-stars";
    themeToggle.title = "Switch to light mode";
  } else {
    icon.className = "bi bi-sun";
    themeToggle.title = "Switch to dark mode";
  }
}

// ── Flow strip ─────────────────────────────────────────────────────────────────
// envNameCache stores { name, ts } per environment ID.
// Entries expire after ENV_NAME_TTL_MS so renamed environments are picked up on next open.
const ENV_NAME_TTL_MS = 60 * 60 * 1000; // 1 hour
const envNameCache = {}; // { [envId]: { name: string, ts: number } }
let _loadedFlowId = null;

export function setLoadedFlow(flowId) {
  _loadedFlowId = flowId;
  showContextBanner(false);
}

export function getLoadedFlowId() { return _loadedFlowId; }

export function showContextBanner(visible) {
  const contextBanner = document.getElementById("contextBanner");
  if (contextBanner) contextBanner.style.display = visible ? "flex" : "none";
}

// Shows/hides the "Refreshing…" indicator in the flow strip.
// While refreshing: dot pulses amber. On completion: dot returns to green, status text clears.
export function setFlowStripRefreshing(refreshing) {
  const dot    = document.getElementById("flowStripDot");
  const status = document.getElementById("flowStripStatus");
  if (dot)    dot.classList.toggle("flow-strip-dot--refreshing", refreshing);
  if (status) status.textContent = refreshing ? "Refreshing…" : "";
}

export function updateFlowStrip(displayName, url, environmentId) {
  if (!displayName) return;
  const flowStrip     = document.getElementById("flowStrip");
  const flowStripName = document.getElementById("flowStripName");
  const flowStripEnv  = document.getElementById("flowStripEnv");

  flowStripName.textContent = displayName;
  flowStripName.title = displayName;
  const envMatch = url ? url.match(/environments\/([^/?#]+)/) : null;
  const envId = environmentId || (envMatch ? envMatch[1] : null);
  if (envId) {
    const entry = envNameCache[envId];
    const cachedName = (entry && Date.now() - entry.ts < ENV_NAME_TTL_MS) ? entry.name : null;
    flowStripEnv.textContent = cachedName || envId.slice(-8);
    flowStripEnv.title = cachedName ? `${cachedName}\n${envId}` : envId;
  } else {
    flowStripEnv.textContent = "";
    flowStripEnv.title = "";
  }
  flowStrip.style.display = "flex";
  const flowMatch = url ? url.match(/flows\/([0-9a-f-]{36})/i) : null;
  if (flowMatch) setLoadedFlow(flowMatch[1]);
}

export async function fetchAndCacheEnvName(environmentId, tokens) {
  if (!environmentId) return;
  // Skip fetch if we have a fresh cache entry (not yet expired).
  const existing = envNameCache[environmentId];
  if (existing && Date.now() - existing.ts < ENV_NAME_TTL_MS) return;
  try {
    const r = await chrome.runtime.sendMessage({ type: "FETCH_ENV", environmentId, tokens });
    if (r?.name) {
      envNameCache[environmentId] = { name: r.name, ts: Date.now() };
      const flowStripEnv = document.getElementById("flowStripEnv");
      if (flowStripEnv?.title?.includes(environmentId)) {
        flowStripEnv.textContent = r.name;
        flowStripEnv.title = `${r.name}\n${environmentId}`;
      }
    }
  } catch {}
}

// ── Action type pill ──────────────────────────────────────────────────────────
export function makeTypePill(item) {
  const mapped = ACTION_TYPE_MAP[item.type];
  let label = mapped?.label || item.type;
  let cat = mapped?.cat || "unknown";

  if (cat === "connector") {
    const apiId = item.action?.inputs?.host?.apiId || "";
    const apiMatch = apiId.match(/shared_([a-z0-9]+)$/i);
    if (apiMatch) {
      const raw = apiMatch[1].toLowerCase();
      label = CONNECTOR_NAMES[raw] || (raw.charAt(0).toUpperCase() + raw.slice(1, 14));
    }
  }

  const style = ACTION_CAT_STYLE[cat];
  const pill = document.createElement("span");
  pill.className = "picker-type-pill";
  pill.textContent = label;
  pill.style.cssText = `background:${style.bg};color:${style.color};`;
  pill.title = item.type;
  return pill;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  Succeeded: { bg: "rgba(45,212,167,0.15)", color: "#2dd4a7" },
  Failed:    { bg: "rgba(255,95,95,0.15)",  color: "#ff5f5f" },
  Skipped:   { bg: "rgba(122,127,154,0.18)",color: "#9da3b8" },
  TimedOut:  { bg: "rgba(255,180,50,0.15)", color: "#ffb432" },
};

export function makeBadge(status) {
  const s = STATUS_COLORS[status] || { bg: "rgba(255,255,255,0.08)", color: "#9da3b8" };
  const el = document.createElement("span");
  el.className = "status-badge";
  el.textContent = status;
  el.style.cssText = `background:${s.bg};color:${s.color};`;
  return el;
}
