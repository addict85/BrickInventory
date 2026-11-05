import { tRaw } from '../i18n.js';
import { G } from './01-dom.js';
import { toast } from './01-meldungen.js';
import { leseBetrag } from './01-format.js';

// Formulare: Meldungen am Feld, Passwortregeln, Beträge aus Eingaben. Eine Fassung für alle Dialoge, damit
// Vorleser und Markierung überall gleich reagieren.

/**
 * Mindestlänge eines Passworts. Der Server setzt sie durch, der Browser sagt sie vorher;
 * test/passwortlaenge.test.js hält Server, Web und App gleich.
 * Ausführlich: docs/begruendungen/public/js/01-formular.js.md#passwort-min-zeichen
 */
export const PASSWORT_MIN_ZEICHEN = 12;

/**
 * Die Webapp prüfte die Länge an keiner der fünf Stellen, die ein Passwort setzen, und lief in den
 * Serverfehler, wo die App den Knopf gar nicht erst freigibt. Hier wird vorher gefragt.
 * Ausführlich: docs/begruendungen/public/js/01-formular.js.md#passwortzukurz
 * @param {unknown} p
 */
export function passwortZuKurz(p){ return String(p ?? '').length < PASSWORT_MIN_ZEICHEN; }

/** Die Meldung dazu — an fuenf Stellen dieselbe. */
export function passwortZuKurzText(){
  return tRaw('settings.password.too_short', { n: PASSWORT_MIN_ZEICHEN });
}

/** bcrypt liest 72 Byte; dieselbe Grenze wie PASSWORT_MAX_BYTE im Server. */
export const PASSWORT_MAX_BYTE = 72;

/**
 * Was der Browser vor dem Absenden prüfen kann, als Meldung, sonst null. Die Liste häufiger Passwörter kennt
 * nur der Server; seine Meldung kommt zurück.
 * @param {string} p
 */
export function passwortRegelText(p){
  if (passwortZuKurz(p)) return passwortZuKurzText();
  if (new TextEncoder().encode(String(p)).length > PASSWORT_MAX_BYTE) return tRaw('settings.password.too_long', { n: PASSWORT_MAX_BYTE });
  return null;
}

/**
 * Sieht die Eingabe aus wie eine Set-Nummer? Ziffern, davor höchstens ein Buchstaben-Präfix echter Nummern
 * (llca30, comcon001), dahinter ein Versionsanhang (-1). Der Server prüft selbst; hier geht es darum, dass
 * „abc“ gar nicht erst als Set „abc-1“ angelegt wird.
 * @param {string} eingabe
 */
