import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './01-api.js';
import { ico, G } from './01-dom.js';
import { antwortFehler, feldFehler } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { loadGallery } from './02-gallery.js';
import { esc } from './00-escapen.js';
import { confirmDelete } from './01-rueckfrage.js';
import { ladeLagerortVorgabe } from './02-konten-orte.js';
import { ladeLagerorte } from './02-detailfelder.js';
// Einstellungen, Abschnitt Lagerorte: der Vorrat an Orten, aus dem die Detailfelder wählen;
// anlegen, umbenennen, als Vorgabe setzen, löschen.

/**
 * Die eigenen Orte samt Belegung.
 */
export async function ladeLagerortVerwaltung() {
  const el = G('storage-list');
  if (!el) return;
  // Beide Listen zusammen: `locations` sagt, was zur WAHL steht, `storage`,
  // was wirklich DRIN liegt. Ohne die zweite stünde neben jedem Ort nichts,
  // und die Absage beim Löschen („da liegt noch was") käme aus dem Nichts.
  const [v, b] = await Promise.all([
    api('GET', '/v1/storage/locations'),
    api('GET', '/v1/storage?accounts=own'),
  ]);
  if (!v?.success) return;
  // Ein neuer oder umbenannter Ort steht gleich in den Auswahlfeldern der Erfassung.
  ladeLagerorte().catch(() => {});
  const belegung = new Map((b?.orte || []).map(o => [o.ort, o]));
  const orte = v.orte || [];
  if (!orte.length) {
    el.innerHTML = `<div data-stil="color:var(--mut)">${esc(tRaw('storage.empty'))}</div>`;
    return;
  }
  // Marcos Stern: „Weiter möchte ich ein Lagerort in den Einstellungen als
  // Default setzen können. […] Ich stelle mir das mit einem Sternicon vor."
  const vorgabeId = v.vorgabe?.id ?? null;
  // Das Raster liegt an der Liste, die Zeilen sind display:contents: So teilen alle Zeilen dieselben
  // Spaltenbreiten, und das Namensfeld wird nicht vom Belegungstext daneben schmal gedrückt.
  // minmax(0,1fr), damit ein langer Name die Spalte nicht sprengt; der Trennstrich liegt darum an jeder
  // Zelle.
  // Ausführlich: docs/begruendungen/public/js/05-lagerorte.js.md#marcos-befund-dass-die-felder-alle-schoe
  el.innerHTML = `<div data-stil="font-size:var(--fs-1);color:var(--mut);margin-bottom:6px">` +
                 `${esc(tRaw('storage.default_hint'))}</div>` +
                 `<div class="lager-raster" data-stil="display:grid;grid-template-columns:minmax(0,1fr) max-content max-content max-content;align-items:center;column-gap:8px">` +
                 orte.map(o => {
    const n = belegung.get(o.name);
    // Figuren stehen EIGEN da, nicht bei den Teilesorten (src/bestand/lagerort.ts):
    // „18 Teilesorten" hiesse sonst mal 18 Teilesorten und mal 12 plus 6
    // Figuren, und niemand koennte der Zahl ansehen, was gemeint ist.
    const wie = n ? [t('storage.belegt.sets', { n: Number(n.sets) || 0 }), t('storage.belegt.teile', { n: Number(n.teile) || 0 }),
                     t('storage.belegt.figuren', { n: Number(n.figuren) || 0 })].filter(x => !x.startsWith('0 ')).join(', ')
                  : esc(tRaw('storage.leer'));
    return `<div data-stil="display:contents">
      <span class="lager-feld" data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><input type="text" maxlength="60" value="${esc(o.name)}" aria-label="${esc(tRaw('detail.storage'))}"
             data-change="benenneLagerortUm" data-arg="${o.id}" data-val="1" class="lager-eingabe" /></span>
      <span class="lager-belegt" data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center;font-size:var(--fs-1);color:var(--mut);white-space:nowrap;justify-content:flex-end"><span class="lager-marke${n ? '' : ' lager-frei'}">${wie}</span></span>
      <span data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs lager-sinnbild" data-click="schalteLagerortVorgabe" data-arg="${o.id}"
              data-arg2="${o.id === vorgabeId ? 1 : 0}"
              title="${esc(tRaw(o.id === vorgabeId ? 'storage.default_is' : 'storage.default_set'))}"
              aria-label="${esc(tRaw(o.id === vorgabeId ? 'storage.default_is' : 'storage.default_set'))}"
              aria-pressed="${o.id === vorgabeId ? 'true' : 'false'}">${ico(o.id === vorgabeId ? 'stern-voll' : 'merkliste')}</button></span>
      <span data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs lager-sinnbild" data-click="loescheLagerort"${echt()} data-arg="${o.id}"
              aria-label="${esc(tRaw('common.delete'))}: ${esc(o.name)}" title="${esc(tRaw('common.delete'))}"
              data-arg2="${esc(o.name)}">${ico('loeschen')}</button></span>
    </div>`;
  }).join('') + `</div>`;
}

