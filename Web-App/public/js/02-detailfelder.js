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
 * Die bekannten Lagerorte in die gemeinsame <datalist> schreiben.
 *
 * EINE Liste für alle Eingabefelder (Set-Detail, Teil-Detail, Filter): Der
 * Ortsname ist frei, aber wer „Kiste 3" schon einmal getippt hat, soll ihn
 * beim nächsten Mal vorgeschlagen bekommen — sonst stehen „Kiste 3" und
 * „kiste 3" nebeneinander und die Übersicht zählt sie getrennt.
 */
/**
 * Preisalarm des offenen Sets laden und anzeigen.
 *
 * ── Warum nur der Zustand „neu" im Dialog steht ─────────────────────────────
 *
 * Der Server kann je Zustand einen Alarm — die Oberfläche bietet vorerst den
 * für NEU an, weil das der Fall ist, nach dem gefragt wurde. Die Trennung
 * steckt trotzdem schon im Server und in der Tabelle: Sie nachträglich
 * einzuziehen hiesse, bestehende Alarme zuordnen zu müssen, und das geht nicht
 * ohne Raten. Ein zweites Auswahlfeld hier ist dagegen eine Zeile.
 */
/**
 * Für WELCHEN Zustand der Alarm gilt — neu oder gebraucht.
 *
 * ── Warum das jetzt eine Wahl ist und keine Konstante ───────────────────────
 *
 * Hier stand `const ALARM_ZUSTAND = 'N'` mit der Begründung: „Die Oberfläche
 * bietet vorerst den für NEU an, weil das der Fall ist, nach dem gefragt
 * wurde. Ein zweites Auswahlfeld hier ist dagegen eine Zeile."
 *
 * Server und Tabelle konnten es die ganze Zeit — `price_alerts` hat den
 * Zustand im Schlüssel. Neu und gebraucht liegen oft um ein Vielfaches
 * auseinander; wer ein gebrauchtes Exemplar sucht, hatte bisher keine
 * Möglichkeit, darauf zu warten.
 */
/**
 * Welcher Alarmblock gerade gemeint ist: 'm' (Set-Detail) oder 'mk-m'
 * (Merkposten-Detail).
 *
 * ── Warum eine Modulvariable und kein Parameter ─────────────────────────────
 *
 * Die Handler werden vom Ereignis-Dispatcher über data-click/data-change
 * gerufen und bekommen genau EIN Argument: die Setnummer. Ein zweites
 * hiesse, sie in data-arg zu kodieren und überall wieder zu zerlegen.
 *
 * Eine Modulvariable ist hier gefahrlos, weil immer höchstens EIN Dialog
 * offen ist — beide setzen sie beim Öffnen. Stünden je zwei gleichzeitig
 * offen, wäre das falsch; dann gäbe es aber auch zwei gleiche IDs im
 * Dokument, und das ginge ohnehin schief.
 */
let _alarmFeld = 'm';

export function setzeAlarmFeld(praefix) { _alarmFeld = praefix === 'mk-m' ? 'mk-m' : 'm'; }

const alarmId = (teil) => `${_alarmFeld}-alert-${teil}`;

