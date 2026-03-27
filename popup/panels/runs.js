/**
 * popup/panels/runs.js — Failed Run Errors panel
 */
import { API_VERSION } from "../../shared/constants.js";
import { resolveFlowContext, buildApiUrl, getApiHost } from "../context.js";
import { registerPanel, closeAllPanels, setActiveBtn, showStatus, handleApiError, updateFlowStrip, esc } from "../ui.js";

const runsBtn          = document.getElementById("runsBtn");
const runsPanel        = document.getElementById("runsPanel");
const runsBody         = document.getElementById("runsBody");
const runsPerfBody     = document.getElementById("runsPerfBody");
const runsPanelTitle   = document.getElementById("runsPanelTitle");
const runsBackBtn      = document.getElementById("runsBackBtn");
const runsPanelFooter  = document.getElementById("runsPanelFooter");
const runsMeta         = document.getElementById("runsMeta");
const runsCopyBtn      = document.getElementById("runsCopyBtn");
const runsStatsBar     = document.getElementById("runsStatsBar");
const runsChart        = document.getElementById("runsChart");
const runsRatio        = document.getElementById("runsRatio");
const runsStatLabel    = document.getElementById("runsStatLabel");
const runsStatAvg      = document.getElementById("runsStatAvg");
const runsDetailTabs   = document.getElementById("runsDetailTabs");
const runsTabErrors    = document.getElementById("runsTabErrors");
const runsTabPerf      = document.getElementById("runsTabPerf");

registerPanel(runsBtn, runsPanel);

