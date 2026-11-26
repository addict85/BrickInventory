// Login, logout and building the application afterwards. The module stands at the very top of the import graph: it
// may start or clear every view, and no view imports it. The API wrapper only reports a
// session end as an event; the reaction happens here.
import { registerActions } from './registry.js';
import { html } from './escaping.js';
import { subscribe, emit } from './events.js';
import { resetScopeModes } from './account-filter.js';
import { LANG, applyLang, setLangValue, tRaw } from '../i18n.js';
import { api, apiRaw, emptyCache } from './api.js';
import { G, buttonBusy, queryAll, setHtml } from './dom.js';
import { fieldError, formError, passwordRuleText } from './form.js';
import { applyTheme, initDefaultCondition, showUsernames, showRbHint, _updateLangSelect } from './account.js';
import { toast } from './messages.js';
import { acceptMailLink, openMailLink } from './mail-link.js';
import { setGallerySets, setAccount, setSettingsSnapshot, setAccountCurrency, loggedInAccount } from './state.js';
import { routeOnStart } from './router.js';
import { plInit, resetPartsList, plRenderSets } from './init.js';
import { bindGlobalErrorHandlers } from './error-capture.js';
import { checkSession, sessionUnresolved, removeStartupScaffold, waitForStartup, showOffline } from './start-box.js';
import { gibCheckOnLoad, resetGive } from './progress.js';
import { checkSetup } from './setup.js';
import { setupCheckButtonRefresh } from './setup-status.js';
import { initScrollbar } from './scrollbar.js';
import { bindTabs, refreshPageName } from './navigation.js';
import { loadHouseholdMembers } from './account-locations.js';
import { showOpenAlerts } from './detail-fields.js';

/** Starts the application. Called exclusively from js/main.js, after all modules have been evaluated. */
export function startApp() {
  bindGlobalErrorHandlers();
  bindTabs();
  plRenderSets();
  // Own scroll bar; the browser's one is hidden via CSS.
  initScrollbar();
  checkAuth();
}

subscribe('passwordChangeRequired', () => showRequiredSwitch());
subscribe('secondFactorRequired', () => showSecondRequired());

/** Account of the expired session: if another one logs in, the page reloads instead of showing its state. */
let _expiredAccount = /** @type {number | null} */ (null);
/**
 * A 401 means: the session is no longer valid. Instead of one hint per click above old data it goes
 * back to the login with "session expired" — as in the Android app.
 */
subscribe('sessionEnded', path => {
  if (path.startsWith('/v2/auth/me') || path.startsWith('/v2/auth/login')) return;
  if (!loggedInAccount) return; // was never logged in — nothing to end
  _expiredAccount = loggedInAccount.id;
  setAccount(null);
  // Already without a session right after login, on a page without HTTPS: the Secure cookie is missing.
  // "Expired" sent the operator into a loop of repeated logins.
  const withoutCookie = Date.now() - _signedInUm < 60_000 && !_cookieSet && withoutHttps();
  showLogin({ expired: true, hint: withoutCookie ? tRaw('auth.cookie_missing') : undefined });
});
/** Time of the last login via the form (for the case above). */
let _signedInUm = 0;
/** The server has confirmed that it set the cookie (cookie_missing: false); then a 401 is real. */
let _cookieSet = false;
/** http://localhost counts as a secure context for the browser, but carries no Secure cookie from the server. */
const withoutHttps = () => window.isSecureContext === false || location.protocol === 'http:';
// Up front only the sentence for every user; what the operator has to do (COOKIE_SECURE) is said by auth.cookie_missing
// only when the cookie is really missing.
const _withoutHttpsHint = G('login-without-https');
if (_withoutHttpsHint) _withoutHttpsHint.hidden = !withoutHttps();

// ── AUTH & PANELS ─────────────────────────────────────
/** @type {string | null} */
let _resetToken = null;
/**
 * @type {string}
 */
/** @type {string | null} */
let _verifyToken = null;
let _verifySignedIn = false;

/**
 * @param {string} name
 * @param {boolean} [focus] After a click on a switch link: the link disappears with its field, and
 *   without a new target the focus would state on BODY — keyboard and screen reader would start at the top again.
 */
