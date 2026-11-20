// Rückfragen vor heiklen Schritten: Bestätigen, eigenes Passwort, zweiter Faktor. Eine Ebene über dem Kern,
// damit jede Ansicht sie nutzen kann, ohne eine andere Ansicht zu importieren.
import { api } from './api.js';
import { G, ico, setzeHtml } from './dom.js';
import { html } from './escaping.js';
import { tRaw } from '../i18n.js';

/**
 * Ohne `knopf` heisst der Hauptknopf rot „Löschen“; wer etwas anderes bestätigt, nennt sein Verb.
 * @param {string} title
 * @param {string} msg
 * @param {string} [icon]
 * @param {Knopf | null} [knopf]
 */
export function confirmDelete(title, msg, icon, knopf = null) {
  return openDialog(title, msg, icon, false, false, false, knopf).then(r => r !== null);
}

/**
 * Löschen mit Auswahl, etwa welche Konten eines Haushalts; die erste Möglichkeit ist vorgewählt.
 * @param {string} title @param {string} msg @param {{ wert: string, text: string }[]} wahl
 * @returns {Promise<string | null>} der gewählte Wert, null bei Abbruch
 */
export function deleteWithChoice(title, msg, wahl) {
  return /** @type {Promise<string | null>} */ (openDialog(title, msg, 'loeschen', false, false, false, { wahl }));
}

/**
 * Wie confirmDelete, verlangt aber das eigene Passwort — für Verwalteraktionen an fremden Konten. Liefert das
 * Passwort oder null (abgebrochen).
 * @param {string} title
 * @param {string} msg
 * @param {string} icon
 * @param {Knopf} knopf
 */
export function bestaetigeMitPasswort(title, msg, icon, knopf) {
  if (!knopf?.knopf || !['bp', 'bd'].includes(knopf.art ?? ''))
    throw new Error('bestaetigeMitPasswort: Knopftext und Art fehlen');
  return openDialog(title, msg, icon, true, false, false, { feld: 'confirm.admin_password', ...knopf });
}

/** Bei aktivem zweitem Faktor verlangt der Server für heikle Änderungen den
 * Code (zweiter_faktor_noetig); dann einmal fragen und mit `code` wiederholen.
 * @template T
 * @param {(zusatz: { code?: string, passkey?: object }) => Promise<T>} ruf
 * @returns {Promise<T | null>} die Antwort, oder null, wenn der Dialog abgebrochen wurde */
export async function withSecondFactor(ruf) {
  const d = await ruf({});
  const a = /** @type {{ code?: unknown, passkey?: unknown } | null | undefined} */ (d);
  if (a?.code !== 'zweiter_faktor_noetig') return d;
  const withPasskey = !!(a.passkey && fetchPasskey);
  const code = await openDialog(
    tRaw('zf.title'),
    tRaw(withPasskey ? 'zf.code_oder_passkey' : 'zf.code_noetig'),
    'schloss',
    false,
    true,
    withPasskey,
    CONFIRM,
  );
  if (code === null) return null;
  if (code !== WITH_PASSKEY) return ruf({ code: code.trim() });
  const passkey = await /** @type {() => Promise<object | null>} */ (fetchPasskey)();
  return passkey ? ruf({ passkey }) : null;
}
/**
 * Nur einen Code abfragen, ohne Passwort (neue Wiederherstellungscodes).
 * @param {string} titel @param {string} text @returns {Promise<string | null>} der Code, oder null bei Abbruch
 */
export async function questionCode(titel, text) {
  const code = await openDialog(titel, text, 'schloss', false, true, false, CONFIRM);
  return typeof code === 'string' ? code.trim() : null;
}
/**
 * Hauptknopf des Rückfragedialogs: Text, Art (bp blau, bd rot), Feldbeschriftung.
 * withCode: Passwort und Code in einem Dialog, statt zwei nacheinander.
 * @typedef {{ knopf?: string, art?: string, feld?: string, werte?: Record<string, unknown>, fehler?: boolean, wahl?: { wert: string, text: string }[], withCode?: boolean }} Knopf
 */
/** Ein Bestätigen ist kein Löschen: Knopf in der Hauptfarbe statt rot. @type {Knopf} */
const CONFIRM = { knopf: 'common.confirm', art: 'bp', feld: 'settings.password.current' };

/**
 * Eine Kontoänderung mit dem eigenen Passwort bestätigen — einmal beim Speichern im Dialog statt je Abschnitt
 * ein Feld „Aktuelles Passwort“, das wie ein Fehler aussah. Bei falschem Passwort fragt der Dialog erneut.
 * @param {string} titel
 * @template T
 * @param {(passwort: string, zusatz: { code?: string, passkey?: object }) => Promise<T>} ruf
 * @param {string} [erklaerung] sagt, was bestätigt wird (statt nur „bitte Passwort“)
 * @param {Knopf} [knopf] Hauptknopf; mit `withCode` fragt derselbe Dialog den Code mit
 */
