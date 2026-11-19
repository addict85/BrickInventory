import { echt, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { bildTag, platzhalterInhalt, imgUrl, thumbUrl } from './bilder.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtN, leseBetrag, betragFuerFeld } from './format.js';
import { feldFehler } from './formular.js';
import { toast } from './meldungen.js';
import { csvHochladen } from './bausteine.js';
import { confirmDelete } from './rueckfrage.js';
import { gallerySets } from './state.js';
import { esc, html, rawHtml } from './escaping.js';
// Settings, price alerts section: overview, change threshold, delete, CSV import.

/** A price alert created directly from the overview, without going via the set. */
async function legeAlarmAn() {
  const raw = String(G('alarm-neu-set')?.value || '').trim();
  const sn = /^\d+$/.test(raw) ? raw + '-1' : raw;
  const threshold = leseBetrag(G('alarm-neu-preis')?.value);
  if (!sn) {
    feldFehler('alarm-neu-set', tRaw('alerts.new_set_fehlt'));
    return;
  }
  if (!(Number(threshold) > 0)) {
    feldFehler('alarm-neu-preis', tRaw('alerts.new_preis_fehlt'));
    return;
  }
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
    direction: G('alarm-neu-richtung').value,
    threshold,
    condition: G('alarm-neu-zustand').value,
  });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  G('alarm-neu-set').value = '';
  G('alarm-neu-preis').value = '';
  toast(tRaw('alerts.new_ok', { set: sn }), 'success');
  await ladeAlarmUebersicht();
}

/**
 * All price alerts in one place: in the set detail, an alert is only found once the set itself has been
 * found. Threshold as a field (saves on blur), plus the last price, without which it cannot be judged.
 */