let runsContext = null;
let currentRunErrors = [];

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtDuration(startOrMs, endStr) {
  let ms;
  if (endStr === undefined || typeof startOrMs === "number") { ms = startOrMs; }
  else {
    if (!startOrMs || !endStr) return "";
    ms = new Date(endStr) - new Date(startOrMs);
  }
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function fmtTime(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `today ${time}`;
  if (isYesterday) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function setRunsLoading(msg = "Loading…") {
  runsBody.innerHTML = `<div class="runs-loading"><div class="spinner"></div> ${msg}</div>`;
  runsPanelFooter.style.display = "none";
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function renderRunStats(runs) {
  if (!runs.length) { runsStatsBar.classList.remove("show"); return; }
  const counts = { Succeeded: 0, Failed: 0, Running: 0, Cancelled: 0 };
  const durations = [];
  for (const run of runs) {
    const props = run.properties || {};
    const s = props.status || "Unknown";
    if (s in counts) counts[s]++;
    if (props.startTime && props.endTime) {
      const ms = new Date(props.endTime) - new Date(props.startTime);
      if (ms > 0) durations.push(ms);
    }
  }
  const total = runs.length;
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const pct = counts.Succeeded / total * 100;
  runsStatLabel.textContent = `${counts.Succeeded}/${total} succeeded · ${pct.toFixed(0)}% pass rate`;
  runsStatAvg.textContent = avgMs ? `avg ${fmtDuration(0, avgMs)}` : "";

  runsChart.innerHTML = "";
  const maxMs = Math.max(...durations, 1);
  for (const run of [...runs].reverse()) {
    const props = run.properties || {};
    const status = props.status || "Unknown";
    const dur = (props.startTime && props.endTime)
      ? new Date(props.endTime) - new Date(props.startTime) : 0;
    const heightPct = dur ? Math.max(10, (dur / maxMs) * 100) : 12;
    const wrap = document.createElement("div");
    wrap.className = "runs-bar-wrap";
    wrap.dataset.tip = `${status} · ${dur ? fmtDuration(props.startTime, props.endTime) : "—"}`;
    wrap.addEventListener("click", () => loadRunDetail(run));
    const bar = document.createElement("div");
    bar.className = `runs-bar ${status}`;
    bar.style.height = `${heightPct}%`;
    wrap.appendChild(bar);
    runsChart.appendChild(wrap);
  }

  runsRatio.innerHTML = "";
  const dotColors = { Succeeded: "var(--success)", Failed: "var(--error)", Running: "var(--accent)", Cancelled: "var(--text-3)" };
  for (const [key, val] of Object.entries(counts)) {
    if (!val) continue;
    const item = document.createElement("div");
    item.className = "runs-ratio-item";
    item.innerHTML = `<span class="runs-ratio-dot" style="background:${dotColors[key]}"></span>${val} ${key}`;
    runsRatio.appendChild(item);
  }
  // Remove any previous sparkline before appending a new one
  runsStatsBar.querySelector(".runs-sparkline")?.remove();
  const sparkline = renderSparkline(runs);
  if (sparkline) runsStatsBar.appendChild(sparkline);

  runsStatsBar.classList.add("show");
}

// ── Duration sparkline ────────────────────────────────────────────────────────
function renderSparkline(runs) {
  // Build ordered (oldest→newest) duration array; null for runs without times
  const ordered = [...runs].reverse();
  const durations = ordered.map(run => {
    const { startTime, endTime } = run.properties || {};
    if (!startTime || !endTime) return null;
    const ms = new Date(endTime) - new Date(startTime);
    return ms > 0 ? ms : null;
  });

  const valid = durations.filter(d => d !== null);
  if (valid.length < 3) return null;   // too few points for a meaningful line

  const min   = Math.min(...valid);
  const range = Math.max(...valid) - min || 1;
  const W = 200, H = 22;

  const points = durations
    .map((d, i) => d === null ? null : `${((i / (durations.length - 1)) * W).toFixed(1)},${(H - ((d - min) / range) * H).toFixed(1)}`)
    .filter(Boolean);

  // Trend: compare first-half vs second-half average
  const half       = Math.floor(valid.length / 2);
  const firstAvg   = valid.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const secondAvg  = valid.slice(half).reduce((a, b) => a + b, 0) / (valid.length - half);
  const trendColor = secondAvg > firstAvg * 1.1 ? "var(--error)"
                   : secondAvg < firstAvg * 0.9 ? "var(--success)"
                   : "var(--text-3)";
  const trendLabel = secondAvg > firstAvg * 1.1 ? "↑ Trending slower"
                   : secondAvg < firstAvg * 0.9 ? "↓ Trending faster"
                   : "→ Stable";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.cssText = `width:100%;height:${H}px;display:block;overflow:visible`;

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", points.join(" "));
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", trendColor);
  poly.setAttribute("stroke-width", "1.5");
  poly.setAttribute("stroke-linejoin", "round");
  poly.setAttribute("stroke-linecap", "round");
  svg.appendChild(poly);

  const wrap = document.createElement("div");
  wrap.className = "runs-sparkline";
  wrap.title = trendLabel;

  const label = document.createElement("div");
  label.className = "runs-sparkline-label";
  label.textContent = trendLabel;
  label.style.color = trendColor;

  wrap.appendChild(svg);
  wrap.appendChild(label);
  return wrap;
}

// ── Performance view ──────────────────────────────────────────────────────────
let _perfData = [];   // [{ name, status, dur }] built during loadRunDetail

function renderPerfView() {
  runsPerfBody.innerHTML = "";

  const timed   = _perfData.filter(a => a.dur !== null).sort((a, b) => b.dur - a.dur);
  const untimed = _perfData.filter(a => a.dur === null);
  const all     = [...timed, ...untimed];

  if (!all.length) {
    runsPerfBody.innerHTML = `<div class="runs-empty">No action timing data available for this run.</div>`;
    return;
  }

  const maxDur = timed.length ? timed[0].dur : 1;
  const total  = _perfData.reduce((s, a) => s + (a.dur || 0), 0);

  // Summary bar
  const summary = document.createElement("div");
  summary.className = "perf-summary";
  summary.innerHTML =
    `<span class="perf-summary-stat">${all.length} action${all.length !== 1 ? "s" : ""}</span>` +
    `<span class="perf-summary-sep">·</span>` +
    `<span class="perf-summary-stat">Total <strong>${fmtDuration(total)}</strong></span>` +
    (timed.length ? `<span class="perf-summary-sep">·</span><span class="perf-summary-stat">Slowest <strong>${fmtDuration(timed[0].dur)}</strong></span>` : "");
  runsPerfBody.appendChild(summary);

  const list = document.createElement("div");
  list.className = "perf-list";

  for (const action of all) {
    const pct = action.dur !== null ? Math.max(3, (action.dur / maxDur) * 100) : 2;
    const durLabel = action.dur !== null ? fmtDuration(action.dur) : "—";

    // Status dot colour class
    const dotClass = {
      Succeeded: "Succeeded", Failed: "Failed",
      TimedOut: "TimedOut", Skipped: "Skipped",
    }[action.status] || "Skipped";

    const row = document.createElement("div");
    row.className = "perf-row";

    const head = document.createElement("div");
    head.className = "perf-row-head";

    const dot = document.createElement("span");
    dot.className = `perf-dot perf-dot-${dotClass}`;

    const nameEl = document.createElement("span");
    nameEl.className = "perf-name";
    nameEl.textContent = action.name;
    nameEl.title = action.name;

    const durEl = document.createElement("span");
    durEl.className = "perf-dur";
    durEl.textContent = durLabel;

    head.append(dot, nameEl, durEl);

    const track = document.createElement("div");
    track.className = "perf-track";
    const fill = document.createElement("div");
    fill.className = `perf-fill perf-fill-${dotClass}`;
    fill.style.width = `${pct}%`;
    track.appendChild(fill);

    row.append(head, track);
    list.appendChild(row);
  }

  runsPerfBody.appendChild(list);
}

// ── Detail view tab switching ─────────────────────────────────────────────────
function showDetailTab(tab) {
  const isPerf = tab === "perf";
  runsTabErrors.classList.toggle("active", !isPerf);
  runsTabPerf.classList.toggle("active", isPerf);
  runsBody.style.display        = isPerf ? "none" : "";
  runsPerfBody.style.display    = isPerf ? ""     : "none";
  runsPanelFooter.style.display = isPerf ? "none" : (currentRunErrors?.failed?.length || currentRunErrors?.skipped?.length ? "flex" : "none");
  if (isPerf) renderPerfView();
}

runsTabErrors.addEventListener("click", () => showDetailTab("errors"));
runsTabPerf.addEventListener("click",   () => showDetailTab("perf"));

// ── Runs list ─────────────────────────────────────────────────────────────────
function showRunsList(runs) {
  runsPanelTitle.textContent = "Recent Runs";
  runsBackBtn.classList.remove("show");
  runsPanelFooter.style.display = "none";
  runsDetailTabs.style.display = "none";
  runsBody.style.display = "";
  runsPerfBody.style.display = "none";
  currentRunErrors = [];
  _perfData = [];
  renderRunStats(runs);

  if (!runs.length) {
    runsBody.innerHTML = `<div class="runs-empty">No recent runs found.</div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "runs-list";
  for (const run of runs) {
    const props = run.properties || {};
    const status = props.status || "Unknown";
    const start = props.startTime;
    const end = props.endTime;
    const dur = fmtDuration(start, end);
    const row = document.createElement("div");
    row.className = "run-row";
    row.innerHTML = `
      <div class="run-dot ${status}"></div>
      <div class="run-info">
        <div class="run-time">${fmtTime(start)}</div>
        <div class="run-meta">${dur ? `Duration: ${dur}` : ""}</div>
      </div>
      <div class="run-badge ${status}">${status}</div>
    `;
    row.addEventListener("click", () => loadRunDetail(run));
    list.appendChild(row);
  }
  runsBody.innerHTML = "";
  runsBody.appendChild(list);
}

// ── Run detail ────────────────────────────────────────────────────────────────
async function loadRunDetail(run) {
  const props = run.properties || {};
  const status = props.status || "Unknown";
  const start = props.startTime;
  const runId = run.name;

  runsPanelTitle.textContent = `${status} · ${fmtTime(start)}`;
  runsBackBtn.classList.add("show");
  runsStatsBar.classList.remove("show");
  setRunsLoading("Fetching action details…");

  const { host, environmentId, flowId, token, tokens, displayName } = runsContext;
  const runUrl = `https://${host}/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs/${runId}?api-version=${API_VERSION}&$expand=properties/actions`;
  const result = await chrome.runtime.sendMessage({ type: "FETCH_RUN_DETAIL", runUrl, token, tokens });

  if (!result || result.error) {
    runsBody.innerHTML = `<div class="runs-empty">Could not load run detail.<br><small>${result?.error || ""}</small></div>`;
    return;
  }

  const actions = result.run?.properties?.actions || {};
  const failed = [];
  const skipped = [];
  _perfData = [];

  for (const [name, action] of Object.entries(actions)) {
    const s = action.status;
    if (s === "Failed" || s === "TimedOut") {
      failed.push({
        name, status: s,
        code: action.error?.code || action.code || "",
        msg: action.error?.message || action.message || "",
        inputsLink: action.inputsLink?.uri || null,
        outputsLink: action.outputsLink?.uri || null,
      });
    } else if (s === "Skipped") {
      skipped.push({ name, status: s, reason: action.error?.message || "" });
    }
    // Collect timing for every action for the performance view
    const dur = (action.startTime && action.endTime)
      ? Math.max(0, new Date(action.endTime) - new Date(action.startTime))
      : null;
    _perfData.push({ name, status: s || "Unknown", dur });
  }

  // Show tab bar; reset to Errors tab
  runsDetailTabs.style.display = "flex";
  runsTabErrors.classList.add("active");
  runsTabPerf.classList.remove("active");
  runsBody.style.display = "";
  runsPerfBody.style.display = "none";

  currentRunErrors = { displayName, runId, start, status, failed, skipped };

  const detailList = document.createElement("div");
  detailList.className = "detail-list";

  if (!failed.length && !skipped.length) {
    detailList.innerHTML = `<div class="runs-empty">No failed or skipped actions found in this run.</div>`;
  } else {
    for (const a of failed) {
      const el = document.createElement("div");
      el.className = "detail-action";
      el.innerHTML = `
        <div class="detail-head">
          <i class="bi bi-x-circle detail-icon fail"></i>
          <span class="detail-name">${esc(a.name)}</span>
          <span class="detail-badge ${esc(a.status)}">${esc(a.status)}</span>
        </div>
        <div class="detail-body">
          ${a.code ? `<div class="detail-code">${esc(a.code)}</div>` : ""}
          ${a.msg ? `<div class="detail-msg">${esc(a.msg)}</div>` : ""}
          <div class="io-wrap" id="io-${esc(a.name.replace(/\W/g, '_'))}">
            <div class="io-loading">Loading inputs/outputs…</div>
          </div>
        </div>
      `;
      detailList.appendChild(el);

      const ioSec = el.querySelector(".io-wrap");
      (async () => {
        const parts = [];
        async function fetchIO(label, url) {
          if (!url) return;
          const r = await chrome.runtime.sendMessage({ type: "FETCH_RUN_IO", ioUrl: url, token });
          const json = r?.data ? JSON.stringify(r.data, null, 2) : (r?.error || "—");
          parts.push({ label, json });
        }
        await Promise.all([fetchIO("Inputs", a.inputsLink), fetchIO("Outputs", a.outputsLink)]);

        if (!parts.length) { ioSec.innerHTML = `<div class="io-loading">No inputs/outputs available.</div>`; return; }
        ioSec.innerHTML = "";
        for (const { label, json } of parts) {
          const wrap = document.createElement("div");
          wrap.style.cssText = "margin-bottom:6px";
          const labelRow = document.createElement("div");
          labelRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:3px";
          const labelEl = document.createElement("span");
          labelEl.textContent = label;
          labelEl.style.cssText = "font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-3)";
          const copyBtn = document.createElement("button");
          copyBtn.textContent = "Copy";
          copyBtn.style.cssText = "font-size:10px;font-weight:600;font-family:Inter,sans-serif;background:var(--surface-3);border:1px solid var(--border);border-radius:4px;color:var(--text-2);padding:2px 8px;cursor:pointer;transition:all 0.15s";
          const ioBlock = document.createElement("pre");
          ioBlock.style.cssText = "background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:5px 7px;font-family:JetBrains Mono,monospace;font-size:9.5px;color:var(--text-2);max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;line-height:1.45;margin:0;transition:border-color 0.15s";
          ioBlock.textContent = json;
          copyBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(json);
              copyBtn.textContent = "✓ Copied";
              copyBtn.style.borderColor = "var(--success)";
              copyBtn.style.color = "var(--success)";
              copyBtn.style.background = "var(--success-dim)";
              ioBlock.style.borderColor = "var(--success)";
              setTimeout(() => {
                copyBtn.textContent = "Copy";
                copyBtn.style.borderColor = "";
                copyBtn.style.color = "";
                copyBtn.style.background = "";
                ioBlock.style.borderColor = "";
              }, 1800);
            } catch (err) {
              copyBtn.textContent = "Failed";
              copyBtn.style.color = "var(--error)";
              setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.style.color = ""; }, 2000);
            }
          });
          labelRow.appendChild(labelEl);
          labelRow.appendChild(copyBtn);
          wrap.appendChild(labelRow);
          wrap.appendChild(ioBlock);
          ioSec.appendChild(wrap);
        }
      })();
    }

    for (const a of skipped) {
      const el = document.createElement("div");
      el.className = "detail-action";
      el.innerHTML = `
        <div class="detail-head">
          <i class="bi bi-skip-forward detail-icon skip"></i>
          <span class="detail-name">${esc(a.name)}</span>
          <span class="detail-badge Skipped">Skipped</span>
        </div>
        ${a.reason ? `<div class="detail-body"><div class="detail-skip-reason">${esc(a.reason)}</div></div>` : ""}
      `;
      detailList.appendChild(el);
    }
  }

  runsBody.innerHTML = "";
  runsBody.appendChild(detailList);
  const totalIssues = failed.length + skipped.length;
  runsMeta.textContent = `${failed.length} failed · ${skipped.length} skipped`;
  runsPanelFooter.style.display = totalIssues ? "flex" : "none";
}

