/**
 * popup/panels/paste.js — Paste Actions into Flow panel
 *
 * Accepted clipboard formats:
 *   • Single FlowKit envelope  { operationName, operationDefinition, connectionReferences, … }
 *   • Array of envelopes       [{ … }, { … }]
 *   • Raw action object        { type, inputs, runAfter }
 *   • Raw actions map          { ActionName: { type, … }, … }
 *   • Flow inner definition    { triggers, actions, connectionReferences }
 */
import { ACTION_TYPE_MAP } from "../../shared/constants.js";
import { normalizeAuth, ensureAuth, topoSortActions } from "../../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl } from "../context.js";
import {
  registerPanel, closeAllPanels, setActiveBtn, hideStatus, showStatus,
  updateFlowStrip, setUndoPasteRef,
} from "../ui.js";
import { invalidatePickerCache } from "./picker.js";
import { invalidateQuickCache } from "./quick-copy.js";

const pasteBtn       = document.getElementById("pasteBtn");
const pastePanel     = document.getElementById("pastePanel");
const undoPasteBtn   = document.getElementById("undoPasteBtn");
const undoPasteWrap  = document.getElementById("undoPasteWrap");
const undoDismissBtn = document.getElementById("undoDismissBtn");

registerPanel(pasteBtn, pastePanel);

// ── Undo snapshot ─────────────────────────────────────────────────────────────
let prePasteSnapshot = null; // { patchUrls, tokens, patchBodies }
let pasteState       = null; // { pastedItems, targetDef, targetDisplayName, ctx }
let lastPatchDebug   = null; // populated on failure for debug copy

// Wire undo btn ref into ui.js toast delay logic
setUndoPasteRef(undoPasteBtn);

// ── Undo button helpers ───────────────────────────────────────────────────────
function showUndoBtn(visible) {
  const el = undoPasteWrap || undoPasteBtn;
  if (el) el.style.display = visible ? "" : "none";
}

export function getPasteState() { return pasteState; }

// ── Startup: restore undo snapshot from session storage ──────────────────────
(async () => {
  try {
    const s = await chrome.storage.session.get("undoSnapshot");
    if (s?.undoSnapshot) {
      prePasteSnapshot = s.undoSnapshot;
      if (undoPasteBtn) {
        undoPasteBtn.disabled = false;
        undoPasteBtn.innerHTML = `<i class="bi bi-arrow-counterclockwise"></i>Undo Last Paste`;
      }
      showUndoBtn(true);
    }
  } catch (_) {}
})();

// ── Dismiss undo bar ──────────────────────────────────────────────────────────
undoDismissBtn?.addEventListener("click", async () => {
  prePasteSnapshot = null;
  try { await chrome.storage.session.remove("undoSnapshot"); } catch (_) {}
  showUndoBtn(false);
});

// ── Undo last paste ───────────────────────────────────────────────────────────
undoPasteBtn?.addEventListener("click", async () => {
  if (!prePasteSnapshot) return;
  undoPasteBtn.disabled = true;
  undoPasteBtn.innerHTML = `<div class="spinner" style="border-top-color:var(--warn)"></div> Reverting…`;
  const { patchUrls, tokens, patchBodies } = prePasteSnapshot;
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: "PATCH_FLOW", patchUrls, tokens, patchBodies });
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  undoPasteBtn.disabled = false;
  undoPasteBtn.innerHTML = `<i class="bi bi-arrow-counterclockwise"></i>Undo Last Paste`;
  if (r?.ok) {
    prePasteSnapshot = null;
    try { await chrome.storage.session.remove("undoSnapshot"); } catch (_) {}
    showUndoBtn(false);
    showStatus("success", "Paste undone", "Click ↺ Reload to see the changes", true);
  } else {
    showStatus("error", "Undo failed", r?.error || "Could not revert");
  }
});

