import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { G } from './dom.js';
import { formularFehler } from './formular.js';

// Links aus Mails, die ohne Anmeldung wirken: eine angekündigte Verwalteraktion abbrechen
// (Server: src/konto/verwalterAktionen.ts) und eine Anmeldung über der Tagesgrenze freigeben
// (src/konto/loginLimiter.ts). Erst der Knopf wirkt (POST): Ein Link-Scanner des Mailanbieters
// bräche sonst ab oder gäbe frei.

/** @type {{ token: string, art: 'abbrechen' | 'freigeben' } | null} */
let offen = null;
// Ausgeschrieben, damit die Wörterbuchprüfung jeden Schlüssel als Aufruf findet.
const TEXTE = {
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
 * Füllt die Tafel, wenn der Pfad ein Link aus einer Mail ist.
 * @param {string} token @param {string} pfad
 * @returns {boolean}
 */
export function mailLinkAnnehmen(token, pfad) {
  const art = pfad === '/uebernahme-abbrechen' ? 'abbrechen' : pfad === '/anmeldung-freigeben' ? 'freigeben' : null;
  if (!art) return false;
  offen = { token, art };
  const t = TEXTE[art]();
  G('maillink-titel').textContent = t.titel;
  G('maillink-text').textContent = t.text;
  G('btn-maillink').textContent = t.knopf;
  return true;
}

export const mailLinkOffen = () => offen !== null;

G('btn-maillink')?.addEventListener('click', async () => {
  if (!offen) return;
  const err = G('maillink-err'),
    btn = G('btn-maillink');
  formularFehler(err, '');
  btn.disabled = true;
  const body = { token: offen.token };
  const d =
    offen.art === 'abbrechen'
      ? await api('POST', '/v1/auth/uebernahme-abbrechen', body)
      : await api('POST', '/v1/auth/anmeldung-freigeben', body);
  btn.disabled = false;
  if (!d.success) {
    formularFehler(err, d.error || tRaw('settings.error'));
    return;
  }
  btn.hidden = true;
  const ok = G('maillink-ok');
  ok.textContent = TEXTE[offen.art]().ok;
  ok.hidden = false;
  offen = null;
});