// ── Event listeners ───────────────────────────────────────────────────────────
runsBackBtn.addEventListener("click", async () => {
  runsBackBtn.classList.remove("show");
  setRunsLoading("Loading runs…");
  const { host, environmentId, flowId, token, tokens } = runsContext;
  const runsUrl = `https://${host}/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=${API_VERSION}&$top=15`;
  const result = await chrome.runtime.sendMessage({ type: "FETCH_RUNS", runsUrl, token, tokens });
  if (result?.error) {
    const is401 = /(401|403|unauthorized|forbidden)/.test(result.error || "");
    runsBody.innerHTML = `<div class="runs-empty">${is401 ? "Session expired — refresh the Power Automate tab (F5) and try again." : result.error}</div>`;
  } else {
    showRunsList(result.runs || []);
  }
});

runsCopyBtn.addEventListener("click", async () => {
  if (!currentRunErrors) return;
  const { displayName, runId, start, status, failed, skipped } = currentRunErrors;
  const lines = [`Flow:   ${displayName}`, `Run:    ${start || runId}  (${status})`, ""];
  for (const a of failed) {
    lines.push(`[${a.status.toUpperCase()}] ${a.name}`);
    if (a.code) lines.push(`  Code:    ${a.code}`);
    if (a.msg) lines.push(`  Message: ${a.msg}`);
    lines.push("");
  }
  for (const a of skipped) {
    lines.push(`[SKIPPED] ${a.name}`);
    if (a.reason) lines.push(`  Reason: ${a.reason}`);
    lines.push("");
  }
  await navigator.clipboard.writeText(lines.join("\n").trimEnd());
  showStatus("success", "Errors copied!", `${failed.length} failed · ${skipped.length} skipped`);
});