function showPanel(name, focus = false) {
  ['login', 'register', 'forgot', 'reset', 'verify', 'maillink', 'required-change', 'second-factor-required'].forEach(
    p => {
      const el = G('panel-' + p);
      if (el) el.style.display = p === name ? 'block' : 'none';
    },
  );
  const panel = G('panel-' + name);
  const title = panel?.querySelector('h1')?.textContent?.trim();
  if (title) document.title = `${title} – BrickInventory`;
  if (!focus || !panel) return;
  const field = [...panel.querySelectorAll('input:not([type="hidden"]):not([disabled])')].find(
    e => !e.closest('[hidden],[style*="display: none"]'),
  );
  /** @type {HTMLElement | undefined} */ (field)?.focus();
}

// With the start password the server only allows the change (403 password_change_required); the application would
// otherwise come up with nothing but errors.

function showRequiredSwitch() {
  G('login-screen').style.display = 'flex';
  removeStartupScaffold();
  G('app').style.display = 'none';
  showPanel('required-change');
  G('lp').value = '';
  G('required-new').focus();
}
// Admin without a second factor: the server only allows its setup (403 second_factor_mandatory);
// js/second-factor.js draws it into the field.
function showSecondRequired() {
  G('login-screen').style.display = 'flex';
  removeStartupScaffold();
  G('app').style.display = 'none';
  showPanel('second-factor-required');
  document.dispatchEvent(new CustomEvent('second-factor-required'));
}
function requiredLogout() {
  G('btn-logout')?.click();
}
function openApp() {
  if (loggedInAccount?.mustChangePassword) showRequiredSwitch();
  else if (loggedInAccount?.secondFactorRequired) showSecondRequired();
  else showApp();
}
G('btn-required')?.addEventListener('click', async () => {
  const newValue = G('required-new').value,
    err = G('required-err');
  formError(err, '');
  const rule = passwordRuleText(newValue);
  if (rule) {
    formError(err, rule, ['required-new']);
    return;
  }
  if (newValue !== G('required-repeat').value) {
    formError(err, tRaw('settings.password.mismatch'), ['required-repeat']);
    return;
  }
  const d = await api('POST', '/v2/auth/change-password', { newPassword: newValue });
  if (!d.success) {
    formError(err, d.error || tRaw('settings.error'), ['required-new']);
    return;
  }
  location.reload();
});

