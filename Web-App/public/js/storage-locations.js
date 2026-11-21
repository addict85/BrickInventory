import { emit } from './events.js';
import { echt, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { responseError, feldFehler } from './form.js';
import { toast } from './messages.js';
import { html } from './escaping.js';
import { confirmDelete } from './confirm-prompt.js';
import { loadLocationDefault } from './account-locations.js';
import { loadLocations } from './detail-fields.js';
// Settings, storage locations section: the pool of locations the detail fields pick from; create, rename,
// set as default, delete.

/**
 * Our own locations, with their occupancy.
 */
export async function ladeLagerortVerwaltung() {
  const el = G('storage-list');
  if (!el) return;
  // Both lists together: `locations` says what can be CHOSEN, `storage` what is actually IN there. Without
  // the second, nothing would show next to each location, and the refusal to delete ("something's still in
  // there") would come out of nowhere.
  const [v, b] = await Promise.all([api('GET', '/v1/storage/locations'), api('GET', '/v1/storage?accounts=own')]);
  if (!v?.success) return;
  // A new or renamed location shows up right away in the collection form's selects.
  loadLocations().catch(() => {});
  const occupancy = new Map((b?.orte || []).map(o => [o.ort, o]));
  const locations = v.orte || [];
  if (!locations.length) {
    setzeHtml(el, html`<div data-stil="color:var(--mut)">${tRaw('storage.empty')}</div>`);
    return;
  }
  // Feature request: being able to set a storage location as the default in settings, with a star icon.
  const defaultId = v.vorgabe?.id ?? null;
  // The grid sits on the list, and the rows are display:contents: that way every row shares the same column
  // widths, and the name field doesn't get squeezed narrow by the occupancy text next to it. minmax(0,1fr) so
  // a long name doesn't blow out the column; the divider line therefore sits on each cell.
  setzeHtml(
    el,
    html`${html`<div data-stil="font-size:var(--fs-1);color:var(--mut);margin-bottom:6px">`}${html`${tRaw('storage.default_hint')}</div>`}${html`<div class="lager-raster" data-stil="display:grid;grid-template-columns:minmax(0,1fr) max-content max-content max-content;align-items:center;column-gap:0">`}${locations.map(
      o => {
        const occ = occupancy.get(o.name);
        // Minifigs show up on their OWN, not lumped in with part counts (src/inventory/storageLocation.ts): "18 part
        // types" would otherwise sometimes mean 18 part types and sometimes 12 plus 6 minifigs, and no one
        // could tell from the number what it means.
        const how = occ
          ? [
              tRaw('storage.belegt.sets', { n: Number(occ.sets) || 0 }),
              tRaw('storage.belegt.teile', { n: Number(occ.teile) || 0 }),
              tRaw('storage.belegt.figuren', { n: Number(occ.figuren) || 0 }),
            ]
              .filter(x => !x.startsWith('0 '))
              .join(', ')
          : tRaw('storage.leer');
        // Occupied: the server already refused the delete after the confirmation dialog. Disabled says so
        // beforehand, with the reason.
        const occupied = !!occ && (Number(occ.sets) || 0) + (Number(occ.teile) || 0) + (Number(occ.figuren) || 0) > 0;
        return html`<div data-stil="display:contents">
      <span class="lager-feld" data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><input type="text" maxlength="60" value="${o.name}" aria-label="${tRaw('storage.umbenennen', { name: o.name })}"
             data-change="benenneLagerortUm" data-arg="${o.id}" data-val="1" data-zaehler class="lager-eingabe" /></span>
      <span class="lager-belegt" data-stil="padding:6px 0 6px 8px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;font-size:var(--fs-1);color:var(--mut);white-space:nowrap;justify-content:flex-end"><span class="lager-marke${occ ? '' : ' lager-frei'}">${how}</span></span>
      <span data-stil="padding:6px 0 6px 8px;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs lager-sinnbild" data-click="schalteLagerortVorgabe" data-arg="${o.id}"
              data-arg2="${o.id === defaultId ? 1 : 0}"
              title="${tRaw(o.id === defaultId ? 'storage.default_is' : 'storage.default_set')}"
              aria-label="${tRaw(o.id === defaultId ? 'storage.default_is' : 'storage.default_set')}"
              aria-pressed="${o.id === defaultId ? 'true' : 'false'}">${ico(o.id === defaultId ? 'stern-voll' : 'merkliste')}</button></span>
      <span data-stil="padding:6px 0 6px 8px;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs lager-sinnbild" data-click="loescheLagerort"${echt()} data-arg="${o.id}"
              aria-label="${tRaw('common.delete')}: ${o.name}${occupied ? ` (${tRaw('storage.erst_umraeumen', { wie: how })})` : ''}" title="${occupied ? tRaw('storage.erst_umraeumen', { wie: how }) : tRaw('common.delete')}"
              data-arg2="${o.name}"${occupied ? ' disabled' : ''}>${ico('loeschen')}</button></span>
    </div>`;
      },
    )}${html`</div>`}`,
  );
}

async function legeLagerortAn() {
  const field = G('storage-new');
  const name = String(field?.value || '').trim();
  if (!name) {
    feldFehler('storage-new', tRaw('storage.name_fehlt'));
    return;
  }
  const d = await api('POST', '/v1/storage/locations', { name });
  if (!d?.success) {
    responseError(
      d,
      { lagerort_leer: 'storage-new', lagerort_zu_lang: 'storage-new', lagerort_doppelt: 'storage-new' },
      tRaw('settings.error'),
    );
    return;
  }
  field.value = '';
  await ladeLagerortVerwaltung();
}

/**
 * Enter in the input field creates it — the same gesture as everywhere else in the tree.
 * @param {string} _id
 * @param {KeyboardEvent} ev
 */
function lagerortTaste(_id, ev) {
  if (ev?.key === 'Enter') {
    ev.preventDefault();
    legeLagerortAn();
  }
}

/**
 * @param {string} id
 * @param {string} value
 */
async function benenneLagerortUm(id, value) {
  const name = String(value || '').trim();
  // Empty does NOT mean delete here: when renaming, a field cleared out is almost always a slip, and delete
  // has its own button right next to it. (On the LOCATION AT THE SET it's the other way round — there,
  // clearing is the natural gesture to drop the assignment.)
  if (!name) {
    toast(tRaw('storage.name_fehlt'), 'error');
    await ladeLagerortVerwaltung();
    return;
  }
  const d = await api('PUT', `/v1/storage/locations/${encodeURIComponent(id)}`, { name });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
  } else toast(tRaw('storage.umbenannt', { name }), 'success');
  await ladeLagerortVerwaltung();
  // The assignments moved along with it (benenneOrtUm on the server) — the gallery would otherwise keep
  // showing the old name.
  emit('sammlungLaden');
}

