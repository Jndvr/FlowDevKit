/**
 * diff-view.js — Full-screen side-by-side diff viewer
 *
 * Opened by flow-diff.js via chrome.windows.create().
 * Reads serialised diff data from chrome.storage.local and renders a
 * two-column line-level comparison (Baseline | Live Flow) at full
 * browser-window size.
 */

// ── HTML escaping ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── LCS-based line diff ───────────────────────────────────────────────────────
/**
 * Returns [{t:'='|'+'|'-', l, r}] representing a unified line diff.
 * maxLines is higher here (500) since we have full screen real-estate.
 */
function lineDiff(leftText, rightText, maxLines = 500) {
  const L = leftText.split("\n").slice(0, maxLines);
  const R = rightText.split("\n").slice(0, maxLines);
  const m = L.length, n = R.length;

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = L[i - 1] === R[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const res = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && L[i - 1] === R[j - 1]) {
      res.unshift({ t: "=", l: L[i - 1], r: R[j - 1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      res.unshift({ t: "+", l: "",        r: R[j - 1] }); j--;
    } else {
      res.unshift({ t: "-", l: L[i - 1], r: ""        }); i--;
    }
  }
  return res;
}

// ── Two-column HTML from line-diff result ─────────────────────────────────────
function buildLineBlocks(lines) {
  let lHtml = "", rHtml = "";
  for (const { t, l, r } of lines) {
    const lCls = t === "-" ? "sbs-line-rem" : t === "=" ? "sbs-line-ctx" : "sbs-line-empty";
    const rCls = t === "+" ? "sbs-line-add" : t === "=" ? "sbs-line-ctx" : "sbs-line-empty";
    lHtml += `<div class="${lCls}">${esc(l) || " "}</div>`;
    rHtml += `<div class="${rCls}">${esc(r) || " "}</div>`;
  }
  return { lHtml, rHtml };
}

// ── Render full side-by-side diff into a container ───────────────────────────
function renderSideBySide(diff, container) {
  container.innerHTML = "";

  // Sticky column headers
  const colHeaders = document.createElement("div");
  colHeaders.className = "sbs-col-headers";
  colHeaders.innerHTML = `<div class="sbs-col-head">Baseline</div><div class="sbs-col-head">Live Flow</div>`;
  container.appendChild(colHeaders);

  function addSectionHeader(text, kind) {
    const el = document.createElement("div");
    el.className = `sbs-section ${kind}`;
    el.textContent = text;
    container.appendChild(el);
  }

  function addActionHeader(item, kind) {
    const el = document.createElement("div");
    el.className = `sbs-action-header ${kind}`;
    el.innerHTML = `<span class="sbs-action-name">${esc(item.name)}</span><span class="sbs-action-type">${esc(item.type)}</span>`;
    container.appendChild(el);
  }

  function addRow(lHtml, rHtml) {
    const row = document.createElement("div");
    row.className = "sbs-row";
    row.innerHTML = `<div class="sbs-col">${lHtml}</div><div class="sbs-col">${rHtml}</div>`;
    container.appendChild(row);
  }

  // Changed actions — line-level diff
  if (diff.changed.length) {
    addSectionHeader(`~ ${diff.changed.length} changed`, "changed");
    for (const item of diff.changed) {
      addActionHeader(item, "changed");
      const leftJson  = JSON.stringify(item.baseItem?.action, null, 2) || "";
      const rightJson = JSON.stringify(item.action, null, 2) || "";
      const { lHtml, rHtml } = buildLineBlocks(lineDiff(leftJson, rightJson));
      addRow(lHtml, rHtml);
    }
  }

  // Added actions — right side only
  if (diff.added.length) {
    addSectionHeader(`+ ${diff.added.length} added`, "added");
    for (const item of diff.added) {
      addActionHeader(item, "added");
      const lines = (JSON.stringify(item.action, null, 2) || "").split("\n");
      const lHtml = lines.map(() => `<div class="sbs-line-empty"> </div>`).join("");
      const rHtml = lines.map(l => `<div class="sbs-line-add">${esc(l)}</div>`).join("");
      addRow(lHtml, rHtml);
    }
  }

  // Removed actions — left side only
  if (diff.removed.length) {
    addSectionHeader(`− ${diff.removed.length} removed`, "removed");
    for (const item of diff.removed) {
      addActionHeader(item, "removed");
      const lines = (JSON.stringify(item.action, null, 2) || "").split("\n");
      const lHtml = lines.map(l => `<div class="sbs-line-rem">${esc(l)}</div>`).join("");
      const rHtml = lines.map(() => `<div class="sbs-line-empty"> </div>`).join("");
      addRow(lHtml, rHtml);
    }
  }

  // Unchanged — collapsed summary
  if (diff.unchanged.length) {
    const el = document.createElement("div");
    el.className = "sbs-section unchanged";
    el.textContent = `${diff.unchanged.length} unchanged actions (identical in both versions)`;
    container.appendChild(el);
  }
}

// ── Initialise ────────────────────────────────────────────────────────────────
async function init() {
  const content = document.getElementById("dvContent");
  const meta    = document.getElementById("dvMeta");

  let stored;
  try {
    stored = await chrome.storage.local.get("diffViewData");
  } catch {
    content.innerHTML = `<div id="dvEmpty">Unable to read diff data — storage API unavailable.</div>`;
    return;
  }

  const data = stored?.diffViewData;
  if (!data?.diff) {
    content.innerHTML = `<div id="dvEmpty">No diff data found. Please run a comparison from the FlowDevKit panel first.</div>`;
    return;
  }

  const { diff, theme, displayName } = data;

  // Apply saved theme
  if (theme) document.documentElement.dataset.theme = theme;

  // Window title
  if (displayName) document.title = `Flow Diff: ${displayName} — FlowDevKit`;

  // Summary chips
  meta.innerHTML = `
    <span class="diff-chip added">+${diff.added.length} added</span>
    <span class="diff-chip removed">−${diff.removed.length} removed</span>
    <span class="diff-chip changed">~${diff.changed.length} changed</span>
    <span class="diff-chip unchanged">${diff.unchanged.length} same</span>`;

  renderSideBySide(diff, content);
}

// ── Navigation handlers ───────────────────────────────────────────────────────
function goBack() { window.close(); }

document.getElementById("dvBack").addEventListener("click", goBack);
document.getElementById("dvClose").addEventListener("click", goBack);
document.addEventListener("keydown", e => { if (e.key === "Escape") goBack(); });

// ── Boot ──────────────────────────────────────────────────────────────────────
init().catch(err => {
  const content = document.getElementById("dvContent");
  if (content) content.innerHTML = `<div id="dvEmpty">Error loading diff: ${esc(err.message || String(err))}</div>`;
});
