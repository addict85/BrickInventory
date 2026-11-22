// Add a set: the dialog, confirmation on an unknown number, and the stream that creates it. The
// collection reloads afterwards via the 'collectionLoad' event.
import { emit } from './events.js';
import { closeCapture } from './components.js';
import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { errorMessage, api } from './api.js';
import { G, activeTab } from './dom.js';
import { setNumberFieldValid, amountFromField, quantityFromField, purchaseDateValid } from './form.js';
import { toast } from './messages.js';
import { handleSseEvent, hideProgress, showProgress, streamDone, streamRequest } from './progress.js';
import { setLastImportAt } from './state.js';
import { jumpTo } from './targets.js';
import { emptyLocationField, selectedOwner, selectedStorage } from './account-locations.js';

G('btn-add').onclick = addSet;
G('add-num').addEventListener('input', resetUnknown);
// Enter from any field submits: the form names btn-add in data-submit (actions.js).
G('add-num').form?.addEventListener('reset', resetUnknown);
/**
 * A number the catalog doesn't know is only created after confirmation: otherwise a typo would create a
 * set with no name and no image. The confirmation sits in the dialog; a second click creates it.
 */
function resetUnknown() {
  const box = G('add-unknown');
  if (box) box.hidden = true;
  delete G('add-num').dataset.confirmed;
  delete G('add-num').dataset.present;
  G('btn-add-text').textContent = tRaw('gallery.add.submit');
}

/**
 * @param {string} num
 */
async function checkUnknown(num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  if (G('add-num').dataset.confirmed === nr) return false;
  const box = G('add-unknown');
  // The own collection first: an existing set is never "unknown", and the server never creates it twice
  // anyway, it opens it instead.
  const own = await api('GET', `/v2/sets/${encodeURIComponent(nr)}`);
  if (own?.success && own.set) {
    G('add-num').dataset.confirmed = nr;
    G('add-num').dataset.present = nr;
    // The main button now says "Open set"; a second one with the same name in the hint was one too many.
    box.textContent = tRaw('gallery.add.already_da', { num: nr, name: own.set.name || nr, n: own.set.quantity || 1 });
    box.hidden = false;
    G('btn-add-text').textContent = tRaw('gallery.add.to_set');
    return true;
  }
  const d = await api('GET', `/v2/catalog/sets/${encodeURIComponent(nr)}`);
  if (d?.success) return false;
  const reason =
    d?.code === 'catalog_not_loaded'
      ? 'gallery.add.catalog_missing'
      : d?.code === 'set_not_in_catalog' || d?.status === 404
        ? 'gallery.add.unknown'
        : null;
  if (!reason) return false;
  G('add-num').dataset.confirmed = nr;
  box.textContent = tRaw(reason, { num: nr });
  box.hidden = false;
  G('btn-add-text').textContent = tRaw('gallery.add.anyway');
  return true;
}
/**
 * From the add-set dialog straight to the existing set.
 * @param {string} nr
 */
export function captureForSet(nr) {
  G('add-num').value = '';
  resetUnknown();
  closeCapture();
  jumpTo('setDetail', nr);
}

async function addSet() {
  const num = G('add-num').value.trim();
  const price = amountFromField('add-price');
  const purchase_price = price.value;
  const condition = G('add-condition')?.value || 'N';
  const currency = price.value != null ? G('add-currency')?.value || null : null;
  const date = G('add-date')?.value || null;
  // Only send a target account when the selector is even visible. Without a household the web app sends
  // nothing at all, and the server stays with the own account — the same response as before household views.
  const owner_user_id = selectedOwner('add-owner');
  // Check every field, don't stop at the first error: each shows its own message, focus stays on the first (set number).
  const dateOk = purchaseDateValid('add-date');
  const qtyField = quantityFromField('add-qty');
  const numberOk = setNumberFieldValid('add-num', num);
  if (!numberOk || !qtyField.ok || !price.ok || !dateOk) return;
  const qty = qtyField.value;
  // If the set is already there, the main button says "Open set" and does exactly that, with no write attempt.
  const existing = G('add-num').dataset.present;
  if (existing && existing === (/-\d+$/.test(num) ? num : num + '-1')) {
    captureForSet(existing);
    return;
  }
  if (await checkUnknown(num)) return;
  resetUnknown();
  showProgress(tRaw('gallery.adding_set', { num }), false);
  try {
    await streamRequest(
      '/v2/sets/add-stream',
      {
        set_number: num,
        quantity: qty,
        purchase_price,
        condition,
        owner_user_id,
        storage: selectedStorage('add-storage'),
        currency,
        date,
      },
      ev => {
        handleSseEvent(ev, num);
        if (ev.step === 'done' && ev.action === 'exists') {
          // Already in view, the server wrote nothing: the detail view instead of a message, as in the app.
          streamDone();
          hideProgress();
          G('add-num').value = '';
          closeCapture();
          jumpTo('setDetail', ev.set_number ?? '');
          return;
        }
        if (ev.step === 'done') {
          streamDone();
          closeCapture();
          setTimeout(() => {
            hideProgress();
            emit('collectionLoad');
            G('add-num').value = '';
            if (G('add-price')) G('add-price').value = '';
            if (G('add-date')) G('add-date').value = '';
            emptyLocationField('add-storage');
            if (ev.catalog_pending) toast(tRaw('gallery.added_no_catalog', { num: ev.set_number }), 'info');
            else
              toast(
                tRaw(ev.action === 'added' ? 'gallery.set_added' : 'gallery.set_updated', {
                  num: ev.set_number,
                }),
                'success',
              );
            // Background jobs are still running: refresh every tab periodically
            setLastImportAt(Date.now());
            // If the stream couldn't fill in name and image, a job catches up after a minute.
            for (const delay of [3000, 8000, 15000, 25000, ...(ev.supplement === 'pending' ? [70000, 120000] : [])])
              setTimeout(() => {
                const tab = activeTab();
                emit(tab === 'parts' || tab === 'minifigs' ? 'stockChanged' : 'collectionLoad');
              }, delay);
          }, 800);
        } else if (ev.step === 'error') {
          streamDone();
          setTimeout(() => {
            hideProgress();
            toast(ev.error, 'error');
          }, 1500);
        }
      },
    );
  } catch (e) {
    if (/** @type {Error} */ (e).name !== 'AbortError') {
      hideProgress();
      toast(errorMessage(e), 'error');
    }
  }
}

registerActions({ captureForSet });
