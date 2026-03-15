/**
 * popup/prefs.js — Preference persistence (chrome.storage.sync + localStorage fallback)
 */

async function loadPrefs() {
  try {
    return await chrome.storage.sync.get({ pa_region: "emea", pa_mode: "full", pa_theme: "light" });
  } catch {
    return { pa_region: "emea", pa_mode: "full", pa_theme: "light" };
  }
}

async function savePref(key, value) {
  try { await chrome.storage.sync.set({ [key]: value }); } catch { }
}

// ── Synchronous getters/setters backed by localStorage (initial render) ───────
let _region = (() => { try { return localStorage.getItem("pa_copier_region") || "emea"; } catch { return "emea"; } })();
let _mode   = (() => { try { return localStorage.getItem("pa_copier_mode")   || "full"; } catch { return "full"; } })();
let _theme  = (() => { try { return localStorage.getItem("pa_copier_theme")  || "light"; } catch { return "light"; } })();

export const getRegion = () => _region;
export const getMode   = () => _mode;
export const getTheme  = () => _theme;

export function setRegion(r) {
  _region = r;
  savePref("pa_region", r);
  try { localStorage.setItem("pa_copier_region", r); } catch { }
}
export function setMode(m) {
  _mode = m;
  savePref("pa_mode", m);
  try { localStorage.setItem("pa_copier_mode", m); } catch { }
}
export function setTheme(t) {
  _theme = t;
  savePref("pa_theme", t);
  try { localStorage.setItem("pa_copier_theme", t); } catch { }
}

/**
 * Resolves synced prefs and calls the provided callbacks if values differ
 * from the in-memory defaults. Callbacks let callers update DOM/state.
 */
export async function initPrefs({ onRegion, onMode, onTheme } = {}) {
  const prefs = await loadPrefs();
  if (prefs.pa_region && prefs.pa_region !== _region) {
    _region = prefs.pa_region;
    onRegion?.(_region);
  }
  if (prefs.pa_mode && prefs.pa_mode !== _mode) {
    _mode = prefs.pa_mode;
    onMode?.(_mode);
  }
  if (prefs.pa_theme && prefs.pa_theme !== _theme) {
    _theme = prefs.pa_theme;
    onTheme?.(_theme);
  }
}