export function istSetnummer(eingabe) {
  return /^[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?$/.test(String(eingabe ?? '').trim());
}

/**
 * Eine Fehlermeldung direkt am Feld (leerer Text räumt sie weg). Vorleser hören sie über role="alert" und
 * finden sie über aria-describedby.
 * @param {string} id
 * @param {string} text
 */
export function feldFehler(id, text) {
  const feld = G(id);
  if (!feld) return;
  /** @type {HTMLElement | null} */
  let el = G(id + '-fehler');
  if (!el) {
    el = document.createElement('div');
    el.id = id + '-fehler';
    el.className = 'feld-fehler';
    el.setAttribute('role', 'alert');
    feld.insertAdjacentElement('afterend', el);
    feld.addEventListener('input', () => feldFehler(id, ''));
  }
  el.textContent = text || '';
  el.hidden = !text;
  // Die eigene Kennung ergänzen und wieder nehmen: Ein vorhandener Hinweis (Passwortregel) bleibt verknüpft.
  const ids = new Set((feld.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  if (text) { ids.add(el.id); feld.setAttribute('aria-invalid', 'true'); }
  else { ids.delete(el.id); feld.removeAttribute('aria-invalid'); }
  if (ids.size) feld.setAttribute('aria-describedby', [...ids].join(' ')); else feld.removeAttribute('aria-describedby');
  if (text) feld.focus();
}

/**
 * Eine Absage des Servers: Gehört ihr Code zu einem Feld des Formulars, steht die Meldung dort (wie
 * feldFehler), sonst als Toast.
 * @param {object | null | undefined} d Antwort von api()
 * @param {Record<string, string>} felder Fehlercode → Feld-ID
 * @param {string} ersatz Text, wenn die Antwort keinen hat
 */
export function antwortFehler(d, felder, ersatz) {
  const a = /** @type {{ code?: string, error?: string | null }} */ (d ?? {});
  const id = a.code ? felder[a.code] : null;
  if (id && G(id)) feldFehler(id, a.error || ersatz);
  else toast(a.error || ersatz, 'error');
}

/**
 * Prüft das Set-Nummer-Feld vor dem Absenden; meldet am Feld und sagt, ob es weitergeht.
 * @param {string} id
 * @param {string} wert
 */
export function setnummerFeldGueltig(id, wert) {
  const v = wert ?? (G(id)?.value || '').trim();
  if (!v) { feldFehler(id, tRaw('common.enter_set_number')); return false; }
  if (!istSetnummer(v)) { feldFehler(id, tRaw('gallery.add.number_invalid', { num: v })); return false; }
  feldFehler(id, '');
  return true;
}

/**
 * Liest ein Geldfeld; ist der Inhalt keine Zahl (oder negativ), steht die Meldung am Feld und `ok` ist false
 * — gesendet wird dann nichts.
 * @param {string|HTMLInputElement} feld  ID oder Element
 * @returns {{ ok: boolean, wert: number|null }}
 */
export function betragAusFeld(feld) {
  const el = typeof feld === 'string' ? G(feld) : feld;
  if (!el) return { ok: true, wert: null };
  const wert = leseBetrag(el.value);
  if (wert !== null && !(wert >= 0)) {
    if (el.id) feldFehler(el.id, tRaw('common.amount_invalid', { wert: el.value.trim() }));
    else toast(tRaw('common.amount_invalid', { wert: el.value.trim() }), 'error');
    return { ok: false, wert: null };
  }
  if (el.id && G(el.id + '-fehler')) feldFehler(el.id, '');
  return { ok: true, wert };
}

// ── FORMULARE ─────────────────────────────────────────────────────────────
/**
 * Fehler eines Formulars an die betroffenen Felder binden: aria-invalid markiert das Feld, aria-describedby
 * lässt Vorleser die Meldung beim Feld nennen, und der Fokus springt in das erste, damit man gleich
 * korrigiert. Ohne Text verschwinden Meldung und Markierungen.
 * @param {HTMLElement} box  das Meldungsfeld (role=alert)
 * @param {string} text
 * @param {string[]} [felder] IDs der betroffenen Felder
 */
export function formularFehler(box, text, felder = []) {
  box.textContent = text; box.style.display = text ? 'block' : 'none';
  box.parentElement?.querySelectorAll('[aria-invalid="true"]').forEach(f => feldGueltig(f, box.id));
  const ziele = /** @type {HTMLElement[]} */ (felder.map(id => G(id)).filter(Boolean));
  for (const f of ziele) {
    f.setAttribute('aria-invalid', 'true');
    const ids = new Set((f.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); ids.add(box.id);
    f.setAttribute('aria-describedby', [...ids].join(' '));
  }
  if (text && ziele[0]) ziele[0].focus();
}

/** @param {Element} f @param {string} boxId */
function feldGueltig(f, boxId) {
  f.removeAttribute('aria-invalid');
  const rest = (f.getAttribute('aria-describedby') || '').split(/\s+/).filter(x => x && x !== boxId);
  if (rest.length) f.setAttribute('aria-describedby', rest.join(' ')); else f.removeAttribute('aria-describedby');
}

// Wer im markierten Feld tippt, korrigiert: Die Markierung geht, die Meldung bleibt stehen.
if (typeof document !== 'undefined') document.addEventListener('input', (ev) => {
  const f = ev.target instanceof Element ? ev.target : null;
  if (f?.getAttribute('aria-invalid') === 'true') f.removeAttribute('aria-invalid');
});
