import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './01-api.js';
import { bildTag, platzhalterInhalt, imgUrl, thumbUrl } from './01-bilder.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { fmtN, leseBetrag, betragFuerFeld } from './01-format.js';
import { feldFehler } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { csvHochladen } from './01-bausteine.js';
import { confirmDelete } from './01-rueckfrage.js';
import { allSets } from './00-zustand.js';
import { esc, html, ungeprueft } from './00-escapen.js';
// Einstellungen, Abschnitt Preisalarme: Übersicht, Schwelle ändern, löschen, CSV-Import.

// Lagerorte verwalten. Nur die eigenen: Ein Ort ist ein Regal in der eigenen Wohnung, fremde umzubenennen
// wäre ein Versehen. Die Auswahl selbst steckt im Detailfenster (ladeOrtAuswahl).
// Ausführlich: docs/begruendungen/public/js/05-alarme.js.md#der-lagerort-soll-ein-auswahlfeld-mit-ei

/** Ein Preisalarm direkt in der Übersicht, ohne Umweg über das Set. */
async function legeAlarmAn() {
  const roh = String(G('alarm-neu-set')?.value || '').trim();
  const sn = /^\d+$/.test(roh) ? roh + '-1' : roh;
  const schwelle = leseBetrag(G('alarm-neu-preis')?.value);
  if (!sn) { feldFehler('alarm-neu-set', tRaw('alerts.new_set_fehlt')); return; }
  if (!(Number(schwelle) > 0)) { feldFehler('alarm-neu-preis', tRaw('alerts.new_preis_fehlt')); return; }
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`,
    { richtung: G('alarm-neu-richtung').value, schwelle, condition: G('alarm-neu-zustand').value });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  G('alarm-neu-set').value = ''; G('alarm-neu-preis').value = '';
  toast(tRaw('alerts.new_ok', { set: sn }), 'success');
  await ladeAlarmUebersicht();
}

/**
 * Alle Preisalarme an einem Ort: Im Set-Detail findet man einen Alarm nur, wenn man das Set schon gefunden
 * hat. Schwelle als Feld (speichert beim Verlassen), dazu der letzte Preis, ohne den sie nicht zu beurteilen
 * ist.
 * Ausführlich: docs/begruendungen/public/js/05-alarme.js.md#alle-preisalarme-des-kontos-die-uebersic
 */
export async function ladeAlarmUebersicht() {
  const el = G('alerts-list');
  if (!el) return;
  const vorschlag = G('alarm-neu-sets');
  if (vorschlag) setzeHtml(vorschlag, allSets.map(x => html`<option value="${x.set_number}">${x.name || ''}</option>`));
  const d = await api('GET', '/v1/alerts');
  if (!d?.success) return;
  const alarme = d.alerts || [];
  if (!alarme.length) {
    setzeHtml(el, html`<p class="text-mut">${tRaw('alerts.empty')}</p>`);
    return;
  }
  setzeHtml(el, alarme.map(a => {
    const zustand = a.condition === 'U' ? tRaw('common.condition_used') : tRaw('common.condition_new');
    const richtung = a.richtung === 'unter' ? tRaw('alerts.below') : tRaw('alerts.above');
    // Der Schluessel ist (Set, Zustand) — beides muss mit, sonst trifft das Aendern den falschen der beiden
    // moeglichen Alarme eines Sets.
    const schluessel = `${a.set_number}|${a.condition}`;
    const stand = a.zuletzt_preis == null
      ? ''
      : t('alerts.last', { preis: fmtN(a.zuletzt_preis, a.currency_code) });
    // „scharf“ gegen „unscharf“ nicht über die Farbe allein, denn grün und grau sind für Rot-Grün-Schwache
    // gleich: Wort, Fläche (gefüllt/umrandet) und Zeichen (●/○) tragen es je für sich, wie in der App.
    // Ausführlich: docs/begruendungen/public/js/05-alarme.js.md#marke
    const marke = a.ausgeloest
      ? `<span class="alarm-marke alarm-marke-aus">${esc(tRaw('alerts.fired'))}</span>`
      : `<span class="alarm-marke alarm-marke-an">${esc(tRaw('alerts.armed'))}</span>`;
    // Bild wie in den Finanzen: erst die heruntergeladene Kopie, dann die Adresse aus der eigenen Sammlung,
    // zuletzt die des Katalogs. Ein Alarm auf ein Set, das man NICHT besitzt, hat nur die letzte — deshalb
    // steht sie ueberhaupt in der Antwort.
    const bildQuelle = a.image_local || a.image_url || a.set_img_url || '';
    const bild = bildQuelle
      ? bildTag({ src: imgUrl(thumbUrl(bildQuelle) || bildQuelle, true), alt: '', klasse: 'bild-38', ph: 'set' })
      : `<span class="bild-ph bild-38" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
    // Die Zeile öffnet das Set-Detail, aber nur wenn das Set im Bestand ist — sonst käme statt Dialog ein
    // Fehler. Feld und Löschknopf haben eigenes data-click, sonst öffnete jeder Klick ins Feld den Dialog
    // darüber.
    // Ausführlich: docs/begruendungen/public/js/05-alarme.js.md#oeffnet
    const oeffnet = a.besitzt
      ? ` class="zeiger" data-click="openModal" data-arg="${esc(a.set_number)}"`
      : '';
    return html`<div class="alarm-ue"${ungeprueft(oeffnet)}>
      ${ungeprueft(bild)}
      <div class="alarm-ue-text">
        <div><strong>${a.name || a.set_number}</strong></div>
        <div class="alarm-ue-unter">${a.name ? html`${a.set_number}${' · '}` : ''}${zustand}</div>
      </div>
      <div class="alarm-ue-stand">${ungeprueft(marke)}<span class="alarm-ue-zuletzt">${stand}</span></div>
      <div class="alarm-ue-schwelle">
        <span class="alarm-ue-richtung">${richtung}</span>
        <input inputmode="decimal" type="text" autocomplete="off" value="${betragFuerFeld(a.schwelle)}" aria-label="${tRaw('detail.alert_price')} ${a.set_number}"
               data-change="aendereAlarmSchwelle" data-arg="${schluessel}" data-val="1" data-click="stopEvent" class="alarm-ue-feld" />
        <span class="alarm-ue-waehrung">${a.currency_code}</span>
      </div>
      <button class="btn bs btn-sm alarm-ue-loeschen" data-click="loescheAlarm"${echt()} data-arg="${schluessel}"
              aria-label="${tRaw('common.delete')}: ${a.set_number}" title="${tRaw('common.delete')}"
              data-arg2="${a.set_number}">${ico('loeschen')}</button>
    </div>`;
  }));
}

