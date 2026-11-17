// Set erfassen: Dialog, Rückfrage bei unbekannter Nummer und der Strom zum Anlegen. Die Sammlung lädt danach
// über das Ereignis 'sammlungLaden' neu.
import { emit } from './events.js';
import { schliesseErfassen } from './bausteine.js';
import { registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { fehlerMeldung, api } from './api.js';
import { G, aktiverReiter } from './dom.js';
import { setnummerFeldGueltig, betragAusFeld, mengeAusFeld, kaufdatumGueltig } from './formular.js';
import { toast } from './meldungen.js';
import { handleSseEvent, hideProgress, showProgress, streamFertig, streamRequest } from './fortschritt.js';
import { setLastImportAt } from './state.js';
import { jumpTo } from './targets.js';
import { leereLagerortFeld, selectedOwner, selectedStorage } from './konten-orte.js';

G('btn-add').onclick = doAddSet;
G('add-num').addEventListener('input', unbekanntZuruecksetzen);
// Enter aus jedem Feld schickt ab: Das Formular nennt btn-add in data-submit (aktionen.js).
G('add-num').form?.addEventListener('reset', unbekanntZuruecksetzen);
/**
 * Eine Nummer, die der Katalog nicht kennt, wird erst nach Rückfrage angelegt: Sonst entsteht aus einem
 * Tippfehler ein Set ohne Namen und Bild. Die Rückfrage steht im Dialog; ein zweiter Klick legt an.
 */
function unbekanntZuruecksetzen() {
  const box = G('add-unbekannt');
  if (box) box.hidden = true;
  delete G('add-num').dataset.bestaetigt;
  delete G('add-num').dataset.vorhanden;
  G('btn-add-text').textContent = tRaw('gallery.add.submit');
}

/**
 * @param {string} num
 */
async function setUnbekannt(num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  if (G('add-num').dataset.bestaetigt === nr) return false;
  const box = G('add-unbekannt');
  // Erst die eigene Sammlung: Ein vorhandenes Set ist nie „unbekannt“, und der Server legt es ohnehin nicht
  // doppelt an, sondern öffnet es.
  const eigen = await api('GET', `/v1/sets/${encodeURIComponent(nr)}`);
  if (eigen?.success && eigen.set) {
    G('add-num').dataset.bestaetigt = nr;
    G('add-num').dataset.vorhanden = nr;
    // Der Hauptknopf heisst jetzt „Set öffnen“; ein zweiter gleichen Namens im Hinweis war einer zu viel.
    box.textContent = tRaw('gallery.add.schon_da', { num: nr, name: eigen.set.name || nr, n: eigen.set.quantity || 1 });
    box.hidden = false;
    G('btn-add-text').textContent = tRaw('gallery.add.zum_set');
    return true;
  }
  const d = await api('GET', `/v1/catalog/sets/${encodeURIComponent(nr)}`);
  if (d?.success) return false;
  const ursache =
    d?.code === 'katalog_nicht_geladen'
      ? 'gallery.add.katalog_fehlt'
      : d?.code === 'set_nicht_im_katalog' || d?.status === 404
        ? 'gallery.add.unbekannt'
        : null;
  if (!ursache) return false;
  G('add-num').dataset.bestaetigt = nr;
  box.textContent = tRaw(ursache, { num: nr });
  box.hidden = false;
  G('btn-add-text').textContent = tRaw('gallery.add.trotzdem');
  return true;
}
/**
 * Aus dem Erfassen-Dialog direkt zum vorhandenen Set.
 * @param {string} nr
 */
export function erfassenZumSet(nr) {
  G('add-num').value = '';
  unbekanntZuruecksetzen();
  schliesseErfassen();
  jumpTo('setDetail', nr);
}

async function doAddSet() {
  const num = G('add-num').value.trim();
  const preis = betragAusFeld('add-price');
  const purchase_price = preis.wert;
  const condition = G('add-condition')?.value || 'N';
  const currency = preis.wert != null ? G('add-currency')?.value || null : null;
  const date = G('add-date')?.value || null;
  // Zielkonto nur mitschicken, wenn die Auswahl überhaupt sichtbar ist. Ohne Haushalt schickt die Webapp gar
  // nichts, und der Server bleibt beim eigenen Konto — dieselbe Antwort wie vor der Haushaltssicht.
  const owner_user_id = selectedOwner('add-owner');
  // Alle Felder prüfen, nicht beim ersten Fehler aufhören: Jedes zeigt seine Meldung, der Fokus bleibt am ersten (Set-Nummer).
  const datumOk = kaufdatumGueltig('add-date');
  const menge = mengeAusFeld('add-qty');
  const nummerOk = setnummerFeldGueltig('add-num', num);
  if (!nummerOk || !menge.ok || !preis.ok || !datumOk) return;
  const qty = menge.wert;
  // Steht das Set schon da, heisst der Hauptknopf „Set öffnen“ und tut genau das, ohne Schreibversuch.
  const vorhanden = G('add-num').dataset.vorhanden;
  if (vorhanden && vorhanden === (/-\d+$/.test(num) ? num : num + '-1')) {
    erfassenZumSet(vorhanden);
    return;
  }
  if (await setUnbekannt(num)) return;
  unbekanntZuruecksetzen();
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
          // Schon im Blickfeld, der Server schrieb nichts: Die Detailansicht statt einer Meldung, wie in der App.
          streamFertig();
          hideProgress();
          G('add-num').value = '';
          schliesseErfassen();
          jumpTo('setDetail', ev.set_number ?? '');
          return;
        }
        if (ev.step === 'done') {
          streamFertig();
          schliesseErfassen();
          setTimeout(() => {
            hideProgress();
            emit('sammlungLaden');
            G('add-num').value = '';
            if (G('add-price')) G('add-price').value = '';
            if (G('add-date')) G('add-date').value = '';
            leereLagerortFeld('add-storage');
            if (ev.katalog_offen) toast(tRaw('gallery.added_no_catalog', { num: ev.set_number }), 'info');
            else
              toast(
                tRaw(ev.action === 'added' ? 'gallery.set_hinzugefuegt' : 'gallery.set_aktualisiert', {
                  num: ev.set_number,
                }),
                'success',
              );
            // Hintergrundaufträge laufen noch: alle Reiter regelmässig auffrischen
            setLastImportAt(Date.now());
            // Konnte der Strom nicht ergänzen, holt ein Auftrag Name und Bild nach einer Minute.
            for (const delay of [3000, 8000, 15000, 25000, ...(ev.ergaenzung === 'ausstehend' ? [70000, 120000] : [])])
              setTimeout(() => {
                const reiter = aktiverReiter();
                emit(reiter === 'parts' || reiter === 'minifigs' ? 'bestandGeaendert' : 'sammlungLaden');
              }, delay);
          }, 800);
        } else if (ev.step === 'error') {
          streamFertig();
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
      toast(fehlerMeldung(e), 'error');
    }
  }
}

registerActions({ erfassenZumSet });