export async function confirmWithPassword(titel, ruf, erklaerung = tRaw('konto.passwort_bestaetigen'), knopf = {}) {
  let text = erklaerung,
    buttonKind = { ...CONFIRM, ...knopf };
  for (let versuch = 0; versuch < 5; versuch++) {
    const ablage = { code: '' };
    const pw = await openDialog(titel, text, 'schloss', true, !!knopf.withCode, false, buttonKind, ablage);
    if (pw === null) return null;
    const code = ablage.code.trim();
    const d = await withSecondFactor(z => ruf(pw, code && !z.code && !z.passkey ? { code } : z));
    const a = /** @type {{ code?: unknown, error?: string } | null} */ (d);
    if (a?.code !== 'aktuelles_passwort_falsch' && a?.code !== 'aktuelles_passwort_erforderlich') return d;
    text = a.error || erklaerung;
    buttonKind = { ...buttonKind, fehler: true };
  }
  return null;
}

/** Erst ohne Passwort; nur wenn der Server es für diese Änderung verlangt, wird nachgefragt.
 * @returns die Antwort, oder null bei Abbruch
 * @param {string} titel
 * @param {Record<string, unknown>} werte
 */
export async function saveSettings(titel, werte) {
  const d = await api('POST', '/v1/settings', werte);
  if (d?.code !== 'aktuelles_passwort_erforderlich') return d;
  return confirmWithPassword(titel, (admin_password, z) =>
    api('POST', '/v1/settings', { ...werte, admin_password, ...z }),
  );
}

/** passkeys.js meldet sich hier an, wenn der Browser Passkeys kann: Ein
 * Import in die Gegenrichtung liesse den Kern eine Ansicht laden.
 * @type {(() => Promise<object | null>) | null} */
let fetchPasskey = null;

/** @param {() => Promise<object | null>} fn */
export function fetchSetPasskey(fn) {
  fetchPasskey = fn;
}

const WITH_PASSKEY = Symbol('passkey');

/**
 * @param {Knopf | null} [knopf]
 * @param {string} title
 * @param {string} msg
 * @param {string | undefined} icon
 * @param {boolean} withPassword
 * @param {{ code: string } | null} [ablage] nimmt den Code auf, wenn Passwort und Code zusammen gefragt werden
 */
function openDialog(
  title,
  msg,
  icon,
  withPassword,
  withCode = false,
  withPasskey = false,
  knopf = null,
  ablage = null,
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
    setzeHtml(G('cd-icon'), ico(icon || 'loeschen'));
    modal.style.display = 'flex';
    const btnYes = G('cd-confirm');
    const btnNo = G('cd-cancel');
    const gefahr = (knopf?.art || 'bd') === 'bd';
    btnYes.textContent = tRaw(knopf?.knopf || 'confirm.delete_btn', knopf?.werte);
    btnYes.classList.toggle('bd', gefahr);
    btnYes.classList.toggle('bp', !gefahr);
    G('cd-icon').classList.toggle('neutral', !gefahr);
    G('cd-msg').classList.toggle('text-gefahr', !!knopf?.fehler);
    G('cd-pw-label').textContent = tRaw(knopf?.feld || 'confirm.admin_password');
    const choiceField = G('cd-wahl');
    choiceField.hidden = !knopf?.wahl;
    setzeHtml(
      choiceField,
      html`${(knopf?.wahl || []).map((w, i) => html`<label class="cd-wahl-zeile"><input type="radio" name="cd-wahl" value="${w.wert}"${i ? '' : ' checked'}> ${w.text}</label>`)}`,
    );
    if (withPassword) setTimeout(() => pw?.focus(), 0);
    else if (withCode) setTimeout(() => codeField?.focus(), 0);
    /** @param {string | symbol | null} result */
    function cleanup(result) {
      if (ablage && result !== null) ablage.code = codeField?.value || '';
      if (pw) pw.value = '';
      if (codeField) codeField.value = '';
      modal.style.display = 'none';
      btnYes.onclick = null;
      btnNo.onclick = null;
      modal.onclick = null;
      if (pkButton) pkButton.onclick = null;
      resolve(result);
    }
    const gewaehlt = () =>
      /** @type {HTMLInputElement | null} */ (choiceField.querySelector('input:checked'))?.value || '';
    const wert = () =>
      withPassword ? pw?.value || '' : withCode ? codeField?.value || '' : knopf?.wahl ? gewaehlt() : '';
    btnYes.onclick = () => {
      const w = wert();
      cleanup(w);
    };
    if (pkButton && withPasskey) pkButton.onclick = () => cleanup(WITH_PASSKEY);
    btnNo.onclick = () => cleanup(null);
    modal.onclick = e => {
      if (e.target === modal) cleanup(null);
    };
  });
}
