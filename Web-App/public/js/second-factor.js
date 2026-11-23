import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { formError } from './form.js';
import { toast } from './messages.js';
import { loadUsers } from './user-management.js';
import { html, rawHtml } from './escaping.js';
import { fmtDate } from './format.js';
import { emit } from './events.js';
import { loggedInAccount } from './state.js';
import { confirmDeleteWithPassword, questionCode, withSecondFactor, confirmWithPassword } from './confirm-prompt.js';

// ═══ Second factor in the profile (server: src/factors/secondFactor.ts) ══════════════
// Flow: password → QR code and key → confirm code → show the ten recovery codes once. After that: disable
// or get new codes.

// On the login screen, while an admin still has to set it up (js/api.js reports it).
let mandatory = false;
/** The setup an admin's "set up again" has already started. @type {import('../../frontend-types/contract').SecondFactorSetup | null} */
let started = null;
const area = () => (mandatory ? G('sf-required-surface') : G('sf-surface'));
if (typeof document !== 'undefined')
  document.addEventListener('second-factor-required', () => {
    mandatory = true;
    mandatoryHint('sf_required.hint');
    const d = started;
    started = null;
    void (d ? showSetup(d) : loadSecondFactor());
  });

/**
 * The intro above the area: first "please set up", after the code "done, save the codes".
 * @param {string} key
 */
function mandatoryHint(key) {
  const h = G('sf-required-hint');
  if (!h) return;
  h.dataset.i18n = key;
  h.textContent = tRaw(key);
}

/**
 * @param {import('./escaping.js').Markup} markup
 */
function render(markup) {
  const f = area();
  if (f) setHtml(f, markup);
}
// On the login screen the buttons stack wide, same as "log out" below them.
const buttonKind = () => (mandatory ? 'button-wide' : 'btn-sm');

const button = (/** @type {string} */ action, /** @type {string} */ text, kind = 'bs') =>
  html`<button type="button" class="btn ${kind} ${rawHtml(buttonKind())}" data-click="${action}"${genuine()}>${rawHtml(text)}</button>`;
const row = (/** @type {string} */ content) =>
  html`<div class="${mandatory ? 'sf-buttons-wide' : 'sf-buttons'}">${rawHtml(content)}</div>`;
// The fields are spelled out here rather than behind a helper: test/dom-ids.test.js only finds literal id
// attributes. The dialog asks for the password when triggered.
const CODE_FIELD = (/** @type {string} */ label, length = 24) =>
  html`<div class="fg"><label for="sf-code">${rawHtml(label)}</label><input type="text" id="sf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${length}" data-first-focus /></div>`;

export async function loadSecondFactor() {
  if (!area()) return;
  const d = await api('GET', '/v2/auth/second-factor');
  if (!d?.success) {
    render(html`<div class="voucher-empty">${tRaw('settings.error')}</div>`);
    return;
  }
  if (!d.active) {
    render(html`<form class="sform" data-submit="sf-start" data-style="max-width:420px">
      <div><button type="button" class="btn bp ${buttonKind()}" id="sf-start" data-click="setupSecondFactor"${genuine()}>${tRaw('sf.setup')}</button></div>
    </form>`);
    // On the login screen "set up" is the only next step.
    if (mandatory) G('sf-start')?.focus();
    return;
  }
  // Every action asks for the code in its own dialog: one field for two buttons would leave open what it
  // applies to. Old-style codes expire (migration 0122); only the owner knows whether the open ones are old.
  const old = d.old_codes_until
    ? html`<p role="note" data-style="margin:0 0 .75rem 0">${ico('warning')} ${tRaw('sf.old_codes', { bis: fmtDate(d.old_codes_until) })}</p>`
    : '';
  render(html`<p data-style="font-size:var(--fs-3);margin:0 0 .75rem 0">${ico('ok')} ${tRaw('sf.active', { n: d.codes_left })}</p>
    ${old}
    <div class="sf-buttons">
      ${button('newRecoveryCodes', tRaw('sf.new_codes'))}
      ${button('disableSecondFactor', tRaw(loggedInAccount?.isAdmin ? 'sf.new_setup' : 'sf.disable'), 'bd')}
    </div>`);
}

