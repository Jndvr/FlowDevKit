export const REGION_HOSTS = {
  emea:         "emea.api.flow.microsoft.com",
  unitedstates: "unitedstates.api.flow.microsoft.com",
  asia:         "asia.api.flow.microsoft.com",
  australia:    "australia.api.flow.microsoft.com",
  canada:       "canada.api.flow.microsoft.com",
  india:        "india.api.flow.microsoft.com",
};

export const API_VERSION = "2016-11-01";

export const ACTION_TYPE_MAP = {
  // Control flow
  "If":               { label: "Condition",    cat: "control" },
  "Switch":           { label: "Switch",       cat: "control" },
  "Foreach":          { label: "Each",         cat: "control" },
  "Until":            { label: "Until",        cat: "control" },
  "Scope":            { label: "Scope",        cat: "control" },
  "Terminate":        { label: "Terminate",    cat: "control" },
  // HTTP
  "Http":             { label: "HTTP",         cat: "http" },
  "Request":          { label: "HTTP Trigger", cat: "http" },
  "Response":         { label: "Response",     cat: "http" },
  // Variables
  "InitializeVariable":      { label: "Init Var",      cat: "variable" },
  "SetVariable":             { label: "Set Var",       cat: "variable" },
  "AppendToArrayVariable":   { label: "Append Array",  cat: "variable" },
  "AppendToStringVariable":  { label: "Append String", cat: "variable" },
  "IncrementVariable":       { label: "Increment",     cat: "variable" },
  "DecrementVariable":       { label: "Decrement",     cat: "variable" },
  // Data
  "ParseJson":    { label: "Parse JSON", cat: "data" },
  "Select":       { label: "Select",     cat: "data" },
  "Filter":       { label: "Filter",     cat: "data" },
  "Query":        { label: "Filter",     cat: "data" },
  "Join":         { label: "Join",       cat: "data" },
  "Compose":      { label: "Compose",    cat: "data" },
  "Table":        { label: "Table",      cat: "data" },
  "Recurrence":   { label: "Schedule",   cat: "data" },
  // Child flow
  "Workflow": { label: "Child Flow", cat: "flow" },
  // Connectors
  "OpenApiConnection":             { label: "Connector", cat: "connector" },
  "OpenApiConnectionWebhook":      { label: "Connector", cat: "connector" },
  "OpenApiConnectionNotification": { label: "Connector", cat: "connector" },
};

export const ACTION_CAT_STYLE = {
  control:   { bg: "rgba(99,102,241,0.15)",  color: "#818cf8" },
  http:      { bg: "rgba(20,184,166,0.15)",  color: "#2dd4bf" },
  variable:  { bg: "rgba(245,158,11,0.15)",  color: "#fbbf24" },
  data:      { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa" },
  flow:      { bg: "rgba(168,85,247,0.15)",  color: "#c084fc" },
  connector: { bg: "rgba(52,211,153,0.15)",  color: "#34d399" },
  unknown:   { bg: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

export const CONNECTOR_NAMES = {
  sharepointonline: "SharePoint", sharepointbeta: "SharePoint",
  teams: "Teams", microsoftteams: "Teams",
  office365: "Outlook", office365users: "O365 Users", office365groups: "O365 Groups",
  outlook: "Outlook", outlookv2: "Outlook",
  onedriveforbusiness: "OneDrive", onedrive: "OneDrive",
  commondataservice: "Dataverse", commondataserviceforapps: "Dataverse",
  dynamicscrmonline: "Dynamics",
  planner: "Planner",
  approvals: "Approvals",
  flowpush: "Notifications",
  excelonlinebusiness: "Excel", excelonline: "Excel",
  wordonlinebusiness: "Word",
  powerbi: "Power BI",
  sendgrid: "SendGrid",
  salesforce: "Salesforce",
  slack: "Slack",
  twitter: "Twitter/X",
  github: "GitHub",
  azureblob: "Azure Blob", azurequeues: "Azure Queues",
  servicebus: "Service Bus",
  sql: "SQL", sqldw: "SQL DW",
  keyvault: "Key Vault",
  azuread: "Azure AD",
  ftp: "FTP", sftp: "SFTP",
  smtp: "SMTP",
  rss: "RSS",
  http: "HTTP",
  webcontents: "Web",
  documentdb: "Cosmos DB",
  pvaprebuiltentitiesflow: "Copilot Studio",
  powerplatformforadmins: "PP Admin", powerplatformforadminsv2: "PP Admin",
  powerautomate: "Power Automate", flowmanagement: "Flow Mgmt",
};