/**
 * Der Alarmblock — EINMAL formuliert, von beiden Dialogen benutzt.
 *
 * Das Merkposten-Detail zeigt denselben Alarm: Es ist derselbe Eintrag in
 * price_alerts, am selben Schlüssel. Eine zweite Maske dafür wäre die
 * nächste Stelle, an der eine Regel nur an einem der beiden Wege nachgezogen
 * wird — das ist in diesem Baum schon mehrfach passiert.
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
      <input inputmode="decimal" type="text" autocomplete="off" id="${p}-alert-val" class="alarm-feld" placeholder="${esc(tRaw('detail.alert_preis_ph'))}" aria-label="${esc(tRaw('detail.alert_price'))}"
             data-input="alarmGetippt" data-arg="${escJs(sn)}"
             data-change="speichereAlarm" />
      <span id="${p}-alert-state" data-stil="font-size:var(--fs-1);color:var(--mut)"></span>
    `;
}

/**
 * Der Lagerort: ein AUSWAHLFELD, das auch neue Werte annimmt.
 *
 * ── Marcos Vorgabe ─────────────────────────────────────────────────────────
 *
 * „Das Feld Lagerort soll ein Auswahlfeld sein (analog den Feldern beim
 * Preisalarm), zusaetzlich sollen dort aber auch neue Werte erfasst werden
 * koennen."
 *
 * ── Warum die datalist das nicht war ───────────────────────────────────────
 *
 * Hier stand ein `<input list="lagerorte">`. Das nimmt Getipptes an und kennt
 * die Vorschlaege — aber es SIEHT aus wie ein Textfeld: kein Pfeil, und in
 * Chrome klappt die Liste auf einen Klick nicht auf. Wer sie nicht kennt,
 * findet sie nicht. Die App hat dafuer laengst ein richtiges Aufklappfeld
 * (ui/screens/LagerortFeld.kt) — die Webapp zieht hiermit nach.
 *
 * ── Wie beides zusammengeht ────────────────────────────────────────────────
 *
 * Ein `select` mit den bekannten Orten und einem letzten Eintrag „neuer Ort".
 * Wird der gewaehlt, erscheint das Textfeld daneben. Das Textfeld traegt die
 * urspruengliche Kennung und die urspruenglichen data-Attribute weiter — es
 * ist nach wie vor DAS Feld, das gespeichert wird. Eine Wahl aus der Liste
 * schreibt nur hinein und loest sein change-Ereignis aus; damit laeuft das
 * Speichern durch DENSELBEN Weg wie eine Eingabe von Hand, und es gibt keine
 * zweite Fassung der Speicherregel.
 *
 * @param id     Kennung des TEXTFELDES (m-storage, setitem-storage) — die
 *               Auswahl bekommt dieselbe mit dem Zusatz "-sel".
 * @param wert   Aktueller Lagerort, oder leer.
 * @param attrs  Weitere Attribute fuers Textfeld (data-change, data-part, …).
 */
/**
 * Wie der Eintrag „neuer Ort" erkannt wird.
 *
 * Als data-Attribut und NICHT ueber einen abgemachten Wert: Jeder Wert, den
 * man sich ausdenkt, kann jemand als Lagerort eintippen — und ein
 * Steuerzeichen als Notloesung waere schlimmer, HTML ersetzt U+0000 beim
 * Einlesen durch U+FFFD, der Vergleich ginge still schief. Das Attribut kann
 * mit keinem Ortsnamen kollidieren.
 */
const ORT_NEU_MARKE = 'data-neu="1"';

const istNeuEintrag = (sel) => sel?.selectedOptions?.[0]?.dataset?.neu === '1';

let _orte = [];

