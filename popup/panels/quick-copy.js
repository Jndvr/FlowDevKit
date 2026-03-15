/**
 * popup/panels/quick-copy.js — Quick Copy Action panel
 */
import { ACTION_TYPE_MAP } from "../../shared/constants.js";
import { flattenActions } from "../../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, showStatus } from "../ui.js";

const quickBtn     = document.getElementById("quickBtn");
const quickPanel   = document.getElementById("quickPanel");
const quickSearch  = document.getElementById("quickSearch");
const quickResults = document.getElementById("quickResults");
const quickClear   = document.getElementById("quickClear");

registerPanel(quickBtn, quickPanel);

// ── Shared cache ──────────────────────────────────────────────────────────────
let quickFlat = [];
let quickConnRefs = {};

export function invalidateQuickCache() {
  quickFlat = [];
  quickConnRefs = {};
}

async function ensureQuickFlat() {
  if (quickFlat.length > 0) return true;
  try {
    const { environmentId, flowId, token, tokens } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);
    const result = await chrome.runtime.sendMessage({ type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl, token, tokens, mode: "full", environmentId, flowId });
    if (!result || result.error) return false;
    const inner = result.definition?.properties?.definition;
    quickFlat = flattenActions(inner?.actions || {});
    quickConnRefs = result.definition?.properties?.connectionReferences || {};
    return quickFlat.length > 0;
  } catch { return false; }
}

// ── Action envelope builder ───────────────────────────────────────────────────
function buildActionEnvelope(item) {
  const src = item.action || {};
  const connName = src.inputs?.host?.connectionName || null;
  const primaryRef = connName ? quickConnRefs[connName] : null;

  const connectionReferences = {};
  if (connName && quickConnRefs[connName]) {
    const ref = quickConnRefs[connName];
    const logicalName = ref.connectionReferenceLogicalName || ref.connectionName || null;
    connectionReferences[connName] = {
      connection: { id: logicalName ? `/${logicalName}` : (ref.id || `/${connName}`) },
      ...(ref.api ? { api: ref.api } : {}),
    };
  }
  for (const [key, ref] of Object.entries(quickConnRefs)) {
    if (key === connName) continue;
    const logicalName = ref.connectionReferenceLogicalName || ref.connectionName || null;
    connectionReferences[key] = {
      connection: { id: logicalName ? `/${logicalName}` : (ref.id || `/${key}`) },
      ...(ref.api ? { api: ref.api } : {}),
    };
  }

  const srcInputs = src.inputs || {};
  let sanitizedInputs;
  if (Object.keys(srcInputs).length) {
    const isOpenApi = /^OpenApiConnection/i.test(src.type || "");
    if (isOpenApi) {
      sanitizedInputs = {
        host: srcInputs.host,
        parameters: srcInputs.parameters,
        authentication: "@parameters('$authentication')",
        retryPolicy: srcInputs.retryPolicy,
      };
    } else {
      sanitizedInputs = { ...srcInputs };
      if (sanitizedInputs.authentication) {
        sanitizedInputs.authentication = "@parameters('$authentication')";
      }
    }
  }

  const operationDefinition = {
    type: src.type,
    inputs: sanitizedInputs,
    runAfter: src.runAfter,
    limit: src.limit,
    metadata: src.metadata,
  };
  Object.keys(operationDefinition).forEach(k => {
    if (operationDefinition[k] === undefined) delete operationDefinition[k];
  });
  if (operationDefinition.inputs) {
    Object.keys(operationDefinition.inputs).forEach(k => {
      if (operationDefinition.inputs[k] === undefined) delete operationDefinition.inputs[k];
    });
  }

  return {
    id: crypto.randomUUID(),
    brandColor: primaryRef?.brandColor || primaryRef?.api?.brandColor || "#0078D4",
    connectionReferences,
    connectorDisplayName: primaryRef?.displayName || item.type,
    icon: primaryRef?.iconUri || primaryRef?.api?.iconUri || "",
    isTrigger: false,
    operationName: item.name,
    operationDefinition,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderQuickResults(query) {
  const lc = query.trim().toLowerCase();
  if (!lc) {
    quickResults.innerHTML = `<div class="quick-hint">Start typing to find an action</div>`;
    return;
  }
  if (!quickFlat.length) {
    quickResults.innerHTML = `<div class="quick-hint">Loading flow…</div>`;
    return;
  }
  const matches = quickFlat.filter(i =>
    i.name.toLowerCase().includes(lc) ||
    i.type.toLowerCase().includes(lc) ||
    i.inputText.toLowerCase().includes(lc)
  ).slice(0, 20);

  if (!matches.length) {
    quickResults.innerHTML = `<div class="quick-hint">No actions match "${query}"</div>`;
    return;
  }

  quickResults.innerHTML = "";
  for (const item of matches) {
    const row = document.createElement("div");
    row.className = "quick-row";

    const nameEl = document.createElement("span");
    nameEl.className = "quick-row-name";
    nameEl.title = item.name;
    nameEl.textContent = item.name;

    const typeEl = document.createElement("span");
    typeEl.className = "quick-row-type";
    typeEl.textContent = ACTION_TYPE_MAP[item.type]?.label || item.type;

    const btn = document.createElement("button");
    btn.className = "quick-copy-btn";
    btn.textContent = "Copy";

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        const output = buildActionEnvelope(item);
        await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
        btn.textContent = "✓ Copied!";
        btn.style.borderColor = "var(--success)";
        btn.style.color = "var(--success)";
        btn.style.background = "var(--success-dim)";
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.style.borderColor = "";
          btn.style.color = "";
          btn.style.background = "";
        }, 1800);
        showStatus("success", "Action copied!", `"${item.name}" · ${item.type}`);
      } catch (err) {
        btn.textContent = "Error";
        btn.style.color = "var(--error)";
        setTimeout(() => { btn.textContent = "Copy"; btn.style.color = ""; }, 2000);
        showStatus("error", "Copy failed", err.message || String(err));
      }
    });

    row.appendChild(nameEl);
    row.appendChild(typeEl);
    row.appendChild(btn);
    quickResults.appendChild(row);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
let _debounce = null;
quickSearch.addEventListener("input", () => {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => renderQuickResults(quickSearch.value), 120);
});

quickClear.addEventListener("click", () => {
  quickSearch.value = "";
  quickResults.innerHTML = `<div class="quick-hint">Start typing to find an action</div>`;
  quickSearch.focus();
});

quickBtn.addEventListener("click", async () => {
  if (quickPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  quickPanel.classList.add("show");
  setActiveBtn(quickBtn);
  quickSearch.focus();

  if (!quickFlat.length) {
    quickResults.innerHTML = `<div class="quick-hint">Loading flow…</div>`;
    const ok = await ensureQuickFlat();
    if (!ok) {
      quickResults.innerHTML = `<div class="quick-hint">Open a Power Automate flow first</div>`;
    } else if (!quickSearch.value.trim()) {
      quickResults.innerHTML = `<div class="quick-hint">Start typing to find an action</div>`;
    } else {
      renderQuickResults(quickSearch.value);
    }
  }
});
