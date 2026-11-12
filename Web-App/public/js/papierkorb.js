import { echt, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum } from './format.js';
import { toast } from './meldungen.js';
import { html, verbinde } from './escapen.js';
import { bestaetigeMitPasswort, mitZweitemFaktor } from './rueckfrage.js';
import { melde } from './ereignisse.js';

// ═══ Papierkorb (Einstellungen → Daten) ═════════════════════════════════════
// Der Server legt beim Löschen einen Schnappschuss ab (src/bestand/papierkorb.ts); hier wird er angezeigt,
// zurückgeholt oder endgültig entfernt.

const ICON = { set: 'set', teil: 'teil', figur: 'figur' };

/** @param {import('../../frontend-typen/vertrag').PapierkorbEintrag} e */
function zeile(e) {
  const frist = fmtDatum(e.endgueltig_am);
  return html`<div class="pk-zeile">
    <span aria-hidden="true">${ico(ICON[e.art] || 'loeschen')}</span>
    <span class="pk-name"><span class="pk-nr">${e.nummer}</span>
      ${e.bezeichnung ? html`${' · '}${e.bezeichnung}` : ''}
      ${e.anzahl > 1 ? html` · ×${e.anzahl}` : ''}</span>
    <span class="pk-frist">${tRaw('trash.until', { datum: frist })}</span>
    <button class="btn bs btn-sm" data-click="papierkorbWiederherstellen" data-arg="${e.id}">${tRaw('trash.restore')}</button>
    <button class="btn bd btn-sm" data-click="papierkorbEndgueltig"${echt()} data-arg="${e.id}">${tRaw('trash.delete_final')}</button>
  </div>`;
}

export async function ladePapierkorb() {
  const liste = G('papierkorb-liste');
  if (!liste) return;
  const d = await api('GET', '/v1/papierkorb');
  const leeren = G('papierkorb-leeren');
  if (!d?.success) {
    setzeHtml(liste, html`<div class="voucher-leer">${tRaw('trash.load_error')}</div>`);
    return;
  }
  const eintraege = d.eintraege || [];
  setzeHtml(
    liste,
    eintraege.length ? verbinde(eintraege.map(zeile)) : html`<div class="voucher-leer">${tRaw('trash.empty')}</div>`,
  );
  if (leeren) leeren.style.display = eintraege.length ? '' : 'none';
}

/** Alles nachladen, was ein Wiederherstellen verändert haben kann. */
function bestandNeuLaden() {
  melde('bestandGeaendert');
}

/** @param {(number | string)[]} ids */
async function wiederherstellen(ids) {
  for (const id of ids) {
    const d = await api('POST', `/v1/papierkorb/${id}/wiederherstellen`);
    if (!d?.success) {
      toast(d?.error || tRaw('settings.error'), 'error');
      return false;
    }
  }
  return true;
}

/** @param {string} id */
export async function papierkorbWiederherstellen(id) {
  if (!(await wiederherstellen([id]))) return;
  toast(tRaw('trash.restored'), 'success');
  bestandNeuLaden();
  await ladePapierkorb();
}

// Endgültig heisst unumkehrbar: Der Server verlangt dafür das Passwort (und den zweiten Faktor).
/** @param {string} id */
export async function papierkorbEndgueltig(id) {
  const password = await bestaetigeMitPasswort(tRaw('trash.delete_final'), tRaw('common.delete_text'), 'loeschen', {
    knopf: 'confirm.btn.endgueltig_loeschen',
    art: 'bd',
  });
  if (password === null) return;
  const d = await mitZweitemFaktor(z => api('DELETE', `/v1/papierkorb/${id}`, { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await ladePapierkorb();
}

export async function papierkorbLeeren() {
  const password = await bestaetigeMitPasswort(tRaw('trash.clear'), tRaw('trash.clear_confirm'), 'loeschen', {
    knopf: 'confirm.btn.papierkorb_leeren',
    art: 'bd',
  });
  if (password === null) return;
  const d = await mitZweitemFaktor(z => api('DELETE', '/v1/papierkorb', { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await ladePapierkorb();
}

/**
 * Die Erfolgsmeldung nach dem Löschen, mit „Rückgängig".
 * @param {string} meldung
 * @param {{papierkorb?: number[]}} antwort die Antwort des DELETE
 */
export function geloeschtMitRueckgaengig(meldung, antwort) {
  const ids = antwort?.papierkorb || [];
  toast(
    meldung,
    'success',
    ids.length
      ? {
          text: tRaw('trash.undo'),
          bleibt: true,
          fn: async () => {
            if (!(await wiederherstellen(ids))) return;
            toast(tRaw('trash.restored'), 'success');
            bestandNeuLaden();
          },
        }
      : undefined,
  );
}

registerActions({ papierkorbWiederherstellen, papierkorbEndgueltig, papierkorbLeeren });