export async function setupSecondFactor() {
  // Shortly after login the server skips the password (grace period); otherwise it answers without a
  // counter with current_password_required.
  const first = await api('POST', '/v2/auth/second-factor/setup', {});
  const d =
    first?.code !== 'current_password_required'
      ? first
      : await confirmWithPassword(tRaw('sf.title'), (password, z) =>
          api('POST', '/v2/auth/second-factor/setup', { password, ...z }),
        );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  showSetup(d);
}

/** @param {import('../../frontend-types/contract').SecondFactorSetup} d */
function showSetup(d) {
  // Grouped for readability, in case someone types the key in by hand.
  const readable = (d.secret ?? '').replace(/(.{4})/g, '$1 ').trim();
  render(html`<form class="sform" data-submit="sf-confirm" data-style="max-width:420px">
      <p data-style="font-size:var(--fs-2);margin:0">${tRaw('sf.scan')}</p>
      <div id="sf-qr" class="sf-qr"></div>
      <div data-style="font-size:var(--fs-1);color:var(--mut)">${tRaw('sf.manual')}<br><code id="sf-key" data-style="user-select:all;font-size:var(--fs-3)">${readable}</code></div>
      <div class="sf-buttons">${button('copySecondFactorKey', tRaw('sf.key_copy'))}<a class="btn bs ${buttonKind()}" id="sf-otpauth" hidden>${tRaw('sf.in_app_open')}</a></div>
      <div class="lerr" id="sf-error" role="alert"></div>
      ${CODE_FIELD(tRaw('sf.confirm_code'), 6)}
      ${row(`<button type="button" class="btn bp ${buttonKind()}" id="sf-confirm" data-click="confirmSecondFactor">${t('sf.confirm')}</button>
        ${mandatory ? '' : button('loadSecondFactor', tRaw('common.cancel'))}`)}
    </form>`);
  const qr = G('sf-qr');
  if (qr && typeof QRCode !== 'undefined') {
    new QRCode(qr, {
      text: d.otpauth,
      width: 200,
      height: 200,
      colorDark: '#1e293b',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
    // The library creates the canvas and image with no name; what's read aloud is their purpose.
    qr.querySelector('img')?.setAttribute('alt', tRaw('sf.qr_alt'));
    qr.querySelector('canvas')?.setAttribute('aria-hidden', 'true');
  } else if (qr) qr.textContent = d.otpauth ?? '';
  // On the phone you can't scan your own screen: the link opens the authenticator app directly.
  const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('sf-otpauth'));
  if (link && /^otpauth:\/\/totp\//i.test(d.otpauth ?? '')) {
    link.href = d.otpauth ?? '';
    link.hidden = false;
  }
  G('sf-code')?.focus();
}

export async function copySecondFactorKey() {
  const text = (G('sf-key')?.textContent || '').replace(/\s+/g, '');
  try {
    await navigator.clipboard.writeText(text);
    toast(tRaw('sf.key_copied'), 'success');
  } catch {
    toast(tRaw('sf.copy_failed'), 'error');
  }
}

/** @param {string[]} codes */
function showCodes(codes) {
  if (mandatory) mandatoryHint('sf_required.done');
  render(html`<div class="sform" data-style="max-width:420px">
      <p data-style="font-size:var(--fs-2);margin:0"><strong>${tRaw('sf.codes_title')}</strong><br>${tRaw('sf.codes_hint')}</p>
      <pre id="sf-codes" data-style="font-size:var(--fs-3);line-height:1.6;background:var(--s50,#f8fafc);border:1px solid var(--bdr);border-radius:8px;padding:.6rem .9rem;margin:0;user-select:all">${codes.join('\n')}</pre>
      ${row(`${button('copyRecoveryCodes', tRaw('sf.copy'))}${button('saveRecoveryCodes', tRaw('sf.codes_file'))}
        <button type="button" class="btn bp ${buttonKind()}" id="sf-saved" data-click="${mandatory ? 'secondFactorRequiredDone' : 'loadSecondFactor'}">${t('sf.codes_done')}</button>`)}
    </div>`);
  G('sf-saved')?.focus();
}

export async function confirmSecondFactor() {
  const field = G('sf-code'),
    error = G('sf-error');
  const code = (field?.value || '').trim();
  if (!code) {
    if (error) formError(error, tRaw('sf.code_empty'), ['sf-code']);
    return;
  }
  const d = await api('POST', '/v2/auth/second-factor/confirm', { code });
  if (!d?.success) {
    // At the field instead of a toast: the error belongs to the code, and a toast would still sit next to
    // "set up" after the correct code.
    if (error) {
      formError(error, d?.error || tRaw('settings.error'), ['sf-code']);
      field?.select?.();
    } else toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('sf.enabled'), 'success');
  showCodes(d.codes ?? []);
}

export async function newRecoveryCodes() {
  const code = await questionCode(tRaw('sf.new_codes'), tRaw('sf.code_for_codes'));
  if (!code) return;
  const d = await api('POST', '/v2/auth/second-factor/codes', { code });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  showCodes(d.codes ?? []);
}

// An admin without a second factor may do nothing except set it up: for them, disabling is therefore
// called "set up again", and the setup starts with that same password right in the mandatory field.
export async function disableSecondFactor() {
  const isAdmin = !!loggedInAccount?.isAdmin;
  let adminPassword = '';
  const d = await confirmWithPassword(
    tRaw(isAdmin ? 'sf.new_setup' : 'sf.disable'),
    (password, z) => {
      adminPassword = password;
      return api('POST', '/v2/auth/second-factor/disable', { password, ...z });
    },
    tRaw(isAdmin ? 'sf.new_setup_text' : 'sf.disable_confirm'),
    { button: isAdmin ? 'sf.new_setup' : 'confirm.btn.disable', kind: 'bd', withCode: true },
  );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('sf.disabled'), 'success');
  if (!isAdmin) return loadSecondFactor();
  const started_ = await api('POST', '/v2/auth/second-factor/setup', { password: adminPassword });
  started = started_?.success ? started_ : null;
  emit('secondFactorRequired');
}

