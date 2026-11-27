import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { G, setHtml } from './dom.js';
import { toast } from './messages.js';
import { esc, html, rawHtml, joinHtml } from './escaping.js';
import { confirmDelete } from './confirm-prompt.js';
// Settings, section household: invite, join, unlink. An account then sees the inventories of the
// linked accounts; the rules for it live in the server (src/household).

/**
 * Inviting and joining need both sides: the main account creates, the other redeems. Depending on the role
 * only one of the boxes stands there — a button the server always rejects is worse than none.
 */
export async function loadHousehold() {
  const d = await api('GET', '/v2/settings/household');
  if (!d?.success) return;
  renderHousehold(d);
}

/**
 * The household card: parent accounts and sub-accounts are two independent sections, because an account can be both
 * at the same time. Below, the hint about accounts that were only visible via a chain and no longer
 * are.
 * @param {import('../../frontend-types/contract').HouseholdStatusResponse} d
 */
function renderHousehold(d) {
  const stateEl = G('household-state');
  const inviteEl = G('household-invite-box');
  const redeemEl = G('household-redeem-box');
  if (!stateEl) return;

  // A grid with rows as display:contents: names and buttons share two columns; the icon marks accounts.
  const list = (
    /** @type {{ id: number, username?: string | null, via?: string | null }[]} */ entries,
    /** @type {(a: { id: number, username?: string | null, via?: string | null }) => string} */ action,
  ) =>
    html`<ul class="household-list">${entries.map(
      a => html`<li data-style="display:contents">
      <span class="household-name"><svg class="ico" aria-hidden="true"><use href="#i-profile"/></svg>${a.username}</span>
      <span class="household-action">${rawHtml(action(a))}</span>
    </li>`,
    )}</ul>`;

  const parts = [];
  const parent = d.parents || (d.linked_to ? [d.linked_to] : []);
  if (parent.length) {
    parts.push(
      html`<div>${tRaw('household.state_parents', { n: parent.length })}${list(
        parent,
        a =>
          `<button class="btn bs btn-sm" data-click="unlinkFromParent"${genuine()} data-arg="${a.id}" data-arg2="${esc(a.username || '')}">${t('household.unlink_self')}</button>`,
      )}</div>`,
    );
  }
  if (d.sub_accounts?.length) {
    parts.push(
      html`${parent.length ? html`<div data-style="margin-top:.6rem">` : html`<div>`}${tRaw('household.state_main', { n: d.sub_accounts.length })}${list(
        d.sub_accounts,
        a =>
          `<button class="btn bs btn-sm" data-click="unlinkHousehold"${genuine()} data-arg="${a.id}" data-arg2="${esc(a.username || '')}">${t('household.unlink_sub')}</button>`,
      )}</div>`,
    );
  }
  if (!parts.length) {
    parts.push(html`<div data-style="color:var(--mut)">${t('household.state_none', { cur: d.currency || '' })}</div>`);
  }
  if (d.former_links?.length) {
    parts.push(html`<div role="note" data-style="margin-top:.8rem;padding:.6rem .8rem;border-radius:8px;background:var(--b100);color:var(--b600)">
      ${tRaw('household.former_intro')}${list(
        d.former_links,
        a => `<span data-style="color:var(--mut)">${a.via ? t('household.former_via', { via: a.via }) : ''}</span>
              <button class="btn bs btn-sm" data-click="dismissFormerLink" data-arg="${a.id}">${t('household.former_dismiss')}</button>`,
      )}
    </div>`);
  }
  setHtml(stateEl, joinHtml(parts));

  // Every account may invite and redeem: each of several parent accounts needs its own invitation.
  if (inviteEl) inviteEl.style.display = '';
  if (redeemEl) redeemEl.style.display = '';
}

export async function createHouseholdInvite() {
  const d = await api('POST', '/v2/settings/household/invite', {});
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  const out = G('household-invite-out');
  G('household-invite-code').value = d.code ?? '';
  if (out) out.style.display = '';
  toast(tRaw('household.invite_created'), 'success');
}

export async function copyHouseholdInvite() {
  const el = G('household-invite-code');
  if (!el?.value) return;
  // The clipboard can fail (no HTTPS, permission denied): then select instead of failing silently.
  try {
    await navigator.clipboard.writeText(el.value);
    toast(tRaw('household.invite_copied'), 'success');
  } catch (_) {
    el.select();
    toast(tRaw('household.invite_copy_manual'), 'info');
  }
}

export async function redeemHouseholdInvite() {
  const code = (G('household-redeem-code')?.value || '').trim();
  if (!code) {
    toast(tRaw('household.redeem_empty'), 'error');
    return;
  }
  // Resolve the code first: whoever agrees should know whom they are giving access.
  const p = await api('POST', '/v2/settings/household/redeem/check', { code });
  if (!p.success) {
    toast(p.error || t('settings.error'), 'error');
    return;
  }
  const name = p.inviter.username;
  // The main account then sees and changes the own collection — hence the question naming it.
  const yes = await confirmDelete(
    tRaw('household.redeem_question', { name }),
    tRaw('household.redeem_confirm_text', { name }),
    'link',
    { button: 'confirm.btn.invitation_accept', kind: 'bp' },
  );
  if (!yes) return;
  const d = await api('POST', '/v2/settings/household/redeem', { code });
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  G('household-redeem-code').value = '';
  // tRaw + raw name: the toast sets text, so esc() would show "Marco &amp; Co".
  const linked = /** @type {{ linked_to?: { username?: string } }} */ (d).linked_to;
  toast(tRaw('household.redeem_ok', { name: linked?.username || '' }), 'success');
  loadHousehold();
}

/**
 * @param {string} mainUserId
 * @param {string} name
 */
export async function unlinkFromParent(mainUserId, name) {
  if (
    !(await confirmDelete(
      tRaw('household.unlink_confirm_title', { name }),
      tRaw('household.unlink_confirm_text_parent', { name }),
      'link',
      { button: 'confirm.btn.link_unlink', kind: 'bp' },
    ))
  )
    return;
  const d = await api('POST', '/v2/settings/household/unlink', { main_user_id: parseInt(mainUserId, 10) });
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  toast(tRaw('household.unlink_ok'), 'success');
  loadHousehold();
}

/**
 * @param {string} subUserId
 */
export async function dismissFormerLink(subUserId) {
  const d = await api('POST', '/v2/settings/household/former/dismiss', { sub_user_id: parseInt(subUserId, 10) });
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  loadHousehold();
}

/**
 * @param {string} subUserId
 * @param {string} name
 */
export async function unlinkHousehold(subUserId, name) {
  if (
    !(await confirmDelete(
      tRaw('household.unlink_confirm_title', { name }),
      tRaw('household.unlink_confirm_text', { name }),
      'link',
      { button: 'confirm.btn.link_unlink', kind: 'bp' },
    ))
  )
    return;
  const d = await api(
    'POST',
    '/v2/settings/household/unlink',
    subUserId ? { sub_user_id: parseInt(subUserId, 10) } : {},
  );
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  toast(tRaw('household.unlink_ok'), 'success');
  loadHousehold();
}

registerActions({
  copyHouseholdInvite,
  createHouseholdInvite,
  redeemHouseholdInvite,
  unlinkHousehold,
  unlinkFromParent,
  dismissFormerLink,
});
