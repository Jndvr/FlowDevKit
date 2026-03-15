/**
 * popup/panels/picker.js — Select Actions to Copy panel
 */
import { flattenActions, buildSelectedActions, getUsedConnRefs, normalizeAuth, collectDependencyChain } from "../../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl } from "../context.js";
import {
  registerPanel, closeAllPanels, setActiveBtn, hideStatus, showStatus,
  updateFlowStrip, fetchAndCacheEnvName, makeTypePill, makeBadge,
} from "../ui.js";
import { invalidateQuickCache } from "./quick-copy.js";

const selectActionsBtn = document.getElementById("selectActionsBtn");
const pickerPanel      = document.getElementById("pickerPanel");
const pickerList       = document.getElementById("pickerList");
const pickerSearch     = document.getElementById("pickerSearch");
const pickerToggleAll  = document.getElementById("pickerToggleAll");
const pickerCount      = document.getElementById("pickerCount");
const copySelectionBtn = document.getElementById("copySelectionBtn");

registerPanel(selectActionsBtn, pickerPanel);

// ── Module state ───────────────────────────────────────────────────────────────
let pickerFlat        = [];
let pickerDefinition  = null;
let pickerDisplayName = "";
let pickerTriggers    = {};

export function invalidatePickerCache() {
  pickerFlat        = [];
  pickerDefinition  = null;
  pickerDisplayName = "";
  pickerTriggers    = {};
}

