/**
 * popup/panels/env-vars.js — Environment Variables panel
 *
 * Fetches Dataverse environmentvariabledefinition records for the current
 * environment and lets developers browse + copy @parameters('schemaname')
 * references for use in flow expressions.
 */
import { resolveFlowContext } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, showStatus, hideStatus } from "../ui.js";

const envVarsBtn    = document.getElementById("envVarsBtn");
const envVarsPanel  = document.getElementById("envVarsPanel");
const envVarsList   = document.getElementById("envVarsList");
const envVarsSearch = document.getElementById("envVarsSearch");
const envVarsMeta   = document.getElementById("envVarsMeta");

registerPanel(envVarsBtn, envVarsPanel);

// ── Type metadata ─────────────────────────────────────────────────────────────
const TYPE_LABELS = {
  100000000: "String",
  100000001: "Number",
  100000002: "Boolean",
  100000003: "JSON",
  100000004: "Data Source",
  100000005: "Secret",
};

const TYPE_CLASSES = {
  100000000: "ev-type-string",
  100000001: "ev-type-number",
  100000002: "ev-type-bool",
  100000003: "ev-type-json",
  100000004: "ev-type-datasource",
  100000005: "ev-type-secret",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Extract the current value from the OData expand result or fall back to defaultvalue. */
function getCurrentValue(v) {
  // Correct Dataverse OData navigation property for the 1:N relationship
  const values = v.environmentvariabledefinition_environmentvariablevalue
               || v.environmentvariablevalues
               || [];
  const currentVal = (Array.isArray(values) && values.length > 0)
    ? values[0].value
    : (v.defaultvalue ?? null);
  return currentVal !== null && currentVal !== undefined ? String(currentVal) : null;
}

// ── State ─────────────────────────────────────────────────────────────────────
let _allVars = [];

// ── Render ────────────────────────────────────────────────────────────────────
function renderVars(filter = "") {
  envVarsList.innerHTML = "";
  const lc = filter.trim().toLowerCase();
  const vars = lc
    ? _allVars.filter(v =>
        (v.displayname  || "").toLowerCase().includes(lc) ||
        (v.schemaname   || "").toLowerCase().includes(lc) ||
        (v.description  || "").toLowerCase().includes(lc)
      )
    : _allVars;

  if (!vars.length) {
    envVarsList.innerHTML = `<div class="ev-empty">${
      lc ? `No variables match "${filter}"` : "No environment variables found in this environment"
    }</div>`;
    return;
  }

  for (const v of vars) {
    const typeCode  = v.type;
    const typeLabel = TYPE_LABELS[typeCode] || `Type ${typeCode}`;
    const typeClass = TYPE_CLASSES[typeCode] || "ev-type-default";
    const isSecret  = typeCode === 100000005;
    const refSyntax = `@parameters('${v.schemaname}')`;

    const rawVal     = isSecret ? null : getCurrentValue(v);
    const isLong     = rawVal !== null && rawVal.length > 64;
    const displayVal = rawVal !== null
      ? (isLong ? rawVal.slice(0, 61) + "…" : rawVal)
      : (isSecret ? "••••••" : null);
    const expandable = rawVal !== null && !isSecret; // secrets stay hidden

    const row = document.createElement("div");
    row.className = "ev-row" + (expandable ? " ev-row-expandable" : "");

    // ── Top row: display name · type badge · copy-ref button ──────────────
    const topRow = document.createElement("div");
    topRow.className = "ev-top";

    const nameEl = document.createElement("span");
    nameEl.className = "ev-name";
    nameEl.textContent = v.displayname || v.schemaname;
    nameEl.title = v.description
      ? `${v.displayname}\n\n${v.description}`
      : (v.displayname || v.schemaname);

    const typeEl = document.createElement("span");
    typeEl.className = `ev-type ${typeClass}`;
    typeEl.textContent = typeLabel;

    const copyRefBtn = document.createElement("button");
    copyRefBtn.className = "ev-copy-btn";
    copyRefBtn.title = `Copy: ${refSyntax}`;
    copyRefBtn.innerHTML = `<i class="bi bi-at"></i>`;
    copyRefBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(refSyntax);
      copyRefBtn.innerHTML = `<i class="bi bi-check2"></i>`;
      copyRefBtn.style.color = "var(--success)";
      setTimeout(() => {
        copyRefBtn.innerHTML = `<i class="bi bi-at"></i>`;
        copyRefBtn.style.color = "";
      }, 1500);
    });

    topRow.append(nameEl, typeEl, copyRefBtn);

    // ── Bottom row: schema name · current value ────────────────────────────
    const bottomRow = document.createElement("div");
    bottomRow.className = "ev-bottom";

    const schemaEl = document.createElement("span");
    schemaEl.className = "ev-schema";
    schemaEl.textContent = v.schemaname;
    schemaEl.title = refSyntax;
    bottomRow.appendChild(schemaEl);

    if (displayVal !== null) {
      const sep = document.createElement("span");
      sep.className = "ev-val-sep";
      sep.textContent = "=";
      const valEl = document.createElement("span");
      valEl.className = isSecret ? "ev-value ev-value-secret" : "ev-value";
      valEl.textContent = displayVal;
      bottomRow.append(sep, valEl);
    }

    if (expandable) {
      const chevron = document.createElement("i");
      chevron.className = "bi bi-chevron-down ev-chevron";
      bottomRow.appendChild(chevron);
    }

    // ── Expanded panel: full value + copy ─────────────────────────────────
    let expandPanel = null;
    if (expandable) {
      expandPanel = document.createElement("div");
      expandPanel.className = "ev-expand";

      const pre = document.createElement("pre");
      pre.className = "ev-expand-val";
      pre.textContent = rawVal;
      expandPanel.appendChild(pre);

      const copyValBtn = document.createElement("button");
      copyValBtn.className = "ev-copy-val-btn";
      copyValBtn.innerHTML = `<i class="bi bi-clipboard"></i> Copy value`;
      copyValBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(rawVal);
        copyValBtn.innerHTML = `<i class="bi bi-check2"></i> Copied`;
        setTimeout(() => { copyValBtn.innerHTML = `<i class="bi bi-clipboard"></i> Copy value`; }, 1500);
      });
      expandPanel.appendChild(copyValBtn);

      row.addEventListener("click", () => {
        const open = row.classList.toggle("ev-expanded");
        chevron.className = `bi bi-chevron-${open ? "up" : "down"} ev-chevron`;
      });
    }

    row.append(topRow, bottomRow);
    if (expandPanel) row.appendChild(expandPanel);
    envVarsList.appendChild(row);
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
let _debounce = null;
envVarsSearch.addEventListener("input", () => {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => renderVars(envVarsSearch.value), 120);
});