runsBtn.addEventListener("click", async () => {
  if (runsPanel.classList.contains("show")) { closeAllPanels(); return; }
  closeAllPanels();

  runsBtn.disabled = true;
  runsBtn.innerHTML = `<div class="tool-btn-icon"><div class="spinner" style="width:14px;height:14px;margin:0"></div></div><div class="tool-btn-text"><span class="tool-btn-title">Loading…</span></div>`;

  try {
    const { environmentId, flowId, token, tokens, tab } = await resolveFlowContext();
    const { apiUrl: flowApiUrl } = buildApiUrl(flowId, environmentId);
    const flowResult = await chrome.runtime.sendMessage({ type: "FETCH_FLOW", apiUrl: flowApiUrl, token, tokens, mode: "definition" });
    const displayName = flowResult?.displayName || "Unknown Flow";

    runsContext = { host: getApiHost(), environmentId, flowId, token, tokens, displayName };
    const runsUrl = `https://${getApiHost()}/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=${API_VERSION}&$top=15`;

    runsPanel.classList.add("show");
    setActiveBtn(runsBtn);
    setRunsLoading("Loading runs…");

    const result = await chrome.runtime.sendMessage({ type: "FETCH_RUNS", runsUrl, token, tokens });
    if (result?.error) {
      const is401 = /(401|403|unauthorized|forbidden)/.test(result.error || "");
      runsBody.innerHTML = `<div class="runs-empty">${is401 ? "Session expired — refresh the Power Automate tab (F5) and try again." : result.error}</div>`;
    } else {
      showRunsList(result.runs || []);
    }
  } catch (err) {
    (([t, d]) => showStatus("error", t, d || ""))((err.message || String(err)).split("\0"));
    runsPanel.classList.remove("show");
  } finally {
    runsBtn.disabled = false;
    runsBtn.innerHTML = `<div class="tool-btn-icon"><i class="bi bi-exclamation-circle"></i></div><div class="tool-btn-text"><span class="tool-btn-title">Failed Run Errors</span><span class="tool-btn-desc">View and inspect past run failures</span></div><i class="bi bi-chevron-right tool-btn-chevron"></i>`;
  }
});