// ── Count & footer ────────────────────────────────────────────────────────────
function updatePickerCount() {
  const checked = pickerList.querySelectorAll("input[type=checkbox]:checked").length;
  const total   = pickerList.querySelectorAll("input[type=checkbox]").length;
  pickerCount.textContent = `${checked} / ${total} selected`;
  copySelectionBtn.disabled = checked === 0;
  pickerToggleAll.textContent = (checked === total && total > 0) ? "Deselect all" : "Select all";
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderPickerList(filter = "") {
  pickerList.innerHTML = "";
  const lc = filter.toLowerCase();

  const visible = filter
    ? pickerFlat.filter(i =>
        i.name.toLowerCase().includes(lc) ||
        i.type.toLowerCase().includes(lc) ||
        i.inputText.toLowerCase().includes(lc))
    : pickerFlat;

  // ── Trigger row (always at top, not a checkbox) ───────────────────────────
  if (!filter && pickerTriggers) {
    for (const [tName, tDef] of Object.entries(pickerTriggers)) {
      const trigRow = document.createElement("div");
      trigRow.className = "picker-trigger-row";
      trigRow.innerHTML = `
        <span class="trigger-icon">⚡</span>
        <span class="picker-item-label" title="${tName}">${tName}</span>
        <span class="picker-item-type">${tDef.type || "Trigger"}</span>
      `;
      pickerList.appendChild(trigRow);
    }
  }

  let lastBranchLabel = null;

  for (const item of visible) {
    // Branch group header
    if (!filter && item.depth > 0 && item.branchLabel && item.branchLabel !== lastBranchLabel) {
      const header = document.createElement("div");
      header.className = "picker-branch-header";
      header.textContent = item.branchLabel;
      pickerList.appendChild(header);
      lastBranchLabel = item.branchLabel;
    }

    const row = document.createElement("div");
    row.className = `picker-item depth-${Math.min(item.depth, 3)}${item.isParallel ? " parallel" : ""}`;
    row.dataset.path = item.path;

    // Checkbox
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = item.path;
    cb.checked = true;
    cb.addEventListener("change", () => {
      if (item.depth === 0) {
        pickerList.querySelectorAll("input[type=checkbox]").forEach(box => {
          if (box !== cb && box.value.startsWith(item.path + ".")) box.checked = cb.checked;
        });
      }
      if (item.depth > 0 && !cb.checked) {
        const parentPath = item.path.split(".")[0];
        const parentCb = pickerList.querySelector(`input[type=checkbox][value="${parentPath}"]`);
        if (parentCb) parentCb.checked = false;
      }
      if (item.depth > 0 && cb.checked) {
        const parentPath = item.path.split(".")[0];
        const parentCb = pickerList.querySelector(`input[type=checkbox][value="${parentPath}"]`);
        if (parentCb) parentCb.checked = true;
      }
      updatePickerCount();
    });

    // Name
    const lbl = document.createElement("span");
    lbl.className = "picker-item-label";
    lbl.title = item.name;
    lbl.textContent = item.name;

    // Type pill
    const typePill = makeTypePill(item);

    // runAfter status badges
    const badgeWrap = document.createElement("span");
    badgeWrap.className = "badge-wrap";
    for (const [, statuses] of Object.entries(item.runAfterStatuses)) {
      for (const s of statuses) badgeWrap.appendChild(makeBadge(s));
    }

    const CONTAINER_TYPES = new Set(["If", "Switch", "Foreach", "Until", "Scope"]);
    const hasChildren = item.depth === 0 && CONTAINER_TYPES.has(item.type);
    if (hasChildren) {
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:9px;color:var(--text-3);font-family:'JetBrains Mono',monospace;white-space:nowrap;flex-shrink:0";
      hint.title = "Selecting this includes all nested actions inside it";
      hint.textContent = "incl. children";
      row.append(cb, lbl, typePill, hint, badgeWrap);
    } else {
      row.append(cb, lbl, typePill, badgeWrap);
    }

    // Right-click → select dependency chain
    row.addEventListener("contextmenu", e => {
      e.preventDefault();
      const parentActions = item.parentActions || pickerDefinition?.properties?.definition?.actions || {};
      const chain = collectDependencyChain(item.name, parentActions);
      pickerList.querySelectorAll("input[type=checkbox]").forEach(box => {
        const boxPath   = box.value;
        const boxName   = boxPath.split(".").pop();
        const boxParent = boxPath.includes(".") ? boxPath.slice(0, boxPath.lastIndexOf(".")) : "";
        const itemParent = item.path.includes(".") ? item.path.slice(0, item.path.lastIndexOf(".")) : "";
        if (boxParent === itemParent && chain.has(boxName)) box.checked = true;
      });
      updatePickerCount();
      row.classList.add("chain-flash");
      setTimeout(() => row.classList.remove("chain-flash"), 600);
    });

    pickerList.appendChild(row);
  }

  updatePickerCount();
}

// ── Search ────────────────────────────────────────────────────────────────────
pickerSearch.addEventListener("input", () => renderPickerList(pickerSearch.value));

// ── Toggle all ────────────────────────────────────────────────────────────────
pickerToggleAll.addEventListener("click", () => {
  const boxes = pickerList.querySelectorAll("input[type=checkbox]");
  const allOn = [...boxes].every(b => b.checked);
  boxes.forEach(b => { b.checked = !allOn; });
  updatePickerCount();
});

// ── Copy as JSON ──────────────────────────────────────────────────────────────
copySelectionBtn.addEventListener("click", async () => {
  if (!pickerDefinition) return;
  const boxes    = pickerList.querySelectorAll("input[type=checkbox]:checked");
  const selected = new Set([...boxes].map(b => b.value));
  const inner    = pickerDefinition?.properties?.definition;
  const filtered = buildSelectedActions(pickerFlat, selected);
  if (!inner?.actions) { showStatus("error", "No action data available.", "Fetch the flow first."); return; }

  const usedRefs  = getUsedConnRefs(filtered);
  const knownRefs = Object.keys(pickerDefinition?.properties?.connectionReferences || {});
  const missing   = usedRefs.filter(r => !knownRefs.includes(r));

  const output = JSON.parse(JSON.stringify(inner));
  output.actions = normalizeAuth(filtered);
  const srcConnRefs = pickerDefinition?.properties?.connectionReferences;
  if (srcConnRefs && Object.keys(srcConnRefs).length) {
    output.connectionReferences = srcConnRefs;
  }
  await navigator.clipboard.writeText(JSON.stringify(output, null, 2));

  const n    = Object.keys(filtered).length;
  const warn = missing.length ? ` ⚠ Missing conn refs: ${missing.join(", ")}` : "";
  showStatus(missing.length ? "info" : "success", "Copied to clipboard!",
    `"${pickerDisplayName}" · ${n} action${n !== 1 ? "s" : ""}${warn}`);
});

// ── Select Actions button ─────────────────────────────────────────────────────
const SELECT_BTN_HTML = `<div class="tool-btn-icon"><i class="bi bi-ui-checks"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Select Actions to Copy</span><span class="tool-btn-desc">Multi-select actions for bulk copy</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;

function setSelectLoading(loading) {
  selectActionsBtn.disabled = loading;
  selectActionsBtn.innerHTML = loading
    ? `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Loading…</span></div>`
    : SELECT_BTN_HTML;
}

selectActionsBtn.addEventListener("click", async () => {
  if (pickerPanel.classList.contains("show") && pickerFlat.length > 0) {
    closeAllPanels();
    return;
  }

  closeAllPanels();
  hideStatus();
  setSelectLoading(true);

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: "full", environmentId, flowId,
    });
    if (!result) { showStatus("error", "No response from background.", "Try reloading the extension."); return; }
    if (result.error) { showStatus("error", "API error", result.error); return; }

    pickerDefinition  = result.definition;
    pickerDisplayName = result.displayName;
    invalidateQuickCache(); // new fetch — invalidate quick copy cache

    updateFlowStrip(result.displayName, tab.url);
    fetchAndCacheEnvName(environmentId, tokens);

    const innerDef = result.definition?.properties?.definition;
    pickerTriggers = innerDef?.triggers || {};
    pickerFlat     = flattenActions(innerDef?.actions || {});

    if (pickerFlat.length === 0) { showStatus("info", "No actions found in this flow."); return; }

    pickerSearch.value = "";
    renderPickerList();
    pickerPanel.classList.add("show");
    setActiveBtn(selectActionsBtn);

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    setSelectLoading(false);
  }
});
