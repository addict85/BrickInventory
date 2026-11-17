import { echt, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum } from './format.js';
import { toast } from './meldungen.js';
import { html, joinHtml } from './escaping.js';
import { bestaetigeMitPasswort, mitZweitemFaktor } from './rueckfrage.js';
import { emit } from './events.js';

// ═══ Papierkorb (Einstellungen → Daten) ═════════════════════════════════════
// Der Server legt beim Löschen einen Schnappschuss ab (src/bestand/papierkorb.ts); hier wird er angezeigt,
// zurückgeholt oder endgültig entfernt.

const ICON = { set: 'set', teil: 'teil', figur: 'figur' };

/**
 * Gleiche Sets zweier Konten sahen gleich aus; Konto und Menge unterscheiden sie, auch im Namen der Knöpfe.
 * @param {import('../../frontend-typen/vertrag').PapierkorbEintrag} e
 * @param {Map<number, string>} konten Name je Konto, leer ohne Haushalt
 */
function zeile(e, konten) {
  const frist = fmtDatum(e.endgueltig_am);
  const konto = konten.get(e.user_id);
  const was = [e.number, e.label, tRaw('trash.menge', { n: e.anzahl }), konto].filter(Boolean).join(' · ');
  return html`<div class="pk-zeile" data-pk-id="${e.id}">
    <span aria-hidden="true">${ico(ICON[e.type] || 'loeschen')}</span>
    <span class="pk-name"><span class="pk-nr">${e.number}</span>
      ${e.label ? html`${' · '}${e.label}` : ''}
      <span>${' · '}${tRaw('trash.menge', { n: e.anzahl })}</span>
      ${konto ? html`<span>${' · '}${konto}</span>` : ''}</span>
    <span class="pk-frist">${tRaw('trash.until', { datum: frist })}</span>
    <button class="btn bs btn-sm" data-click="papierkorbWiederherstellen" data-arg="${e.id}" aria-label="${tRaw('trash.restore_was', { was })}">${tRaw('trash.restore')}</button>
    <button class="btn bd btn-sm" data-click="papierkorbEndgueltig"${echt()} data-arg="${e.id}" aria-label="${tRaw('trash.delete_final_was', { was })}">${tRaw('trash.delete_final')}</button>
  </div>`;
}

/** Name je Konto, nur im Haushalt: Mit einem Konto wäre der Name auf jeder Zeile derselbe. */
async function kontenNamen() {
  const d = await api('GET', '/v1/sets/household-members');
  const m = d?.success ? d.members : [];
  return new Map(
    m.length > 1 ? m.map(k => [k.id, k.is_self ? `${k.username} ${tRaw('household.ich')}` : k.username]) : [],
  );
}

/** @param {string} [fokusNach] Kennung des eben entfernten Eintrags: Der Fokus geht auf seinen Nachbarn. */
export async function ladePapierkorb(fokusNach) {
  const liste = G('papierkorb-liste');
  if (!liste) return;
  const vorher = fokusNach
    ? [...liste.querySelectorAll('.pk-zeile')].findIndex(z => z.getAttribute('data-pk-id') === fokusNach)
    : -1;
  const [d, konten] = await Promise.all([api('GET', '/v1/papierkorb'), kontenNamen()]);
  const leeren = G('papierkorb-leeren');
  if (!d?.success) {
    setzeHtml(liste, html`<div class="voucher-leer">${tRaw('trash.load_error')}</div>`);
    return;
  }
  const eintraege = d.eintraege || [];
  setzeHtml(
    liste,
    eintraege.length
      ? joinHtml(eintraege.map(e => zeile(e, konten)))
      : html`<div class="voucher-leer" tabindex="-1">${tRaw('trash.empty')}</div>`,
  );
  if (leeren) leeren.style.display = eintraege.length ? '' : 'none';
  if (vorher < 0) return;
  const zeilen = liste.querySelectorAll('.pk-zeile');
  const nachbar = zeilen[Math.min(vorher, zeilen.length - 1)];
  /** @type {HTMLElement | null} */ (nachbar?.querySelector('button') ?? liste.querySelector('.voucher-leer'))?.focus();
}

/** Alles nachladen, was ein Wiederherstellen verändert haben kann. */
function bestandNeuLaden() {
  emit('bestandGeaendert');
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
  // Das „Rückgängig“ desselben Löschens hätte nichts mehr zurückzuholen.
  for (const t of document.querySelectorAll('#toasts [data-papierkorb]'))
    if (t.getAttribute('data-papierkorb')?.split(',').includes(String(id))) t.remove();
  toast(tRaw('trash.restored'), 'success');
  bestandNeuLaden();
  await ladePapierkorb(String(id));
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
  await ladePapierkorb(String(id));
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
 * Der Fokus geht auf den zurückgeholten Eintrag, sobald die neu geladene Liste ihn zeigt, statt auf die
 * Überschrift. Die Liste zeichnet sich danach noch einmal (Preise, zweites Laden): Bis zur Frist holt er den
 * Fokus zurück, solange er nur auf Seite oder Überschrift gefallen ist, nicht wenn jemand weitergegangen ist.
 * @param {string} sel
 */
function fokusWennDa(sel) {
  const ende = Date.now() + 5000;
  const versuch = () => {
    const el = /** @type {HTMLElement | null} */ (document.querySelector(`#app .tab.active :is(${sel})`));
    const aktiv = document.activeElement;
    const verloren = !aktiv || aktiv === document.body || aktiv.matches('#app .tab.active h1, #toasts *');
    if (el && aktiv !== el && verloren) el.focus();
    if (Date.now() < ende && (verloren || aktiv === el)) setTimeout(versuch, 100);
  };
  versuch();
}

/**
 * Die Erfolgsmeldung nach dem Löschen, mit „Rückgängig".
 * @param {string} meldung
 * @param {{papierkorb?: number[]}} antwort die Antwort des DELETE
 * @param {() => unknown} [nachher] was danach neu zu zeichnen ist, etwa das offene Set-Detail
 * @param {string} [fokus] Selektor des Eintrags, der nach dem Zurückholen den Fokus bekommt
 */
export function geloeschtMitRueckgaengig(meldung, antwort, nachher, fokus) {
  const ids = antwort?.papierkorb || [];
  const el = toast(
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
            nachher?.();
            if (fokus) fokusWennDa(fokus);
          },
        }
      : undefined,
  );
  if (el && ids.length) el.dataset.papierkorb = ids.join(',');
}

registerActions({ papierkorbWiederherstellen, papierkorbEndgueltig, papierkorbLeeren });