// ── Clipboard parsing ─────────────────────────────────────────────────────────
function parseClipboardAsActions(text) {
  let parsed;
  try { parsed = JSON.parse(text.trim()); } catch { return null; }

  const results = [];

  function isRawAction(obj) {
    return obj && typeof obj === "object" && typeof obj.type === "string" && !Array.isArray(obj);
  }
  function isEnvelope(obj) {
    return obj && typeof obj === "object" && obj.operationName && obj.operationDefinition;
  }
  function isActionsMap(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    const vals = Object.values(obj);
    return vals.length > 0 && vals.every(v => v && typeof v.type === "string");
  }
  function isDefinition(obj) {
    return obj && typeof obj === "object" && !Array.isArray(obj) &&
      (obj.triggers || obj.actions) && !obj.type && !obj.operationName;
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];

  for (const item of items) {
    if (isEnvelope(item)) {
      results.push({ name: item.operationName, actionDef: item.operationDefinition, connRefs: item.connectionReferences || {} });
    } else if (isDefinition(item)) {
      const actionsMap = item.actions || {};
      const connRefs   = item.connectionReferences || {};
      for (const [name, actionDef] of Object.entries(actionsMap)) {
        results.push({ name, actionDef, connRefs });
      }
    } else if (isActionsMap(item)) {
      for (const [name, actionDef] of Object.entries(item)) {
        results.push({ name, actionDef, connRefs: {} });
      }
    } else if (isRawAction(item)) {
      results.push({ name: item._name || "Pasted_Action", actionDef: item, connRefs: {} });
    }
  }

  return results.length ? results : null;
}

// ── Dependency analysis ───────────────────────────────────────────────────────
function analysePaste(pastedItems, targetDef) {
  const targetActions  = targetDef?.actions || {};
  const targetVarInits = new Set();
  const targetConnRefs = targetDef?.connectionReferences || {};

  for (const a of Object.values(targetActions)) {
    if (a.type === "InitializeVariable" && a.inputs?.variables?.[0]?.name) {
      targetVarInits.add(a.inputs.variables[0].name);
    }
  }

  const warnings          = [];
  const connMerges        = [];
  const missingConnActions = [];
  const pastedNames        = new Set(pastedItems.map(p => p.name));

  for (const item of pastedItems) {
    const inputStr = JSON.stringify(item.actionDef?.inputs || {});

    // Broken body()/outputs() references
    const REF_RE = /(?:body|outputs)\(["']([^"']+)["']\)/gi;
    let m;
    const seenRef = new Set();
    while ((m = REF_RE.exec(inputStr)) !== null) {
      const ref = m[1];
      if (seenRef.has(ref)) continue;
      seenRef.add(ref);
      if (!targetActions[ref] && !pastedNames.has(ref)) {
        warnings.push({ kind: "broken-ref", msg: `"${item.name}" references action "${ref}" which doesn't exist in the target flow. The expression will return null at runtime.` });
      }
    }

    // Variable references
    const VAR_RE = /variables\(["']([^"']+)["']\)/gi;
    const seenVar = new Set();
    while ((m = VAR_RE.exec(inputStr)) !== null) {
      const varName = m[1];
      if (seenVar.has(varName)) continue;
      seenVar.add(varName);
      if (!targetVarInits.has(varName)) {
        warnings.push({ kind: "missing-var", msg: `"${item.name}" uses variable "${varName}" which is not initialised in the target flow.` });
      }
    }

    // Connection reference merging
    const actionConnKey = item.actionDef?.inputs?.host?.connectionName || null;
    if (actionConnKey && !targetConnRefs[actionConnKey]) {
      missingConnActions.push({ name: item.name, connectorKey: actionConnKey });
    }
    for (const [key, ref] of Object.entries(item.connRefs || {})) {
      if (!connMerges.find(c => c.key === key)) {
        connMerges.push({ key, connRef: ref, status: targetConnRefs[key] ? "exists" : "new" });
      }
    }
    if (actionConnKey && !connMerges.find(c => c.key === actionConnKey)) {
      connMerges.push({ key: actionConnKey, connRef: {}, status: targetConnRefs[actionConnKey] ? "exists" : "new" });
    }
  }

  return { warnings, connMerges, missingConnActions };
}

// ── Build runAfter dropdown options ───────────────────────────────────────────
function buildRunAfterOptions(targetDef) {
  const actions  = targetDef?.actions  || {};
  const triggers = targetDef?.triggers || {};
  const opts     = [{ value: "", label: "— start of flow (no dependency)" }];

  const trigName = Object.keys(triggers)[0];
  if (trigName) opts.push({ value: `__trigger__${trigName}`, label: `⚡ ${trigName} (trigger)` });

  function addActions(actionsMap, indent, parentEncoded) {
    const sorted = topoSortActions(actionsMap);
    for (const name of sorted) {
      const label = "  ".repeat(indent) + (indent > 0 ? "↳ " : "") + name;
      const value = parentEncoded ? `@@in@@${parentEncoded}@@${name}` : name;
      opts.push({ value, label });

      const a = actionsMap[name];
      if (a.actions)       addActions(a.actions,        indent + 1, `${name}@@actions`);
      if (a.else?.actions) addActions(a.else.actions,   indent + 1, `${name}@@else_actions`);
      if (a.default?.actions) addActions(a.default.actions, indent + 1, `${name}@@default_actions`);
      if (a.cases) for (const [caseKey, c] of Object.entries(a.cases))
        if (c.actions) addActions(c.actions, indent + 1, `${name}@@case__${caseKey}`);
    }
  }
  addActions(actions, 0, "");
  return opts;
}

