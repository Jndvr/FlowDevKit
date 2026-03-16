// depth limit of 10: Power Automate flows rarely nest more than 5–6 levels deep
// in practice; 10 gives a generous safety margin without risking stack overflows
// on malformed or adversarially-crafted flow JSON.
export function countActions(actions, depth = 0) {
  if (!actions || typeof actions !== "object" || depth > 10) return 0;
  let n = 0;
  for (const a of Object.values(actions)) {
    n++;
    if (a.actions) n += countActions(a.actions, depth + 1);
    if (a.else?.actions) n += countActions(a.else.actions, depth + 1);
    if (a.default?.actions) n += countActions(a.default.actions, depth + 1);
    if (a.cases) for (const c of Object.values(a.cases))
      if (c.actions) n += countActions(c.actions, depth + 1);
  }
  return n;
}

// depth limit of 15: slightly higher than action traversal because connection
// references and authentication objects can be deeply nested inside inputs.
export function normalizeAuth(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 15) return obj;
  if (Array.isArray(obj)) return obj.map(v => normalizeAuth(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "authentication" && v && typeof v === "object" && (v.type === "Raw" || v.value)) {
      out[k] = "@parameters('$authentication')";
    } else {
      out[k] = normalizeAuth(v, depth + 1);
    }
  }
  return out;
}

export function ensureAuth(actionsOrTriggers) {
  if (!actionsOrTriggers || typeof actionsOrTriggers !== "object") return actionsOrTriggers;
  const NEEDS_AUTH = /^OpenApiConnection/i;
  for (const [, def] of Object.entries(actionsOrTriggers)) {
    if (!def || typeof def !== "object") continue;
    if (NEEDS_AUTH.test(def.type || "") && def.inputs) {
      if (!def.inputs.authentication || (typeof def.inputs.authentication === "object" &&
          (def.inputs.authentication.type === "Raw" || def.inputs.authentication.value))) {
        def.inputs.authentication = "@parameters('$authentication')";
      }
    }
    if (def.actions) ensureAuth(def.actions);
    if (def.else?.actions) ensureAuth(def.else.actions);
    if (def.default?.actions) ensureAuth(def.default.actions);
    if (def.cases) for (const c of Object.values(def.cases)) if (c.actions) ensureAuth(c.actions);
  }
  return actionsOrTriggers;
}

// Converts raw API connectionReferences to the compact solution workflow.json format
function normalizeConnRefs(connRefs) {
  if (!connRefs || typeof connRefs !== "object") return connRefs;
  const out = {};
  for (const [key, ref] of Object.entries(connRefs)) {
    // Already in solution format — pass through unchanged
    if (ref.runtimeSource !== undefined) { out[key] = ref; continue; }
    // api.name = last segment of the id (e.g. "/providers/.../shared_teams") or fallback
    const apiName = ref.id
      ? ref.id.split("/").pop()
      : ref.apiName ? `shared_${ref.apiName}` : key;
    out[key] = {
      runtimeSource: (ref.source || "embedded").toLowerCase(),
      connection: {
        connectionReferenceLogicalName: ref.connectionReferenceLogicalName || "",
      },
      api: { name: apiName },
    };
  }
  return out;
}

export function normalizeToSolutionFormat(definition, mode) {
  const def = JSON.parse(JSON.stringify(definition));
  if (mode === "full") {
    if (def.properties?.definition?.actions)
      def.properties.definition.actions = normalizeAuth(def.properties.definition.actions);
    if (def.properties?.definition?.triggers)
      def.properties.definition.triggers = normalizeAuth(def.properties.definition.triggers);
    // Normalize connectionReferences to compact solution format
    if (def.properties?.connectionReferences)
      def.properties.connectionReferences = normalizeConnRefs(def.properties.connectionReferences);
    // Add solution metadata fields
    if (def.properties && !("templateName" in def.properties))
      def.properties.templateName = null;
    if (!("schemaVersion" in def))
      def.schemaVersion = "1.0.0.0";
  } else {
    if (def.actions) def.actions = normalizeAuth(def.actions);
    if (def.triggers) def.triggers = normalizeAuth(def.triggers);
  }
  return def;
}

export function topoSortActions(actions) {
  if (!actions || typeof actions !== "object") return [];
  const sorted = [];
  const visited = new Set();
  function visit(name, stack = new Set()) {
    if (visited.has(name) || stack.has(name)) return;
    stack.add(name);
    for (const dep of Object.keys(actions[name]?.runAfter || {}))
      if (actions[dep]) visit(dep, stack);
    visited.add(name);
    sorted.push(name);
  }
  for (const name of Object.keys(actions)) visit(name);
  return sorted;
}

export function detectBranches(actions) {
  const groups = {};
  for (const [name, action] of Object.entries(actions)) {
    const deps = Object.keys(action.runAfter || {}).sort().join("|");
    if (!groups[deps]) groups[deps] = [];
    groups[deps].push(name);
  }
  const parallel = new Set();
  for (const members of Object.values(groups))
    if (members.length > 1) members.forEach(n => parallel.add(n));
  return parallel;
}

// depth limit of 4: only needs a few levels to reach string values inside
// action inputs; deeper traversal would add cost with no practical benefit.
export function extractStrings(obj, depth = 0) {
  if (depth > 4 || !obj) return "";
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return String(obj);
  return Object.values(obj).map(v => extractStrings(v, depth + 1)).join(" ");
}

// depth limit of 10: matches countActions — same rationale.
export function flattenActions(actions, depth = 0, parentPath = "", branchLabel = "") {
  if (!actions || typeof actions !== "object" || depth > 10) return [];
  const result = [];
  const ordered = topoSortActions(actions);
  const parallel = detectBranches(actions);

  for (const name of ordered) {
    const action = actions[name];
    const path = parentPath ? `${parentPath}.${name}` : name;
    const type = action.type || "";
    const runAfterStatuses = action.runAfter || {};
    const inputText = extractStrings(action.inputs || action.parameters || {});
    const isParallel = parallel.has(name);

    result.push({ name, path, depth, type, action, runAfterStatuses, branchLabel, isParallel, inputText, isTrigger: false, parentActions: actions });

    if (action.actions)
      result.push(...flattenActions(action.actions, depth + 1, path, "If yes / Main"));
    if (action.else?.actions)
      result.push(...flattenActions(action.else.actions, depth + 1, path + ".else", "If no / Else"));
    if (action.default?.actions)
      result.push(...flattenActions(action.default.actions, depth + 1, path + ".default", "Default"));
    if (action.cases)
      for (const [caseKey, c] of Object.entries(action.cases))
        if (c.actions)
          result.push(...flattenActions(c.actions, depth + 1, `${path}.cases.${caseKey}`, `Case: ${caseKey}`));
  }
  return result;
}

export function collectDependencyChain(actionName, actions) {
  const chain = new Set();
  function walk(name) {
    if (chain.has(name) || !actions[name]) return;
    chain.add(name);
    for (const dep of Object.keys(actions[name]?.runAfter || {})) walk(dep);
  }
  walk(actionName);
  return chain;
}

export function buildSelectedActions(allFlat, selectedPaths) {
  const result = {};
  for (const item of allFlat) {
    if (item.depth === 0 && selectedPaths.has(item.path))
      result[item.name] = item.action;
  }
  return result;
}

export function getUsedConnRefs(actionsObj) {
  const text = JSON.stringify(actionsObj);
  return text.match(/"referenceName"\s*:\s*"([^"]+)"/g)
    ?.map(m => m.match(/"([^"]+)"$/)?.[1])
    .filter(Boolean) ?? [];
}