export async function copyRecoveryCodes() {
  const text = G('sf-codes')?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast(tRaw('sf.copied'), 'success');
  } catch {
    toast(tRaw('sf.copy_failed'), 'error');
  }
}

/** The codes as a text file: copying alone often made them vanish from the clipboard again. */
export function saveRecoveryCodes() {
  const text = G('sf-codes')?.textContent || '';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
  a.download = 'brickinventory-wiederherstellungscodes.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Admin: remove an account's second factor (phone and codes lost). */
/** @param {string} uid @param {string} name */
export async function resetSecondFactor(uid, name) {
  const admin_password = await confirmDeleteWithPassword(
    tRaw('sf.reset_title_name', { name }),
    tRaw('sf.reset_text', { name }),
    'lock',
    { button: 'confirm.btn.reset', kind: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z => api('DELETE', `/v2/auth/users/${uid}/second-factor`, { admin_password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(
    d.effective_at ? tRaw('users.takeover_later', { time: fmtDate(d.effective_at, 'datetime') }) : tRaw('sf.disabled'),
    'success',
  );
  loadUsers();
}

/** Set up: reloading opens the app. */
function secondFactorRequiredDone() {
  location.reload();
}

// Names below are registry-exposed (index.html/connection.js) — kept unchanged.
registerActions({
  loadSecondFactor,
  secondFactorRequiredDone,
  setupSecondFactor,
  confirmSecondFactor,
  newRecoveryCodes,
  disableSecondFactor,
  copyRecoveryCodes,
  copySecondFactorKey,
  saveRecoveryCodes,
  resetSecondFactor,
});