// The mail's token is in the fragment (#token=), which no browser sends: in no log, no referer.
(() => {
  const params = new URLSearchParams(location.search);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || params.get('token');
  // The link from the mail confirms nothing by itself; only the button (POST) does.
  if (token && location.pathname === '/verify') {
    _verifyToken = token;
    showPanel('verify');
  } else if (token && (location.pathname.includes('reset-password') || params.get('type') === 'reset')) {
    _resetToken = token;
    showPanel('reset');
  } else if (token && acceptMailLink(token, location.pathname)) showPanel('maillink');
  if (token) history.replaceState({}, '', location.pathname);
})();
// Another link in the same tab only changes the fragment: reload, otherwise the old token would stay.
addEventListener('hashchange', () => /[#&]token=/.test(location.hash) && location.reload());

G('link-register')?.addEventListener('click', e => {
  e.preventDefault();
  showPanel('register', true);
  const rl = G('reg-lang');
  if (rl && (LANG === 'de' || LANG === 'en')) rl.value = LANG;
});
G('link-forgot')?.addEventListener('click', e => {
  e.preventDefault();
  showPanel('forgot', true);
});
G('link-to-login')?.addEventListener('click', e => {
  e.preventDefault();
  showPanel('login', true);
});
G('link-forgot-to-login')?.addEventListener('click', e => {
  e.preventDefault();
  showPanel('login', true);
});

G('btn-register')?.addEventListener('click', async () => {
  const u = G('reg-user').value.trim(),
    e = G('reg-email').value.trim();
  const p = G('reg-pass').value,
    p2 = G('reg-pass2').value;
  const err = G('reg-err');
  formError(err, '');
  if (!u || !e || !p) {
    formError(
      err,
      tRaw('register.req_fields'),
      [!u && 'reg-user', !e && 'reg-email', !p && 'reg-pass'].filter(x => typeof x === 'string'),
    );
    return;
  }
  // Order: too short BEFORE unequal — the same as in the app (LoginScreen.kt). Its comment already claimed
  // before "the same three checks as in the web form, and in the same order"; neither was
  // true until now, because the web app did not check the length at all.
  const rule = passwordRuleText(p);
  if (rule) {
    formError(err, rule, ['reg-pass']);
    return;
  }
  if (p !== p2) {
    formError(err, tRaw('settings.password.mismatch'), ['reg-pass2']);
    return;
  }
  const btn = G('btn-register');
  const free = buttonBusy(btn);
  const d = await api('POST', '/v2/auth/register', {
    username: u,
    email: e,
    first_name: G('reg-first').value.trim() || null,
    last_name: G('reg-last').value.trim() || null,
    password: p,
    language: G('reg-lang')?.value || LANG || 'de',
  });
  free();
  if (d.success) {
    G('reg-form').style.display = 'none';
    G('reg-success').style.display = 'block';
    G('reg-success').textContent = tRaw(d.email_sent === false ? 'register.not_sent' : 'register.sent');
  } else {
    formError(err, d.error || tRaw('settings.error'));
  }
});

G('btn-forgot')?.addEventListener('click', async () => {
  const email = G('forgot-email').value.trim();
  const err = G('forgot-err');
  formError(err, '');
  if (!email) {
    formError(err, tRaw('register.email_required'), ['forgot-email']);
    return;
  }
  const btn = G('btn-forgot');
  const free = buttonBusy(btn);
  const d = await api('POST', '/v2/auth/forgot-password', { email });
  free();
  if (d && d.success === false) {
    formError(err, d.error || tRaw('common.network_error'), ['forgot-email']);
    return;
  }
  G('forgot-form').style.display = 'none';
  G('forgot-success').style.display = 'block';
  G('forgot-success').textContent = d.message || tRaw('reset.link_sent');
});
G('btn-verify')?.addEventListener('click', async () => {
  const err = G('verify-err'),
    btn = G('btn-verify');
  formError(err, '');
  btn.disabled = true;
  const d = await api('POST', '/v2/auth/confirm-email', { token: _verifyToken });
  btn.disabled = false;
  if (!d.success) {
    formError(err, d.error || tRaw('settings.error'));
    return;
  }
  _verifyToken = null;
  if (_verifySignedIn) {
    await confirmedSignedIn();
    return;
  }
  history.replaceState({}, '', '/');
  showPanel('login');
  const m = G('verified-msg');
  if (m) m.style.display = 'block';
});
G('link-verify-to-login')?.addEventListener('click', e => {
  e.preventDefault();
  if (_verifySignedIn) {
    location.replace('/');
    return;
  }
  _verifyToken = null;
  showPanel('login');
});

G('btn-reset')?.addEventListener('click', async () => {
  const p = G('reset-pass').value,
    p2 = G('reset-pass2').value;
  const err = G('reset-err');
  formError(err, '');
  if (!p || p !== p2) {
    formError(err, tRaw('settings.password.mismatch'), [p ? 'reset-pass2' : 'reset-pass']);
    return;
  }
  const rule = passwordRuleText(p);
  if (rule) {
    formError(err, rule, ['reset-pass']);
    return;
  }
  if (!_resetToken) {
    formError(err, tRaw('reset.invalid_token'));
    return;
  }
  const btn = G('btn-reset');
  btn.disabled = true;
  btn.textContent = tRaw('reset.saving');
  const d = await api('POST', '/v2/auth/reset-password', { token: _resetToken, password: p });
  btn.disabled = false;
  btn.textContent = tRaw('reset.button');
  if (d.success) {
    G('reset-form').style.display = 'none';
    G('reset-success').style.display = 'block';
    G('reset-success').textContent = tRaw('reset.done');
    setTimeout(() => showPanel('login'), 2000);
  } else {
    formError(err, d.error || tRaw('settings.error'));
  }
});

// ── AUTH ──────────────────────────────────────────────

export async function checkAuth() {
  // Apply the language (from localStorage or browser language) immediately, so that the login/registration
  // and startup screens are translated BEFORE login too (so far applyLang only ran after login in showApp).
  applyLang(LANG, false);
  await waitForStartup();
  const { d, waitSec } = await checkSession();
  // The login mask is already usable while this question runs. Whoever has logged in meanwhile
  // would otherwise get the mask back from the late answer "no", although the session is valid.
  if (loggedInAccount) return;
  // Only an explicit "not logged in" leads to the mask. Throttling, server errors or no network
  // say nothing about the session; the mask would otherwise suggest it is gone.
  if (typeof d.loggedIn !== 'boolean') {
    sessionUnresolved(d, waitSec, checkAuth);
    return;
  }
  showOffline(false);
  // The user is under `user` with `is_admin`, as in the login response; loggedInAccount keeps isAdmin, id and
  // username. Even when logged in (new address in the profile) confirmation comes first, then the application opens.
  _verifySignedIn = !!d.loggedIn;
  if (_verifyToken) showConfirmationTarget(!!d.loggedIn);
  // Logged in means: `user` is there; the contract leaves it optional because /auth/me also answers when logged out.
  if (d.loggedIn && !_verifyToken && !openMailLink()) {
    setAccount(
      /** @type {import('./state.js').Account} */ ({ ...d, ...(d.user || {}), isAdmin: d.user?.is_admin === true }),
    );
    openApp();
  } else {
    G('login-screen').style.display = 'flex';
    removeStartupScaffold();
    G('app').style.display = 'none';
    // Don't override reset/verified panels that were already set from URL params
    if (!_resetToken && !_verifyToken && !openMailLink() && !G('verified-msg')?.style.display.includes('block')) {
      showPanel('login');
    }
    checkRegistrationEnabled();
  }
}
/**
 * Before redeeming, the server names the link's account, and the button names it once more: whoever opens the
 * one of a foreign account from two identical mails sees its name before confirming its address.
 * @param {boolean} loggedIn
 */
async function showConfirmationTarget(loggedIn) {
  const el = G('verify-target'),
    btn = G('btn-verify');
  if (!el || !btn) return;
  btn.disabled = true;
  const v = await api('POST', '/v2/auth/confirm-email/preview', { token: _verifyToken });
  const p = loggedIn ? await api('GET', '/v2/auth/profile') : null;
  const u = p?.success ? p.user : null;
  if (!v?.success) {
    formError(G('verify-err'), v?.error || tRaw('settings.error'));
    // When logged in still say what is waiting for the own account; the link cannot be confirmed.
    if (u) {
      el.textContent = u.new_email
        ? tRaw('verify.pending', { email: u.new_email, account: u.username })
        : tRaw('verify.nichts_pending', { account: u.username });
      confirmationSignedIn(u.new_email);
    }
    return;
  }
  el.textContent =
    u && u.username !== v.username
      ? tRaw('verify.fremdes_account', { account: v.username, ich: u.username })
      : u?.new_email
        ? tRaw('verify.pending', { email: u.new_email, account: u.username })
        : tRaw('verify.account', { account: v.username });
  btn.removeAttribute('data-i18n');
  btn.textContent = tRaw('verify.button_account', { account: v.username });
  btn.disabled = false;
  if (u) confirmationSignedIn(u.new_email);
}
/**
 * When logged in the page leads back into the collection; if nothing is waiting, "confirm" is no longer the
 * suggested step.
 * @type {string | null}
 */
let _verifyEmail = null;
/**
 * @param {string | null | undefined} email
 */
function confirmationSignedIn(email) {
  _verifyEmail = email || null;
  const back = G('link-verify-to-login');
  if (back) {
    back.textContent = tRaw('verify.to_collection');
    back.removeAttribute('data-i18n');
  }
  G('btn-verify')?.classList.toggle('bp', !!email);
  G('btn-verify')?.classList.toggle('bs', !email);
}
/** Into the app without reloading, so that the feedback stays. */
async function confirmedSignedIn() {
  history.replaceState({}, '', '/');
  await checkAuth();
  toast(_verifyEmail ? tRaw('verify.confirmed', { email: _verifyEmail }) : tRaw('verify.confirmed_short'), 'success');
}
/**
 * @param {{ expired?: boolean, hint?: string }} [o] expired: the name stays, so that
 *   one can log in again right away; password and code never — otherwise a press on "log in"
 *   would be enough for the next person at the device.
 */
function showLogin(o = {}) {
  G('lp').value = '';
  G('lc').value = '';
  G('lc-row').style.display = 'none';
  G('lc-status').textContent = '';
  // A shown password does not stay visible for the next login.
  if (G('lp').type !== 'password') {
    G('lp').type = 'password';
    const k = document.querySelector('[data-click="toggleSecret"][data-arg="lp"]');
    k?.setAttribute('aria-pressed', 'false');
    k?.querySelector('use')?.setAttribute('href', '#i-eye');
  }
  if (!o.expired) G('lu').value = '';
  const hint = G('login-hint');
  if (hint) {
    hint.hidden = !o.expired;
    hint.textContent = o.expired ? o.hint || tRaw('auth.session_expired') : '';
  }
  formError(G('lerr'), '');
  // The progress bar belongs to js/progress.js — that is also where it says what "reset" means for it
  // (display off, both polls stopped, log cleared). Its internals used to be written out
  // here.
  resetGive();
  sessionStorage.removeItem('webToken');
  emptyCache();
  // Clear sensitive data from all tabs before hiding. Only clear the chart, not its section: it
  // carries header and period choice, which would otherwise be missing after the next login.
  ['fin-tbl', 'portfolio-chart', 'portfolio-pnl', 'gallery-grid', 'parts-main', 'monitor-content'].forEach(id => {
    const el = G(id);
    if (el) el.replaceChildren();
  });
  setGallerySets([]);
  resetPartsList();
  // Clear partslist DOM so it doesn't persist after re-login
  const plResult = G('pl-result');
  if (plResult) plResult.replaceChildren();
  const plSetsEl = G('pl-sets');
  if (plSetsEl) plSetsEl.replaceChildren();
  const plStatus = G('pl-status');
  if (plStatus) plStatus.textContent = '';
  ['btn-pl-pdf', 'btn-pl-bl', 'pl-bl-condition', 'pl-stock-row'].forEach(id => {
    const el = G(id);
    if (el) el.style.display = 'none';
  });
  G('login-screen').style.display = 'flex';
  removeStartupScaffold();
  G('app').style.display = 'none';
  showPanel('login');
  checkRegistrationEnabled();
}
/** Counter of the queries for the login methods. Logout and expired session
 * both ask; if the older answer arrives last, it no longer counts. */
let _loginMethodsRun = 0;
async function checkRegistrationEnabled() {
  // The same occasion as the login methods: whoever shows the login page should know whether the
  // initial setup is still open — at startup as after logout.
  setupCheckButtonRefresh();
  const run = ++_loginMethodsRun;
  // Only stands again once the most recent answer is entered (browser tests wait for it).
  delete G('login-screen').dataset.loginMethods;
  try {
    const d = await api('GET', '/v2/auth/registration-status');
    if (run !== _loginMethodsRun || d.success === false) return;
    const wrap = G('link-register-wrap');
    if (wrap) wrap.style.display = d.enabled ? '' : 'none';
    // Only offer methods the server supports; if the information is missing (older server), everything stays as it was.
    if (d.passkey === false && G('btn-passkey')) G('btn-passkey').hidden = true;
    if (G('link-forgot')) G('link-forgot').hidden = d.forgot_password === false;
    if (G('forgot-admin')) G('forgot-admin').hidden = d.forgot_password !== false;
    G('login-screen').dataset.loginMethods = 'loaded';
  } catch (_) {}
}

function showApp() {
  bindTabs();
  plInit();
  setTimeout(() => {
    gibCheckOnLoad();
  }, 1000);
  G('login-screen').style.display = 'none';
  G('app').style.display = 'block';
  showUsernames();
  initDefaultCondition();
  // Account selection when capturing — stays hidden if there is nothing to choose.
  const household = loadHouseholdMembers();
  // Price alerts fired since the last visit — the counterpart to the Android app's hourly fetch.
  showOpenAlerts();
  // Setup wizard for a fresh installation (admins only).
  if (loggedInAccount?.isAdmin) checkSetup();
  // ?set=<number> opens the set directly (button of the price alert mail). Here and not on load, because only
  // here a session exists. Opening happens via the address #/set/…: routeOnStart() below closes every
  // dialog the address does not name. The parameter is dropped, so that F5 does not redeem a link again.
  const setFromLink = new URLSearchParams(location.search).get('set');
  if (setFromLink) history.replaceState({}, '', `${location.pathname}#/set/${encodeURIComponent(setFromLink)}`);
  // Apply saved language immediately (from localStorage) so static elements translate before server responds
  setLangValue(localStorage.getItem('bim_lang') || LANG);
  applyLang(LANG, false);
  // Load settings — also picks up server-stored language preference
  const settings = api('GET', '/v2/settings/raw').then(d => {
    if (d.success && d.settings) {
      setSettingsSnapshot(d.settings);
      setAccountCurrency(d.settings.currency || 'EUR');
      applyTheme(d.settings.app_theme);
      // The server's language wins (explicit choice); update localStorage too
      const srvLang = d.settings.language;
      // Also a language not loaded yet: applyLang loads it.
      if (srvLang === 'de' || srvLang === 'en') {
        if (srvLang !== LANG) applyLang(srvLang, false);
        localStorage.setItem('bim_lang', srvLang);
      }
    }
    _updateLangSelect();
  });
  // Since 16.10. the "settings" tab only carries what an admin sets (Marco's requirement) — it
  // is therefore, like monitoring, only shown here. For everyone else it would be empty, and an empty
  // tab is worse than none: one clicks it and searches.
  if (loggedInAccount?.isAdmin) {
    const ns = G('ntab-settings');
    if (ns) ns.style.display = '';
  }
  if (loggedInAccount?.isAdmin) {
    queryAll('.admin-only').forEach(el => {
      el.style.display = '';
    });
    const nm = G('ntab-monitor');
    if (nm) {
      nm.style.display = '';
      const lbl = nm.querySelector('.tab-label');
      if (lbl) lbl.textContent = tRaw('nav.monitoring');
    }
    G('usermgmt').style.display = 'block';
    ['bl-ao', 'rb-ao', 'bs-ao'].forEach(id => {
      const el = G(id);
      if (el) el.style.display = 'none';
    });
    const gg = G('global-settings-grid');
    if (gg) gg.style.display = 'grid';
    const gl = G('global-settings-label');
    if (gl) gl.style.display = 'block';
  } else {
    ['bl-ck', 'bl-cs', 'bl-tok', 'bl-ts', 'rb-key', 'bs-key', 'lim-rb', 'lim-bl', 'lim-bs'].forEach(id => {
      const el = G(id);
      if (el) {
        el.disabled = true;
        if (el.type !== 'number') el.placeholder = tRaw('settings.admins_only_ph');
      }
    });
    G('btn-sav-bl').disabled = true;
    G('btn-sav-rb').disabled = true;
    G('btn-sav-bs').disabled = true;
  }
  // Without a Rebrickable key the collection opens anyway: a jump into the settings on every
  // login takes the admin's start page away. A banner points it out once per session. First the
  // settings, then amounts: otherwise the prices would briefly state in the default currency and then jump
  // (UI check 6, N12).
  const bandDecided = settings
    .catch(() => {})
    .finally(() => {
      if (loggedInAccount?.isAdmin) showRbHint();
      emit('collectionLoad');
    });
  // The skeleton covers the app until banner and account filter are settled: otherwise the header slid down by the
  // banner while loading and the search field shrank by the account selection. If the server does not answer, after 2.5 s.
  Promise.race([Promise.allSettled([bandDecided, household]), new Promise(r => setTimeout(r, 2500))]).then(
    removeStartupScaffold,
  );
  routeOnStart();
  refreshPageName();
}
/** @type {[string, string][]} */
const LOGIN_REQUIRED = [
  ['lu', 'login.user_empty'],
  ['lp', 'login.password_empty'],
];
G('btn-login').onclick = doLogin;
for (const id of ['lu', 'lp', 'lc'])
  G(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doLogin();
    }
  });
