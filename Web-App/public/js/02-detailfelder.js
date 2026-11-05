// Felder, die mehrere Detail-Dialoge teilen: Lagerort (Auswahl mit neuem
// Eintrag), Preisalarm und das Schliessen des Set-Dialogs. Liegt unter den
// Ansichten, damit Set-Detail, Merkliste und Teile-Detail sie gleich nutzen.
import { registerActions } from './00-registry.js';
import { G, api, betragFuerFeld, escJs, leseBetrag, toast } from './01-core.js';
import { ME, allSets, curSet, set_curSet } from './00-zustand.js';
import { scopeQuery, LAGER_VIEWS, lagerModus, setLagerModus } from './14-scope.js';
import { tRaw } from '../i18n.js';
import { esc } from './00-escapen.js';

/**
 * Lagerort eines Sets speichern.
 *
 * ── Warum beim Verlassen des Feldes und nicht auf Tastendruck ──────────────
 *
 * Wie die Menge daneben (`autosaveSet`): Ein Lagerort wird getippt, nicht
 * gewählt. Ein Speichern je Zeichen erzeugte sechs Anfragen für „Kiste 3" und
 * hinterliesse dabei fünf Zwischenstände in der Datenbank.
 * @param {string} sn
 */
export async function speichereSetLagerort(sn) {
  const el = G('m-storage');
  if (!el) return;
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/storage`, { storage: el.value });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Die Liste im Hintergrund trägt den Ort ebenfalls — ohne Nachziehen zeigte
  // die Kachel den alten, bis jemand neu lädt.
  const eintrag = (allSets || []).find(x => x.set_number === sn);
  if (eintrag) eintrag.storage = d.storage;
  if (curSet && curSet.set_number === sn) curSet.storage = d.storage;
  await ladeLagerorte();
}

/**
 * Welcher Alarmblock gemeint ist: 'm' (Set) oder 'mk-m' (Merkposten). Eine Modulvariable statt
 * Parameter, weil der Dispatcher nur die Setnummer reicht; offen ist ohnehin immer nur ein Dialog.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#alarmfeld
 */
let _alarmFeld = 'm';

/**
 * @param {string} praefix
 */
export function setzeAlarmFeld(praefix) { _alarmFeld = praefix === 'mk-m' ? 'mk-m' : 'm'; }

const alarmId = (/** @type {string} */ teil) => `${_alarmFeld}-alert-${teil}`;

/**
 * Der Alarmblock — EINMAL formuliert, von beiden Dialogen benutzt.
 * 
 * Das Merkposten-Detail zeigt denselben Alarm: Es ist derselbe Eintrag in
 * price_alerts, am selben Schlüssel. Eine zweite Maske dafür wäre die
 * nächste Stelle, an der eine Regel nur an einem der beiden Wege nachgezogen
 * wird — das ist in diesem Baum schon mehrfach passiert.
 * @param {string} sn
 */
export function alarmBlock(sn, praefix = 'm') {
  const p = praefix === 'mk-m' ? 'mk-m' : 'm';
  // Das Aussehen steht in styles.css unter .alarm-feld, nicht hier: Die feste
  // Hoehe im style-Attribut hat den gewaehlten Eintrag auf sechs Pixel
  // zusammengeschnitten (im Browser gemessen, Begruendung dort).
  return `
      <select id="${p}-alert-cond" class="alarm-feld" aria-label="${esc(tRaw('detail.alert'))}: ${esc(tRaw('common.condition'))}" data-change="wechsleAlarmZustand" data-arg="${escJs(sn)}">
        <option value="N">${esc(tRaw('common.condition_new'))}</option>
        <option value="U">${esc(tRaw('common.condition_used'))}</option>
      </select>
      <select id="${p}-alert-dir" class="alarm-feld" aria-label="${esc(tRaw('detail.alert'))}" data-change="speichereAlarm" data-arg="${escJs(sn)}">
        <option value="unter">${esc(tRaw('detail.alert_below'))}</option>
        <option value="ueber">${esc(tRaw('detail.alert_above'))}</option>
      </select>
      <label class="alarm-preis" for="${p}-alert-val"><span class="alarm-preis-titel">${esc(tRaw('detail.alert_preis_ph'))}</span>
      <input inputmode="decimal" type="text" autocomplete="off" id="${p}-alert-val" class="alarm-feld" aria-label="${esc(tRaw('detail.alert_price'))}"
             data-input="alarmGetippt" data-arg="${escJs(sn)}"
             data-change="speichereAlarm" /></label>
      <span id="${p}-alert-state" data-stil="font-size:var(--fs-1);color:var(--mut)"></span>
    `;
}

/**
 * „Neuer Ort“ wird an einem Attribut erkannt, nicht an einem abgemachten Wert: Jeden ausgedachten Wert
 * kann jemand als Lagerort eintippen.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#ort-neu-marke
 */
const ORT_NEU_MARKE = 'data-neu="1"';

const istNeuEintrag = (/** @type {Pick<HTMLSelectElement, 'selectedOptions'> | null | undefined} */ sel) => sel?.selectedOptions?.[0]?.dataset?.neu === '1';

/** @type {string[]} */
let _orte = [];

/**
 * Den Vorrat merken und bereits gezeichnete Auswahlfelder nachziehen.
 *
 * Die Orte kommen ueber das Netz, der Dialog steht aber schon. Ohne das
 * Nachziehen zeigte die erste Anzeige eine leere Auswahl — und genau dann
 * schaut man hin.
 * @param {unknown[] | null | undefined} namen
 */
export function setzeOrtVorrat(namen) {
  _orte = [...new Set((namen || []).filter(Boolean).map(String))]
    .sort((a, b) => a.localeCompare(b));
  for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (document.querySelectorAll('select[data-ortauswahl]'))) {
    // Steht die Auswahl gerade auf „neuer Ort", soll sie dort stehen bleiben —
    // sonst spraenge sie jemandem beim Tippen unter der Hand weg.
    const warNeu = istNeuEintrag(sel);
    const vorher = sel.value;
    sel.innerHTML = ortOptionen(vorher);
    if (warNeu) sel.selectedIndex = sel.options.length - 1;
    else if ([...sel.options].some(o => o.value === vorher)) sel.value = vorher;
  }
}

/**
 * @param {string} wert
 */
function ortOptionen(wert) {
  const bekannt = _orte.includes(wert);
  return [
    `<option value="">${esc(tRaw('detail.storage_none'))}</option>`,
    // Ein Ort, den der Vorrat (noch) nicht kennt — etwa weil er gerade erst
    // eingetippt wurde —, muss trotzdem dastehen, sonst spraenge die Anzeige
    // auf „—" zurueck.
    ...(wert && !bekannt ? [`<option value="${esc(wert)}" selected>${esc(wert)}</option>`] : []),
    ..._orte.map(o => `<option value="${esc(o)}"${o === wert ? ' selected' : ''}>${esc(o)}</option>`),
    // IMMER zuletzt: setzeOrtVorrat() greift ihn ueber options.length - 1 ab.
    `<option value="" ${ORT_NEU_MARKE}>${esc(tRaw('detail.storage_new'))}</option>`,
  ].join('');
}

/**
 * Der Lagerort als Auswahl, die auch Neues annimmt: Eine datalist sah wie ein Textfeld aus und klappte
 * nicht auf. Gespeichert wird weiter über das Textfeld, damit die Speicherregel nur einmal existiert.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#der-lagerort-ein-auswahlfeld-das-auch-ne
 * @param {string} id  Kennung des Textfeldes (m-storage, setitem-storage); die
 *   Auswahl bekommt dieselbe mit dem Zusatz "-sel".
 * @param {string | null | undefined} wert  Aktueller Lagerort, oder leer.
 * @param {string} [attrs]  Weitere Attribute fürs Textfeld (data-change, data-part, …).
 */
export function lagerortBlock(id, wert, attrs = '') {
  const ort = String(wert || '');
  return `
      <select id="${id}-sel" class="alarm-feld" aria-label="${esc(tRaw('detail.storage'))}" data-ortauswahl="1"
              data-change="lagerortGewaehlt" data-arg="${id}">${ortOptionen(ort)}</select>
      <input type="text" id="${id}" class="alarm-feld" maxlength="60" aria-label="${esc(tRaw('detail.storage'))}" data-stil="display:none"
             placeholder="${esc(tRaw('detail.storage_ph'))}" value="${esc(ort)}"
             data-blur="lagerortGetippt" ${attrs} />
    `;
}

/**
 * Aus der Liste gewaehlt — oder „neuer Ort".
 * @param {string} id Kennung des Textfeldes; die Auswahl heisst id + "-sel".
 */
export function lagerortGewaehlt(id) {
  const sel = G(`${id}-sel`), feld = G(id);
  if (!sel || !feld) return;
  if (istNeuEintrag(sel)) {
    // Leeren, zeigen, Fokus: Wer „neuer Ort" waehlt, will tippen — nicht erst
    // den alten Namen wegloeschen.
    feld.value = '';
    feld.style.display = '';
    feld.focus();
    return;
  }
  feld.style.display = 'none';
  feld.value = sel.value;
  // Das change-Ereignis von Hand: Ein programmatisch gesetzter Wert loest
  // keines aus. Ueber die Ereignis-Delegation (11-actions.js) landet es bei
  // genau dem Handler, der auch eine Eingabe von Hand speichert.
  feld.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Ein neuer Ort ist fertig getippt. Gespeichert hat schon das change-Ereignis des Feldes; hier zieht
 * nur die Auswahl daneben nach. `this` ist das Feld (der Dispatcher ruft mit dem Element als
 * Empfänger).
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#lagerortgetippt
 */
export function lagerortGetippt() {
  const feld = this;
  const sel = G(`${feld?.id}-sel`);
  if (!sel) return;
  const ort = String(feld.value || '').trim();
  if (!_orte.includes(ort) && ort) _orte = [..._orte, ort].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = ortOptionen(ort);
  sel.value = ort;
  if (ort) feld.style.display = 'none';
}

/**
 * Für welchen Zustand der Alarm gilt: Neu und gebraucht liegen oft weit auseinander, und wer gebraucht
 * sucht, soll darauf warten können. Der Server hat den Zustand im Schlüssel.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#fuer-welchen-zustand-der-alarm-gilt-neu
 */
function alarmZustand() {
  return G(alarmId('cond'))?.value === 'U' ? 'U' : 'N';
}

/**
 * Preisalarm des offenen Sets laden und anzeigen.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#preisalarm-des-offenen-sets-laden-und-an
 * @param {string} sn
 */
export async function ladeAlarm(sn) {
  const d = await api('GET', `/v1/sets/${encodeURIComponent(sn)}/alert`).catch(() => null);
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  const a = (d?.alerts || []).find(x => x.condition === alarmZustand());
  dir.value = a?.richtung || 'unter';
  val.value = a ? betragFuerFeld(a.schwelle) : '';
  zeigeAlarmMerker(a);
}

/**
 * Nur den Merker nachführen, nie das Eingabefeld: Während getippt wird, schriebe die Serverantwort
 * sonst ein eben getipptes Zeichen wieder weg.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#zeigealarmmerker
 * @param {import('../../frontend-typen/vertrag').Preisalarm | undefined} a
 */
function zeigeAlarmMerker(a) {
  const st = G(alarmId('state'));
  if (!st) return;
  // Der Merker sagt, ob schon gemeldet wurde. Ihn zu zeigen ist der
  // Unterschied zwischen „der Alarm steht" und „der Alarm hat gefeuert" —
  // sonst fragt man sich, warum keine Mail mehr kommt.
  st.textContent = !a ? ''
    : a.ausgeloest ? tRaw('detail.alert_fired') : tRaw('detail.alert_armed');
}

/**
 * Auf den anderen Zustand umschalten lädt nur und speichert nicht: Ein Wechsel ist eine Frage, keine
 * Eingabe. Eine laufende Ruhezeit fällt weg, damit die alte Schwelle nicht beim neuen Zustand landet.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#wechslealarmzustand
 * @param {string} sn
 */
export function wechsleAlarmZustand(sn) {
  clearTimeout(_alarmRuhe); _alarmRuhe = null;
  return ladeAlarm(sn);
}

/**
 * Wie lange Ruhe herrschen muss, bevor beim Tippen gespeichert wird.
 *
 * Dieselbe Zahl wie in der App (Alarmeingabe.RUHE_MS) — laufen die beiden
 * auseinander, verhält sich dasselbe Feld an zwei Stellen verschieden, ohne
 * dass es jemandem auffiele.
 */
const ALARM_RUHE = 800;

/**
 * @type {ReturnType<typeof setTimeout> | null}
 */
let _alarmRuhe = null;

/**
 * Beim Tippen speichern, entprellt: Wer tippt und das Fenster schliesst, ohne woanders hinzuklicken,
 * verlor die Eingabe. Die Werte werden jetzt kopiert, weil das Feld beim Ablauf der Ruhezeit schon weg
 * sein kann.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#alarmgetippt
 * @param {string} sn
 */
export function alarmGetippt(sn) {
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  const richtung = dir.value, roh = String(val.value || '').trim();
  clearTimeout(_alarmRuhe);
  _alarmRuhe = setTimeout(() => { _alarmRuhe = null; sendeAlarm(sn, richtung, roh); }, ALARM_RUHE);
}

/**
 * Preisalarm speichern oder löschen — SOFORT.
 *
 * Für die Richtung: Sie wird gewählt, nicht getippt, und eine Ruhezeit auf
 * eine einzelne Wahl wäre nur eine Verzögerung ohne Gewinn. Eine noch
 * laufende Ruhezeit wird dabei verworfen, damit nicht kurz darauf die alte
 * Richtung hinterherkommt.
 * @param {string} sn
 */
export function speichereAlarm(sn) {
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  clearTimeout(_alarmRuhe); _alarmRuhe = null;
  return sendeAlarm(sn, dir.value, String(val.value || '').trim());
}

/**
 * Der eine Weg zum Server. Ein leeres Feld löscht den Alarm, keine Schwelle 0: Das Feld zu leeren ist
 * die natürliche Geste. Die Ruhezeit verhindert, dass auf dem Weg zu „249“ eine Schwelle bei 2
 * entsteht.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#sendealarm
 * @param {string} sn
 * @param {string} richtung
 * @param {string} roh
 */
async function sendeAlarm(sn, richtung, roh) {
  const zahl = leseBetrag(roh);
  const loeschen = !(zahl != null && zahl > 0);
  const cond = alarmZustand();
  const d = loeschen
    ? await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${cond}`)
    : await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`,
                { richtung, schwelle: zahl, condition: cond });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Nur den Merker, nicht das Feld — die Begründung steht an zeigeAlarmMerker().
  zeigeAlarmMerker(loeschen ? undefined : d.alert ?? undefined);
}

/**
 * Beim Öffnen zeigen, welche Alarme seit dem letzten Besuch ausgelöst haben — das Gegenstück zur
 * stündlichen Abfrage der App. Die Marke kommt vom Server (keine eigene Uhr) und gilt je Konto.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#zeigeoffenealarme
 */
export async function zeigeOffeneAlarme() {
  if (!ME?.id) return;
  const schluessel = 'bim_alarm_marke_' + ME.id;
  /** @type {string | null} */
  let marke = null;
  try { marke = localStorage.getItem(schluessel); } catch (_) {}
  const d = await api('GET', `/v1/alerts/pending${marke ? '?since=' + encodeURIComponent(marke) : ''}`)
    .catch(() => null);
  // Ohne `now` keine neue Marke — und ohne neue Marke lieber gar nichts
  // speichern als eine falsche.
  if (!d?.success || !d.now) return;
  try { localStorage.setItem(schluessel, String(d.now)); } catch (_) {}
  // Erster Besuch: nur merken, nichts melden. Sonst schlaegt ein frisch
  // angemeldetes Konto mit Schwellen auf, die vor Wochen gerissen sind.
  if (!marke) return;
  const unter = tRaw('detail.alert_below'), ueber = tRaw('detail.alert_above');
  for (const a of (d.alerts || [])) {
    const richtung = a.richtung === 'unter' ? unter : ueber;
    const schwelle = Number(a.schwelle).toFixed(2);
    // Derselbe Aufbau wie Alarmabholung.text() in der App — wer beides
    // benutzt, soll nicht zwei Formulierungen derselben Meldung lesen.
    const txt = a.zuletzt_preis == null
      ? `${a.set_number}: ${richtung} ${a.currency_code} ${schwelle}`
      : `${a.set_number}: ${a.currency_code} ${Number(a.zuletzt_preis).toFixed(2)} ` +
        `(${richtung} ${a.currency_code} ${schwelle})`;
    toast(txt, 'info');
  }
}

/**
 * Die Ortsauswahl im Detail ist der Vorrat des BESITZERS: Beim Set des Enkels stehen die Regale des
 * Enkels zur Wahl. Eine datalist erlaubt Auswählen und Neues tippen zugleich.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#ladeortauswahl
 * @param {({ id: number } | number)[] | null | undefined} besitzer
 */
export async function ladeOrtAuswahl(besitzer) {
  const dl = G('lagerorte');
  if (!dl) return;
  const ids = (besitzer || []).map((/** @type {{ id: number } | number} */ o) => typeof o === 'number' ? o : o?.id ?? o).filter(n => Number.isFinite(Number(n)));
  const frage = ids.length ? '?owner=' + encodeURIComponent(ids.join(',')) : '';
  const d = await api('GET', `/v1/storage/locations${frage}`).catch(() => null);
  if (!d?.success) return;
  dl.innerHTML = (d.orte || []).map(o => `<option value="${esc(o.name)}"></option>`).join('');
  // Dieselbe Liste speist das Auswahlfeld im Detail (lagerortBlock).
  setzeOrtVorrat((d.orte || []).map(o => o.name));
}

/** Die Konten, deren Lagerorte beim Erfassen zur Wahl stehen; gesetzt vom Laden des Haushalts. @type {number[]} */
let _vorratKonten = [];

/**
 * Zur Wahl steht der ganze Vorrat (/v1/storage/locations), auch ein neuer, leerer Ort; die Filter
 * zeigen nur belegte Orte (/v1/storage), weil ein leerer Ort dort nichts fände.
 * @param {number[]} [konten] Haushaltskonten; ohne Angabe die zuletzt genannten
 */
export async function ladeLagerorte(konten) {
  if (konten) _vorratKonten = konten;
  const frage = _vorratKonten.length > 1 ? '?owner=' + encodeURIComponent(_vorratKonten.join(',')) : '';
  const [vorrat, belegt] = await Promise.all([
    api('GET', `/v1/storage/locations${frage}`).catch(() => null),
    api('GET', `/v1/storage${scopeQuery('gallery')}`).catch(() => null),
  ]);
  if (vorrat?.success) {
    const namen = (vorrat.orte || []).map(o => o.name);
    const dl = G('lagerorte');
    if (dl) dl.innerHTML = [...new Set(namen)].map(n => `<option value="${esc(n)}"></option>`).join('');
    setzeOrtVorrat(namen);
  }
  if (belegt?.success) initStorageSelects(belegt.orte || []);
}

// Hier und nicht im Set-Detail: Auch der Kaufpreis-Dialog schliesst ihn, und der
// liegt im Importgraphen darunter.
export function closeModal(){ G('set-modal').classList.remove('open'); set_curSet(null); }

registerActions({
  closeModal,
  speichereAlarm,
  alarmGetippt,
  wechsleAlarmZustand,
  speichereSetLagerort,
  lagerortGewaehlt,
  lagerortGetippt,
});

/**
 * Die Lagerort-Filter füllen. Ohne Orte bleiben sie verborgen: Eine Wahl mit nur „Alle“ beantwortet
 * nichts — dieselbe Regel wie beim Kontofilter.
 * Ausführlich: docs/begruendungen/public/js/02-detailfelder.js.md#initstorageselects
 * @param {import('../../frontend-typen/vertrag').Lagerort[]} orte
 */
export function initStorageSelects(orte) {
  const opts = [`<option value="">${esc(tRaw('filter.storage_all'))}</option>`,
    ...orte.map(o => `<option value="${esc(o.ort)}">${esc(o.ort)}</option>`)].join('');
  for (const view of LAGER_VIEWS) {
    const el = G('storage-' + view);
    if (!el) continue;
    if (!orte.length) { el.style.display = 'none'; continue; }
    el.innerHTML = opts;
    // Zeigt die gespeicherte Wahl auf einen inzwischen leeren Ort, steht hier
    // sonst eine leere Beschriftung über einer gefilterten Liste — dieselbe
    // Falle wie beim Kontofilter.
    const gespeichert = lagerModus(view);
    el.value = [...el.options].some(o => o.value === gespeichert) ? gespeichert : '';
    if (el.value !== gespeichert) setLagerModus(view, el.value);
    el.style.display = '';
  }
}
