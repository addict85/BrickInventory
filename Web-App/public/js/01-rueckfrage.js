// Rückfragen vor heiklen Schritten: Bestätigen, eigenes Passwort, zweiter
// Faktor. Eine Ebene über dem Kern, damit jede Ansicht sie nutzen kann, ohne
// eine andere Ansicht zu importieren.
import { G, ico, api } from './01-core.js';
import { t, tRaw } from '../i18n.js';

/**
 * Ohne `knopf` heisst der Hauptknopf rot „Löschen“; wer etwas anderes bestätigt, nennt sein Verb.
 * @param {string} title
 * @param {string} msg
 * @param {string} [icon]
 * @param {Knopf | null} [knopf]
 */
export function confirmDelete(title, msg, icon, knopf = null) {
  return dialogOeffnen(title, msg, icon, false, false, false, knopf).then(r => r !== null);
}

/**
 * Wie confirmDelete, verlangt aber das eigene Passwort — für Verwalteraktionen
 * an fremden Konten. Liefert das Passwort oder null (abgebrochen).
 * @param {string} title
 * @param {string} msg
 * @param {string} icon
 * @param {Knopf} knopf
 */
export function bestaetigeMitPasswort(title, msg, icon, knopf) {
  if (!knopf?.knopf || !['bp', 'bd'].includes(knopf.art ?? '')) throw new Error('bestaetigeMitPasswort: Knopftext und Art fehlen');
  return dialogOeffnen(title, msg, icon, true, false, false, { feld: 'confirm.admin_password', ...knopf });
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
    'schloss', false, true, mitPasskey, BESTAETIGEN);
  if (code === null) return null;
  if (code !== MIT_PASSKEY) return ruf({ code: code.trim() });
  const passkey = await /** @type {() => Promise<object | null>} */ (passkeyHolen)();
  return passkey ? ruf({ passkey }) : null;
}
/**
 * Hauptknopf des Rückfragedialogs: Text, Art (bp blau, bd rot), Feldbeschriftung.
 * @typedef {{ knopf?: string, art?: string, feld?: string, werte?: Record<string, unknown>, fehler?: boolean }} Knopf
 */
/** Ein Bestätigen ist kein Löschen: Knopf in der Hauptfarbe statt rot. @type {Knopf} */
const BESTAETIGEN = { knopf: 'common.confirm', art: 'bp', feld: 'settings.password.current' };

/**
 * Eine Kontoänderung mit dem eigenen Passwort bestätigen — einmal beim
 * Speichern im Dialog statt je Abschnitt ein Feld „Aktuelles Passwort“, das
 * wie ein Fehler aussah. Bei falschem Passwort fragt der Dialog erneut.
 * @param {string} titel
 * @param {(passwort: string, zusatz: { code?: string, passkey?: object }) => Promise<any>} ruf
 * @param {string} [erklaerung] sagt, was bestätigt wird (statt nur „bitte Passwort“)
 * @returns die Antwort, oder null bei Abbruch
 */
export async function mitPasswortBestaetigen(titel, ruf, erklaerung = tRaw('konto.passwort_bestaetigen')) {
  let text = erklaerung, knopfArt = BESTAETIGEN;
  for (let versuch = 0; versuch < 5; versuch++) {
    const pw = await dialogOeffnen(titel, text, 'schloss', true, false, false, knopfArt);
    if (pw === null) return null;
    const d = await mitZweitemFaktor(z => ruf(pw, z));
    if (d?.code !== 'aktuelles_passwort_falsch' && d?.code !== 'aktuelles_passwort_erforderlich') return d;
    text = d.error || erklaerung;
    knopfArt = { ...BESTAETIGEN, fehler: true };
  }
  return null;
}

/** Erst ohne Passwort; nur wenn der Server es für diese Änderung verlangt, wird nachgefragt.
 * @returns die Antwort, oder null bei Abbruch
 * @param {string} titel
 * @param {Record<string, unknown>} werte
 */
export async function speichereEinstellungen(titel, werte) {
  const d = await api('POST', '/v1/settings', werte);
  if (d?.code !== 'aktuelles_passwort_erforderlich') return d;
  return mitPasswortBestaetigen(titel, (admin_password, z) => api('POST', '/v1/settings', { ...werte, admin_password, ...z }));
}


/** 23-passkeys.js meldet sich hier an, wenn der Browser Passkeys kann: Ein
 * Import in die Gegenrichtung schlösse einen Kreis über 01-core.js.
 * @type {(() => Promise<object | null>) | null} */
let passkeyHolen = null;

/** @param {() => Promise<object | null>} fn */
export function setzePasskeyHolen(fn) { passkeyHolen = fn; }

const MIT_PASSKEY = Symbol('passkey');

/**
 * @param {Knopf | null} [knopf]
 * @param {string} title
 * @param {string} msg
 * @param {string | undefined} icon
 * @param {boolean} mitPasswort
 */
function dialogOeffnen(title, msg, icon, mitPasswort, mitCode = false, mitPasskey = false, knopf = null) {
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
    const gefahr = (knopf?.art || 'bd') === 'bd';
    btnYes.textContent = tRaw(knopf?.knopf || 'confirm.delete_btn', knopf?.werte);
    btnYes.classList.toggle('bd', gefahr); btnYes.classList.toggle('bp', !gefahr);
    G('cd-icon').classList.toggle('neutral', !gefahr);
    G('cd-msg').classList.toggle('text-gefahr', !!knopf?.fehler);
    G('cd-pw-label').textContent = tRaw(knopf?.feld || 'confirm.admin_password');
    if (mitPasswort) setTimeout(() => pw?.focus(), 0);
    else if (mitCode) setTimeout(() => codeFeld?.focus(), 0);
    /** @param {string | symbol | null} result */
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
