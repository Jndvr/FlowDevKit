/**
 * popup/panels/lint.js — Flow Linter / Analyzer panel
 */
import { flattenActions } from "../../shared/flow-utils.js";
import { resolveFlowContext, buildApiUrl } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, hideStatus, showStatus, updateFlowStrip } from "../ui.js";

const lintBtn        = document.getElementById("lintBtn");
const lintPanel      = document.getElementById("lintPanel");
const lintList       = document.getElementById("lintList");
const lintMeta       = document.getElementById("lintMeta");
const lintFooterMeta = document.getElementById("lintFooterMeta");
const lintCopyBtn    = document.getElementById("lintCopyBtn");

registerPanel(lintBtn, lintPanel);

// ── Lint rules ────────────────────────────────────────────────────────────────
function runLintRules(innerDef, flat) {
  const findings   = [];
  const actionsRaw = innerDef?.actions || {};
  const fullJson   = JSON.stringify(actionsRaw);

  function push(severity, rule, message, actionName) {
    findings.push({ severity, rule, message, actionName });
  }

  // Rule 1: Missing RunAfter
  const topLevel      = flat.filter(i => i.depth === 0);
  const emptyRunAfter = topLevel.filter(i => Object.keys(i.runAfterStatuses).length === 0);
  if (emptyRunAfter.length > 1) {
    for (const item of emptyRunAfter.slice(1)) {
      push("warn", "Missing RunAfter",
        "Action has no runAfter dependency — it may run in parallel unintentionally or be disconnected.",
        item.name);
    }
  }

  // Rule 2: Default / Unrenamed Action Names
  const DEFAULT_NAME_RE = [
    /^Compose(_\d+)?$/i, /^Condition(_\d+)?$/i, /^Apply_to_each(_\d+)?$/i,
    /^Do_until(_\d+)?$/i, /^Switch(_\d+)?$/i, /^Scope(_\d+)?$/i,
    /^Initialize_variable(_\d+)?$/i, /^Set_variable(_\d+)?$/i,
    /^Append_to_array_variable(_\d+)?$/i, /^Append_to_string_variable(_\d+)?$/i,
    /^Parse_JSON(_\d+)?$/i, /^Send_an_email(_\d+)?$/i,
    /^Get_items(_\d+)?$/i, /^Get_item(_\d+)?$/i,
    /^Create_item(_\d+)?$/i, /^Update_item(_\d+)?$/i, /^Delete_item(_\d+)?$/i,
    /^HTTP(_\d+)?$/i, /^Response(_\d+)?$/i, /^Terminate(_\d+)?$/i,
    /^Filter_array(_\d+)?$/i, /^Select(_\d+)?$/i, /^Join(_\d+)?$/i,
    /^Send_an_HTTP_request(_\d+)?$/i, /^Start_and_wait_for_an_approval(_\d+)?$/i,
    /^Post_a_message(_\d+)?$/i, /^Post_message_in_a_chat_or_channel(_\d+)?$/i,
  ];
  for (const item of flat) {
    if (DEFAULT_NAME_RE.some(re => re.test(item.name))) {
      push("info", "Default Name",
        "Action uses a default unrenamed title. Give it a descriptive name before deploying.",
        item.name);
    }
  }

  // Rule 3: Unused Initialized Variables
  for (const item of flat.filter(i => i.type === "InitializeVariable")) {
    const varName = item.action?.inputs?.variables?.[0]?.name;
    if (!varName) continue;
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`variables\\(["']${escaped}["']\\)`, "gi");
    if ((fullJson.match(re) || []).length <= 1) {
      push("warn", "Unused Variable",
        `Variable "${varName}" is initialized but never referenced in any expression.`,
        item.name);
    }
  }

  // Rule 4: Unhandled HTTP Failure
  for (const item of flat.filter(i => i.type === "Http")) {
    const handled = flat.some(i => {
      const s = i.runAfterStatuses[item.name] || [];
      return s.includes("Failed") || s.includes("TimedOut");
    });
    if (!handled) {
      push("warn", "Unhandled HTTP Failure",
        "HTTP action has no downstream error handler. Failures will be silently swallowed.",
        item.name);
    }
  }

  // Rule 5: Unreachable Terminate
  for (const item of flat.filter(i => i.type === "Terminate")) {
    const runStatus = item.action?.inputs?.runStatus;
    if (runStatus === "Failed" && Object.keys(item.runAfterStatuses).length === 0) {
      push("info", "Unreachable Terminate",
        "Terminate (Failed) has no runAfter — it may never actually be reached.",
        item.name);
    }
  }

  // Rule 6: Hardcoded URLs
  const URL_RE = /https?:\/\/[^\s"'\\]+/gi;
  const URL_WHITELIST = [
    /^https:\/\/login\.microsoftonline\.com/i,
    /^https:\/\/graph\.microsoft\.com/i,
    /^https:\/\/management\.azure\.com/i,
  ];
  const seenUrls = new Set();
  for (const item of flat) {
    const inputStr = JSON.stringify(item.action?.inputs || {});
    const matches = [...new Set(inputStr.match(URL_RE) || [])];
    for (const url of matches) {
      if (URL_WHITELIST.some(re => re.test(url))) continue;
      if (inputStr.includes(`@{`) && inputStr.indexOf(url) > inputStr.indexOf("@{")) continue;
      const key = `${item.name}::${url}`;
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      push("warn", "Hardcoded URL",
        `Hardcoded URL found: "${url.slice(0, 60)}${url.length > 60 ? "…" : ""}". Use a parameter or environment variable instead.`,
        item.name);
    }
  }

  // Rule 7: Hardcoded Email Addresses
  const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  // Teams thread IDs look like emails but aren't (e.g. *@thread.tacv2, *@thread.skype).
  // The email regex captures only the alpha TLD so "tacv2" becomes "tacv" — match on @thread. prefix only.
  const TEAMS_THREAD_RE = /@thread\./i;
  const seenEmails = new Set();
  for (const item of flat) {
    const inputs   = item.action?.inputs || {};
    const inputStr = JSON.stringify(inputs);
    const emails   = [...new Set(inputStr.match(EMAIL_RE) || [])];
    for (const email of emails) {
      if (TEAMS_THREAD_RE.test(email)) continue;              // skip Teams thread IDs
      const idx    = inputStr.indexOf(email);
      const before = inputStr.slice(Math.max(0, idx - 10), idx);
      if (before.includes("@{") || before.includes("@variables") || before.includes("@parameters")) continue;
      const key = `${item.name}::${email}`;
      if (seenEmails.has(key)) continue;
      seenEmails.add(key);
      push("warn", "Hardcoded Email",
        `Hardcoded email address "${email}" found. Hard-coded recipients break across environments and when staff change.`,
        item.name);
    }
  }

  // Rule 8: Missing Retry Policy on HTTP
  for (const item of flat.filter(i => i.type === "Http")) {
    const rp = item.action?.inputs?.retryPolicy;
    if (!rp || rp.type === "none") {
      push("info", "No Retry Policy",
        "HTTP action has no retry policy. Consider adding exponential backoff for transient failure resilience.",
        item.name);
    }
  }

  // Rule 9: Concurrent Loop + Variable Write (Race Condition)
  for (const item of flat.filter(i => i.type === "Foreach")) {
    const concurrency = item.action?.runtimeConfiguration?.concurrency?.repetitions ?? 1;
    if (concurrency <= 1) continue;
    const bodyFlat = flattenActions(item.action?.actions || {});
    const writesVar = bodyFlat.some(i =>
      ["SetVariable", "AppendToArrayVariable", "AppendToStringVariable",
        "IncrementVariable", "DecrementVariable"].includes(i.type)
    );
    if (writesVar) {
      push("error", "Race Condition",
        `Loop runs with concurrency ${concurrency} but its body writes to a variable. Results will be non-deterministic.`,
        item.name);
    }
  }

  // Rule 10: Terminate(Succeeded) Masking Errors
  for (const item of flat.filter(i => i.type === "Terminate")) {
    if (item.action?.inputs?.runStatus !== "Succeeded") continue;
    const runsAfterFailure = Object.entries(item.runAfterStatuses).some(
      ([, statuses]) => statuses.includes("Failed") || statuses.includes("TimedOut")
    );
    if (runsAfterFailure) {
      push("error", "Error Masking",
        "Terminate(Succeeded) runs after a failed action — this reports success even when the flow has failed. Monitoring and alerts will be blind to these failures.",
        item.name);
    }
  }

  // Rule 11: Empty Scope / Switch
  for (const item of flat.filter(i => i.type === "Scope")) {
    if (Object.keys(item.action?.actions || {}).length === 0) {
      push("info", "Empty Scope", "Scope contains no actions — it is dead code and can be removed.", item.name);
    }
  }
  for (const item of flat.filter(i => i.type === "Switch")) {
    const caseCount = Object.keys(item.action?.cases || {}).length;
    const hasDefault = !!item.action?.default?.actions;
    if (caseCount === 0 && !hasDefault) {
      push("info", "Empty Switch", "Switch has no cases and no default branch — it is dead code.", item.name);
    }
  }

  // Rule 12: SharePoint Get Items Without Row Limit
  for (const item of flat) {
    const apiId = item.action?.inputs?.host?.apiId || "";
    if (!apiId.toLowerCase().includes("sharepoint")) continue;
    const op = (item.action?.inputs?.host?.operationId || "").toLowerCase();
    if (!["getitems", "getlistitemsv2"].includes(op)) continue;
    if (!item.action?.inputs?.parameters?.["$top"]) {
      push("warn", "No Row Limit",
        "SharePoint 'Get items' has no $top limit. On large lists this causes throttling and timeouts. Set a limit or paginate explicitly.",
        item.name);
    }
  }

  // Rule 13: Nested Loops (O(n²) risk)
  for (const item of flat.filter(i => i.type === "Foreach")) {
    const innerLoops = flattenActions(item.action?.actions || {}).filter(i => i.type === "Foreach");
    if (innerLoops.length > 0) {
      push("warn", "Nested Loop",
        `Loop contains ${innerLoops.length} inner loop(s). Nested loops can cause O(n²) API calls and throttling on large datasets.`,
        item.name);
    }
  }

  // Rule 14: Legacy Shared Connections
  const connRefs = innerDef?.connectionReferences || {};
  for (const [key, ref] of Object.entries(connRefs)) {
    const hasLogical = !!(ref.connectionReferenceLogicalName || ref.connectionReferenceId);
    const isLegacy   = !hasLogical && (ref.connectionName || "").startsWith("shared-");
    if (isLegacy) {
      push("warn", "Legacy Connection",
        `Connection "${key}" uses a legacy shared connection without a connectionReferenceLogicalName. This breaks solution portability across environments.`,
        key);
    }
  }

  // Rule 15: Sensitive String Patterns
  const SECRET_PATTERNS = [
    { re: /\?sv=\d{4}-\d{2}-\d{2}&/i,          label: "Azure SAS token" },
    { re: /sig=[A-Za-z0-9%+/]{20,}/i,           label: "SAS signature" },
    { re: /AccountKey=[A-Za-z0-9+/]{40,}==/i,   label: "Storage account key" },
    { re: /[Aa]pi[_-]?[Kk]ey["']?\s*[:=]\s*["'][A-Za-z0-9\-_]{16,}/, label: "API key" },
    { re: /Basic\s+[A-Za-z0-9+/]{20,}={0,2}/,  label: "HTTP Basic auth credential" },
  ];
  const seenSecrets = new Set();
  for (const item of flat) {
    const inputStr = JSON.stringify(item.action?.inputs || {});
    for (const { re, label } of SECRET_PATTERNS) {
      if (!re.test(inputStr)) continue;
      const key = `${item.name}::${label}`;
      if (seenSecrets.has(key)) continue;
      seenSecrets.add(key);
      push("error", "Exposed Secret",
        `Possible ${label} detected in action inputs. Move secrets to Azure Key Vault or environment parameters.`,
        item.name);
    }
  }

  // Rule 16: Recurrence Without Timezone
  for (const [tName, tDef] of Object.entries(innerDef?.triggers || {})) {
    if (tDef.type !== "Recurrence") continue;
    const tz = tDef.recurrence?.timeZone || tDef.inputs?.recurrence?.timeZone;
    if (!tz) {
      push("warn", "No Timezone on Schedule",
        "Recurrence trigger has no timezone — it runs in UTC. Daylight saving time will silently shift execution by ±1 hour.",
        tName);
    }
  }

  // Rule 17: HTTP Trigger Without JSON Schema
  for (const [tName, tDef] of Object.entries(innerDef?.triggers || {})) {
    if (tDef.type !== "Request") continue;
    const schema    = tDef.inputs?.schema;
    const hasSchema = schema && Object.keys(schema).length > 0 && (schema.properties || schema.type === "object");
    if (!hasSchema) {
      push("info", "No Request Schema",
        "HTTP trigger has no JSON schema defined. Without a schema, body properties have no type safety and won't appear as dynamic content tokens.",
        tName);
    }
  }

  // Rule 18: Multiple Triggers
  const triggerCount = Object.keys(innerDef?.triggers || {}).length;
  if (triggerCount > 1) {
    push("error", "Multiple Triggers",
      `Flow definition contains ${triggerCount} trigger objects. Power Automate only supports one trigger — this flow may behave unpredictably.`,
      "Trigger");
  }

  // Rule 19: Do Until Without Max Count
  for (const item of flat.filter(i => i.type === "Until")) {
    const count = item.action?.limit?.count;
    if (count === undefined || count === null) {
      push("warn", "Do Until: No Max Count",
        "Until loop has no explicit iteration limit. Set a maximum count to prevent runaway loops if the exit condition is never met.",
        item.name);
    }
  }

  // Rule 20: Approval Without Timeout
  for (const item of flat) {
    const apiId = (item.action?.inputs?.host?.apiId || "").toLowerCase();
    const opId  = (item.action?.inputs?.host?.operationId || "").toLowerCase();
    if (!apiId.includes("approvals") && !opId.includes("approval")) continue;
    if (!opId.includes("startandwaitforanapproval") &&
        !opId.includes("createandwaitforapproval") &&
        !opId.includes("waitforapprovalresponse")) continue;
    if (!item.action?.limit?.timeout) {
      push("warn", "Approval: No Timeout",
        "Approval action has no timeout limit. If the approver never responds, this flow run stays active for up to 30 days.",
        item.name);
    }
  }

  // Rule 21: Hardcoded GUIDs
  {
    const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    // These parameter keys are set by the connector UI picker — the GUIDs inside are
    // expected configuration values, not user-typed literals that can be parameterized.
    const CONNECTOR_PICKER_KEYS = new Set([
      "groupid", "channelid", "teamid", "listid", "siteid", "sitecollectionid",
      "driveid", "folderid", "fileid", "itemid", "calendarid", "userid",
      "mailfolderid", "contactfolderid", "bucketid", "planid", "boardid",
      "spaceid", "messageid", "threadid", "conversationid",
    ]);
    const seenGuids = new Set();
    for (const item of flat) {
      // Build set of GUIDs that live inside known connector picker parameters
      const exemptGuids = new Set();
      const params = item.action?.inputs?.parameters || {};
      for (const [k, v] of Object.entries(params)) {
        // Keys can be slash-paths like "body/recipient/groupId" — check the last segment
        const lastSegment = k.split("/").pop().toLowerCase();
        if (!CONNECTOR_PICKER_KEYS.has(lastSegment)) continue;
        const str = typeof v === "string" ? v : JSON.stringify(v);
        (str.match(GUID_RE) || []).forEach(g => exemptGuids.add(g.toLowerCase()));
      }

      const inputStr = JSON.stringify(item.action?.inputs?.parameters || item.action?.inputs || {});
      const guids    = [...new Set(inputStr.match(GUID_RE) || [])];
      for (const guid of guids) {
        if (exemptGuids.has(guid.toLowerCase())) continue;   // connector picker value — skip
        const idx    = inputStr.indexOf(guid);
        const before = inputStr.slice(Math.max(0, idx - 15), idx);
        if (before.includes("@{") || before.includes("variables(") ||
            before.includes("parameters(") || before.includes("outputs(")) continue;
        const key = `${item.name}::${guid}`;
        if (seenGuids.has(key)) continue;
        seenGuids.add(key);
        push("warn", "Hardcoded GUID",
          `Hardcoded GUID "${guid}" found in inputs. This is likely an environment-specific ID that will break on promotion — use a parameter instead.`,
          item.name);
      }
    }
  }

  // Rule 22: Broken body()/outputs() References
  {
    const allActionNames = new Set(flat.map(i => i.name));
    const REF_RE = /(?:body|outputs)\(["']([^"']+)["']\)/gi;
    for (const item of flat) {
      const inputStr  = JSON.stringify(item.action?.inputs || {});
      const seenBroken = new Set();
      REF_RE.lastIndex = 0;
      let match;
      while ((match = REF_RE.exec(inputStr)) !== null) {
        const referencedName = match[1];
        if (allActionNames.has(referencedName)) continue;
        if (seenBroken.has(referencedName)) continue;
        seenBroken.add(referencedName);
        push("error", "Broken Reference",
          `Expression references action "${referencedName}" which does not exist in this flow. This will throw a runtime error.`,
          item.name);
      }
    }
  }

  // Rule 23: Get Items / List Rows Inside a Loop
  {
    const LIST_OPS = new Set([
      "getitems", "getlistitemsv2",
      "listrecords", "listrows", "listrowsv2",
      "getrows", "getrowsv2",
    ]);
    for (const item of flat.filter(i => i.type === "Foreach")) {
      const bodyFlat = flattenActions(item.action?.actions || {});
      for (const inner of bodyFlat) {
        const opId = (inner.action?.inputs?.host?.operationId || "").toLowerCase();
        if (!LIST_OPS.has(opId)) continue;
        push("warn", "List Query Inside Loop",
          `"${inner.name}" fetches a full list of records inside a loop — this is an N+1 query pattern. Move the list fetch outside the loop and filter in memory.`,
          item.name);
        break;
      }
    }
  }

  // Rule 24: Send Email Inside a Loop
  {
    const EMAIL_OPS = new Set([
      "sendmailv2", "sendmail", "sendemailv2", "sendemail", "sendhtmlemail", "sendemailwithoptions",
    ]);
    for (const item of flat.filter(i => i.type === "Foreach")) {
      const bodyFlat = flattenActions(item.action?.actions || {});
      for (const inner of bodyFlat) {
        const opId = (inner.action?.inputs?.host?.operationId || "").toLowerCase();
        if (!EMAIL_OPS.has(opId)) continue;
        push("warn", "Email Inside Loop",
          `"${inner.name}" sends an email on every loop iteration. This risks hitting connector throttle limits. Aggregate content and send a single email after the loop.`,
          item.name);
        break;
      }
    }
  }

  // Rule 25: Missing Error Boundary
  {
    const topLevelActions       = flat.filter(i => i.depth === 0);
    const hasTopLevelScope      = topLevelActions.some(i => i.type === "Scope");
    const hasTopLevelTerminate  = topLevelActions.some(i =>
      i.type === "Terminate" && Object.values(i.runAfterStatuses).some(s => s.includes("Failed"))
    );
    if (topLevelActions.length >= 4 && !hasTopLevelScope && !hasTopLevelTerminate) {
      push("info", "No Error Boundary",
        "Flow has no top-level Scope or error handling structure. Wrap the main logic in a Scope and add a 'Configure Run After' handler for failures and timeouts.",
        "Flow structure");
    }
  }

  // Rule 26: HTTP Action With Hardcoded Authorization Header
  {
    const AUTH_RE = /Bearer\s+[A-Za-z0-9\-_]{20,}|[Tt]oken\s+[A-Za-z0-9\-_]{20,}/;
    for (const item of flat.filter(i => i.type === "Http")) {
      const headers  = item.action?.inputs?.headers || {};
      const authHdr  = headers["Authorization"] || headers["authorization"] || "";
      if (AUTH_RE.test(authHdr)) {
        push("error", "Hardcoded Auth Token",
          "HTTP action has a hardcoded Authorization token in its headers. Tokens expire and create security exposure — use managed identity or Key Vault parameters instead.",
          item.name);
      }
    }
  }

  // Rule 27: Parse JSON Without Schema
  for (const item of flat.filter(i => i.type === "ParseJson")) {
    const schema = item.action?.inputs?.schema;
    const hasSchema = schema && (schema.properties || schema.type === "array" || schema.type === "object");
    if (!hasSchema) {
      push("warn", "Parse JSON: No Schema",
        "Parse JSON has no schema defined. Without a schema, output properties have no type safety and won't appear as dynamic content tokens in downstream actions.",
        item.name);
    }
  }

  // Rule 28: Long Delay at Top Level
  for (const item of flat.filter(i => i.depth === 0 && i.type === "Wait")) {
    const unit  = (item.action?.inputs?.interval?.unit  || "").toLowerCase();
    const count = item.action?.inputs?.interval?.count;
    const isLong = (unit === "hour" || unit === "day" || unit === "minute" && count >= 30);
    if (isLong) {
      push("info", "Long Delay Outside Scope",
        `Delay action (${count} ${unit}) runs at the top level. Long delays hold a flow run slot open — consider wrapping the full flow in a Scope with an error handler in case the run is abandoned.`,
        item.name);
    }
  }

  // Rule 29: Missing Flow Description
  if (!innerDef?.description || !innerDef.description.trim()) {
    push("info", "No Flow Description",
      "The flow has no description. Adding one makes it easier to understand the flow's purpose during review and solution import.",
      "Flow");
  }

  // Rule 30: Foreach With API Calls and Default Concurrency
  for (const item of flat.filter(i => i.type === "Foreach")) {
    const concurrency = item.action?.runtimeConfiguration?.concurrency?.repetitions;
    if (concurrency !== undefined) continue; // explicitly configured — fine
    const bodyFlat = flattenActions(item.action?.actions || {});
    const hasApiCall = bodyFlat.some(i =>
      i.type === "OpenApiConnection" || i.type === "OpenApiConnectionWebhook" || i.type === "Http"
    );
    if (hasApiCall) {
      push("info", "Loop: Concurrency Not Set",
        "Apply to each runs sequentially (concurrency = 1) by default. If order doesn't matter, set a concurrency limit (e.g. 5–10) in Settings to significantly speed up the loop.",
        item.name);
    }
  }

  // Rule 31: Response Action Without HTTP Request Trigger
  {
    const triggerTypes = Object.values(innerDef?.triggers || {}).map(t => t.type || "");
    const hasHttpTrigger = triggerTypes.some(t => t === "Request");
    if (!hasHttpTrigger) {
      for (const item of flat.filter(i => i.type === "Response")) {
        push("warn", "Response Without HTTP Trigger",
          `"${item.name}" is a Response action, but this flow is not triggered by an HTTP Request. The response will never be delivered to any caller — this action is dead code.`,
          item.name);
      }
    }
  }

  // Rule 32: Scope Without Downstream Error Handler
  for (const item of flat.filter(i => i.type === "Scope")) {
    const scopeActionCount = Object.keys(item.action?.actions || {}).length;
    if (scopeActionCount < 3) continue; // small scopes used as labels — not worth flagging
    const hasErrorHandler = flat.some(i => {
      const statuses = i.runAfterStatuses[item.name] || [];
      return statuses.includes("Failed") || statuses.includes("TimedOut");
    });
    if (!hasErrorHandler) {
      push("info", "Scope: No Error Handler",
        `Scope "${item.name}" contains ${scopeActionCount} actions but has no downstream handler configured to run after failure or timeout. Add a "Configure run after" error path to catch failures inside this scope.`,
        item.name);
    }
  }

  // Rule 33: High-Frequency Recurrence (< 5 minutes)
  for (const [tName, tDef] of Object.entries(innerDef?.triggers || {})) {
    if (tDef.type !== "Recurrence") continue;
    const freq     = (tDef.recurrence?.frequency || tDef.inputs?.recurrence?.frequency || "").toLowerCase();
    const interval = +(tDef.recurrence?.interval ?? tDef.inputs?.recurrence?.interval ?? 1);
    const isHighFreq = freq === "second" || (freq === "minute" && interval < 5);
    if (isHighFreq) {
      push("warn", "High-Frequency Schedule",
        `Recurrence trigger runs every ${interval} ${freq}(s). Flows executing more than once every 5 minutes consume significant Power Platform API call quota and can cause throttling during business hours.`,
        tName);
    }
  }

  // Rule 34: Initialize Variable Inside a Nested Branch or Scope
  for (const item of flat.filter(i => i.depth > 0 && i.type === "InitializeVariable")) {
    const varName = item.action?.inputs?.variables?.[0]?.name || item.name;
    push("info", "Variable Init Inside Branch",
      `Variable "${varName}" is initialized inside a nested scope or branch (depth ${item.depth}). Variables are global in Power Automate — initialize all variables at the top level so they always have a defined starting value regardless of which path executes.`,
      item.name);
  }

  // Rule 35: Condition With Empty Yes-Branch
  for (const item of flat.filter(i => i.type === "If")) {
    const yesCount = Object.keys(item.action?.actions || {}).length;
    const noCount  = Object.keys(item.action?.else?.actions || {}).length;
    if (yesCount === 0 && noCount === 0) {
      push("info", "Empty Condition",
        "Condition has no actions in either branch — it is dead code and can be safely removed.",
        item.name);
    } else if (yesCount === 0 && noCount > 0) {
      push("info", "Condition: Empty Yes-Branch",
        "Condition has an empty 'If yes' branch and all logic in 'If no'. Invert the condition expression so logic lives in the 'If yes' branch — this is easier to read and reduces nesting.",
        item.name);
    }
  }

  return findings;
}

// ── Metrics ───────────────────────────────────────────────────────────────────
function computeMetrics(innerDef, flat, findings) {
  // ── Complexity (cyclomatic-style) ─────────────────────────────────────────
  const condCount   = flat.filter(i => i.type === "If").length;
  const loopCount   = flat.filter(i => i.type === "Foreach" || i.type === "Until").length;
  const switchCases = flat.filter(i => i.type === "Switch")
    .reduce((n, i) => n + Object.keys(i.action?.cases || {}).length, 0);
  const maxDepth    = flat.reduce((m, i) => Math.max(m, i.depth), 0);
  const cc          = 1 + condCount + loopCount + switchCases;
  const complexLevel = cc <= 5 ? "Low" : cc <= 12 ? "Medium" : cc <= 25 ? "High" : "Very High";

  const complexReasons = [`CC: ${cc}  (1 + ${condCount} conditions + ${loopCount} loops + ${switchCases} switch cases)`,
    `${flat.length} total actions`, `max nesting depth: ${maxDepth}`];

  // ── Maintainability ───────────────────────────────────────────────────────
  let maintScore = 100;
  const maintReasons = [];

  const defaultNames = findings.filter(f => f.rule === "Default Name").length;
  if (defaultNames > 0) {
    maintScore -= Math.min(defaultNames * 3, 30);
    maintReasons.push(`${defaultNames} action${defaultNames !== 1 ? "s" : ""} use default names (−${Math.min(defaultNames * 3, 30)})`);
  }

  // Duplicate expressions: only long expressions (>30 chars) repeated in 4+ different actions
  const exprCounts = {};
  for (const item of flat) {
    for (const e of new Set(JSON.stringify(item.action?.inputs || {}).match(/@\{[^}]{30,100}\}/g) || []))
      exprCounts[e] = (exprCounts[e] || 0) + 1;
  }
  const dupExprs = Object.values(exprCounts).filter(c => c >= 4).length;
  if (dupExprs > 0) {
    maintScore -= Math.min(dupExprs * 5, 20);
    maintReasons.push(`${dupExprs} long expression${dupExprs !== 1 ? "s" : ""} repeated in 4+ actions (−${Math.min(dupExprs * 5, 20)})`);
  }

  const nestedConds = flat.filter(i => i.type === "If" && i.depth > 0).length;
  if (nestedConds > 0) {
    maintScore -= Math.min(nestedConds * 4, 16);
    maintReasons.push(`${nestedConds} nested condition${nestedConds !== 1 ? "s" : ""} (−${Math.min(nestedConds * 4, 16)})`);
  }

  // Deep nesting: actions at depth > 3
  const deepActions = flat.filter(i => i.depth > 3).length;
  if (deepActions > 0) {
    maintScore -= Math.min(deepActions * 2, 14);
    maintReasons.push(`${deepActions} action${deepActions !== 1 ? "s" : ""} at depth > 3 (−${Math.min(deepActions * 2, 14)})`);
  }

  // Large flow
  if (flat.length > 50) {
    maintScore -= 10;
    maintReasons.push(`${flat.length} actions — consider splitting into child flows (−10)`);
  }

  const unusedVars = findings.filter(f => f.rule === "Unused Variable").length;
  if (unusedVars > 0) {
    maintScore -= Math.min(unusedVars * 3, 12);
    maintReasons.push(`${unusedVars} unused variable${unusedVars !== 1 ? "s" : ""} (−${Math.min(unusedVars * 3, 12)})`);
  }

  if (findings.some(f => f.rule === "No Flow Description")) {
    maintScore -= 10;
    maintReasons.push("no flow description (−10)");
  }

  maintScore = Math.max(0, maintScore);
  const maintLevel = maintScore >= 80 ? "Good" : maintScore >= 60 ? "Fair" : maintScore >= 40 ? "Poor" : "Critical";
  if (!maintReasons.length) maintReasons.push("No issues detected");

  // ── Reliability ───────────────────────────────────────────────────────────
  let reliRisk = 0;
  const reliReasons = [];

  const raceConditions   = findings.filter(f => f.rule === "Race Condition").length;
  const errorMasking     = findings.filter(f => f.rule === "Error Masking").length;
  const secrets          = findings.filter(f => f.rule === "Exposed Secret" || f.rule === "Hardcoded Auth Token").length;
  const brokenRefs       = findings.filter(f => f.rule === "Broken Reference").length;
  const unhandledHttp    = findings.filter(f => f.rule === "Unhandled HTTP Failure").length;
  const noRetry          = findings.filter(f => f.rule === "No Retry Policy").length;
  const noErrBoundary    = findings.some(f => f.rule === "No Error Boundary");
  const runawayLoop      = findings.filter(f => f.rule === "Do Until: No Max Count").length;
  const approvalNoTimeout = findings.filter(f => f.rule === "Approval: No Timeout").length;
  const legacyConn       = findings.filter(f => f.rule === "Legacy Connection").length;

  if (raceConditions > 0)    { reliRisk += 30; reliReasons.push(`${raceConditions} race condition${raceConditions !== 1 ? "s" : ""} in loops (+30)`); }
  if (errorMasking > 0)      { reliRisk += 25; reliReasons.push("error masking hides failures (+25)"); }
  if (secrets > 0)           { reliRisk += 25; reliReasons.push("hardcoded credentials detected (+25)"); }
  if (brokenRefs > 0)        { reliRisk += 20; reliReasons.push(`${brokenRefs} broken expression reference${brokenRefs !== 1 ? "s" : ""} (+20)`); }
  if (unhandledHttp > 0)     { reliRisk += 15; reliReasons.push(`${unhandledHttp} unhandled HTTP failure${unhandledHttp !== 1 ? "s" : ""} (+15)`); }
  if (approvalNoTimeout > 0) { reliRisk += 10; reliReasons.push(`${approvalNoTimeout} approval${approvalNoTimeout !== 1 ? "s" : ""} without timeout (+10)`); }
  if (noRetry > 0)           { reliRisk += 10; reliReasons.push(`${noRetry} HTTP action${noRetry !== 1 ? "s" : ""} without retry (+10)`); }
  if (noErrBoundary)         { reliRisk +=  5; reliReasons.push("no top-level error boundary (+5)"); }
  if (legacyConn > 0)        { reliRisk +=  8; reliReasons.push(`${legacyConn} legacy connection${legacyConn !== 1 ? "s" : ""} (+8)`); }
  if (runawayLoop > 0)       { reliRisk +=  5; reliReasons.push("runaway loop risk (+5)"); }

  reliRisk = Math.min(reliRisk, 100);
  const reliLevel = reliRisk < 15 ? "Low" : reliRisk < 35 ? "Medium" : reliRisk < 60 ? "High" : "Critical";
  if (!reliReasons.length) reliReasons.push("No issues detected");

  return {
    complexity:      { cc, level: complexLevel,  reasons: complexReasons },
    maintainability: { score: maintScore, level: maintLevel,  reasons: maintReasons },
    reliability:     { risk: reliRisk,    level: reliLevel,   reasons: reliReasons },
  };
}

function renderMetrics(metrics, container) {
  const CLS = { Low: "good", Good: "good", Fair: "warn", Medium: "warn", High: "bad", Poor: "bad", "Very High": "bad", Critical: "bad" };
  const row = document.createElement("div");
  row.className = "metrics-row";

  const cards = [
    {
      label: "COMPLEXITY",
      value: metrics.complexity.level,
      sub: `CC = ${metrics.complexity.cc}`,
      cls: CLS[metrics.complexity.level],
      reasons: metrics.complexity.reasons,
    },
    {
      label: "MAINTAINABILITY",
      value: metrics.maintainability.level,
      sub: `${metrics.maintainability.score} / 100`,
      cls: CLS[metrics.maintainability.level],
      reasons: metrics.maintainability.reasons,
    },
    {
      label: "RELIABILITY",
      value: metrics.reliability.level === "Low" ? "Good" : `${metrics.reliability.level} Risk`,
      sub: metrics.reliability.risk === 0 ? "No issues" : `${metrics.reliability.risk} risk pts`,
      cls: CLS[metrics.reliability.level],
      reasons: metrics.reliability.reasons,
    },
  ];

  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "metric-card";
    el.title = card.reasons.map(r => `• ${r}`).join("\n");
    el.innerHTML = `
      <div class="metric-label">${card.label}</div>
      <div class="metric-value ${card.cls}">${card.value}</div>
      <div class="metric-sub">${card.sub}</div>`;
    row.appendChild(el);
  }
  container.appendChild(row);
}

