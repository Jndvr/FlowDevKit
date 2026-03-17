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
| **Run History & Errors** | Browse recent runs, inspect failures, copy error messages and input/output detail |
| **Action Performance View** | Switch to the Performance tab inside any run to see every action sorted by duration, with a proportional timing bar |
| **Expression Inspector** | Scan and decode every Power FX / workflow expression in the flow |
| **Copy Trigger** | Copy just the trigger configuration |
| **Variable Tracker** | List all variables with their init values and usage locations |
| **Environment Variables** | Browse all Dataverse environment variables for the current environment — see type, current value, schema name, and copy `@parameters('...')` references in one click |
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

Click the **gear icon** in the header to access settings.

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
| **Definition only** | `triggers` + `actions` (lighter, portable) |
| **Full export** | + `connectionReferences` (needed for full import) |

---

## Action Performance View

Inside the **Run History** panel, open any run and use the **Performance** tab to see all actions ranked by execution time. Each row shows:

- Colour-coded status dot (succeeded / failed / skipped)
- Action name and duration in ms
- A proportional fill bar relative to the slowest action in the run

This lets you spot bottlenecks at a glance without leaving the browser.

---

## Environment Variables

The **Environment Variables** panel queries the Dataverse OData API for `environmentvariabledefinition` records in your current environment. For each variable you see:

- Display name and type badge (String / Number / Boolean / JSON / Data Source / Secret)
- Schema name
- Current value (masked for Secrets)
- **`@`** button — copies `@parameters('schemaname')` to your clipboard, ready to paste into a flow expression
- **Click any row** to expand and see the full value + a **Copy value** button

Use the search bar to filter by display name, schema name, or description.

> **Note:** The Environment Variables panel requires a Dataverse-scoped session token. FlowDevKit scans open browser tabs for this token automatically. If no token is found, an inline prompt directs you to open the Power Apps Tables page for your environment, which triggers the necessary authentication.

---

## Analyze Flow — Scores & Rules

The **Analyze Flow** panel runs 35 best-practice checks and computes three scores shown at the top.

### Complexity Score (Cyclomatic Complexity)

```
CC = 1 + conditions + loops + switch cases
```

| Range | Label |
|---|---|
| ≤ 5 | Low |
| ≤ 12 | Medium |
| ≤ 25 | High |
| > 25 | Very High |

### Maintainability Score (0–100)

Starts at 100, deducted for:
- Default action names (`Copy_of_…`, `Action_1`, etc.)
- Duplicate long expressions repeated across 4+ actions
- Deeply nested conditions (depth > 3)
- Large flows (50+ actions)
- Unused variables
- Missing flow description

### Reliability Risk (0–100+, lower is better)

Additive risk points from:
- Parallel branch race conditions
- Error masking (terminate + continue-on-error together)
- Secrets hardcoded in expressions
- Broken or missing connection references
- Unhandled HTTP responses
- Approval actions without timeout
- Missing retry policies on HTTP actions
- No top-level error boundary
- Legacy / deprecated connectors
- Potential runaway loops

### Lint Rules (35 total)

<details>
<summary>Show all rules</summary>

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

---

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Detect the currently open flow URL |
| `tabs` | Scan tab frames to resolve flow context |
| `scripting` | Inject token-extraction scripts into the active tab |
| `clipboardWrite` / `clipboardRead` | Copy and paste flow JSON |
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
