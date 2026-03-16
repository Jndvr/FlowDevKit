/**
 * popup/panels/child-flow-nav.js — Child Flow Navigator
 *
 * Scans the current flow for actions that call child flows (built-in Workflow
 * type, or connector-based InvokeFlow) and shows each one with an "Open" button
 * that navigates the Power Automate tab to that child flow.
 */
import { flattenActions } from "../../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, showStatus, hideStatus, updateFlowStrip } from "../ui.js";

const childFlowBtn   = document.getElementById("childFlowBtn");
const childFlowPanel = document.getElementById("childFlowPanel");
const childFlowList  = document.getElementById("childFlowList");

registerPanel(childFlowBtn, childFlowPanel);

const BTN_HTML = `<div class="tool-btn-icon"><i class="bi bi-diagram-3"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Child Flows</span><span class="tool-btn-desc">Navigate to called child flows</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;

// ── Detection ─────────────────────────────────────────────────────────────────
function detectChildFlows(flat) {
  const children = [];

  for (const item of flat) {
    const type      = item.type || "";
    const inputs    = item.action?.inputs || {};
    const apiId     = (inputs.host?.apiId      || "").toLowerCase();
    const opId      = (inputs.host?.operationId || "").toLowerCase();

    // ① Built-in "Run a Child Flow" (type: Workflow)
    if (type === "Workflow") {
      const ref = inputs.host?.workflowReferenceName
               || inputs.host?.workflow?.id
               || inputs.workflowId
               || "";
      children.push({
        actionName: item.name,
        kind:       "Built-in",
        flowId:     ref,
        flowName:   item.action?.metadata?.flowDisplayName || ref || "Child Flow",
      });
      continue;
    }

    // ② Connector-based InvokeFlow (shared_flowmanagement / shared_logicflows)
    if (opId === "invokeflow" &&
        (apiId.includes("shared_flowmanagement") || apiId.includes("shared_logicflows"))) {
      const flowId = inputs.parameters?.workflowId
                  || inputs.parameters?.FlowId
                  || inputs.parameters?.["workflowId"]
                  || "";
      children.push({
        actionName: item.name,
        kind:       "Connector",
        flowId,
        flowName:   flowId || "Child Flow",
      });
      continue;
    }

    // ③ OpenApiConnectionWebhook InvokeFlow
    if (type === "OpenApiConnectionWebhook" && opId === "invokeflow") {
      const flowId = inputs.parameters?.workflowId || inputs.parameters?.FlowId || "";
      children.push({ actionName: item.name, kind: "Webhook", flowId, flowName: flowId || "Child Flow" });
    }
  }
  return children;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderChildFlowList(children, environmentId, paTabId) {
  childFlowList.innerHTML = "";

  if (!children.length) {
    childFlowList.innerHTML = `<div class="child-flow-empty">No child flow calls detected in this flow.</div>`;
    return;
  }

  for (const child of children) {
    const row = document.createElement("div");
    row.className = "child-flow-row";

    const info = document.createElement("div");
    info.className = "child-flow-info";

    const nameEl = document.createElement("div");
    nameEl.className = "child-flow-action";
    nameEl.textContent = child.actionName;

    const meta = document.createElement("div");
    meta.className = "child-flow-meta";
    meta.innerHTML = `<span class="child-flow-kind">${child.kind}</span>${child.flowId ? ` · <span class="child-flow-id">${child.flowId}</span>` : ""}`;

    info.append(nameEl, meta);

    const openBtn = document.createElement("button");
    openBtn.className = "child-flow-open-btn";
    openBtn.textContent = "Open";
    openBtn.disabled = !child.flowId;
    openBtn.title = child.flowId
      ? "Open child flow in Power Automate"
      : "Flow ID could not be resolved from the action definition";

    if (child.flowId) {
      openBtn.addEventListener("click", async () => {
        const childUrl = `https://make.powerautomate.com/environments/${environmentId}/flows/${child.flowId}/details`;
        if (paTabId) {
          chrome.tabs.update(paTabId, { url: childUrl, active: true });
        } else {
          chrome.tabs.create({ url: childUrl });
        }
      });
    }

    row.append(info, openBtn);
    childFlowList.appendChild(row);
  }
}

// ── Event listener ────────────────────────────────────────────────────────────
childFlowBtn.addEventListener("click", async () => {
  if (childFlowPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  hideStatus();
  setActiveBtn(childFlowBtn);
  childFlowBtn.disabled = true;
  childFlowBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Scanning…</span></div>`;

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
    const flat     = flattenActions(innerDef?.actions || {});
    const children = detectChildFlows(flat);

    renderChildFlowList(children, environmentId, tab.id);
    childFlowPanel.classList.add("show");
  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    childFlowBtn.disabled = false;
    childFlowBtn.innerHTML = BTN_HTML;
  }
});
