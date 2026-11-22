// Questions before sensitive steps: confirm, own password, second factor. One level above the core,
// so that every view can use them without importing another view.
import { api } from './api.js';
import { G, ico, setHtml } from './dom.js';
import { html } from './escaping.js';
import { tRaw } from '../i18n.js';

/**
 * Without `button` the main button is red "delete"; whoever confirms something else names their verb.
 * @param {string} title
 * @param {string} msg
 * @param {string} [icon]
 * @param {Button | null} [button]
 */
export function confirmDelete(title, msg, icon, button = null) {
  return openDialog(title, msg, icon, false, false, false, button).then(r => r !== null);
}

/**
 * Delete with a choice, e.g. which accounts of a household; the first option is preselected.
 * @param {string} title @param {string} msg @param {{ value: string, text: string }[]} choice
 * @returns {Promise<string | null>} the chosen value, null on cancel
 */
export function deleteWithChoice(title, msg, choice) {
  return /** @type {Promise<string | null>} */ (openDialog(title, msg, 'delete', false, false, false, { choice }));
}

/**
 * Like confirmDelete, but requires the own password — for admin actions on other accounts. Returns the
 * password or null (cancelled).
 * @param {string} title
 * @param {string} msg
 * @param {string} icon
 * @param {Button} button
 */
export function confirmDeleteWithPassword(title, msg, icon, button) {
  if (!button?.button || !['bp', 'bd'].includes(button.kind ?? ''))
    throw new Error('confirmDeleteWithPassword: button text and kind are missing');
  return openDialog(title, msg, icon, true, false, false, { field: 'confirm.admin_password', ...button });
}

/** With an active second factor the server requires the code for sensitive changes
 * (second_factor_required); then ask once and repeat with `code`.
 * @template T
 * @param {(extra: { code?: string, passkey?: object }) => Promise<T>} call
 * @returns {Promise<T | null>} the response, or null if the dialog was cancelled */
export async function withSecondFactor(call) {
  const d = await call({});
  const a = /** @type {{ code?: unknown, passkey?: unknown } | null | undefined} */ (d);
  if (a?.code !== 'second_factor_required') return d;
  const withPasskey = !!(a.passkey && fetchPasskey);
  const code = await openDialog(
    tRaw('sf.title'),
    tRaw(withPasskey ? 'sf.code_or_passkey' : 'sf.code_required'),
    'lock',
    false,
    true,
    withPasskey,
    CONFIRM,
  );
  if (code === null) return null;
  if (code !== WITH_PASSKEY) return call({ code: code.trim() });
  const passkey = await /** @type {() => Promise<object | null>} */ (fetchPasskey)();
  return passkey ? call({ passkey }) : null;
}
/**
 * Only ask for a code, without password (new recovery codes).
 * @param {string} title @param {string} text @returns {Promise<string | null>} the code, or null on cancel
 */
export async function questionCode(title, text) {
  const code = await openDialog(title, text, 'lock', false, true, false, CONFIRM);
  return typeof code === 'string' ? code.trim() : null;
}
/**
 * Main button of the question dialog: text, kind (bp blue, bd red), field label.
 * withCode: password and code in one dialog instead of two one after another.
 * @typedef {{ button?: string, kind?: string, field?: string, values?: Record<string, unknown>, error?: boolean, choice?: { value: string, text: string }[], withCode?: boolean }} Button
 */
/** A confirmation is not a deletion: button in the main color instead of red. @type {Button} */
const CONFIRM = { button: 'common.confirm', kind: 'bp', field: 'settings.password.current' };

/**
 * Confirm an account change with the own password — once when saving in the dialog instead of a field
 * "current password" per section, which looked like an error. With a wrong password the dialog asks again.
 * @param {string} title
 * @template T
 * @param {(password: string, extra: { code?: string, passkey?: object }) => Promise<T>} call
 * @param {string} [explanation] says what is being confirmed (instead of just "password please")
 * @param {Button} [button] main button; with `withCode` the same dialog asks for the code too
 */
export async function confirmWithPassword(title, call, explanation = tRaw('account.password_confirm'), button = {}) {
  let text = explanation,
    buttonKind = { ...CONFIRM, ...button };
  for (let attempt = 0; attempt < 5; attempt++) {
    const storage = { code: '' };
    const pw = await openDialog(title, text, 'lock', true, !!button.withCode, false, buttonKind, storage);
    if (pw === null) return null;
    const code = storage.code.trim();
    const d = await withSecondFactor(z => call(pw, code && !z.code && !z.passkey ? { code } : z));
    const a = /** @type {{ code?: unknown, error?: string } | null} */ (d);
    if (a?.code !== 'current_password_wrong' && a?.code !== 'current_password_required') return d;
    text = a.error || explanation;
    buttonKind = { ...buttonKind, error: true };
  }
  return null;
}

