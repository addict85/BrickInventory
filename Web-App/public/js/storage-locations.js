import { emit } from './events.js';
import { genuine, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { responseError, fieldError } from './form.js';
import { toast } from './messages.js';
import { html } from './escaping.js';
import { deleteFinal } from './deletion.js';
import { loadLocationDefault } from './account-locations.js';
import { loadLocations } from './detail-fields.js';
// Settings, storage locations section: the pool of locations the detail fields pick from; create, rename,
// set as default, delete.

/**
 * Our own locations, with their occupancy.
 */
export async function loadLocationManagement() {
  const el = G('storage-list');
  if (!el) return;
  // Both lists together: `locations` says what can be CHOSEN, `storage` what is actually IN there. Without
  // the second, nothing would show next to each location, and the refusal to delete ("something's still in
  // there") would come out of nowhere.
  const [v, b] = await Promise.all([api('GET', '/v2/storage/locations'), api('GET', '/v2/storage?accounts=own')]);
  if (!v?.success) return;
  // A new or renamed location shows up right away in the collection form's selects.
  loadLocations().catch(() => {});
  const occupancy = new Map((b?.locations || []).map(o => [o.location, o]));
  const locations = v.locations || [];
  if (!locations.length) {
    setHtml(el, html`<div data-style="color:var(--mut)">${tRaw('storage.empty')}</div>`);
    return;
  }
  // Feature request: being able to set a storage location as the default in settings, with a star icon.
  const defaultId = v.preset?.id ?? null;
  // The grid sits on the list, and the rows are display:contents: that way every row shares the same column
  // widths, and the name field doesn't get squeezed narrow by the occupancy text next to it. minmax(0,1fr) so
  // a long name doesn't blow out the column; the divider line therefore sits on each cell.
  setHtml(
    el,
    html`${html`<div data-style="font-size:var(--fs-1);color:var(--mut);margin-bottom:6px">`}${html`${tRaw('storage.default_hint')}</div>`}${html`<div class="location-grid" data-style="display:grid;grid-template-columns:minmax(0,1fr) max-content max-content max-content;align-items:center;column-gap:0">`}${locations.map(
      o => {
        const occ = occupancy.get(o.name);
        // Minifigs show up on their OWN, not lumped in with part counts (src/inventory/storageLocation.ts): "18 part
        // types" would otherwise sometimes mean 18 part types and sometimes 12 plus 6 minifigs, and no one
        // could tell from the number what it means.
        const how = occ
          ? [
              tRaw('storage.used.sets', { n: Number(occ.sets) || 0 }),
              tRaw('storage.used.parts', { n: Number(occ.parts) || 0 }),
              tRaw('storage.used.minifigs', { n: Number(occ.minifigs) || 0 }),
            ]
              .filter(x => !x.startsWith('0 '))
              .join(', ')
          : tRaw('storage.unused');
        // Occupied: the server already refused the delete after the confirmation dialog. Disabled says so
        // beforehand, with the reason.
        const occupied = !!occ && (Number(occ.sets) || 0) + (Number(occ.parts) || 0) + (Number(occ.minifigs) || 0) > 0;
        return html`<div data-style="display:contents">
      <span class="location-field" data-style="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><input type="text" maxlength="60" value="${o.name}" aria-label="${tRaw('storage.rename', { name: o.name })}"
             data-change="renameLocation" data-arg="${o.id}" data-val="1" data-counter class="location-input" /></span>
      <span class="location-used" data-style="padding:6px 0 6px 8px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;font-size:var(--fs-1);color:var(--mut);white-space:nowrap;justify-content:flex-end"><span class="location-badge${occ ? '' : ' location-free'}">${how}</span></span>
      <span data-style="padding:6px 0 6px 8px;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs location-icon" data-click="toggleLocationDefault" data-arg="${o.id}"
              data-arg2="${o.id === defaultId ? 1 : 0}"
              title="${tRaw(o.id === defaultId ? 'storage.default_is' : 'storage.default_set')}"
              aria-label="${tRaw(o.id === defaultId ? 'storage.default_is' : 'storage.default_set')}"
              aria-pressed="${o.id === defaultId ? 'true' : 'false'}">${ico(o.id === defaultId ? 'star-full' : 'wanted')}</button></span>
      <span data-style="padding:6px 0 6px 8px;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs location-icon" data-click="deleteLocation"${genuine()} data-arg="${o.id}"
              aria-label="${tRaw('common.delete')}: ${o.name}${occupied ? ` (${tRaw('storage.first_move_items', { like: how })})` : ''}" title="${occupied ? tRaw('storage.first_move_items', { like: how }) : tRaw('common.delete')}"
              data-arg2="${o.name}"${occupied ? ' disabled' : ''}>${ico('delete')}</button></span>
    </div>`;
      },
    )}${html`</div>`}`,
  );
}

async function createLocation() {
  const field = G('storage-new');
  const name = String(field?.value || '').trim();
  if (!name) {
    fieldError('storage-new', tRaw('storage.name_missing'));
    return;
  }
  const d = await api('POST', '/v2/storage/locations', { name });
  if (!d?.success) {
    responseError(
      d,
      { storage_empty: 'storage-new', storage_too_long: 'storage-new', storage_duplicate: 'storage-new' },
      tRaw('settings.error'),
    );
    return;
  }
  field.value = '';
  await loadLocationManagement();
}

/**
 * Enter in the input field creates it — the same gesture as everywhere else in the tree.
 * @param {string} _id
 * @param {KeyboardEvent} ev
 */
function locationKeydown(_id, ev) {
  if (ev?.key === 'Enter') {
    ev.preventDefault();
    createLocation();
  }
}

/**
 * @param {string} id
 * @param {string} value
 */
async function renameLocation(id, value) {
  const name = String(value || '').trim();
  // Empty does NOT mean delete here: when renaming, a field cleared out is almost always a slip, and delete
  // has its own button right next to it. (On the LOCATION AT THE SET it's the other way round — there,
  // clearing is the natural gesture to drop the assignment.)
  if (!name) {
    toast(tRaw('storage.name_missing'), 'error');
    await loadLocationManagement();
    return;
  }
  const d = await api('PUT', `/v2/storage/locations/${encodeURIComponent(id)}`, { name });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
  } else toast(tRaw('storage.renamed', { name }), 'success');
  await loadLocationManagement();
  // The assignments moved along with it (renamed on the server) — the gallery would otherwise keep
  // showing the old name.
  emit('collectionLoad');
}

/**
 * Toggle the star. ★/☆ differ in shape, not in color, and carry title and aria-pressed. A second click on
 * the same star turns the default off — a separate button for that would be too much.
 * @param {string} id
 * @param {string} was
 */
async function toggleLocationDefault(id, was) {
  const d = await api('PUT', '/v2/storage/default', { id: String(was) === '1' ? null : parseInt(id, 10) });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await loadLocationManagement();
  // The collection forms are already showing — without this follow-up they'd show the old state until
  // someone reloads the page. Same gesture as the collection-condition default, which calls
  // initDefaultCondition() after saving.
  loadLocationDefault();
}

/**
 * @param {string} id
 * @param {string} name
 */
async function deleteLocation(id, name) {
  const d = await deleteFinal({
    title: tRaw('storage.delete_title'),
    text: `${name} — ${tRaw('storage.delete_text')}`,
    icon: 'location',
    request: () => api('DELETE', `/v2/storage/locations/${encodeURIComponent(id)}`),
  });
  if (d) await loadLocationManagement();
}

// Names below are registry-exposed (index.html/connection.js/tests) — kept unchanged.
registerActions({
  createLocation,
  locationKeydown,
  renameLocation,
  deleteLocation,
  toggleLocationDefault,
});