// ── Button handler ────────────────────────────────────────────────────────────
const BTN_HTML = `<div class="tool-btn-icon"><i class="bi bi-sliders"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Environment Variables</span><span class="tool-btn-desc">Browse Dataverse env vars &amp; copy references</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;

envVarsBtn.addEventListener("click", async () => {
  if (envVarsPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  hideStatus();
  setActiveBtn(envVarsBtn);
  envVarsBtn.disabled = true;
  envVarsBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Loading…</span></div>`;

  try {
    const { environmentId, tokens } = await resolveFlowContext();

    const result = await chrome.runtime.sendMessage({
      type: "FETCH_ENV_VARS", environmentId, tokens,
    });

    if (!result?.ok) {
      if (result?.authRequired) {
        // Show an actionable inline state instead of a dead-end toast
        _allVars = [];
        envVarsMeta.textContent = "";
        envVarsList.innerHTML = "";
        const errDiv = document.createElement("div");
        errDiv.className = "ev-auth-error";
        errDiv.innerHTML = `
          <i class="bi bi-shield-lock ev-auth-icon"></i>
          <div class="ev-auth-title">Dataverse token not found</div>
          <div class="ev-auth-desc">
            No Dataverse token found in any open tab. Open the
            <strong>Tables</strong> page in Power Apps — that forces a
            Dataverse sign-in — then come back and try again.
          </div>
          <div class="ev-auth-steps">
            <div class="ev-auth-step"><span class="ev-auth-step-num">1</span>Click <strong>Open Dataverse Tables</strong> below</div>
            <div class="ev-auth-step"><span class="ev-auth-step-num">2</span>Wait for the table list to finish loading</div>
            <div class="ev-auth-step"><span class="ev-auth-step-num">3</span>Come back here and click <strong>Environment Variables</strong> again</div>
          </div>
        `;
        const openBtn = document.createElement("button");
        openBtn.className = "ev-auth-open-btn";
        openBtn.innerHTML = `<i class="bi bi-box-arrow-up-right"></i> Open Dataverse Tables`;
        openBtn.addEventListener("click", () => {
          chrome.tabs.create({ url: `https://make.powerapps.com/environments/${environmentId}/data/tables` });
        });
        errDiv.appendChild(openBtn);
        envVarsList.appendChild(errDiv);
        envVarsPanel.classList.add("show");
      } else {
        showStatus("error", "Could not load env vars", result?.error || "Unknown error");
      }
      return;
    }

    _allVars = result.vars || [];
    const count = _allVars.length;
    envVarsMeta.textContent = `${count} variable${count !== 1 ? "s" : ""}`;
    envVarsSearch.value = "";
    renderVars();
    envVarsPanel.classList.add("show");

  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    envVarsBtn.disabled = false;
    envVarsBtn.innerHTML = BTN_HTML;
  }
});
