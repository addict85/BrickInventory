// Questions before destructive steps: confirm, or choose. No password: a login is enough
// (docs/SICHERHEIT.md). One level above the core, so that every view can use them.
import { G, ico, setHtml } from './dom.js';
import { html } from './escaping.js';
import { tRaw } from '../i18n.js';

/**
 * Without `button` the main button is red "delete"; whoever confirms something else names their verb.
 * @param {string} title
 * @param {string} msg
 * @param {string} [icon]
 * @param {Button | null} [button]
 */
export function confirmDelete(title, msg, icon, button = null) {
  return openDialog(title, msg, icon, button).then(r => r !== null);
}

/**
 * Delete with a choice, e.g. which accounts of a household; the first option is preselected.
 * @param {string} title @param {string} msg @param {{ value: string, text: string }[]} choice
 * @returns {Promise<string | null>} the chosen value, null on cancel
 */
export function deleteWithChoice(title, msg, choice) {
  return /** @type {Promise<string | null>} */ (openDialog(title, msg, 'delete', { choice }));
}

/**
 * Main button of the question dialog: text, kind (bp blue, bd red).
 * @typedef {{ button?: string, kind?: string, values?: Record<string, unknown>, choice?: { value: string, text: string }[] }} Button
 */

/** Title, text, button and choice of the dialog; @returns the choice field.
 * @param {string} title @param {string} msg @param {string | undefined} icon @param {Button | null | undefined} button */
function confirmTexts(title, msg, icon, button) {
  G('cd-title').textContent = title || tRaw('common.delete_title');
  G('cd-msg').textContent = msg || tRaw('common.delete_text');
  setHtml(G('cd-icon'), ico(icon || 'delete'));
  const btnYes = G('cd-confirm');
  const danger = (button?.kind || 'bd') === 'bd';
  btnYes.textContent = tRaw(button?.button || 'confirm.delete_btn', button?.values);
  btnYes.classList.toggle('bd', danger);
  btnYes.classList.toggle('bp', !danger);
  G('cd-icon').classList.toggle('neutral', !danger);
  const choiceField = G('cd-choice');
  choiceField.hidden = !button?.choice;
  setHtml(
    choiceField,
    html`${(button?.choice || []).map((w, i) => html`<label class="cd-choice-row"><input type="radio" name="cd-choice" value="${w.value}"${i ? '' : ' checked'}> ${w.text}</label>`)}`,
  );
  return choiceField;
}

/**
 * @param {string} title
 * @param {string} msg
 * @param {string | undefined} icon
 * @param {Button | null} [button]
 * @returns {Promise<string | null>} the choice ('' without one), null on cancel
 */
function openDialog(title, msg, icon, button = null) {
  return new Promise(resolve => {
    const modal = G('confirm-modal');
    const choiceField = confirmTexts(title, msg, icon, button);
    modal.style.display = 'flex';
    const btnYes = G('cd-confirm');
    const btnNo = G('cd-cancel');
    /** @param {string | null} result */
    function cleanup(result) {
      modal.style.display = 'none';
      btnYes.onclick = null;
      btnNo.onclick = null;
      modal.onclick = null;
      resolve(result);
    }
    const selected = () =>
      /** @type {HTMLInputElement | null} */ (choiceField.querySelector('input:checked'))?.value || '';
    btnYes.onclick = () => cleanup(button?.choice ? selected() : '');
    btnNo.onclick = () => cleanup(null);
    modal.onclick = e => {
      if (e.target === modal) cleanup(null);
    };
  });
}
