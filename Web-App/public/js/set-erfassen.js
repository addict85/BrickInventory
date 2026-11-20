// Add a set: the dialog, confirmation on an unknown number, and the stream that creates it. The
// collection reloads afterwards via the 'sammlungLaden' event.
import { emit } from './events.js';
import { schliesseErfassen } from './bausteine.js';
import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { errorMessage, api } from './api.js';
import { G, activeTab } from './dom.js';
import { setnummerFieldValid, amountFromField, quantityFromField, purchaseDateValid } from './formular.js';
import { toast } from './meldungen.js';
import { handleSseEvent, hideProgress, showProgress, streamDone, streamRequest } from './fortschritt.js';
import { setLastImportAt } from './state.js';
import { jumpTo } from './targets.js';
import { emptyLocationField, selectedOwner, selectedStorage } from './konten-orte.js';

G('btn-add').onclick = addSet;
G('add-num').addEventListener('input', resetUnknown);
// Enter from any field submits: the form names btn-add in data-submit (aktionen.js).
G('add-num').form?.addEventListener('reset', resetUnknown);
/**
 * A number the catalog doesn't know is only created after confirmation: otherwise a typo would create a
 * set with no name and no image. The confirmation sits in the dialog; a second click creates it.
 */
function resetUnknown() {
  const box = G('add-unbekannt');
  if (box) box.hidden = true;
  delete G('add-num').dataset.bestaetigt;
  delete G('add-num').dataset.vorhanden;
  G('btn-add-text').textContent = tRaw('gallery.add.submit');
}

/**
 * @param {string} num
 */
async function checkUnknown(num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  if (G('add-num').dataset.bestaetigt === nr) return false;
  const box = G('add-unbekannt');
  // The own collection first: an existing set is never "unknown", and the server never creates it twice
  // anyway, it opens it instead.
  const own = await api('GET', `/v1/sets/${encodeURIComponent(nr)}`);
  if (own?.success && own.set) {
    G('add-num').dataset.bestaetigt = nr;
    G('add-num').dataset.vorhanden = nr;
    // The main button now says "Open set"; a second one with the same name in the hint was one too many.
    box.textContent = tRaw('gallery.add.schon_da', { num: nr, name: own.set.name || nr, n: own.set.quantity || 1 });
    box.hidden = false;
    G('btn-add-text').textContent = tRaw('gallery.add.zum_set');
    return true;
  }
  const d = await api('GET', `/v1/catalog/sets/${encodeURIComponent(nr)}`);
  if (d?.success) return false;
  const reason =
    d?.code === 'katalog_nicht_geladen'
      ? 'gallery.add.katalog_fehlt'
      : d?.code === 'set_nicht_im_katalog' || d?.status === 404
        ? 'gallery.add.unbekannt'
        : null;
  if (!reason) return false;
  G('add-num').dataset.bestaetigt = nr;
  box.textContent = tRaw(reason, { num: nr });
  box.hidden = false;
  G('btn-add-text').textContent = tRaw('gallery.add.trotzdem');
  return true;
}
/**
 * From the add-set dialog straight to the existing set.
 * @param {string} nr
 */
export function erfassenZumSet(nr) {
  G('add-num').value = '';
  resetUnknown();
  schliesseErfassen();
  jumpTo('setDetail', nr);
}

async function addSet() {
  const num = G('add-num').value.trim();
  const price = amountFromField('add-price');
  const purchase_price = price.wert;
  const condition = G('add-condition')?.value || 'N';
  const currency = price.wert != null ? G('add-currency')?.value || null : null;
  const date = G('add-date')?.value || null;
  // Only send a target account when the selector is even visible. Without a household the web app sends
  // nothing at all, and the server stays with the own account — the same response as before household views.
  const owner_user_id = selectedOwner('add-owner');
  // Check every field, don't stop at the first error: each shows its own message, focus stays on the first (set number).
  const dateOk = purchaseDateValid('add-date');
  const qtyField = quantityFromField('add-qty');
  const numberOk = setnummerFieldValid('add-num', num);
  if (!numberOk || !qtyField.ok || !price.ok || !dateOk) return;
  const qty = qtyField.wert;
  // If the set is already there, the main button says "Open set" and does exactly that, with no write attempt.
  const existing = G('add-num').dataset.vorhanden;
  if (existing && existing === (/-\d+$/.test(num) ? num : num + '-1')) {
    erfassenZumSet(existing);
    return;
  }
  if (await checkUnknown(num)) return;
  resetUnknown();
  showProgress(tRaw('gallery.adding_set', { num }), false);
  try {
    await streamRequest(
      '/v1/sets/add-stream',
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
          schliesseErfassen();
          jumpTo('setDetail', ev.set_number ?? '');
          return;
        }
        if (ev.step === 'done') {
          streamDone();
          schliesseErfassen();
          setTimeout(() => {
            hideProgress();
            emit('sammlungLaden');
            G('add-num').value = '';
            if (G('add-price')) G('add-price').value = '';
            if (G('add-date')) G('add-date').value = '';
            emptyLocationField('add-storage');
            if (ev.katalog_offen) toast(tRaw('gallery.added_no_catalog', { num: ev.set_number }), 'info');
            else
              toast(
                tRaw(ev.action === 'added' ? 'gallery.set_hinzugefuegt' : 'gallery.set_aktualisiert', {
                  num: ev.set_number,
                }),
                'success',
              );
            // Background jobs are still running: refresh every tab periodically
            setLastImportAt(Date.now());
            // If the stream couldn't fill in name and image, a job catches up after a minute.
            for (const delay of [3000, 8000, 15000, 25000, ...(ev.ergaenzung === 'ausstehend' ? [70000, 120000] : [])])
              setTimeout(() => {
                const tab = activeTab();
                emit(tab === 'parts' || tab === 'minifigs' ? 'bestandGeaendert' : 'sammlungLaden');
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

registerActions({ erfassenZumSet });