// ── Render panel ──────────────────────────────────────────────────────────────
function renderLintPanel(findings, metrics, flowName) {
  lintList.innerHTML = "";
  renderMetrics(metrics, lintList);

  if (!findings.length) {
    const empty = document.createElement("div");
    empty.className = "lint-empty";
    empty.textContent = `✓ No issues found in "${flowName}"`;
    lintList.appendChild(empty);
    lintMeta.textContent = "All clear";
    lintFooterMeta.textContent = "0 findings";
    lintCopyBtn.style.display = "none";
    return;
  }

  const groups = [
    { key: "error", label: "Errors",      icon: "⛔", findings: findings.filter(f => f.severity === "error") },
    { key: "warn",  label: "Warnings",    icon: "⚠️",  findings: findings.filter(f => f.severity === "warn")  },
    { key: "info",  label: "Suggestions", icon: "💡", findings: findings.filter(f => f.severity === "info")  },
  ].filter(g => g.findings.length > 0);

  for (const group of groups) {
    const header = document.createElement("div");
    header.className = "lint-section-header";
    const countBadge = document.createElement("span");
    countBadge.className = `lint-section-count ${group.key}`;
    countBadge.textContent = group.findings.length;
    header.append(group.icon, " ", group.label, " ", countBadge);
    lintList.appendChild(header);

    for (const f of group.findings) {
      const item = document.createElement("div");
      item.className = "lint-item";

      const sev  = document.createElement("span");
      sev.className = "lint-sev";
      sev.textContent = group.icon;

      const body = document.createElement("div");
      body.className = "lint-body";

      const msg = document.createElement("div");
      msg.className = "lint-msg";
      msg.textContent = f.message;

      const actionLabel = document.createElement("div");
      actionLabel.className = "lint-action";
      actionLabel.title = f.actionName;
      actionLabel.textContent = `${f.rule}  ·  ${f.actionName}`;

      body.append(msg, actionLabel);
      item.append(sev, body);
      lintList.appendChild(item);
    }
  }

  const total     = findings.length;
  const warnCount = findings.filter(f => f.severity !== "info").length;
  const infoCount = findings.filter(f => f.severity === "info").length;
  lintMeta.textContent = `${total} finding${total !== 1 ? "s" : ""}`;
  lintFooterMeta.textContent = `${warnCount} warning${warnCount !== 1 ? "s" : ""} · ${infoCount} suggestion${infoCount !== 1 ? "s" : ""}`;
  lintCopyBtn.style.display = "";
}

