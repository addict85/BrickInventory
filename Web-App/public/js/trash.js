import { genuine, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { fmtDate } from './format.js';
import { toast } from './messages.js';
import { html, joinHtml } from './escaping.js';
import { confirmDeleteWithPassword, withSecondFactor } from './confirm-prompt.js';
import { emit } from './events.js';

// ═══ Trash (settings → data) ═══════════════════════════════════════════════
// The server stores a snapshot on deletion (src/inventory/trash.ts); here it is shown,
// restored or removed permanently.

const ICON = { set: 'set', teil: 'part', figur: 'minifig' };

/**
 * Identical sets of two accounts looked the same; account and quantity distinguish them, also in the buttons' names.
 * @param {import('../../frontend-types/contract').TrashEntry} e
 * @param {Map<number, string>} accounts name per account, empty without a household
 */
function row(e, accounts) {
  const deadline = fmtDate(e.purge_at);
  const account = accounts.get(e.user_id);
  const was = [e.number, e.label, tRaw('trash.quantity', { n: e.count }), account].filter(Boolean).join(' · ');
  return html`<div class="pk-row" data-pk-id="${e.id}">
    <span aria-hidden="true">${ico(ICON[e.type] || 'delete')}</span>
    <span class="pk-name"><span class="pk-nr">${e.number}</span>
      ${e.label ? html`${' · '}${e.label}` : ''}
      <span>${' · '}${tRaw('trash.quantity', { n: e.count })}</span>
      ${account ? html`<span>${' · '}${account}</span>` : ''}</span>
    <span class="pk-deadline">${tRaw('trash.until', { date: deadline })}</span>
    <button class="btn bs btn-sm" data-click="restoreFromTrash" data-arg="${e.id}" aria-label="${tRaw('trash.restore_was', { was })}">${tRaw('trash.restore')}</button>
    <button class="btn bd btn-sm" data-click="deleteFromTrashPermanently"${genuine()} data-arg="${e.id}" aria-label="${tRaw('trash.delete_final_was', { was })}">${tRaw('trash.delete_final')}</button>
  </div>`;
}

/** Name per account, only in the household: with one account the name would be the same on every row. */
async function accountsNames() {
  const d = await api('GET', '/v2/sets/household-members');
  const m = d?.success ? d.members : [];
  return new Map(
    m.length > 1 ? m.map(k => [k.id, k.is_self ? `${k.username} ${tRaw('household.ich')}` : k.username]) : [],
  );
}

/** @param {string} [focusAfter] identifier of the entry just removed: the focus goes to its neighbor. */
export async function loadTrash(focusAfter) {
  const list = G('trash-list');
  if (!list) return;
  const before = focusAfter
    ? [...list.querySelectorAll('.pk-row')].findIndex(z => z.getAttribute('data-pk-id') === focusAfter)
    : -1;
  const [d, accounts] = await Promise.all([api('GET', '/v2/trash'), accountsNames()]);
  const empty = G('trash-empty');
  if (!d?.success) {
    setHtml(list, html`<div class="voucher-empty">${tRaw('trash.load_error')}</div>`);
    return;
  }
  const entries = d.entries || [];
  setHtml(
    list,
    entries.length
      ? joinHtml(entries.map(e => row(e, accounts)))
      : html`<div class="voucher-empty" tabindex="-1">${tRaw('trash.empty')}</div>`,
  );
  if (empty) empty.style.display = entries.length ? '' : 'none';
  if (before < 0) return;
  const rows = list.querySelectorAll('.pk-row');
  const neighbor = rows[Math.min(before, rows.length - 1)];
  /** @type {HTMLElement | null} */ (
    neighbor?.querySelector('button') ?? list.querySelector('.voucher-empty')
  )?.focus();
}

/** Reload everything a restore may have changed. */
function loadInventoryNew() {
  emit('stockChanged');
}

/** @param {(number | string)[]} ids */
async function restore(ids) {
  for (const id of ids) {
    const d = await api('POST', `/v2/trash/${id}/restore`);
    if (!d?.success) {
      toast(d?.error || tRaw('settings.error'), 'error');
      return false;
    }
  }
  return true;
}

/** @param {string} id */
export async function restoreFromTrash(id) {
  if (!(await restore([id]))) return;
  // The "undo" of the same deletion would have nothing left to restore.
  for (const t of document.querySelectorAll('#toasts [data-trash]'))
    if (t.getAttribute('data-trash')?.split(',').includes(String(id))) t.remove();
  toast(tRaw('trash.restored'), 'success');
  loadInventoryNew();
  await loadTrash(String(id));
}

// Permanently means irreversibly: the server requires the password for it (and the second factor).
/** @param {string} id */
export async function deleteFromTrashPermanently(id) {
  const password = await confirmDeleteWithPassword(tRaw('trash.delete_final'), tRaw('common.delete_text'), 'delete', {
    button: 'confirm.btn.permanently_delete',
    kind: 'bd',
  });
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', `/v2/trash/${id}`, { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  await loadTrash(String(id));
}

export async function emptyTrash() {
  const password = await confirmDeleteWithPassword(tRaw('trash.clear'), tRaw('trash.clear_confirm'), 'delete', {
    button: 'confirm.btn.trash_empty',
    kind: 'bd',
  });
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', '/v2/trash', { password, ...z }));
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
  const end = Date.now() + 5000;
  const attempt = () => {
    const el = /** @type {HTMLElement | null} */ (document.querySelector(`#app .tab.active :is(${sel})`));
    const active = document.activeElement;
    const lost = !active || active === document.body || active.matches('#app .tab.active h1, #toasts *');
    if (el && active !== el && lost) el.focus();
    if (Date.now() < end && (lost || active === el)) setTimeout(attempt, 100);
  };
  attempt();
}

/**
 * The success message after deleting, with "undo".
 * @param {string} message
 * @param {{trash?: number[]}} response the response of the DELETE
 * @param {() => unknown} [after] what to redraw afterwards, e.g. the open set detail
 * @param {string} [focus] selector of the entry that gets the focus after restoring
 */
export function deletedWithUndo(message, response, after, focus) {
  const ids = response?.trash || [];
  const el = toast(
    message,
    'success',
    ids.length
      ? {
          text: tRaw('trash.undo'),
          stays: true,
          fn: async () => {
            if (!(await restore(ids))) return;
            toast(tRaw('trash.restored'), 'success');
            loadInventoryNew();
            after?.();
            if (focus) focusIfDa(focus);
          },
        }
      : undefined,
  );
  if (el && ids.length) el.dataset.trash = ids.join(',');
}

registerActions({ restoreFromTrash, deleteFromTrashPermanently, emptyTrash });
