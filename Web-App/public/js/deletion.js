// One rule for deleting: what can be restored goes at once and offers "undo" in the toast; what is gone
// for good asks first. A question before every delete trains a blind "yes" — and then it no longer
// protects the few deletes where it matters.
import { tRaw } from '../i18n.js';
import { confirmDelete } from './confirm-prompt.js';
import { toast } from './messages.js';
import { deletedWithUndo } from './trash.js';

/** @typedef {{ success?: boolean, error?: string, papierkorb?: number[] }} DeleteResponse */
/** @param {unknown} d @returns {DeleteResponse} */
const asResponse = d => /** @type {DeleteResponse} */ (d ?? {});

/**
 * Restorable: delete without a question, then a success toast with "undo". Without `undo` the trash
 * ids of the response restore the entry; entries outside the trash (wanted item, alert) bring their own.
 * @template T
 * @param {{ request: () => Promise<T>, message: string, undo?: () => Promise<boolean>,
 *   after?: () => unknown, focus?: string }} o
 * @returns {Promise<T | null>} the response, null if the server refused (already reported)
 */
export async function deleteRestorable(o) {
  const res = await o.request();
  const d = asResponse(res);
  if (!d.success) {
    toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  const undo = o.undo;
  if (!undo) deletedWithUndo(o.message, d, o.after, o.focus);
  else
    toast(o.message, 'success', {
      text: tRaw('trash.undo'),
      stays: true,
      fn: async () => {
        if (!(await undo())) return;
        toast(tRaw('trash.restored'), 'success');
        await o.after?.();
      },
    });
  return res;
}

/**
 * Irreversible: ask first, then delete. The caller redraws; a refusal is reported here.
 * @template T
 * @param {{ title: string, text: string, icon: string, request: () => Promise<T> }} o
 * @returns {Promise<T | null>} the response, null if cancelled or refused
 */
export async function deleteFinal(o) {
  if (!(await confirmDelete(o.title, o.text, o.icon))) return null;
  const res = await o.request();
  const d = asResponse(res);
  if (!d.success) {
    toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  return res;
}
