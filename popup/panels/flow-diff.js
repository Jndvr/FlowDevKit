/**
 * popup/panels/flow-diff.js — Flow Diff
 *
 * Compares the live flow's action set against a pasted JSON baseline.
 * Summary view shows added/removed/changed counts.
 * "Side-by-side" button opens diff-view.html as a full-screen window,
 * passing diff data via chrome.storage.session.
 */
import { flattenActions } from "../../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, showStatus, updateFlowStrip } from "../ui.js";

const diffBtn    = document.getElementById("diffBtn");
const diffPanel  = document.getElementById("diffPanel");
const diffInput  = document.getElementById("diffInput");
const diffRunBtn = document.getElementById("diffRunBtn");
const diffResult = document.getElementById("diffResult");

registerPanel(diffBtn, diffPanel);

// Last computed diff
let _lastDiff = null;

// ── Extraction ────────────────────────────────────────────────────────────────
/** Accept full export, definition wrapper, or raw actions object. */
function extractFlat(obj) {
  const inner = obj?.properties?.definition
             ?? obj?.definition?.properties?.definition
             ?? obj;
  return flattenActions(inner?.actions || {});
}

// ── Diff engine ───────────────────────────────────────────────────────────────
function diffFlows(baseline, live) {
  const baseMap     = new Map(baseline.map(a => [a.name, a]));
  const baseJsonMap = new Map(baseline.map(a => [a.name, JSON.stringify(a.action)]));
  const liveJsonMap = new Map(live.map(a => [a.name, JSON.stringify(a.action)]));
  const liveNames   = new Set(live.map(a => a.name));

  return {
    added:     live.filter(a => !baseMap.has(a.name)),
    removed:   baseline.filter(a => !liveNames.has(a.name)),
    // Spread item props; attach baseItem so the overlay can show both sides
    changed:   live
                 .filter(a => baseMap.has(a.name) && baseJsonMap.get(a.name) !== liveJsonMap.get(a.name))
                 .map(a => ({ ...a, baseItem: baseMap.get(a.name) })),
    unchanged: live.filter(a => baseMap.has(a.name) && baseJsonMap.get(a.name) === liveJsonMap.get(a.name)),
  };
}

// ── Summary render ────────────────────────────────────────────────────────────
function renderDiff(diff) {
  diffResult.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "diff-summary";
  summary.innerHTML = `
    <span class="diff-chip added">+${diff.added.length} added</span>
    <span class="diff-chip removed">−${diff.removed.length} removed</span>
    <span class="diff-chip changed">~${diff.changed.length} changed</span>
    <span class="diff-chip unchanged">${diff.unchanged.length} same</span>`;

  // Side-by-side button — only when there is something to show
  const hasDiff = diff.added.length || diff.removed.length || diff.changed.length;
  if (hasDiff) {
    const sbsBtn = document.createElement("button");
    sbsBtn.className = "diff-sbs-btn";
    sbsBtn.title = "Open side-by-side comparison";
    sbsBtn.innerHTML = `<i class="bi bi-layout-split"></i> Side-by-side`;
    sbsBtn.addEventListener("click", () => openSideBySide(diff));
    summary.appendChild(sbsBtn);
  }

  diffResult.appendChild(summary);

  if (!hasDiff) {
    const empty = document.createElement("div");
    empty.className = "diff-empty";
    empty.textContent = "✓ No differences — flows are identical.";
    diffResult.appendChild(empty);
    return;
  }

  function group(items, kind, marker) {
    if (!items.length) return;
    const header = document.createElement("div");
    header.className = `diff-group-header ${kind}`;
    header.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
    diffResult.appendChild(header);
    for (const item of items) {
      const row = document.createElement("div");
      row.className = `diff-row ${kind}`;
      row.innerHTML = `<span class="diff-marker">${marker}</span>
        <span class="diff-action-name">${item.name}</span>
        <span class="diff-action-type">${item.type}</span>`;
      diffResult.appendChild(row);
    }
  }

  group(diff.added,   "added",   "+");
  group(diff.removed, "removed", "−");
  group(diff.changed, "changed", "~");
}

// ── Side-by-side: opens a full-screen tab ─────────────────────────────────────
/**
 * Sends diff data to the background service worker, which writes it to
 * chrome.storage.local and opens diff-view.html in a new tab.
 * Going via the background avoids the popup-lifecycle problem where the
 * popup's JS context is killed when it loses focus mid-await.
 */
function openSideBySide(diff) {
  const theme       = document.documentElement.dataset.theme || "dark";
  const displayName = document.getElementById("flowStripName")?.textContent?.trim() || "";
  chrome.runtime.sendMessage({
    type:     "OPEN_DIFF_VIEW",
    diffData: { diff, theme, displayName },
  }).catch(err => showStatus("error", "Could not open diff viewer", err.message || ""));
}

// ── Toggle panel ──────────────────────────────────────────────────────────────
diffBtn.addEventListener("click", () => {
  if (diffPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  setActiveBtn(diffBtn);
  diffPanel.classList.add("show");
});

// ── Run comparison ────────────────────────────────────────────────────────────
diffRunBtn.addEventListener("click", async () => {
  const raw = diffInput.value.trim();
  if (!raw) { showStatus("error", "Paste baseline JSON first.", ""); return; }

  let baselineJson;
  try { baselineJson = JSON.parse(raw); }
  catch { showStatus("error", "Invalid JSON", "The pasted text is not valid JSON."); return; }

  diffRunBtn.disabled = true;
  diffRunBtn.textContent = "Loading…";
  diffResult.innerHTML = `<div class="diff-loading"><div class="spinner" style="width:12px;height:12px;margin:0 auto 4px"></div>Fetching live flow…</div>`;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: "full", environmentId, flowId,
    });
    if (!result || result.error) {
      showStatus("error", "API error", result?.error || "");
      diffResult.innerHTML = "";
      return;
    }
    updateFlowStrip(result.displayName, tab.url);

    const baseline = extractFlat(baselineJson);
    const live     = extractFlat(result.definition);
    _lastDiff = diffFlows(baseline, live);
    renderDiff(_lastDiff);
  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
    diffResult.innerHTML = "";
  } finally {
    diffRunBtn.disabled = false;
    diffRunBtn.textContent = "Compare with live flow";
  }
});