/**
 * Toggle the star. ★/☆ differ in shape, not in color, and carry title and aria-pressed. A second click on
 * the same star turns the default off — a separate button for that would be too much.
 * @param {string} id
 * @param {string} was
 */
async function schalteLagerortVorgabe(id, was) {
  const d = await api('PUT', '/v1/storage/default', { id: String(was) === '1' ? null : parseInt(id, 10) });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await ladeLagerortVerwaltung();
  // The collection forms are already showing — without this follow-up they'd show the old state until
  // someone reloads the page. Same gesture as the collection-condition default, which calls
  // initDefaultCondition() after saving.
  loadLocationDefault();
}

/**
 * @param {string} id
 * @param {string} name
 */
async function loescheLagerort(id, name) {
  if (!(await confirmDelete(tRaw('storage.delete_title'), `${name} — ${tRaw('storage.delete_text')}`, 'lagerort')))
    return;
  const d = await api('DELETE', `/v1/storage/locations/${encodeURIComponent(id)}`);
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await ladeLagerortVerwaltung();
}

// Names below are registry-exposed (index.html/connection.js/tests) — kept unchanged.
registerActions({
  legeLagerortAn,
  lagerortTaste,
  benenneLagerortUm,
  loescheLagerort,
  schalteLagerortVorgabe,
});