// ── Render paste wizard panel ─────────────────────────────────────────────────
export function renderPastePanel(pastedItems, targetDef, targetDisplayName, ctx) {
  pasteState = { pastedItems, targetDef, targetDisplayName, ctx };
  const { warnings, connMerges, missingConnActions } = analysePaste(pastedItems, targetDef);
  const runAfterOpts  = buildRunAfterOptions(targetDef);
  const newConnectors = connMerges.filter(c => c.status === "new");

  pastePanel.innerHTML = "";

  // ── Actions summary ──
  const summarySection = document.createElement("div");
  summarySection.className = "paste-section";
  summarySection.innerHTML = `
    <div class="paste-section-title"><i class="bi bi-clipboard-data"></i> Actions to paste</div>
    ${pastedItems.map(p => {
      const isNewConn = missingConnActions.some(a => a.name === p.name);
      return `
      <div style="margin-bottom:5px">
        <div class="paste-action-name" style="display:flex;align-items:center;gap:5px">
          ${isNewConn
            ? `<span style="color:var(--warn);font-size:11px" title="New connector — may need connection setup">🔌</span>`
            : `<span style="color:var(--success);font-size:11px">✓</span>`
          }
          ${p.name}
        </div>
        <div class="paste-action-meta">${ACTION_TYPE_MAP[p.actionDef?.type]?.label || p.actionDef?.type || "Unknown type"}</div>
      </div>
    `}).join("")}
  `;
  pastePanel.appendChild(summarySection);

  // ── runAfter anchor ──
  const anchorSection = document.createElement("div");
  anchorSection.className = "paste-section";
  const selectId = "pasteRunAfterSelect";
  anchorSection.innerHTML = `
    <div class="paste-section-title"><i class="bi bi-arrow-down-circle"></i> Insert after</div>
    <div class="paste-runafter-label">Choose which step the pasted action(s) should run after:</div>
    <select class="paste-select" id="${selectId}">
      ${runAfterOpts.map(o => `<option value="${o.value}">${o.label}</option>`).join("")}
    </select>
  `;
  pastePanel.appendChild(anchorSection);

  // ── Connection refs ──
  if (connMerges.length) {
    const connSection = document.createElement("div");
    connSection.className = "paste-section";
    connSection.innerHTML = `<div class="paste-section-title"><i class="bi bi-plug"></i> Connection references</div>`;
    for (const c of connMerges) {
      const row = document.createElement("div");
      row.className = "paste-connref-row";
      row.innerHTML = `
        <span class="paste-connref-name">${c.key.replace(/^shared_/, "")}</span>
        <span class="paste-connref-badge ${c.status}">${c.status === "exists" ? "✓ exists" : "+ new"}</span>
      `;
      connSection.appendChild(row);
    }
    pastePanel.appendChild(connSection);
  }

  // ── New connector info ──
  if (newConnectors.length > 0) {
    const connList = newConnectors.map(c => c.key.replace(/^shared_/, "")).join(", ");
    const infoSection = document.createElement("div");
    infoSection.className = "paste-section";
    infoSection.innerHTML = `
      <div class="paste-warning" style="border-color:var(--accent);background:var(--accent-dim)">
        <i class="bi bi-info-circle" style="color:var(--accent);font-size:14px;flex-shrink:0"></i>
        <div style="font-size:11.5px">
          <strong>New connector${newConnectors.length > 1 ? "s" : ""}: ${connList}</strong>
          <div style="margin-top:3px;color:var(--text-2)">
            A connection reference will be created. If no connection exists for this connector in your environment, you'll need to configure it in the designer after pasting.
          </div>
        </div>
      </div>
    `;
    pastePanel.appendChild(infoSection);
  }

  // ── Warnings ──
  if (warnings.length) {
    const warnSection = document.createElement("div");
    warnSection.className = "paste-section";
    const ul = document.createElement("ul");
    ul.className = "paste-warning-list";
    warnings.forEach(w => { const li = document.createElement("li"); li.textContent = w.msg; ul.appendChild(li); });
    const warnBox  = document.createElement("div");
    warnBox.className = "paste-warning";
    warnBox.innerHTML = `<i class="bi bi-exclamation-triangle"></i>`;
    const warnText = document.createElement("div");
    warnText.innerHTML = `<strong>Heads up — review before confirming</strong>`;
    warnText.appendChild(ul);
    warnBox.appendChild(warnText);
    warnSection.appendChild(warnBox);
    pastePanel.appendChild(warnSection);
  } else if (newConnectors.length === 0) {
    const okSection = document.createElement("div");
    okSection.className = "paste-section";
    okSection.innerHTML = `<div class="paste-ok"><i class="bi bi-check2-circle"></i> No dependency issues detected.</div>`;
    pastePanel.appendChild(okSection);
  }

  // ── Footer ──
  const foot      = document.createElement("div");
  foot.className  = "paste-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "paste-cancel-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => closeAllPanels());

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "paste-confirm-btn";
  confirmBtn.innerHTML = `<i class="bi bi-clipboard-check"></i> Paste into flow`;
  confirmBtn.addEventListener("click", () => executePaste(selectId, warnings.length > 0));

  foot.append(cancelBtn, confirmBtn);
  pastePanel.appendChild(foot);
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function showConfirmModal(title, desc) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header"><i class="bi bi-exclamation-triangle"></i><span class="modal-title">${title}</span></div>
        <div class="modal-body"><div class="modal-desc">${desc}</div></div>
        <div class="modal-foot">
          <button class="modal-btn" id="modalCancel">Cancel</button>
          <button class="modal-btn primary" id="modalConfirm">Paste anyway</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#modalCancel").addEventListener("click",  () => { backdrop.remove(); resolve(false); });
    backdrop.querySelector("#modalConfirm").addEventListener("click", () => { backdrop.remove(); resolve(true);  });
    backdrop.addEventListener("click", e => { if (e.target === backdrop) { backdrop.remove(); resolve(false); } });
  });
}