// ── Event listeners ───────────────────────────────────────────────────────────
lintCopyBtn.addEventListener("click", () => {
  const lines = [];
  for (const row of lintList.querySelectorAll(".lint-item")) {
    const msg    = row.querySelector(".lint-msg")?.textContent    || "";
    const action = row.querySelector(".lint-action")?.textContent || "";
    lines.push(`[${action}] ${msg}`);
  }
  navigator.clipboard.writeText(lines.join("\n")).then(() => {
    const orig = lintCopyBtn.textContent;
    lintCopyBtn.textContent = "✓ Copied!";
    setTimeout(() => { lintCopyBtn.textContent = orig; }, 1400);
  });
});

lintBtn.addEventListener("click", async () => {
  if (lintPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();
  hideStatus();
  setActiveBtn(lintBtn);
  lintBtn.disabled = true;
  lintBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Analyzing…</span></div>`;

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
    const findings = runLintRules(innerDef, flat);
    const metrics  = computeMetrics(innerDef, flat, findings);
    renderLintPanel(findings, metrics, result.displayName || "this flow");
    lintPanel.classList.add("show");
  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
  } finally {
    lintBtn.disabled = false;
    lintBtn.innerHTML = `<div class="tool-btn-icon"><i class="bi bi-shield-check"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Analyze Flow</span><span class="tool-btn-desc">Audit flow against best practices</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;
  }
});
