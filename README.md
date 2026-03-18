# FlowDevKit

**FlowDevKit** is a Chrome / Edge extension (Manifest V3) that lets you inspect, copy, debug, and audit Power Automate cloud flows directly from your browser — no backend, no setup, no extra login.

> Built by [Jan Düver](https://www.linkedin.com/in/janduever/)

---

## Features at a Glance

| Tool | What it does |
|---|---|
| **Copy JSON** | Copy the full flow definition (or definition + connection refs) to your clipboard |
| **Export JSON** | Download the flow as a `.json` file |
| **Quick Copy Action** | Search any action by name and copy just that action |
| **Select Actions to Copy** | Multi-select actions for bulk copy — with dependency resolution on right-click |
| **Copy Connection Refs** | Extract all connection reference keys from the flow |
| **Copy Trigger** | Copy just the trigger configuration |
| **Run History & Errors** | Browse recent runs, inspect failures, copy error messages and input/output detail |
| **Action Performance View** | Switch to the Performance tab inside any run to see every action sorted by duration with a proportional timing bar |
| **Expression Inspector** | Scan and decode every Power FX / workflow expression in the flow |
| **Variable Tracker** | List all variables with their init values and usage locations |
| **Environment Variables** | Browse all Dataverse environment variables — see type, current value, schema name, and copy `@parameters('...')` references in one click |
| **Analyze Flow** | Full best-practice audit with complexity, maintainability, and reliability scores |

Fully works as a **popup** or docked as a **side panel** — switch with the sidebar button in the header.

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `FlowDevKit` folder

### Keyboard Shortcut

`Alt + Shift + F` opens FlowDevKit from any supported tab.

---

## How It Works

1. Open any flow in the Power Automate designer (`make.powerautomate.com/…/flows/{flowId}/edit`)
2. Click the FlowDevKit icon (or press `Alt+Shift+F`)
3. Use any of the tools — the flow is automatically detected from the active tab

The extension calls the Power Automate and Dataverse APIs using your existing browser session tokens. **No credentials are stored or sent to any third party.**

---

## Supported URLs

```
https://make.powerautomate.com/environments/{environmentId}/flows/{flowId}/edit
https://make.powerapps.com/…                (Power Apps maker portal)
https://copilotstudio.microsoft.com/…       (Copilot Studio)
```

---

## Settings

Click the **gear icon** in the header to open settings.

### Region

Select the API region that matches your Power Platform tenant:

| Region | API Host |
|---|---|
| EMEA | `emea.api.flow.microsoft.com` |
| US | `unitedstates.api.flow.microsoft.com` |
| Asia | `asia.api.flow.microsoft.com` |
| AU | `australia.api.flow.microsoft.com` |
| CA | `canada.api.flow.microsoft.com` |
| IN | `india.api.flow.microsoft.com` |

For GCC, GovCloud, or sovereign clouds — enter your full API host in the **Custom host** field.

### Export Format

| Mode | What's included |
|---|---|
| **Definition only** | `triggers` + `actions` — lighter and portable |
| **Full export** | + `connectionReferences` — includes connector metadata alongside the flow definition |

---

## Tools — Detailed Reference

<details>
<summary><strong>Copy JSON</strong> — Copy the full flow definition to the clipboard</summary>

Copies the complete flow definition to your clipboard. What gets copied depends on the **Export Format** setting:

- **Definition only** — includes `triggers` and `actions` only (most common use case — share with a colleague or save for reference)
- **Full export** — also includes `connectionReferences` (includes connector metadata alongside the flow definition)

After copying, a toast confirms how many actions and the trigger name were included.

</details>

<details>
<summary><strong>Export JSON</strong> — Download the flow as a .json file</summary>

Downloads the flow as a `.json` file to your computer. The filename is auto-generated from the flow name and timestamp. Uses the same **Export Format** setting as Copy JSON.

Useful for keeping a local backup, doing a diff between versions, or loading the flow into an external tool.

</details>

<details>
<summary><strong>Copy Trigger</strong> — Copy just the trigger configuration</summary>

Copies only the trigger configuration block — the `triggers` object — as JSON. Everything about how the flow starts: trigger type, inputs, conditions, recurrence settings, and split-on configuration.

Use this when you need to replicate a trigger in a new flow without copying the entire definition.

</details>

<details>
<summary><strong>Copy Connection Refs</strong> — Extract all connection reference keys</summary>

Extracts all `connectionReferences` defined in the flow and copies them to the clipboard.

Each reference includes:
- Connection name
- Connector ID and display name
- Connection ID

If any connection reference is missing a connection ID — a common issue in exported / imported flows — a warning is shown listing the incomplete references.

</details>

<details>
<summary><strong>Quick Copy Action</strong> — Search and copy any single action by name</summary>

A search-as-you-type panel for copying a single action.

1. Type part of the action name or type — results appear immediately (up to 20 matches)
2. Each result shows the action name and a human-readable type label
3. Click the **copy** button on any result

What gets copied is a complete, portable "action envelope": the action definition with all inputs, run-after configuration, and the connection references it depends on. Authentication placeholders are normalised to `@parameters('$authentication')`.

</details>

<details>
<summary><strong>Select Actions to Copy</strong> — Multi-select actions with dependency resolution</summary>

A multi-select panel for bulk-copying groups of actions.

**The list:**
- All actions are shown in execution order with depth-based indentation
- Checkboxes let you include or exclude individual actions
- Container actions (If, Switch, Apply to each, Scope) are labelled with *incl. children* — selecting them automatically selects everything nested inside
- Parallel branches are indicated with a *Parallel* badge
- Each row shows the action type and any run-after dependency status badges

**Selection shortcuts:**
- **Toggle All** — select or deselect everything in one click
- **Right-click any action** — selects that action and its entire dependency chain (all actions it transitively depends on), then flashes the row to confirm

**Search:** Filter the list by action name, type, or input configuration.

**Copy Selection:** Exports only the checked actions as JSON, including the connection references they use. If any referenced connector is missing its connection ID, a warning lists the incomplete entries.

</details>

<details>
<summary><strong>Run History &amp; Errors</strong> — Browse runs, inspect failures, copy error detail</summary>

Fetches the 15 most recent run records and displays them in a scannable list.

**List view:**

At the top, a stats bar shows:
- Success, failed, running, and cancelled counts
- A mini pie chart of the pass/fail ratio
- A sparkline of run durations with a trend label (↑ Trending slower, ↓ Trending faster, → Stable)
- Pass rate as a percentage

Each run row shows:
- A colour-coded status dot (green = succeeded, red = failed, grey = cancelled, blue = running)
- Start time — formatted as *today HH:MM*, *yesterday HH:MM*, or *MMM D HH:MM*
- Duration
- Status badge

**Detail view (click any run):**

Two tabs appear at the top of the detail pane.

**Errors tab** — shows every action that failed or was skipped:
- Error code and full error message for failed actions
- Skip reason for skipped actions
- *Show inputs* / *Show outputs* buttons that load the raw action data on demand (to avoid fetching large payloads upfront)
- A copy button next to inputs/outputs to copy the raw JSON
- A **Copy all errors** button at the bottom that exports a formatted plain-text summary of all failures — ready to paste into a support ticket or bug report

**Performance tab** — shows every action in the run, sorted by duration descending:
- A summary line: total tracked time and action count
- Each row: status dot, action name, duration in ms, and a proportional fill bar relative to the slowest action
- Makes bottlenecks immediately visible without opening the flow designer

Click the back arrow to return to the run list.

</details>

<details>
<summary><strong>Expression Inspector</strong> — Scan and decode every Power FX expression in the flow</summary>

Scans the entire flow definition and extracts every Power FX / workflow expression — anything inside `@{...}` — from action inputs, conditions, parameters, and outputs.

**How it works:**
- Click **Scan** to fetch the flow and index all expressions
- Results are grouped by action, with a count badge per action
- Click an action group to expand or collapse it
- Each expression shows the field name it came from and the full expression text
- A **copy** button on each expression copies that single expression
- **Copy all** exports the complete index as a JSON array with action name, field, and expression value

**Search:** Filter by expression text, field name, or action name. Updates in real time.

Handles nested braces correctly — `@{if(contains('{a}', 'x'), '...', '...')}` is parsed as a single expression, not split at the inner brace.

</details>

<details>
<summary><strong>Variable Tracker</strong> — List all variables with init values and usage locations</summary>

Lists every variable in the flow — where it is initialised, what type it is, and where it gets changed.

**Initialised variables:**
Each `Initialize variable` action is shown with:
- Variable name
- Type badge (String, Integer, Boolean, Array, Object, Float) with colour coding
- Initial value — long values and JSON objects are formatted for readability

**Set operations:**
Each `Set variable` action is shown with:
- Variable name
- The action that sets it and the new value

**Copy all** exports the initialised variables as a JSON array with `name`, `type`, and `initialValue`.

Recursively walks all nesting levels: variables defined inside conditions, loops, switch branches, or scopes are all captured.

</details>

<details>
<summary><strong>Environment Variables</strong> — Browse Dataverse env vars and copy @parameters() references</summary>

Queries the Dataverse OData API for all `environmentvariabledefinition` records in the current Power Platform environment.

**For each variable:**
- Display name
- Type badge — **String**, **Number**, **Boolean**, **JSON**, **Data Source**, or **Secret** — each with a distinct colour
- Schema name in monospace
- Current value (or default value if no override is set) — truncated to 64 characters in the list view; Secrets are always masked as `••••••`

**Interactions:**
- Click the **`@`** button — copies `@parameters('schemaname')` to your clipboard, ready to paste into a flow expression
- **Click any row** — expands it to show the full untruncated value in a scrollable monospace block, plus a **Copy value** button

**Search:** Filters by display name, schema name, or description text.

**Authentication note:** Dataverse requires a separate session token from the main Power Automate token. FlowDevKit tries to acquire it automatically by scanning open browser tabs. If none is found, an inline prompt appears with a button that opens the Power Apps Tables page for your environment — loading that page acquires the token, after which you can retry.

</details>

<details>
<summary><strong>Analyze Flow</strong> — 35 best-practice checks with complexity, maintainability, and reliability scores</summary>

Runs 35 best-practice lint rules against the flow definition and computes three quality scores.

**Three scores shown at the top:**

**Complexity** — Cyclomatic Complexity (CC):

```
CC = 1 + conditions + loops + switch cases
```

| Range | Label |
|---|---|
| ≤ 5 | Low |
| ≤ 12 | Medium |
| ≤ 25 | High |
| > 25 | Very High |

**Maintainability** (0–100, higher is better) — starts at 100, deducted for:
- Default / auto-generated action names
- Duplicate long expressions used across 4+ actions
- Deeply nested conditions (depth > 3)
- Large flows (50+ actions)
- Unused variables
- Missing flow description

**Reliability Risk** (0–100+, lower is better) — additive risk score from:
- Parallel branch race conditions (shared variable writes)
- Error masking (Terminate + Continue-on-error together)
- Secrets hardcoded in expressions
- Broken or missing connection references
- Unhandled HTTP responses
- Approval actions without timeout
- Missing retry policies on HTTP actions
- No top-level error boundary
- Legacy / deprecated connectors
- Potential runaway loops

**Lint findings list:**

Each finding shows a severity icon, rule name, and the action it refers to. Findings are colour-coded by severity.

<details>
<summary>All 35 rules</summary>

| # | Severity | Rule |
|---|---|---|
| 1 | Warning | Default action name |
| 2 | Info | No flow description |
| 3 | Warning | Hardcoded secret in expression |
| 4 | Warning | Empty condition branch |
| 5 | Warning | Terminate inside loop |
| 6 | Info | Deep nesting detected |
| 7 | Warning | No error handling on HTTP action |
| 8 | Info | Large flow (50+ actions) |
| 9 | Warning | Unused variable |
| 10 | Info | Duplicate expression |
| 11 | Warning | Continue on error with no logging |
| 12 | Warning | Hardcoded email address |
| 13 | Info | Missing timeout on approval |
| 14 | Warning | Missing retry policy on HTTP action |
| 15 | Warning | Parallel branch shared variable write |
| 16 | Info | Scope used as try-catch pattern |
| 17 | Warning | Filter array with empty condition |
| 18 | Warning | Select action with no mapping |
| 19 | Info | Compose action chains (consider a variable) |
| 20 | Warning | Send HTTP request without checking status |
| 21 | Warning | Nested loops (performance risk) |
| 22 | Info | Long delay in production flow |
| 23 | Warning | Condition always true/false |
| 24 | Info | Orphaned variable (initialized, never read) |
| 25 | Warning | Hardcoded URL in HTTP action |
| 26 | Info | Switch with single case |
| 27 | Warning | Apply to each inside apply to each |
| 28 | Warning | No run-after configured on critical action |
| 29 | Info | Recurrence without explicit timezone |
| 30 | Warning | Terminate without error message |
| 31 | Warning | HTTP response without HTTP trigger |
| 32 | Warning | Scope with no error handler (run-after Failed) |
| 33 | Info | High-frequency schedule (< 5 min interval) |
| 34 | Warning | Variable initialized inside a condition branch |
| 35 | Warning | Condition with empty Yes branch |

</details>

</details>

---

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Detect the currently open flow URL |
| `tabs` | Scan tab frames to resolve flow context |
| `scripting` | Inject token-extraction scripts into the active tab |
| `clipboardWrite` | Copy flow JSON, actions, and references to the clipboard |
| `webRequest` | Passively capture Dataverse auth tokens from *.dynamics.com requests |
| `webNavigation` | Track tab navigation for context refresh |
| `sidePanel` | Enable the docked side panel mode |
| `storage` | Persist user preferences (region, theme, format) |
| `https://make.powerautomate.com/*` | Target site |
| `https://make.powerapps.com/*` | Power Apps maker portal (token source for Dataverse) |
| `https://*.api.flow.microsoft.com/*` | Power Automate REST API |
| `https://*.environment.api.powerplatform.com/*` | Power Platform environment API |
| `https://api.powerplatform.com/*` | Power Platform global API |
| `https://login.microsoftonline.com/*` | Token handling |
| `https://api.bap.microsoft.com/*` | BAP — resolves Dataverse instance URL |
| `https://*.dynamics.com/*` | Dataverse OData API (environment variables) |

---

## Roadmap

| | Item |
|---|---|
| 🔲 | **Paste actions between flows** — copy actions from one flow and paste them directly into another, without touching JSON manually |
| 🔲 | **Firefox extension** — port FlowDevKit to Firefox via the WebExtensions API |

---

## Project Structure

```
FlowDevKit/
├── manifest.json
├── popup.html
├── sidepanel.html
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   ├── background.js        # Service worker — message routing
│   ├── api-handlers.js      # API call implementations
│   ├── dv-token-cache.js    # Passive Dataverse token cache (webRequest)
│   └── fetch-utils.js       # Authenticated fetch helpers
├── popup/
│   ├── popup.js             # Main controller
│   ├── context.js           # Flow context resolver
│   ├── prefs.js             # User preferences (storage)
│   ├── ui.js                # Shared UI helpers (toast, theme, panel registry)
│   └── panels/
│       ├── lint.js          # Analyze Flow — rules + metrics
│       ├── runs.js          # Run History, Errors & Performance View
│       ├── env-vars.js      # Environment Variables panel
│       ├── expressions.js   # Expression Inspector
│       ├── variables.js     # Variable Tracker
│       ├── picker.js        # Select Actions to Copy
│       ├── paste.js         # Paste Actions into Flow (coming soon)
│       └── quick-copy.js    # Quick Copy Action
└── shared/
    ├── styles.css           # All UI styles (light + dark theme)
    ├── flow-utils.js        # Flow parsing utilities (flattenActions, etc.)
    └── constants.js         # Region map and shared constants
```

---

## Changelog

### v1.2.0
- **New: Action Performance View** — Performance tab inside any run detail; actions ranked by duration with proportional timing bars
- **New: Environment Variables panel** — browse, search, and copy Dataverse environment variable references and values
- Improved Dataverse token acquisition: JWT audience-aware scanner handles both `org.crm4.dynamics.com` and `org.api.crm4.dynamics.com` endpoints
- Fixed `$expand` navigation property name for `environmentvariabledefinition` OData queries

### v1.1.0
- Side panel mode
- Variable Tracker panel
- Analyze Flow — 35 lint rules + 3 scoring dimensions
- Expression Inspector improvements

### v1.0.0
- Initial release

---

## Support & Feedback

If FlowDevKit saves you time, consider buying me a coffee:

[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/jndvr)

Have a bug, feature request, or idea? Submit it here:

[![Feedback](https://img.shields.io/badge/Give%20Feedback-Tally-4F46E5?logo=data:image/svg+xml;base64,)](https://tally.so/r/yPD40B)

---

## License

Source-available — free to use, not licensed for redistribution or use in competing products. See [LICENSE](LICENSE) for full terms. For redistribution or partnership enquiries contact [github.com/Jndvr](https://github.com/Jndvr).