export async function ladeAlarmUebersicht() {
  const el = G('alerts-list');
  if (!el) return;
  const suggestions = G('alarm-neu-sets');
  if (suggestions)
    setzeHtml(
      suggestions,
      gallerySets.map(x => html`<option value="${x.set_number}">${x.name || ''}</option>`),
    );
  const d = await api('GET', '/v1/alerts');
  if (!d?.success) return;
  const alerts = d.alerts || [];
  if (!alerts.length) {
    setzeHtml(el, html`<p class="text-mut">${tRaw('alerts.empty')}</p>`);
    return;
  }
  setzeHtml(
    el,
    alerts.map(a => {
      const condition = a.condition === 'U' ? tRaw('common.condition_used') : tRaw('common.condition_new');
      const direction = a.direction === 'unter' ? tRaw('alerts.below') : tRaw('alerts.above');
      // The key is (set, condition) — both are needed, otherwise changing one hits the wrong one of a
      // set's two possible alerts.
      const key = `${a.set_number}|${a.condition}`;
      const last = a.last_price == null ? '' : t('alerts.last', { preis: fmtN(a.last_price, a.currency_code) });
      // "armed" vs "fired" is never carried by color alone, since green and grey look the same to people
      // with red-green color blindness: word, shape (filled/outlined) and symbol (●/○) each carry it on
      // their own, same as elsewhere in the app.
      const badge = a.triggered
        ? `<span class="alarm-marke alarm-marke-aus">${esc(tRaw('alerts.fired'))}</span>`
        : `<span class="alarm-marke alarm-marke-an">${esc(tRaw('alerts.armed'))}</span>`;
      // Image like in Finances: first the downloaded copy, then the address from the own collection,
      // lastly the catalog's. An alert on a set one does NOT own only has the last one — which is why it's
      // in the response at all.
      const imageSource = a.image_local || a.image_url || a.set_img_url || '';
      const image = imageSource
        ? bildTag({ src: imgUrl(thumbUrl(imageSource) || imageSource, true), alt: '', klasse: 'bild-38', ph: 'set' })
        : `<span class="bild-ph bild-38" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
      // The row opens the set detail, but only if the set is in the collection — otherwise an error would
      // show instead of the dialog. The field and delete button have their own data-click, otherwise every
      // click into the field would open the dialog above it.
      const opens = a.besitzt ? ` class="zeiger" data-click="openModal" data-arg="${esc(a.set_number)}"` : '';
      return html`<div class="alarm-ue"${rawHtml(opens)}>
      ${rawHtml(image)}
      <div class="alarm-ue-text">
        <div><strong>${a.name || a.set_number}</strong></div>
        <div class="alarm-ue-unter">${a.name ? html`${a.set_number}${' · '}` : ''}${condition}</div>
      </div>
      <div class="alarm-ue-stand">${rawHtml(badge)}<span class="alarm-ue-zuletzt">${last}</span></div>
      <div class="alarm-ue-schwelle">
        <span class="alarm-ue-richtung">${direction}</span>
        <span class="alarm-ue-betrag"><input inputmode="decimal" type="text" autocomplete="off" value="${betragFuerFeld(a.threshold)}" aria-label="${tRaw('detail.alert_price')} ${a.set_number}"
               data-change="aendereAlarmSchwelle" data-arg="${key}" data-val="1" data-click="stopEvent" class="alarm-ue-feld" />
        <span class="alarm-ue-waehrung">${a.currency_code}</span></span>
      </div>
      <button class="btn bs btn-sm alarm-ue-loeschen" data-click="loescheAlarm"${echt()} data-arg="${key}"
              aria-label="${tRaw('common.delete')}: ${a.set_number}" title="${tRaw('common.delete')}"
              data-arg2="${a.set_number}">${ico('loeschen')}</button>
    </div>`;
    }),
  );
}

/**
 * (Set, condition) from the row's key — one place, two readers.
 * @param {string} s
 */
function alarmSchluessel(s) {
  const i = String(s).lastIndexOf('|');
  return { setNumber: String(s).slice(0, i), condition: String(s).slice(i + 1) };
}

/**
 * @param {string} key
 * @param {string} value
 */
async function aendereAlarmSchwelle(key, value) {
  const threshold = leseBetrag(value);
  // No silently writing back nonsense: whoever enters 0 or text should see that nothing happened, instead
  // of looking for an alert later that doesn't exist.
  if (!(threshold != null && threshold > 0)) {
    toast(tRaw('alerts.bad_value'), 'error');
    await ladeAlarmUebersicht();
    return;
  }
  const { setNumber, condition } = alarmSchluessel(key);
  // Written via the EXISTING route on the set — the overview gets no write path of its own (see
  // routes/api_v1/sets.ts).
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(setNumber)}/alert`, { condition, threshold });
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
  await ladeAlarmUebersicht();
}

/**
 * @param {string} key
 * @param {string} setNumber
 */
async function loescheAlarm(key, setNumber) {
  // Same confirmation dialog as everywhere else (rueckfrage.js) instead of the browser's, followed by "undo".
  if (!(await confirmDelete(tRaw('alerts.delete_title'), tRaw('alerts.confirm_delete', { set: setNumber }), 'alarm')))
    return;
  const { setNumber: sn, condition } = alarmSchluessel(key);
  const before = (await api('GET', `/v1/sets/${encodeURIComponent(sn)}/alert`))?.alerts?.find(
    a => a.condition === condition,
  );
  const d = await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${encodeURIComponent(condition)}`);
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    await ladeAlarmUebersicht();
    return;
  }
  toast(
    tRaw('alerts.deleted', { set: setNumber }),
    'success',
    before
      ? {
          text: tRaw('trash.undo'),
          bleibt: true,
          fn: async () => {
            const r = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
              direction: before.direction === 'ueber' ? 'ueber' : 'unter',
              threshold: Number(before.threshold),
              condition,
            });
            if (!r?.success) toast(r?.error || tRaw('settings.error'), 'error');
            await ladeAlarmUebersicht();
          },
        }
      : undefined,
  );
  await ladeAlarmUebersicht();
}

/**
 * Read price alerts from a CSV. Thresholds are not converted (a wrong exchange rate would be worse), but
 * apply in the account currency; a currency notice therefore reports with "info" rather than a success tone.
 */
async function importAlarmeCsv() {
  const status = G('alerts-csv-status');
  const d = await csvHochladen({
    feld: 'alerts-csv-file',
    pfad: '/v1/alerts/import/csv',
    hinweise: a => [a.waehrung_hinweis],
    zeige: l => {
      if (status) status.textContent = l ? tRaw('import.running') : '';
    },
  });
  if (d) await ladeAlarmUebersicht();
}

// Names below are registry-exposed (index.html/verbindung.js/tests) — kept unchanged.
registerActions({
  legeAlarmAn,
  aendereAlarmSchwelle,
  importAlarmeCsv,
  loescheAlarm,
});