/**
 * (Set, Zustand) aus dem Schluessel der Zeile — eine Stelle, zwei Leser.
 * @param {string} s
 */
function alarmSchluessel(s) {
  const i = String(s).lastIndexOf('|');
  return { setNumber: String(s).slice(0, i), condition: String(s).slice(i + 1) };
}

/**
 * @param {string} schluessel
 * @param {string} wert
 */
async function aendereAlarmSchwelle(schluessel, wert) {
  const schwelle = leseBetrag(wert);
  // Kein stilles Zurueckschreiben bei Unsinn: Wer 0 oder Text eingibt, soll sehen, dass nichts passiert ist,
  // statt spaeter einen Alarm zu suchen, den es nicht gibt.
  if (!(schwelle != null && schwelle > 0)) { toast(tRaw('alerts.bad_value'), 'error'); await ladeAlarmUebersicht(); return; }
  const { setNumber, condition } = alarmSchluessel(schluessel);
  // Geschrieben wird ueber die BESTEHENDE Route zum Set — die Uebersicht bekommt keinen eigenen Schreibweg
  // (siehe routes/api_v1/sets.ts).
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(setNumber)}/alert`,
    { condition, schwelle });
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
  await ladeAlarmUebersicht();
}

/**
 * @param {string} schluessel
 * @param {string} setNumber
 */
async function loescheAlarm(schluessel, setNumber) {
  // Dieselbe Rückfrage wie überall (01-rueckfrage.js) statt des Browserfensters, danach „Rückgängig“.
  if (!await confirmDelete(tRaw('alerts.delete_title'), tRaw('alerts.confirm_delete', { set: setNumber }), 'alarm')) return;
  const { setNumber: sn, condition } = alarmSchluessel(schluessel);
  const vorher = (await api('GET', `/v1/sets/${encodeURIComponent(sn)}/alert`))?.alerts?.find(a => a.condition === condition);
  const d = await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${encodeURIComponent(condition)}`);
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); await ladeAlarmUebersicht(); return; }
  toast(tRaw('alerts.deleted', { set: setNumber }), 'success', vorher ? { text: tRaw('trash.undo'), bleibt: true, fn: async () => {
    const r = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, { richtung: vorher.richtung === 'ueber' ? 'ueber' : 'unter', schwelle: Number(vorher.schwelle), condition });
    if (!r?.success) toast(r?.error || tRaw('settings.error'), 'error');
    await ladeAlarmUebersicht();
  } } : undefined);
  await ladeAlarmUebersicht();
}

/**
 * Preisalarme aus einer CSV einlesen. Die Schwellen werden nicht umgerechnet (ein falscher Kurs wäre
 * schlimmer), gelten aber in der Kontowährung; ein Währungshinweis meldet deshalb mit „info“ statt im
 * Erfolgston.
 * Ausführlich: docs/begruendungen/public/js/05-alarme.js.md#importalarmecsv
 */
async function importAlarmeCsv() {
  const status = G('alerts-csv-status');
  const d = await csvHochladen({ feld: 'alerts-csv-file', pfad: '/v1/alerts/import/csv',
    hinweise: (a) => [a.waehrung_hinweis],
    zeige: (l) => { if (status) status.textContent = l ? tRaw('import.running') : ''; } });
  if (d) await ladeAlarmUebersicht();
}

registerActions({
  legeAlarmAn,
  aendereAlarmSchwelle,
  importAlarmeCsv,
  loescheAlarm,
});