/**
 * Den Vorrat merken und bereits gezeichnete Auswahlfelder nachziehen.
 *
 * Die Orte kommen ueber das Netz, der Dialog steht aber schon. Ohne das
 * Nachziehen zeigte die erste Anzeige eine leere Auswahl — und genau dann
 * schaut man hin.
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
 *
 * @param id Kennung des Textfeldes; die Auswahl heisst id + "-sel".
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
 * Ein neuer Ort ist fertig getippt (das Feld wurde verlassen).
 *
 * Gespeichert hat das change-Ereignis des Feldes selbst — hier wird nur die
 * Auswahl daneben nachgezogen, damit der neue Name darin steht und nicht
 * weiter „neuer Ort" angezeigt wird.
 *
 * `this` ist das Feld: Die Delegation ruft den Handler mit dem Element als
 * Empfaenger auf (11-actions.js, fn.apply(el, args)). Ein data-self="1" waere
 * hier falsch — dasselbe Attribut gaelte auch fuer das change-Ereignis und
 * schoebe dem Speichern ein Argument unter.
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

function alarmZustand() {
  return G(alarmId('cond'))?.value === 'U' ? 'U' : 'N';
}

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
 * Nur den Merker nachführen — OHNE das Eingabefeld anzufassen.
 *
 * Getrennt von ladeAlarm(), und das ist der Kern der Entprellung: Während
 * getippt wird, darf die Antwort des Servers nicht ins Feld zurückschreiben.
 * Wer „249.90" tippt, hat nach der Ruhezeit hinter „249.9" vielleicht schon
 * die letzte Null gesetzt — ladeAlarm() machte daraus wieder „249.9" und
 * fräse dem Tippenden das Zeichen weg.
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
 * Auf den anderen Zustand umschalten.
 *
 * LÄDT, speichert NICHT — und das ist der Punkt: Ein Wechsel ist die Frage
 * „was steht für gebraucht?", keine Eingabe. Würde hier gespeichert, legte
 * schon das Umschalten einen Alarm im neuen Zustand an (oder löschte ihn,
 * wenn das Feld leer ist). Eine noch laufende Ruhezeit wird verworfen, damit
 * nicht kurz darauf die Schwelle des ALTEN Zustands beim neuen landet.
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

let _alarmRuhe = null;

/**
 * Beim Tippen speichern — entprellt.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Der Preisalarm wird nicht gespeichert … soll gespeichert werden, wenn man
 * was einträgt. Analog dem Kaufpreis."
 *
 * Bis hierher hing das Feld an `change`, also am Verlassen des Feldes. Wer
 * tippt und das Fenster schliesst, ohne vorher woanders hinzuklicken, verlor
 * die Eingabe.
 *
 * ── Warum die Werte JETZT festgehalten werden ───────────────────────────────
 *
 * Der Zeitgeber feuert bis zu ALARM_RUHE später. Läse er die Felder erst
 * dann, wären sie womöglich gar nicht mehr da — das Detailfenster ist
 * inzwischen zu, G() liefert null, und die Eingabe wäre wieder verloren. Das
 * ist genau der Fehler, den diese Änderung beheben soll; deshalb steht hier
 * eine Kopie und kein zweiter Blick in den Baum.
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
 */
export function speichereAlarm(sn) {
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  clearTimeout(_alarmRuhe); _alarmRuhe = null;
  return sendeAlarm(sn, dir.value, String(val.value || '').trim());
}

/**
 * Der eine Weg zum Server.
 *
 * Ein leeres Feld heisst LÖSCHEN, nicht „Schwelle 0": Die natürliche Geste,
 * einen Alarm loszuwerden, ist das Feld zu leeren — ein eigener Knopf daneben
 * wäre ein zweiter Weg für dieselbe Absicht.
 *
 * Ein halber Anfang („-", "abc") ist keine Zahl und damit ein Löschen.
 * „249." dagegen NICHT: `parseFloat("249.")` ist 249 — das hatte ich zuerst
 * falsch behauptet und erst gemessen, als der Android-Lauf meinen Test dazu
 * rot meldete. Dieselbe Lesart wie in Alarmeingabe.zahl().
 *
 * Der Grund für ALARM_RUHE ist damit ein anderer und ein besserer: Wer „249"
 * tippen will, tippt unterwegs „2" und „24". Ohne Ruhezeit stünde am Ende
 * eine Schwelle bei 2 — und die meldet sofort.
 */
async function sendeAlarm(sn, richtung, roh) {
  const zahl = leseBetrag(roh);
  const loeschen = !(zahl > 0);
  const cond = alarmZustand();
  const d = loeschen
    ? await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${cond}`)
    : await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`,
                { richtung, schwelle: zahl, condition: cond });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Nur den Merker, nicht das Feld — die Begründung steht an zeigeAlarmMerker().
  zeigeAlarmMerker(loeschen ? null : d.alert);
}

/**
 * Beim Oeffnen zeigen, welche Alarme seit dem letzten Besuch ausgeloest haben.
 *
 * ── Warum die Webapp das auch tut ───────────────────────────────────────────
 *
 * Die Android-App fragt stuendlich im Hintergrund nach und meldet es als
 * Benachrichtigung (alarm/PreisalarmWorker.kt). Ohne dieses Gegenstueck waere
 * der Preisalarm die erste Funktion, die in der App mehr kann als hier — und
 * genau das soll nicht passieren.
 *
 * Ein Hintergrundlauf ist im Browser nicht das Gegenstueck: Eine
 * geschlossene Seite fragt nichts ab, und ein Service Worker mit Web-Push
 * waere derselbe schwere Apparat, den die App mit Firebase bewusst vermeidet.
 * Das ehrliche Gegenstueck ist: beim Oeffnen nachfragen.
 *
 * ── Die Marke kommt vom SERVER ──────────────────────────────────────────────
 *
 * Dieselbe Begruendung wie in Alarmabholung.kt: Naehme die Seite ihre eigene
 * Uhr, entschiede die Gangabweichung zum Server darueber, ob eine Meldung
 * doppelt kommt oder ausfaellt.
 *
 * Je Konto eine eigene Marke: An einem Rechner melden sich durchaus zwei
 * Leute an, und die Marke des einen darf die Meldungen des anderen nicht
 * verschlucken.
 */
