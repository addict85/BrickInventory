import { echt, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum } from './format.js';
import { toast } from './messages.js';
import { html, joinHtml } from './escaping.js';
import { bestaetigeMitPasswort, withSecondFactor } from './confirm-prompt.js';
import { emit } from './events.js';

// ═══ Trash (settings → data) ═══════════════════════════════════════════════
// The server stores a snapshot on deletion (src/inventory/trash.ts); here it is shown,
// restored or removed permanently.

const ICON = { set: 'set', teil: 'teil', figur: 'figur' };

/**
 * Identical sets of two accounts looked the same; account and quantity distinguish them, also in the buttons' names.
 * @param {import('../../frontend-types/contract').PapierkorbEintrag} e
 * @param {Map<number, string>} konten name per account, empty without a household
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

/** Name per account, only in the household: with one account the name would be the same on every row. */
async function accountsNames() {
  const d = await api('GET', '/v1/sets/household-members');
  const m = d?.success ? d.members : [];
  return new Map(
    m.length > 1 ? m.map(k => [k.id, k.is_self ? `${k.username} ${tRaw('household.ich')}` : k.username]) : [],
  );
}

/** @param {string} [focusAfter] identifier of the entry just removed: the focus goes to its neighbor. */
export async function loadTrash(focusAfter) {
  const liste = G('papierkorb-liste');
  if (!liste) return;
  const vorher = focusAfter
    ? [...liste.querySelectorAll('.pk-zeile')].findIndex(z => z.getAttribute('data-pk-id') === focusAfter)
    : -1;
  const [d, konten] = await Promise.all([api('GET', '/v1/papierkorb'), accountsNames()]);
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
  const neighbor = zeilen[Math.min(vorher, zeilen.length - 1)];
  /** @type {HTMLElement | null} */ (
    neighbor?.querySelector('button') ?? liste.querySelector('.voucher-leer')
  )?.focus();
}

/** Reload everything a restore may have changed. */
function loadInventoryNew() {
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
  // The "undo" of the same deletion would have nothing left to restore.
  for (const t of document.querySelectorAll('#toasts [data-papierkorb]'))
    if (t.getAttribute('data-papierkorb')?.split(',').includes(String(id))) t.remove();
  toast(tRaw('trash.restored'), 'success');
  loadInventoryNew();
  await loadTrash(String(id));
}

// Permanently means irreversibly: the server requires the password for it (and the second factor).
/** @param {string} id */
export async function papierkorbEndgueltig(id) {
  const password = await bestaetigeMitPasswort(tRaw('trash.delete_final'), tRaw('common.delete_text'), 'loeschen', {
    knopf: 'confirm.btn.endgueltig_loeschen',
    art: 'bd',
  });
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', `/v1/papierkorb/${id}`, { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await loadTrash(String(id));
}

export async function papierkorbLeeren() {
  const password = await bestaetigeMitPasswort(tRaw('trash.clear'), tRaw('trash.clear_confirm'), 'loeschen', {
    knopf: 'confirm.btn.papierkorb_leeren',
    art: 'bd',
  });
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', '/v1/papierkorb', { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await loadTrash();
}

/**
 * The focus goes to the restored entry as soon as the reloaded list shows it, instead of to the
 * heading. The list redraws once more afterwards (prices, second load): until the deadline it takes the
 * focus back as long as it only fell onto the page or heading, not if someone has moved on.
 * @param {string} sel
 */
function focusIfDa(sel) {
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
 * The success message after deleting, with "undo".
 * @param {string} meldung
 * @param {{papierkorb?: number[]}} antwort the response of the DELETE
 * @param {() => unknown} [nachher] what to redraw afterwards, e.g. the open set detail
 * @param {string} [fokus] selector of the entry that gets the focus after restoring
 */
export function deletedWithUndo(meldung, antwort, nachher, fokus) {
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
            loadInventoryNew();
            nachher?.();
            if (fokus) focusIfDa(fokus);
          },
        }
      : undefined,
  );
  if (el && ids.length) el.dataset.papierkorb = ids.join(',');
}

registerActions({ papierkorbWiederherstellen, papierkorbEndgueltig, papierkorbLeeren });
