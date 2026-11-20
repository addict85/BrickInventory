import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { formError } from './formular.js';

// Links from emails that work without being logged in: cancel an announced admin action
// (server: src/konto/verwalterAktionen.ts) and release a login past the daily limit
// (src/konto/loginLimiter.ts). Only the button acts (POST): a mail provider's link scanner would
// otherwise cancel or release it by itself.

/** @type {{ token: string, kind: 'abbrechen' | 'freigeben' } | null} */
let open = null;
// Spelled out, so the dictionary check finds every key as a call.
const TEXTS = {
  abbrechen: () => ({
    titel: tRaw('maillink.abbrechen.title'),
    text: tRaw('maillink.abbrechen.text'),
    knopf: tRaw('maillink.abbrechen.button'),
    ok: tRaw('maillink.abbrechen.ok'),
  }),
  freigeben: () => ({
    titel: tRaw('maillink.freigeben.title'),
    text: tRaw('maillink.freigeben.text'),
    knopf: tRaw('maillink.freigeben.button'),
    ok: tRaw('maillink.freigeben.ok'),
  }),
};

/**
 * Fills the panel when the path is a link from an email.
 * @param {string} token @param {string} path
 * @returns {boolean}
 */
export function acceptMailLink(token, path) {
  const kind = path === '/uebernahme-abbrechen' ? 'abbrechen' : path === '/anmeldung-freigeben' ? 'freigeben' : null;
  if (!kind) return false;
  open = { token, kind };
  const t = TEXTS[kind]();
  G('maillink-titel').textContent = t.titel;
  G('maillink-text').textContent = t.text;
  G('btn-maillink').textContent = t.knopf;
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
    open.kind === 'abbrechen'
      ? await api('POST', '/v1/auth/uebernahme-abbrechen', body)
      : await api('POST', '/v1/auth/anmeldung-freigeben', body);
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
