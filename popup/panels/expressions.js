/**
 * popup/panels/expressions.js — Expression Inspector panel
 */
import { resolveFlowContext, buildApiUrl } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, hideStatus, showStatus, updateFlowStrip } from "../ui.js";

const exprBtn       = document.getElementById("exprBtn");
const exprPanel     = document.getElementById("exprPanel");
const exprList      = document.getElementById("exprList");
const exprSearch    = document.getElementById("exprSearch");
const exprMeta      = document.getElementById("exprMeta");
const exprCopyAllBtn = document.getElementById("exprCopyAllBtn");

registerPanel(exprBtn, exprPanel);

// ── Expression extraction helpers ─────────────────────────────────────────────
function extractExprs(val, fieldPath = "") {
  if (!val || typeof val !== "string") return [];
  const results = [];
  const inlineRe = /@\{([^}]+)\}/g;
  let m;
  while ((m = inlineRe.exec(val)) !== null) {
    results.push({ field: fieldPath, expr: `@{${m[1]}}`, raw: m[1] });
  }
  if (!results.length && val.startsWith("@")) {
    results.push({ field: fieldPath, expr: val, raw: val.slice(1) });
  }
  return results;
}

function scanForExpressions(obj, path = "", depth = 0) {
  if (depth > 8 || !obj) return [];
  const results = [];
  if (typeof obj === "string") {
    results.push(...extractExprs(obj, path));
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => results.push(...scanForExpressions(v, `${path}[${i}]`, depth + 1)));
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      results.push(...scanForExpressions(v, path ? `${path}.${k}` : k, depth + 1));
    }
  }
  return results;
}

function buildExpressionGroups(actions) {
  const groups = [];
  function walk(actionMap) {
    if (!actionMap || typeof actionMap !== "object") return;
    for (const [name, action] of Object.entries(actionMap)) {
      const exprs = [];
      if (action.inputs)     exprs.push(...scanForExpressions(action.inputs,     "inputs"));
      if (action.parameters) exprs.push(...scanForExpressions(action.parameters, "params"));
      if (action.expression) exprs.push(...scanForExpressions(action.expression, "condition"));
      if (exprs.length) groups.push({ name, type: action.type || "", exprs });
      if (action.actions) walk(action.actions);
      if (action.else?.actions) walk(action.else.actions);
      if (action.default?.actions) walk(action.default.actions);
      if (action.cases) for (const [, c] of Object.entries(action.cases)) if (c.actions) walk(c.actions);
    }
  }
  walk(actions);
  return groups;
}

// ── Render ────────────────────────────────────────────────────────────────────
let exprGroups = [];

function renderExprList(filter = "") {
  exprList.innerHTML = "";
  const lc = filter.trim().toLowerCase();
  const filtered = lc
    ? exprGroups.map(g => ({
        ...g,
        exprs: g.exprs.filter(e =>
          e.expr.toLowerCase().includes(lc) ||
          e.field.toLowerCase().includes(lc) ||
          g.name.toLowerCase().includes(lc)
        ),
      })).filter(g => g.exprs.length)
    : exprGroups;

  if (!filtered.length) {
    exprList.innerHTML = `<div class="expr-empty">${lc ? `No expressions match "${filter}"` : "No expressions found"}</div>`;
    return;
  }

  for (const group of filtered) {
    const groupEl = document.createElement("div");
    groupEl.className = "expr-group";

    const header = document.createElement("div");
    header.className = "expr-group-header";
    header.innerHTML = `
      <span class="expr-action-name" title="${group.name}">${group.name}</span>
      <span class="expr-action-type">${group.type}</span>
      <span class="expr-count-badge">${group.exprs.length}</span>
    `;
    header.addEventListener("click", () => groupEl.classList.toggle("expr-collapsed"));

    const items = document.createElement("div");
    items.className = "expr-items";

    for (const e of group.exprs) {
      const item = document.createElement("div");
      item.className = "expr-item";

      const fieldEl = document.createElement("span");
      fieldEl.className = "expr-field";
      fieldEl.textContent = e.field.split(".").pop() || e.field;
      fieldEl.title = e.field;

      const valEl = document.createElement("span");
      valEl.className = "expr-value";
      valEl.textContent = e.expr;

      const copyBtn = document.createElement("button");
      copyBtn.className = "expr-copy-btn";
      copyBtn.title = "Copy expression";
      copyBtn.innerHTML = `<i class="bi bi-clipboard"></i>`;
      copyBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await navigator.clipboard.writeText(e.expr);
        copyBtn.innerHTML = `<i class="bi bi-check2"></i>`;
        copyBtn.style.color = "var(--success)";
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="bi bi-clipboard"></i>`;
          copyBtn.style.color = "";
        }, 1500);
      });

      item.append(fieldEl, valEl, copyBtn);
      items.appendChild(item);
    }

    groupEl.append(header, items);
    exprList.appendChild(groupEl);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
let _debounce = null;
exprSearch.addEventListener("input", () => {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => renderExprList(exprSearch.value), 120);
});

exprCopyAllBtn.addEventListener("click", async () => {
  const allExprs = exprGroups.flatMap(g =>
    g.exprs.map(e => ({ action: g.name, field: e.field, expression: e.expr }))
  );
  await navigator.clipboard.writeText(JSON.stringify(allExprs, null, 2));
  showStatus("success", "All expressions copied!", `${allExprs.length} expression${allExprs.length !== 1 ? "s" : ""}`);
});

exprBtn.addEventListener("click", async () => {
  if (exprPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  hideStatus();
  setActiveBtn(exprBtn);
  exprBtn.disabled = true;
  exprBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Scanning…</span></div>`;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);
    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: "full", environmentId, flowId,
    });
    if (!result || result.error) { showStatus("error", "API error", result?.error || ""); return; }
    updateFlowStrip(result.displayName, tab.url);
    const innerDef  = result.definition?.properties?.definition;
    exprGroups      = buildExpressionGroups(innerDef?.actions || {});
    const totalExprs = exprGroups.reduce((n, g) => n + g.exprs.length, 0);
    exprSearch.value = "";
    renderExprList();
    exprMeta.textContent = `${exprGroups.length} action${exprGroups.length !== 1 ? "s" : ""} · ${totalExprs} expression${totalExprs !== 1 ? "s" : ""}`;
    exprCopyAllBtn.style.display = totalExprs ? "" : "none";
    exprPanel.classList.add("show");
  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    exprBtn.disabled = false;
    exprBtn.innerHTML = `<div class="tool-btn-icon"><i class="bi bi-braces-asterisk"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Expression Inspector</span><span class="tool-btn-desc">Scan and decode all flow expressions</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;
  }
});
