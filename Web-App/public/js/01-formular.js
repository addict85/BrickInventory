import { tRaw, locale } from '../i18n.js';
import { G } from './01-dom.js';
import { toast } from './01-meldungen.js';
import { leseBetrag } from './01-format.js';
import { heuteIso } from './01-bausteine.js';

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
 * Sieht die Eingabe aus wie eine Setnummer? Ziffern, davor höchstens ein Buchstaben-Präfix echter Nummern
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
    // Steht das Feld in einer Flex-Zeile (Preis mit Währung), gehört die Meldung hinter die Zeile,
    // sonst drückt sie das Feld auf wenige Pixel zusammen.
    (feld.closest('.preis-mit-waehrung') ?? feld).insertAdjacentElement('afterend', el);
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
 * Prüft das Setnummer-Feld vor dem Absenden; meldet am Feld und sagt, ob es weitergeht.
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

/** Obergrenze der Stückzahl je Erfassung; dieselbe wie `eingabe.stueckzahl()` im Server (src/infra/validate.ts). */
export const STUECKZAHL_MAX = 10_000;

/**
 * Liest ein Anzahlfeld: Nur eine ganze Zahl von 1 bis STUECKZAHL_MAX geht hinaus. Alles andere (leer, 0, 1,5,
 * negativ, zu gross) meldet das Feld, statt stillschweigend zu 1 zu werden oder erst als Toast zurückzukommen.
 * @param {string} id
 * @returns {{ ok: boolean, wert: number }}
 */
export function mengeAusFeld(id) {
  const roh = (G(id)?.value ?? '').trim();
  const wert = /^\d+$/.test(roh) ? Number(roh) : NaN;
  if (!(wert >= 1 && wert <= STUECKZAHL_MAX)) {
    feldFehler(id, tRaw('common.qty_invalid', { max: STUECKZAHL_MAX.toLocaleString(locale()) }));
    return { ok: false, wert: 1 };
  }
  if (G(id + '-fehler')) feldFehler(id, '');
  return { ok: true, wert };
}

/**
 * Prüft ein Kaufdatum: Leer ist erlaubt, ein Tag nach heute nicht. Das Feld bekommt dasselbe als `max`,
 * damit die Auswahl des Browsers gar keine Zukunft anbietet; getippt geht sie trotzdem.
 * @param {string} id
 * @returns {boolean}
 */
export function kaufdatumGueltig(id) {
  const feld = /** @type {HTMLInputElement | null} */ (G(id));
  if (!feld) return true;
  const heute = heuteIso();
  feld.max = heute;
  if (feld.value && feld.value > heute) { feldFehler(id, tRaw('common.date_future')); return false; }
  if (G(id + '-fehler')) feldFehler(id, '');
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
  box.parentElement?.querySelectorAll('[aria-invalid="true"]').forEach(f => { feldGueltig(f, box.id); });
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

// Ein Feld mit maxlength schnitt beim Tippen still ab („…Weihnachtss“). Mit data-zaehler steht ab zehn Zeichen
// vor der Grenze darunter, wie viele es sind, und an der Grenze, dass nicht mehr geht.
if (typeof document !== 'undefined') document.addEventListener('input', (ev) => {
  const f = ev.target instanceof HTMLInputElement && ev.target.hasAttribute('data-zaehler') ? ev.target : null;
  const max = f ? Number(f.getAttribute('maxlength')) : 0;
  if (!f || !max) return;
  let hinweis = f.nextElementSibling instanceof HTMLElement && f.nextElementSibling.classList.contains('zeichen-zaehler') ? f.nextElementSibling : null;
  if (!hinweis) { hinweis = document.createElement('span'); hinweis.className = 'zeichen-zaehler'; hinweis.setAttribute('aria-live', 'polite'); f.insertAdjacentElement('afterend', hinweis); }
  const n = f.value.length;
  hinweis.hidden = n < max - 10;
  hinweis.textContent = n >= max ? tRaw('form.zeichen_grenze', { n, max }) : tRaw('form.zeichen', { n, max });
});