/** First without password; only if the server requires it for this change is it asked for.
 * @returns the response, or null on cancel
 * @param {string} title
 * @param {Record<string, unknown>} values
 */
export async function saveSettings(title, values) {
  const d = await api('POST', '/v2/settings', values);
  if (d?.code !== 'current_password_required') return d;
  return confirmWithPassword(title, (admin_password, z) =>
    api('POST', '/v2/settings', { ...values, admin_password, ...z }),
  );
}

/** passkeys.js registers here if the browser supports passkeys: an
 * import in the opposite direction would make the core load a view.
 * @type {(() => Promise<object | null>) | null} */
let fetchPasskey = null;

/** @param {() => Promise<object | null>} fn */
export function fetchSetPasskey(fn) {
  fetchPasskey = fn;
}

const WITH_PASSKEY = Symbol('passkey');

/**
 * @param {Button | null} [button]
 * @param {string} title
 * @param {string} msg
 * @param {string | undefined} icon
 * @param {boolean} withPassword
 * @param {{ code: string } | null} [storage] receives the code if password and code are asked together
 */
function openDialog(
  title,
  msg,
  icon,
  withPassword,
  withCode = false,
  withPasskey = false,
  button = null,
  storage = null,
) {
  return new Promise(resolve => {
    const modal = G('confirm-modal');
    const pwWrap = G('cd-pw-wrap'),
      pw = G('cd-pw');
    const codeWrap = G('cd-code-wrap'),
      codeField = G('cd-code'),
      pkButton = G('cd-passkey');
    if (pwWrap) pwWrap.hidden = !withPassword;
    if (codeWrap) codeWrap.hidden = !withCode;
    if (pkButton) pkButton.hidden = !withPasskey;
    if (pw) pw.value = '';
    if (codeField) codeField.value = '';
    G('cd-title').textContent = title || tRaw('common.delete_title');
    G('cd-msg').textContent = msg || tRaw('common.delete_text');
    setHtml(G('cd-icon'), ico(icon || 'delete'));
    modal.style.display = 'flex';
    const btnYes = G('cd-confirm');
    const btnNo = G('cd-cancel');
    const danger = (button?.kind || 'bd') === 'bd';
    btnYes.textContent = tRaw(button?.button || 'confirm.delete_btn', button?.values);
    btnYes.classList.toggle('bd', danger);
    btnYes.classList.toggle('bp', !danger);
    G('cd-icon').classList.toggle('neutral', !danger);
    G('cd-msg').classList.toggle('text-danger', !!button?.error);
    G('cd-pw-label').textContent = tRaw(button?.field || 'confirm.admin_password');
    const choiceField = G('cd-choice');
    choiceField.hidden = !button?.choice;
    setHtml(
      choiceField,
      html`${(button?.choice || []).map((w, i) => html`<label class="cd-choice-row"><input type="radio" name="cd-choice" value="${w.value}"${i ? '' : ' checked'}> ${w.text}</label>`)}`,
    );
    if (withPassword) setTimeout(() => pw?.focus(), 0);
    else if (withCode) setTimeout(() => codeField?.focus(), 0);
    /** @param {string | symbol | null} result */
    function cleanup(result) {
      if (storage && result !== null) storage.code = codeField?.value || '';
      if (pw) pw.value = '';
      if (codeField) codeField.value = '';
      modal.style.display = 'none';
      btnYes.onclick = null;
      btnNo.onclick = null;
      modal.onclick = null;
      if (pkButton) pkButton.onclick = null;
      resolve(result);
    }
    const selected = () =>
      /** @type {HTMLInputElement | null} */ (choiceField.querySelector('input:checked'))?.value || '';
    const value = () =>
      withPassword ? pw?.value || '' : withCode ? codeField?.value || '' : button?.choice ? selected() : '';
    btnYes.onclick = () => {
      const w = value();
      cleanup(w);
    };
    if (pkButton && withPasskey) pkButton.onclick = () => cleanup(WITH_PASSKEY);
    btnNo.onclick = () => cleanup(null);
    modal.onclick = e => {
      if (e.target === modal) cleanup(null);
    };
  });
}