/** Empty required fields are reported by the field itself, as in the other forms. If the code field stands
 * there, the code is required: without it the server only returned a silent 401, which moreover counted
 * against the login throttle. @returns {boolean} whether all are filled */
function loginFieldsFilled() {
  /** @type {[string, string][]} */
  const required =
    G('lc-row').style.display === 'none' ? LOGIN_REQUIRED : [...LOGIN_REQUIRED, ['lc', 'login.code_empty']];
  const empty = required.filter(([id]) => !(id === 'lp' ? G(id).value : G(id).value.trim()));
  for (const [id, key] of required) fieldError(id, empty.some(([l]) => l === id) ? tRaw(key) : '');
  if (empty.length) G(empty[0][0]).focus();
  return !empty.length;
}

/** Second factor required: show the code field and continue there. The focus jumps into the new field;
 * without the sentence one would not know whether the password was right. If the account has passkeys, one
 * works instead of the code (js/passkeys.js). @param {import('../../frontend-types/api').ApiResponse<'POST', '/v2/auth/login'>} d @param {string} code */
function askSecondFactor(d, code) {
  G('lc-row').style.display = '';
  G('lc').value = '';
  G('lc-status').textContent = code ? '' : tRaw('login.code_now');
  G('lc').focus();
  G('lc-passkey').hidden = !d.passkey;
  formError(G('lerr'), code ? d.error || '' : '', code ? ['lc'] : []);
}