// ── Execute paste ─────────────────────────────────────────────────────────────
async function executePaste(selectId, hasWarnings) {
  if (!pasteState) return;
  const { pastedItems, targetDef, ctx } = pasteState;

  const anchorEl  = document.getElementById(selectId);
  const anchorVal = anchorEl?.value ?? "";

  if (hasWarnings) {
    const proceed = await showConfirmModal(
      "Paste with warnings?",
      "Some expressions or variables in the pasted actions may not resolve correctly in this flow. Paste anyway?"
    );
    if (!proceed) return;
  }

  // ── Build merged definition ──
  const mergedDef = JSON.parse(JSON.stringify(targetDef));
  if (!mergedDef.actions) mergedDef.actions = {};
  delete mergedDef.connectionReferences;

  const fullConnRefs     = ctx.fullConnRefs || {};
  const isNonSolutionFlow = Object.keys(fullConnRefs).length === 0;
  const crossFlowConnKeys = {};

  // Determine runAfter map and target actions object based on anchorVal
  let runAfterMap  = {};
  let targetActions = mergedDef.actions;

  if (anchorVal === "" || anchorVal.startsWith("__trigger__")) {
    runAfterMap   = {};
    targetActions = mergedDef.actions;
  } else if (anchorVal.startsWith("@@in@@")) {
    const inner = anchorVal.slice("@@in@@".length);
    const [parentName, branchKey, anchorName] = inner.split("@@");
    runAfterMap = anchorName ? { [anchorName]: ["Succeeded"] } : {};
    const parentAction = mergedDef.actions[parentName];
    if (parentAction) {
      if (branchKey === "actions") {
        if (!parentAction.actions) parentAction.actions = {};
        targetActions = parentAction.actions;
      } else if (branchKey === "else_actions") {
        if (!parentAction.else) parentAction.else = {};
        if (!parentAction.else.actions) parentAction.else.actions = {};
        targetActions = parentAction.else.actions;
      } else if (branchKey === "default_actions") {
        if (!parentAction.default) parentAction.default = {};
        if (!parentAction.default.actions) parentAction.default.actions = {};
        targetActions = parentAction.default.actions;
      } else if (branchKey.startsWith("case__")) {
        const caseKey = branchKey.slice("case__".length);
        if (!parentAction.cases) parentAction.cases = {};
        if (!parentAction.cases[caseKey]) parentAction.cases[caseKey] = {};
        if (!parentAction.cases[caseKey].actions) parentAction.cases[caseKey].actions = {};
        targetActions = parentAction.cases[caseKey].actions;
      } else {
        targetActions = mergedDef.actions;
      }
    }
  } else {
    runAfterMap   = { [anchorVal]: ["Succeeded"] };
    targetActions = mergedDef.actions;
  }

  // Merge pasted actions into target
  for (let i = 0; i < pastedItems.length; i++) {
    const item      = pastedItems[i];
    const actionDef = JSON.parse(JSON.stringify(item.actionDef));

    if (i === 0) {
      actionDef.runAfter = runAfterMap;
    } else {
      const existingDeps = Object.keys(actionDef.runAfter || {});
      const validDeps    = existingDeps.filter(d =>
        targetActions[d] || pastedItems.slice(0, i).some(p => p.name === d)
      );
      if (validDeps.length === 0) {
        actionDef.runAfter = { [pastedItems[i - 1].name]: ["Succeeded"] };
      } else {
        actionDef.runAfter = Object.fromEntries(validDeps.map(d => [d, actionDef.runAfter[d]]));
      }
    }

    // Handle name collisions
    let finalName = item.name;
    if (targetActions[finalName]) {
      let suffix = 2;
      while (targetActions[`${finalName}_${suffix}`]) suffix++;
      finalName = `${finalName}_${suffix}`;
      if (i + 1 < pastedItems.length) {
        const nextItem = pastedItems[i + 1];
        if (nextItem.actionDef?.runAfter?.[item.name]) {
          nextItem.actionDef = JSON.parse(JSON.stringify(nextItem.actionDef));
          nextItem.actionDef.runAfter[finalName] = nextItem.actionDef.runAfter[item.name];
          delete nextItem.actionDef.runAfter[item.name];
        }
      }
    }

    // Cross-flow connection handling
    if (actionDef.type && /^OpenApiConnection/i.test(actionDef.type)) {
      const cn = actionDef.inputs?.host?.connectionName;
      if (cn && !fullConnRefs[cn]) {
        crossFlowConnKeys[cn] = actionDef.inputs.host.apiId || "";
        if (isNonSolutionFlow) {
          // Non-solution flows use inputs.host.connection.referenceName, not connectionReferenceName
          delete actionDef.inputs.host.connectionName;
          actionDef.inputs.host.connection = { referenceName: cn };
          delete actionDef.inputs.authentication;
        }
      }
    }

    targetActions[finalName] = actionDef;
  }

  // ── Build PATCH definition ──
  const defOnly = {
    ...(mergedDef.$schema        ? { $schema:        mergedDef.$schema        } : {}),
    ...(mergedDef.contentVersion ? { contentVersion: mergedDef.contentVersion } : {}),
    ...(mergedDef.parameters     ? { parameters:     mergedDef.parameters     } : {}),
    triggers: isNonSolutionFlow ? (mergedDef.triggers || {}) : ensureAuth(normalizeAuth(mergedDef.triggers || {})),
    actions:  isNonSolutionFlow ? (mergedDef.actions  || {}) : ensureAuth(normalizeAuth(mergedDef.actions  || {})),
    ...(mergedDef.outputs ? { outputs: mergedDef.outputs } : {}),
  };

  // Strip authentication from cross-flow actions on non-solution flows
  if (isNonSolutionFlow && Object.keys(crossFlowConnKeys).length > 0) {
    (function stripCrossFlowAuth(actions) {
      if (!actions || typeof actions !== "object") return;
      for (const [, def] of Object.entries(actions)) {
        if (!def) continue;
        if (/^OpenApiConnection/i.test(def.type || "")) {
          const crn = def.inputs?.host?.connectionReferenceName;
          if (crn && crossFlowConnKeys[crn]) delete def.inputs.authentication;
        }
        if (def.actions) stripCrossFlowAuth(def.actions);
        if (def.else?.actions) stripCrossFlowAuth(def.else.actions);
        if (def.default?.actions) stripCrossFlowAuth(def.default.actions);
        if (def.cases) for (const c of Object.values(def.cases)) if (c.actions) stripCrossFlowAuth(c.actions);
      }
    })(defOnly.actions);
  }

  // Ensure $authentication parameter declared (solution flows only)
  if (!isNonSolutionFlow) {
    const needsAuth = JSON.stringify(defOnly.actions || {}).includes("@parameters('$authentication')") ||
                      JSON.stringify(defOnly.triggers || {}).includes("@parameters('$authentication')");
    if (needsAuth) {
      if (!defOnly.parameters) defOnly.parameters = {};
      if (!defOnly.parameters.$authentication) {
        defOnly.parameters.$authentication = { defaultValue: {}, type: "SecureObject" };
      }
    }
  }

  // Show spinner
  const confirmBtn = pastePanel.querySelector(".paste-confirm-btn");
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.innerHTML = `<div class="spinner"></div> Saving…`; }

  // ── Look up existing connections ──
  const allPastedConnKeys = {};
  for (const item of pastedItems) {
    const cn    = item.actionDef?.inputs?.host?.connectionName;
    const apiId = item.actionDef?.inputs?.host?.apiId;
    if (cn) allPastedConnKeys[cn] = apiId || "";
  }

  const resolvedConnections = {};
  if (Object.keys(allPastedConnKeys).length > 0) {
    const { environmentId: envId, tokens: ctxTokens } = ctx;
    await Promise.all(Object.keys(allPastedConnKeys).map(async connectorKey => {
      try {
        const r = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: "FETCH_CONNECTIONS", environmentId: envId, connectorName: connectorKey, tokens: ctxTokens }, resolve)
        );
        if (r?.ok && r.connectionName) {
          resolvedConnections[connectorKey] = { connectionName: r.connectionName, connectionId: r.connectionId || "" };
        }
      } catch { }
    }));
  }

  // Enrich existing refs missing connectionName
  for (const [key, ref] of Object.entries(fullConnRefs)) {
    if ((!ref.connectionName || ref.connectionName === "") && resolvedConnections[key]) {
      ref.connectionName = resolvedConnections[key].connectionName;
    }
  }

  // Add stubs for cross-flow connectors
  if (isNonSolutionFlow) {
    if (!defOnly.parameters) defOnly.parameters = {};
    if (!defOnly.parameters.$connections) defOnly.parameters.$connections = { defaultValue: {}, type: "Object" };
    if (!defOnly.parameters.$connections.defaultValue || typeof defOnly.parameters.$connections.defaultValue !== "object") {
      defOnly.parameters.$connections.defaultValue = {};
    }
    for (const [key, apiId] of Object.entries(crossFlowConnKeys)) {
      if (!defOnly.parameters.$connections.defaultValue[key]) {
        const resolved = resolvedConnections[key];
        defOnly.parameters.$connections.defaultValue[key] = {
          connectionId:   resolved?.connectionId   || "",
          connectionName: resolved?.connectionName || "",
          id: apiId || `/providers/Microsoft.PowerApps/apis/${key}`,
        };
      }
    }
  } else {
    for (const [key, apiId] of Object.entries(crossFlowConnKeys)) {
      if (!fullConnRefs[key]) {
        const resolved = resolvedConnections[key];
        fullConnRefs[key] = {
          connectionName: resolved?.connectionName || "",
          source: "Embedded",
          id: apiId || `/providers/Microsoft.PowerApps/apis/${key}`,
        };
      }
    }
  }

  // ── Build PATCH bodies with fallback strategy ──
  const primaryBody = {
    properties: {
      definition: defOnly,
      ...(Object.keys(fullConnRefs).length ? { connectionReferences: fullConnRefs } : {}),
    },
  };
  const patchBodies = [primaryBody];
  if (isNonSolutionFlow) {
    const defWithoutConnParams = JSON.parse(JSON.stringify(defOnly));
    delete defWithoutConnParams.parameters?.$connections;
    patchBodies.push({ properties: { definition: defWithoutConnParams } });
  }

  // ── Build patch URLs from ctx ──
  const { environmentId, flowId, tokens } = ctx;
  const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);
  const patchUrls = [apiUrl, ppApiUrl, previewApiUrl];

  // ── Build undo snapshot from original definition ──
  const origDef = ctx.originalDefinition;
  if (origDef) {
    const origInner    = origDef.properties?.definition;
    const origConnRefs = origDef.properties?.connectionReferences || {};
    const origDefOnly  = {
      ...(origInner?.$schema        ? { $schema:        origInner.$schema        } : {}),
      ...(origInner?.contentVersion ? { contentVersion: origInner.contentVersion } : {}),
      ...(origInner?.parameters     ? { parameters:     origInner.parameters     } : {}),
      triggers: origInner?.triggers || {},
      actions:  origInner?.actions  || {},
      ...(origInner?.outputs ? { outputs: origInner.outputs } : {}),
    };
    if (isNonSolutionFlow) {
      if (!origDefOnly.parameters) origDefOnly.parameters = {};
      if (!origDefOnly.parameters.$connections) origDefOnly.parameters.$connections = { defaultValue: {}, type: "Object" };
    }
    prePasteSnapshot = {
      patchUrls, tokens,
      patchBodies: [
        { properties: { definition: origDefOnly, ...(Object.keys(origConnRefs).length ? { connectionReferences: origConnRefs } : {}) } },
        { properties: { definition: origDefOnly } },
      ],
    };
  }

  lastPatchDebug = { patchUrls, patchBodies, tokens: tokens.map(t => t ? t.slice(0, 12) + "…" : null) };

  let resp = await chrome.runtime.sendMessage({ type: "PATCH_FLOW", patchUrls, tokens, patchBodies });

  // ── Auto-retry on FlowMissingConnection ──
  if (!resp?.ok) {
    const missingApiMatch = resp?.attempts
      ?.map(a => a.resp?.match(/FlowMissingConnection.*?api '([^']+)'/))
      ?.find(m => m);
    if (missingApiMatch) {
      const missingApi   = missingApiMatch[1];
      const skippedNames = [];
      for (const body of patchBodies) {
        const actions = body.properties?.definition?.actions;
        if (!actions) continue;
        for (const [name, def] of Object.entries(actions)) {
          const apiId    = def.inputs?.host?.apiId    || "";
          const connName = def.inputs?.host?.connectionName || "";
          if (apiId.includes(missingApi) || connName.includes(missingApi)) {
            const myDeps = def.runAfter || {};
            for (const [otherName, otherDef] of Object.entries(actions)) {
              if (otherDef.runAfter?.[name]) {
                delete otherDef.runAfter[name];
                Object.assign(otherDef.runAfter, myDeps);
              }
            }
            delete actions[name];
            skippedNames.push(name);
          }
        }
        const connRefs = body.properties?.connectionReferences;
        if (connRefs?.[missingApi]) delete connRefs[missingApi];
        if (connRefs) for (const k of Object.keys(connRefs)) if (k.includes(missingApi)) delete connRefs[k];
      }

      if (skippedNames.length > 0) {
        if (lastPatchDebug) lastPatchDebug.patchBodies = patchBodies;
        resp = await chrome.runtime.sendMessage({ type: "PATCH_FLOW", patchUrls, tokens, patchBodies });
        if (resp?.ok) {
          closeAllPanels();
          const ok = pastedItems.length - skippedNames.length;
          if (prePasteSnapshot) {
            try { await chrome.storage.session.set({ undoSnapshot: prePasteSnapshot }); } catch (_) {}
            showUndoBtn(true);
          }
          showStatus("info",
            `✓ ${ok} action${ok !== 1 ? "s" : ""} pasted — ${skippedNames.length} skipped`,
            `Skipped: ${skippedNames.join(", ")} — no "${missingApi}" connection exists. Create the connection in your environment first, then paste again.`,
            true);
          invalidatePickerCache(); invalidateQuickCache();
          return;
        }
      }
    }
  }

  if (resp?.ok) {
    closeAllPanels();
    const n = pastedItems.length;
    if (prePasteSnapshot) {
      try { await chrome.storage.session.set({ undoSnapshot: prePasteSnapshot }); } catch (_) {}
      showUndoBtn(true);
    }
    showStatus("success", `✓ ${n} action${n !== 1 ? "s" : ""} pasted`, "Click ↺ Reload to see the changes", true);
    invalidatePickerCache(); invalidateQuickCache();
    return;
  }

  // All URLs failed — show error + debug button
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = `<i class="bi bi-clipboard-check"></i> Paste into flow`;
  }
  if (lastPatchDebug) lastPatchDebug.attempts = resp?.attempts || [];

  // Try to surface a human-readable error for known failure patterns
  const allRespTexts = (resp?.attempts || []).map(a => a.resp || "").join(" ");
  let errorTitle = "Paste failed";
  let errorDetail = resp?.attempts
    ?.map(a => `${a.method}[${a.shape}] → ${a.status}: ${a.resp?.slice(0, 100) || "(empty)"}`)
    .join(" | ") || resp?.error || "Unknown error";

  // InvalidTemplate: missing action referenced in outputs()/body()
  const missingActionMatch = allRespTexts.match(
    /[Tt]he action[s]?\s+'([^']+)'\s+referenced by\s+'?inputs'?\s+in action\s+'([^']+)'/
  );
  if (missingActionMatch) {
    errorTitle = "Missing action reference";
    errorDetail = `"${missingActionMatch[2]}" uses @outputs('${missingActionMatch[1]}') but "${missingActionMatch[1]}" doesn't exist in this flow. Go back and include "${missingActionMatch[1]}" in your copy selection, then paste again.`;
  }

  // InvalidTemplate: missing runAfter reference
  const missingRunAfterMatch = !missingActionMatch && allRespTexts.match(
    /action\s+'([^']+)'\s+.*?not defined/i
  );
  if (missingRunAfterMatch) {
    errorTitle = "Invalid action dependency";
    errorDetail = `Action "${missingRunAfterMatch[1]}" is referenced but doesn't exist in this flow. Copy its dependencies too.`;
  }

  showStatus("error", errorTitle, errorDetail);

  const existingDbg = document.getElementById("pasteDebugBtn");
  if (existingDbg) existingDbg.remove();
  const dbgBtn = document.createElement("button");
  dbgBtn.id = "pasteDebugBtn";
  dbgBtn.className = "tool-btn";
  dbgBtn.style.cssText = "border-color:var(--warn);color:var(--warn);font-size:10.5px;width:100%;margin-top:6px;";
  dbgBtn.innerHTML = `<i class="bi bi-bug"></i> Copy debug payload (paste here to share)`;
  dbgBtn.addEventListener("click", async () => {
    if (!lastPatchDebug) return;
    await navigator.clipboard.writeText(JSON.stringify(lastPatchDebug, null, 2));
    dbgBtn.innerHTML = `<i class="bi bi-check2"></i> Copied to clipboard!`;
    setTimeout(() => { dbgBtn.innerHTML = `<i class="bi bi-bug"></i> Copy debug payload (paste here to share)`; }, 2500);
  });
  if (pastePanel) pastePanel.appendChild(dbgBtn);
}

