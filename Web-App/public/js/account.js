import { LANG, applyLang, tRaw } from '../i18n.js';
import { settingsSnapshot, loggedInAccount } from './state.js';
import { subscribe } from './events.js';
import { registerActions } from './registry.js';
import { G, queryOne } from './dom.js';
import { api } from './api.js';

// What is attached to the logged-in account: language, theme, name in the header bar, hint about the missing
// Rebrickable key.

// ── Hint "Rebrickable key missing" ──────────────────────────────────────────
/** Once dismissed, the banner stays away, per account and device: on the phone it cost a sixteenth of
 * the first screen, and the missing key is shown in the settings and the setup wizard anyway. */
const rbHintKey = () => `bim_rb_hint_dismissed:${loggedInAccount?.id ?? ''}`;

/** Not above the setup wizard: it asks for exactly this key.
 * If it is closed with "later", the banner comes (setup.js). */
export function showRbHint() {
  const band = G('rb-hint');
  if (!band || !loggedInAccount?.isAdmin || G('setup-modal')?.classList.contains('open')) return;
  let show = !String(settingsSnapshot?.rebrickable_api_key || '').trim();
  try {
    show &&= !localStorage.getItem(rbHintKey());
    if (show) localStorage.setItem('bim_rb_band', '1');
    else localStorage.removeItem('bim_rb_band');
  } catch (_) {
    /* without storage: show */
  }
  if (show) band.hidden = false;
}

export function hideRbHint() {
  const b = G('rb-hint');
  if (b) b.hidden = true;
}

function openRbHint() {
  hideRbHint();
  queryOne('.ntab[data-tab="settings"]')?.click();
  /** @type {HTMLElement|null} */ (document.querySelector('.settings-nav a[data-arg="settings-rb"]'))?.click();
  G('rb-key')?.focus();
}

/** Dismissing applies permanently for this account; the focus goes to the page content instead of nowhere. */
function dismissRbHint() {
  hideRbHint();
  try {
    localStorage.setItem(rbHintKey(), '1');
    localStorage.removeItem('bim_rb_band');
  } catch (_) {
    /* then just until reloading */
  }
  G('content')?.focus({ preventScroll: true });
}

// ── LANGUAGE HELPERS ────────────────────────────────────────────────────────
/** @param {string} lang */
export function setLang(lang) {
  applyLang(lang, true);
  _updateLangSelect();
}

export function _updateLangSelect() {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('lang-select'));
  if (sel) sel.value = LANG;
}

// Passes the theme on to theme-boot.js, which already applies it in the <head> and keeps the cache: that way
// a change takes effect immediately and on the next load without flashing.
/**
 * @param {string} theme
 */
export function applyTheme(theme) {
  // No own list of valid themes: the old one knew two of six, and the newer ones only took effect after
  // reloading. Valid is what theme-boot.js knows; without this script nothing is set.
  if (typeof window.__bimApplyTheme !== 'function') return null;
  return window.__bimApplyTheme(theme);
}

export async function initDefaultCondition() {
  try {
    // The user's effective default (user override → global → 'N'), so that the capture forms prefill the
    // condition chosen in the settings.
    const d = await api('GET', '/v1/settings/user/default-condition');
    if (d?.success && d.condition) {
      ['add-condition', 'ap-condition', 'af-condition'].forEach(id => {
        const el = G(id);
        if (el) el.value = d.condition;
      });
    }
  } catch {}
}

/**
 * The name in the header bar, for admins with "(Admin)" instead of a badge of its own. A function, because
 * login and profile write it and a second version once went nowhere.
 */
export function showUsernames() {
  const el = G('ubadge');
  if (!el || !loggedInAccount) return;
  // "admin (Administrator)" says the same thing twice: "admin" is the common short form of the role
  // and the name of the start account.
  const name = loggedInAccount.username.toLocaleLowerCase();
  const duplicate = name === 'admin' || name === tRaw('users.admin_badge').toLocaleLowerCase();
  el.textContent =
    loggedInAccount.isAdmin && !duplicate
      ? `${loggedInAccount.username} (${tRaw('users.admin_badge')})`
      : loggedInAccount.username;
}

/**
 * Jump bar in the account: the sections stay below each other, the link scrolls there and gives the heading
 * the focus, so that keyboard and screen reader continue there. No hash: that belongs to the router.
 * @param {string} id @param {Event} [ev]
 */
function jumpToAccount(id, ev) {
  ev?.preventDefault();
  const target = G(id);
  if (!target) return;
  (target.closest('.ssec') ?? target).scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
}

registerActions({
  jumpToAccount,
  openRbHint,
  dismissRbHint,
});

// Save the chosen language on the account (i18n.js reports the change). Whatever the code writes at runtime
// (account label "Name (Admin)") is updated.
subscribe('languageChanged', ({ language, save }) => {
  if (loggedInAccount) showUsernames();
  if (save) api('POST', '/v1/settings', { language: language });
});