/** Every login starts with "all accounts" — BEFORE showApp(), so that the select fields are created right
 * away with the reset value. @param {import('../../frontend-types/api').ApiResponse<'POST', '/v2/auth/login'>} d */
function enterAfterLogin(d) {
  if (_expiredAccount !== null && _expiredAccount !== d.user?.id) {
    location.reload();
    return;
  }
  setAccount(
    /** @type {import('./state.js').Account} */ ({ ...d, ...(d.user || {}), isAdmin: d.user?.is_admin === true }),
  );
  resetScopeModes();
  formError(G('lerr'), '');
  G('login-hint').hidden = true;
  _signedInUm = Date.now();
  _cookieSet = d.cookie_missing === false;
  openApp();
}

/** Both filled: usually the password is wrong, so go there. @param {import('../../frontend-types/api').ApiResponse<'POST', '/v2/auth/login'>} d */
function loginRefused(d) {
  const err = d.error || tRaw('settings.error');
  formError(G('lerr'), err, ['lp', 'lu']);
  if (d.unverified || d.code === 'email_not_confirmed') {
    setHtml(
      G('lerr'),
      html`${err}${html` <a href="#" data-click="resendConfirmation" data-style="color:var(--b600)">`}${tRaw('auth.resend_mail')}${html`</a>`}`,
    );
  }
}

