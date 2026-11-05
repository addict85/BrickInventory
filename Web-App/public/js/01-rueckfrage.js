// Rückfragen vor heiklen Schritten: Bestätigen, eigenes Passwort, zweiter
// Faktor. Eine Ebene über dem Kern, damit jede Ansicht sie nutzen kann, ohne
// eine andere Ansicht zu importieren.
import { G, ico } from './01-core.js';
import { t, tRaw } from '../i18n.js';

export function confirmDelete(title, msg, icon) {
  return dialogOeffnen(title, msg, icon, false).then(r => r !== null);
}

/**
 * Wie confirmDelete, verlangt aber das eigene Passwort — für Verwalteraktionen
 * an fremden Konten. Liefert das Passwort oder null (abgebrochen).
 */
export function bestaetigeMitPasswort(title, msg, icon) {
  return dialogOeffnen(title, msg, icon, true);
}

/** Bei aktivem zweitem Faktor verlangt der Server für heikle Änderungen den
 * Code (zweiter_faktor_noetig); dann einmal fragen und mit `code` wiederholen.
 * @param {(zusatz: { code?: string, passkey?: object }) => Promise<any>} ruf
 * @returns die Antwort, oder null, wenn der Dialog abgebrochen wurde */
export async function mitZweitemFaktor(ruf) {
  const d = await ruf({});
  if (d?.code !== 'zweiter_faktor_noetig') return d;
  const mitPasskey = !!(d.passkey && passkeyHolen);
  const code = await dialogOeffnen(tRaw('zf.title'), tRaw(mitPasskey ? 'zf.code_oder_passkey' : 'zf.code_noetig'),
    'schloss', false, true, mitPasskey);
  if (code === null) return null;
  if (code !== MIT_PASSKEY) return ruf({ code: code.trim() });
  const passkey = await passkeyHolen();
  return passkey ? ruf({ passkey }) : null;
}

/** 23-passkeys.js meldet sich hier an, wenn der Browser Passkeys kann: Ein
 * Import in die Gegenrichtung schlösse einen Kreis über 01-core.js. */
let passkeyHolen = null;

export function setzePasskeyHolen(fn) { passkeyHolen = fn; }

const MIT_PASSKEY = Symbol('passkey');

function dialogOeffnen(title, msg, icon, mitPasswort, mitCode = false, mitPasskey = false) {
  return new Promise(resolve => {
    const modal = G('confirm-modal');
    const pwWrap = G('cd-pw-wrap'), pw = G('cd-pw');
    const codeWrap = G('cd-code-wrap'), codeFeld = G('cd-code'), pkKnopf = G('cd-passkey');
    if (pwWrap) pwWrap.hidden = !mitPasswort;
    if (codeWrap) codeWrap.hidden = !mitCode;
    if (pkKnopf) pkKnopf.hidden = !mitPasskey;
    if (pw) pw.value = '';
    if (codeFeld) codeFeld.value = '';
    G('cd-title').textContent = title || t('common.delete_title');
    G('cd-msg').textContent   = msg   || t('common.delete_text');
    G('cd-icon').innerHTML  = ico(icon || 'loeschen');
    modal.style.display = 'flex';
    const btnYes = G('cd-confirm');
    const btnNo  = G('cd-cancel');
    if (mitPasswort) setTimeout(() => pw?.focus(), 0);
    else if (mitCode) setTimeout(() => codeFeld?.focus(), 0);
    function cleanup(result) {
      if (pw) pw.value = '';
      if (codeFeld) codeFeld.value = '';
      modal.style.display = 'none';
      btnYes.onclick = null;
      btnNo.onclick  = null;
      modal.onclick  = null;
      if (pkKnopf) pkKnopf.onclick = null;
      resolve(result);
    }
    const wert = () => (mitPasswort ? (pw?.value || '') : mitCode ? (codeFeld?.value || '') : '');
    btnYes.onclick = () => { const w = wert(); cleanup(w); };
    if (pkKnopf && mitPasskey) pkKnopf.onclick = () => cleanup(MIT_PASSKEY);
    btnNo.onclick  = () => cleanup(null);
    modal.onclick  = e => { if (e.target === modal) cleanup(null); };
  });
}