export async function zeigeOffeneAlarme() {
  if (!ME?.id) return;
  const schluessel = 'bim_alarm_marke_' + ME.id;
  let marke = null;
  try { marke = localStorage.getItem(schluessel); } catch (_) {}
  const d = await api('GET', '/v1/alerts/pending' + (marke ? '?since=' + encodeURIComponent(marke) : ''))
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
 * Die Auswahlliste im Detailfenster — der VORRAT des Besitzers.
 *
 * ── Marcos Festlegung ───────────────────────────────────────────────────────
 *
 * „Der Grossvater soll die Werte der Enkel für die entsprechenden Sets sehen
 * und wählen können."
 *
 * Ein Lagerort ist ein Regal in einer Wohnung. Beim Set des Enkels gehören
 * die Regale des ENKELS zur Wahl — ein Set des Enkels in „Grossvaters Keller"
 * wäre eine Aussage über die falsche Wohnung.
 *
 * Ohne `owners` (Einzelkonto, oder eine Zeile ohne Besitzerplakette) bleibt
 * der Parameter weg, und der Server antwortet mit der eigenen Liste. Genau
 * das ist dann auch richtig.
 *
 * ── Warum eine datalist und kein select ─────────────────────────────────────
 *
 * Marco will beides: auswählen UND neue Werte gleich erfassen. Ein `select`
 * kann nur das erste, ein Textfeld nur das zweite. Eine `datalist` klappt auf
 * wie ein Auswahlfeld und nimmt trotzdem Getipptes an — und was getippt wird,
 * landet im Vorrat (setzeLagerort in src/bestand/lagerort.ts).
 */
export async function ladeOrtAuswahl(besitzer) {
  const dl = G('lagerorte');
  if (!dl) return;
  const ids = (besitzer || []).map(o => o?.id ?? o).filter(n => Number.isFinite(Number(n)));
  const frage = ids.length ? '?owner=' + encodeURIComponent(ids.join(',')) : '';
  const d = await api('GET', '/v1/storage/locations' + frage).catch(() => null);
  if (!d?.success) return;
  dl.innerHTML = (d.orte || []).map(o => `<option value="${esc(o.name)}"></option>`).join('');
  // Dieselbe Liste speist das Auswahlfeld im Detail (lagerortBlock).
  setzeOrtVorrat((d.orte || []).map(o => o.name));
}

export async function ladeLagerorte() {
  const d = await api('GET', '/v1/storage' + scopeQuery('gallery')).catch(() => null);
  if (!d?.success) return;
  const orte = d.orte || [];
  const dl = G('lagerorte');
  if (dl) dl.innerHTML = orte.map(o => `<option value="${esc(o.ort)}"></option>`).join('');
  setzeOrtVorrat(orte.map(o => o.ort));
  // Dieselbe Liste speist die Filter-Auswahlfelder. Sie getrennt zu holen
  // hiesse, dass Vorschlag und Filter kurzzeitig zwei Staende zeigen.
  initStorageSelects(orte);
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
 * Die Lagerort-Auswahlfelder füllen.
 *
 * ── Warum sie verborgen bleiben, solange es keine Orte gibt ────────────────
 *
 * Ein Auswahlfeld mit genau einem Eintrag („Alle Lagerorte") beantwortet
 * nichts und steht trotzdem in der Filterzeile. Genau so verhält sich der
 * Kontofilter daneben, wenn es keine Unterkonten gibt — dieselbe Regel, weil
 * es dieselbe Art von Wahl ist.
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