async function doLogin() {
  // The summary message at the top stays for what only the server knows (wrong credentials, lock).
  formError(G('lerr'), '');
  if (!loginFieldsFilled()) return;
  const b = G('btn-login');
  const free = buttonBusy(b);
  const code = G('lc').value.trim();
  const d = await api('POST', '/v2/auth/login', {
    username: G('lu').value,
    password: G('lp').value,
    without_token: true,
    ...(code ? { code } : {}),
  });
  free();
  if (d.second_factor) {
    askSecondFactor(d, code);
    return;
  }
  G('lc-row').style.display = 'none';
  G('lc').value = '';
  G('lc-status').textContent = '';
  // The server did not set the cookie at all: opening the app would mean "expired" again right away.
  if (d.success && d.cookie_missing) showLogin({ expired: true, hint: tRaw('auth.cookie_missing') });
  else if (d.success) enterAfterLogin(d);
  else loginRefused(d);
}
G('btn-logout').onclick = async () => {
  // A token from an older login is invalidated along with it.
  const _wt = sessionStorage.getItem('webToken');
  // Logged out first: running requests that now end with 401 do not report "session expired".
  setAccount(null);
  await apiRaw('POST', '/v2/auth/logout', {
    headers: _wt ? { Authorization: 'Bearer ' + _wt } : {},
  }).catch(() => {});
  sessionStorage.removeItem('webToken');
  // Reload instead of cleaning up: lists, dialogs, title and language of the previous account would otherwise stay in the document.
  // The login mask then speaks the browser's language again.
  localStorage.removeItem('bim_lang');
  showLogin();
  if (navigator.onLine !== false) location.replace('/');
  else addEventListener('online', () => location.replace('/'), { once: true });
};

// Without information about the account: the server answers the same for every address.
async function resendConfirmation() {
  const email = G('lu').value.trim();
  if (!email.includes('@')) {
    toast(tRaw('auth.resend_need_email'), 'info');
    G('lu').focus();
    return;
  }
  const d = await api('POST', '/v2/auth/resend-confirmation', { email });
  toast(d.message || d.error || tRaw('settings.error'), d.success ? 'success' : 'error');
}
/**
 * Empty states lead to the field the first entry belongs in.
 * @param {string} id
 */
function focusField(id) {
  const f = G(id);
  const toggle = f?.closest('details');
  if (toggle) toggle.open = true;
  f?.scrollIntoView({ block: 'center' });
  f?.focus();
}

registerActions({
  showPanel,
  resendConfirmation,
  focusField,
  requiredLogout,
});