// ── Refresh paste panel (called on tab change or button click) ────────────────
export async function refreshPastePanel(existingPastedItems) {
  pastePanel.innerHTML = `<div class="paste-section"><div class="runs-loading"><div class="spinner"></div> ${existingPastedItems ? "Updating for current flow…" : "Reading clipboard & fetching flow…"}</div></div>`;
  pastePanel.classList.add("show");

  try {
    let pastedItems = existingPastedItems;
    if (!pastedItems) {
      let clipText;
      try {
        clipText = await navigator.clipboard.readText();
      } catch {
        pastePanel.innerHTML = `<div class="paste-section"><div class="paste-warning"><i class="bi bi-exclamation-triangle"></i><div>Clipboard access denied. Copy an action first using Quick Copy or Select Actions.</div></div></div>`;
        return;
      }
      pastedItems = parseClipboardAsActions(clipText);
      if (!pastedItems) {
        pastePanel.innerHTML = `<div class="paste-section"><div class="paste-warning"><i class="bi bi-exclamation-triangle"></i><div>Clipboard doesn't contain a recognisable action. Use Quick Copy or Select Actions to copy an action first.</div></div></div>`;
        return;
      }
    }

    const ctx = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(ctx.flowId, ctx.environmentId);
    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token: ctx.token, tokens: ctx.tokens, mode: "full",
      environmentId: ctx.environmentId, flowId: ctx.flowId,
    });

    if (!result || result.error) {
      showStatus("error", "API error", result?.error || "");
      closeAllPanels();
      return;
    }

    updateFlowStrip(result.displayName, ctx.tab.url);
    const innerDef = result.definition?.properties?.definition;
    ctx.fullConnRefs       = result.definition?.properties?.connectionReferences || {};
    ctx.originalDefinition = result.definition;

    renderPastePanel(pastedItems, innerDef, result.displayName, ctx);

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
    closeAllPanels();
  }
}

// ── Paste button handler ──────────────────────────────────────────────────────
pasteBtn?.addEventListener("click", async () => {
  if (pastePanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  hideStatus();
  setActiveBtn(pasteBtn);
  await refreshPastePanel();
});