async function legeLagerortAn() {
  const feld = G('storage-new');
  const name = String(feld?.value || '').trim();
  if (!name) { feldFehler('storage-new', tRaw('storage.name_fehlt')); return; }
  const d = await api('POST', '/v1/storage/locations', { name });
  if (!d?.success) {
    antwortFehler(d, { lagerort_leer: 'storage-new', lagerort_zu_lang: 'storage-new', lagerort_doppelt: 'storage-new' }, tRaw('settings.error'));
    return;
  }
  feld.value = '';
  await ladeLagerortVerwaltung();
}

/**
 * Enter im Eingabefeld legt an — dieselbe Geste wie überall sonst im Baum.
 * @param {string} id
 * @param {KeyboardEvent} ev
 */
function lagerortTaste(id, ev) {
  if (ev?.key === 'Enter') { ev.preventDefault(); legeLagerortAn(); }
}

/**
 * @param {string} id
 * @param {string} wert
 */
async function benenneLagerortUm(id, wert) {
  const name = String(wert || '').trim();
  // Leer heisst hier NICHT löschen: Beim Umbenennen ist ein leergeräumtes Feld
  // fast immer ein Versehen, und das Löschen hat seinen eigenen Knopf daneben.
  // (Beim Lagerort AM SET ist es umgekehrt — dort ist Leeren die natürliche
  // Geste, um die Zuordnung loszuwerden.)
  if (!name) { await ladeLagerortVerwaltung(); return; }
  const d = await api('PUT', `/v1/storage/locations/${encodeURIComponent(id)}`, { name });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); }
  await ladeLagerortVerwaltung();
  // Die Zuordnungen sind mitgewandert (benenneOrtUm im Server) — die Galerie
  // zeigt sonst weiter den alten Namen.
  loadGallery();
}

/**
 * Den Stern umschalten. ★/☆ unterscheiden sich in der Form, nicht in der Farbe, und tragen Titel und
 * aria-pressed. Ein zweiter Druck auf denselben Stern schaltet die Vorgabe ab — ein eigener Knopf
 * dafür wäre zu viel.
 * Ausführlich: docs/begruendungen/public/js/05-lagerorte.js.md#schaltelagerortvorgabe
 * @param {string} id
 * @param {string} war
 */
async function schalteLagerortVorgabe(id, war) {
  const d = await api('PUT', '/v1/storage/default',
                      { id: String(war) === '1' ? null : parseInt(id) });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladeLagerortVerwaltung();
  // Die Erfassungsformulare stehen schon — ohne das Nachziehen zeigten sie
  // den alten Stand, bis jemand die Seite neu laedt. Dieselbe Geste wie beim
  // Erfassungs-Zustand, der nach dem Speichern initDefaultCondition() ruft.
  ladeLagerortVorgabe();
}

/**
 * @param {string} id
 * @param {string} name
 */
async function loescheLagerort(id, name) {
  if (!await confirmDelete(tRaw('storage.delete_title'),
                           `${name} — ${tRaw('storage.delete_text')}`, 'lagerort')) return;
  const d = await api('DELETE', `/v1/storage/locations/${encodeURIComponent(id)}`);
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladeLagerortVerwaltung();
}

registerActions({
  legeLagerortAn,
  lagerortTaste,
  benenneLagerortUm,
  loescheLagerort,
  schalteLagerortVorgabe,
});
