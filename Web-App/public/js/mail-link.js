import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { formError } from './form.js';

// Links from emails that work without being logged in: cancel an announced admin action
// (server: src/account/adminActions.ts) and release a login past the daily limit
// (src/account/loginLimiter.ts). Only the button acts (POST): a mail provider's link scanner would
// otherwise cancel or release it by itself.

/** @type {{ token: string, kind: 'cancel' | 'release' } | null} */
let open = null;
// Spelled out, so the dictionary check finds every key as a call.
const TEXTS = {
  cancel: () => ({
    title: tRaw('maillink.cancel.title'),
    text: tRaw('maillink.cancel.text'),
    button: tRaw('maillink.cancel.button'),
    ok: tRaw('maillink.cancel.ok'),
  }),
  release: () => ({
    title: tRaw('maillink.release.title'),
    text: tRaw('maillink.release.text'),
    button: tRaw('maillink.release.button'),
    ok: tRaw('maillink.release.ok'),
  }),
};

/**
 * Fills the panel when the path is a link from an email.
 * @param {string} token @param {string} path
 * @returns {boolean}
 */
export function acceptMailLink(token, path) {
  const kind = path === '/uebernahme-abbrechen' ? 'cancel' : path === '/anmeldung-freigeben' ? 'release' : null;
  if (!kind) return false;
  open = { token, kind };
  const t = TEXTS[kind]();
  G('maillink-title').textContent = t.title;
  G('maillink-text').textContent = t.text;
  G('btn-maillink').textContent = t.button;
  return true;
}

export const openMailLink = () => open !== null;

G('btn-maillink')?.addEventListener('click', async () => {
  if (!open) return;
  const err = G('maillink-err'),
    btn = G('btn-maillink');
  formError(err, '');
  btn.disabled = true;
  const body = { token: open.token };
  const d =
    open.kind === 'cancel'
      ? await api('POST', '/v2/auth/cancel-takeover', body)
      : await api('POST', '/v2/auth/approve-login', body);
  btn.disabled = false;
  if (!d.success) {
    formError(err, d.error || tRaw('settings.error'));
    return;
  }
  btn.hidden = true;
  const ok = G('maillink-ok');
  ok.textContent = TEXTS[open.kind]().ok;
  ok.hidden = false;
  open = null;
});
