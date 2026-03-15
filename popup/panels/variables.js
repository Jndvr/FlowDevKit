/**
 * popup/panels/variables.js — Variable Tracker panel
 */
import { resolveFlowContext, buildApiUrl } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, hideStatus, showStatus, updateFlowStrip } from "../ui.js";

const varsBtn     = document.getElementById("varsBtn");
const varsPanel   = document.getElementById("varsPanel");
const varsList    = document.getElementById("varsList");
const varsMeta    = document.getElementById("varsMeta");
const varsCopyBtn = document.getElementById("varsCopyBtn");

registerPanel(varsBtn, varsPanel);

// ── Extract variables from an action map (recursive) ─────────────────────────
function extractVariables(actions) {
  const initVars = [];
  const setVars  = [];

  function walk(actionMap) {
    if (!actionMap || typeof actionMap !== "object") return;
    for (const [name, action] of Object.entries(actionMap)) {
      if (action.type === "InitializeVariable") {
        const v = action.inputs?.variables?.[0];
        if (v) initVars.push({ name: v.name || name, type: v.type || "Unknown", value: v.value });
      }
      if (action.type === "SetVariable") {
        const inp = action.inputs || {};
        setVars.push({ varName: inp.name || "?", value: inp.value, actionName: name });
      }
      if (action.actions) walk(action.actions);
      if (action.else?.actions) walk(action.else.actions);
      if (action.default?.actions) walk(action.default.actions);
      if (action.cases) for (const c of Object.values(action.cases)) walk(c.actions);
    }
  }
  walk(actions);
  return { initVars, setVars };
}

// ── Button handler ────────────────────────────────────────────────────────────
varsBtn.addEventListener("click", async () => {
  if (varsPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  hideStatus();
  setActiveBtn(varsBtn);
  varsBtn.disabled = true;
  varsBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Loading…</span></div>`;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl, ppApiUrl, previewApiUrl } = buildApiUrl(flowId, environmentId);

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_FLOW", apiUrl, ppApiUrl, previewApiUrl,
      token, tokens, mode: "full", environmentId, flowId,
    });
    if (!result || result.error) { showStatus("error", "API error", result?.error || ""); return; }

    updateFlowStrip(result.displayName, tab.url);

    const innerDef = result.definition?.properties?.definition;
    const { initVars, setVars } = extractVariables(innerDef?.actions || {});

    varsList.innerHTML = "";
    const totalVars = initVars.length;

    if (!totalVars && !setVars.length) {
      varsList.innerHTML = `<div class="vars-empty">No variables found in this flow</div>`;
      varsMeta.textContent = "";
    } else {
      varsMeta.textContent = `${totalVars} var${totalVars !== 1 ? "s" : ""} · ${setVars.length} set${setVars.length !== 1 ? "s" : ""}`;
      const TYPE_COLORS = { String: 1, Integer: 1, Float: 1, Boolean: 1, Array: 1, Object: 1 };

      if (initVars.length) {
        const secHeader = document.createElement("div");
        secHeader.className = "var-section-header";
        secHeader.textContent = "Initialized";
        varsList.appendChild(secHeader);

        for (const v of initVars) {
          const row    = document.createElement("div");
          row.className = "var-row";
          const nameEl = document.createElement("span");
          nameEl.className = "var-name"; nameEl.textContent = v.name; nameEl.title = v.name;
          const typeEl = document.createElement("span");
          const typeClass = TYPE_COLORS[v.type] ? v.type : "default";
          typeEl.className = `var-type ${typeClass}`; typeEl.textContent = v.type;
          const valEl = document.createElement("span");
          valEl.className = "var-value";
          const valStr = v.value === null || v.value === undefined ? "—"
            : typeof v.value === "object" ? JSON.stringify(v.value) : String(v.value);
          valEl.textContent = valStr; valEl.title = valStr;
          row.append(nameEl, typeEl, valEl);
          varsList.appendChild(row);
        }
      }

      if (setVars.length) {
        const secHeader2 = document.createElement("div");
        secHeader2.className = "var-section-header";
        secHeader2.textContent = "Set Operations";
        varsList.appendChild(secHeader2);

        for (const sv of setVars) {
          const row    = document.createElement("div");
          row.className = "var-row";
          const nameEl = document.createElement("span");
          nameEl.className = "var-name"; nameEl.textContent = sv.varName; nameEl.title = sv.varName;
          const actionEl = document.createElement("span");
          actionEl.className = "var-set-action"; actionEl.textContent = sv.actionName; actionEl.title = sv.actionName;
          const valEl = document.createElement("span");
          valEl.className = "var-value";
          const valStr = sv.value === null || sv.value === undefined ? "—"
            : typeof sv.value === "object" ? JSON.stringify(sv.value) : String(sv.value);
          valEl.textContent = valStr; valEl.title = valStr;
          row.append(nameEl, actionEl, valEl);
          varsList.appendChild(row);
        }
      }
    }

    if (initVars.length) {
      varsCopyBtn.style.display = "";
      varsCopyBtn.onclick = async () => {
        const json = JSON.stringify(initVars.map(v => ({
          name: v.name, type: v.type,
          ...(v.value !== null && v.value !== undefined ? { initialValue: v.value } : {}),
        })), null, 2);
        await navigator.clipboard.writeText(json);
        varsCopyBtn.textContent = "✓ Copied!";
        varsCopyBtn.style.borderColor = "var(--success)";
        varsCopyBtn.style.color = "var(--success)";
        setTimeout(() => {
          varsCopyBtn.textContent = "Copy all";
          varsCopyBtn.style.borderColor = "";
          varsCopyBtn.style.color = "";
        }, 1800);
      };
    } else {
      varsCopyBtn.style.display = "none";
    }

    varsPanel.classList.add("show");

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    varsBtn.disabled = false;
    varsBtn.innerHTML = `<div class="tool-btn-icon"><i class="bi bi-collection"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Variable Tracker</span><span class="tool-btn-desc">Find and track all flow variables</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;
  }
});
