import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { fmtDate } from './format.js';
import { fieldError, passwordRuleText } from './form.js';
import { toast } from './messages.js';
import { loggedInAccount } from './state.js';
import { html, rawHtml } from './escaping.js';
import { confirmDeleteWithPassword, withSecondFactor } from './confirm-prompt.js';
// Settings, Administration section: create, lock, unlock accounts, manage rights. Only
// administrators see it — the server checks every action itself.
/** @typedef {import('../../frontend-types/contract').AccountInList} Account */

// ── USER MGMT ─────────────────────────────────────────
export async function loadUsers() {
  const d = await api('GET', '/v2/auth/users');
  if (!d.success) return;
  // The name comes first: on the phone it's the card title (data-label empty), the ID only shows on desktop.
  setHtml(
    G('users-tbl'),
    html`<div class="tw"><table class="dt user-tbl" aria-label="${tRaw('settings.users_title')}"><thead><tr><th>${tRaw('users.col.username')}</th><th class="user-id">ID</th><th>${tRaw('users.col.role')}</th><th>${tRaw('users.col.created')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.users.map(
      u => html`<tr><td class="user-name" data-label=""><strong>${u.username}</strong></td><td class="user-id">${u.id}</td>
      <td><div class="roles-cell">${role(u)}
        ${u.is_active === false ? html`<span class="rb ru">${tRaw('users.status.inactive')}</span>` : ''}
        ${u.awaiting_confirmation ? html`<span class="rb ru">${tRaw('users.status.waiting')}</span>` : ''}
        ${announced(u)}</div></td>
      <td>${fmtDate(u.created_at)}</td>
      <td>${userActions(u)}</td></tr>`,
    )}</tbody></table></div>`,
  );
  loadLog();
}
/**
 * The role as a chip: revoked via the X, granted with the button next to it — right where
 * the role is read. There's no button against your own account. That also covers the last
 * active administrator: only administrators see this list, so the last one is always the
 * viewer themself. The server checks both.
 * @param {Account} u
 */
function role(u) {
  const self = !!loggedInAccount && u.id === loggedInAccount.id;
  const target = html`data-click="toggleAdmin"${genuine()} data-arg="${u.id}" data-arg2="${u.is_admin ? '1' : '0'}" data-arg3="${u.username}"`;
  if (!u.is_admin) {
    const name = tRaw('users.role.appoint', { name: u.username });
    return html`<span class="rb ru">${tRaw('users.role.user')}</span>${
      self
        ? ''
        : html`<button type="button" class="btn bs btn-sm" ${target} title="${name}" aria-label="${name}">${ico('plus')}<span>${tRaw('users.role.admin')}</span></button>`
    }`;
  }
  const name = tRaw('users.role.revoke', { name: u.username });
  return html`<span class="rb rv role-chip"><span class="role-word">${tRaw('users.role.admin')}</span>${
    self
      ? ''
      : html`<button type="button" class="chip-remove" ${target} title="${name}" aria-label="${name}">${ico('close')}</button>`
  }</span>`;
}
/** @type {Record<string, () => string>} */
const ANNOUNCED = {
  password: () => tRaw('users.announced.password'),
  second_factor: () => tRaw('users.announced.second_factor'),
  deactivate: () => tRaw('users.announced.deactivate'),
  revoke_role: () => tRaw('users.announced.role_revoke'),
  delete: () => tRaw('users.announced.delete'),
};
/**
 * What is announced on an administrator account (24 h): the other administrators should see
 * it, not only learn of it by mail.
 * @param {Account} u
 */
function announced(u) {
  return (u.announced ?? []).map(
    a =>
      html`<span class="rb ru">${tRaw('users.announced', { was: (ANNOUNCED[a.type] || (() => a.type))(), time: fmtDate(a.effective_at, 'datetime') })}</span>`,
  );
}
/** The response to an administrator action: announced (administrator account) or immediate.
 *  @param {{ effective_at?: string }} d @param {string} immediate */
const reportResult = (d, immediate) =>
  toast(
    d.effective_at ? tRaw('users.takeover_later', { time: fmtDate(d.effective_at, 'datetime') }) : immediate,
    'success',
  );
// Written out rather than assembled, so each key appears as a literal call in the source and
// the dictionary check (i18n-calls.test.js) finds it.
/** @type {Record<string, () => string>} */
const ACTIONS = {
  account_created: () => tRaw('users.action.account_created'),
  settings_changed: () => tRaw('users.action.settings_changed'),
  password_set: () => tRaw('users.action.password_set'),
  second_factor_removed: () => tRaw('users.action.second_factor_removed'),
  admin_appointed: () => tRaw('users.action.admin_appointed'),
  admin_revoked: () => tRaw('users.action.admin_revoked'),
  account_deleted: () => tRaw('users.action.account_deleted'),
  account_deactivated: () => tRaw('users.action.account_deactivated'),
  account_reactivated: () => tRaw('users.action.account_reactivated'),
  account_unlocked: () => tRaw('users.action.account_unlocked'),
  voucher_plaintext: () => tRaw('users.action.voucher_plain_text'),
  voucher_pdf: () => tRaw('users.action.voucher_pdf'),
  voucher_export: () => tRaw('users.action.voucher_export'),
  takeover_announced: () => tRaw('users.action.takeover_announced'),
  takeover_cancelled: () => tRaw('users.action.takeover_cancelled'),
};
/** Who changed what on which other account — the most recent entries. */
async function loadLog() {
  const d = await api('GET', '/v2/admin/audit-log');
  if (!d.success) return;
  const entries = d.entries || [];
  setHtml(
    G('vw-log'),
    entries.length
      ? html`<div class="tw"><table class="dt" aria-label="${tRaw('users.log')}"><thead><tr><th>${tRaw('users.log.time')}</th><th>${tRaw('users.log.admin')}</th><th>${tRaw('users.log.action')}</th><th>${tRaw('users.log.account')}</th></tr></thead><tbody>${entries.map(
          e => html`<tr><td>${fmtDate(String(e.occurred_at), 'datetime')}</td><td>${e.verwalter_name || '—'}</td>
      <td>${(ACTIONS[String(e.action)] || (() => String(e.action)))()}${e.details ? html`: ${e.details}` : ''}</td><td>${e.target_name || '#' + e.target_id}</td></tr>`,
        )}</tbody></table></div>`
      : html`<p data-style="color:var(--mut);font-size:var(--fs-2)">${tRaw('users.log.empty')}</p>`,
  );
}
/**
 * There's nothing to do here against your own account (the server rejects it regardless);
 * the row says so. The rare and heavy actions sit behind "More", so a row isn't made up of
 * five framed buttons.
 * @param {Account} u
 */
function userActions(u) {
  if (loggedInAccount && u.id === loggedInAccount.id)
    return html`<span class="text-small">${tRaw('users.self')}</span>`;
  const rare = [
    userButton(
      u,
      'bs',
      'toggleActive',
      u.is_active === false ? 'ok' : 'pause',
      u.is_active === false ? 'users.action.activate' : 'users.action.deactivate',
      u.is_active === false ? 'users.action.activate_title' : 'users.action.deactivate_title',
      u.is_active === false ? 0 : 1,
      u.username,
    ),
    u.second_factor
      ? userButton(u, 'bs', 'resetSecondFactor', 'lock', 'users.action.2fa', 'sf.reset_title', u.username)
      : '',
    userButton(u, 'bd', 'delUser', 'delete', 'common.delete', 'users.action.delete_title', u.username),
  ].join('');
  return html`<div class="user-actions">
    ${u.awaiting_confirmation ? userButton(u, 'bp', 'unlockAccount', 'ok', 'users.action.unlock', 'users.action.unlock_title', u.username) : ''}
    ${userButton(u, 'bs', 'openRpw', 'key', 'users.action.password', 'users.pw_reset_title', u.username)}
    <details class="more-menu v-more"><summary class="btn bs btn-sm" aria-label="${tRaw('users.more', { name: u.username })}">${ico('menu')}<span>${tRaw('users.more_short')}</span></summary>
      <div class="more-list">${rawHtml(rare)}</div></details>
  </div>`;
}

/**
 * A button of the user table: icon and word visible, the longer description as a tooltip,
 * the account's name in there for screen readers.
 * @param {Account} u
 * @param {string} kind
 * @param {string} click
 * @param {string} icon
 * @param {string} wordKey
 * @param {string} titleKey
 * @param {unknown} [arg2]
 * @param {unknown} [arg3]
 */
function userButton(u, kind, click, icon, wordKey, titleKey, arg2, arg3) {
  const word = tRaw(wordKey),
    title = tRaw(titleKey);
  return html`${html`<button type="button" class="btn ${kind} btn-sm" data-click="${click}"${genuine()} data-arg="${u.id}"`}${html`${arg2 !== undefined ? html` data-arg2="${String(arg2)}"` : ''}`}${html`${arg3 !== undefined ? html` data-arg3="${String(arg3)}"` : ''} title="${title}"`}${html` aria-label="${`${word}: ${u.username}`}">${ico(icon)}<span>${word}</span></button>`}`;
}
/**
 * The message takes the place of the rule hint below it: together they'd say the same thing twice.
 * @param {string} id @param {string | null} text
 */
function ruleError(id, text) {
  fieldError(id, text || '');
  const rule = G(`${id}-rule`);
  if (!rule) return;
  rule.hidden = !!text;
  G(id).addEventListener('input', () => (rule.hidden = false), { once: true });
}
G('btn-cu').onclick = async () => {
  const n = G('nu-n').value.trim(),
    p = G('nu-p').value,
    a = G('nu-a').checked;
  // The rules before the confirmation prompt, all at once and each on its own field; the
  // name gets focus last, since it's reported last.
  const nameError =
    n && /^[A-Za-z0-9_.-]{3,32}$/.test(n) ? '' : tRaw(n ? 'users.name_rule_error' : 'users.name_missing');
  const pwError = p ? passwordRuleText(p) : tRaw('users.pw_missing');
  ruleError('nu-p', pwError);
  ruleError('nu-n', nameError);
  if (nameError || pwError) return;
  const admin_password = await confirmDeleteWithPassword(
    tRaw('users.create_title'),
    tRaw('users.admin_confirm_text'),
    'lock',
    { button: 'confirm.btn.account_create', kind: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('POST', '/v2/auth/users', { username: n, password: p, is_admin: a, admin_password, ...z }),
  );
  if (d === null) return;
  if (d.success) {
    toast(tRaw('users.created', { name: n }), 'success');
    G('nu-n').value = G('nu-p').value = '';
    G('nu-a').checked = false;
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
};
/**
 * @param {string} uid
 * @param {string} name
 */
function openRpw(uid, name) {
  G('rpw-uid').value = uid;
  G('rpw-uid').dataset.name = name || '';
  G('rpw-v').value = '';
  G('pw-tit').textContent = name ? tRaw('users.pw_reset_title_name', { name }) : tRaw('users.pw_reset_title');
  G('pw-modal').classList.add('open');
}
G('btn-rpw').onclick = async () => {
  const newPw = G('rpw-v').value;
  const rule = passwordRuleText(newPw);
  if (rule) {
    toast(rule, 'error');
    return;
  }
  const name = G('rpw-uid').dataset.name;
  const admin_password = await confirmDeleteWithPassword(
    name ? tRaw('users.reset_pw_title_name', { name }) : tRaw('users.reset_pw_title'),
    tRaw('users.admin_confirm_text'),
    'lock',
    { button: 'confirm.btn.password_set', kind: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('PUT', `/v2/auth/users/${G('rpw-uid').value}/password`, { password: newPw, admin_password, ...z }),
  );
  if (d === null) return;
  if (d.success) {
    toast(
      d.effective_at
        ? tRaw('users.takeover_later', { time: fmtDate(d.effective_at, 'datetime') })
        : tRaw('users.pw_reset'),
      'success',
    );
    G('pw-modal').classList.remove('open');
  } else toast(d.error || t('settings.error'), 'error');
};
/**
 * @param {string} uid
 * @param {string | number | boolean} isAdmin
 * @param {string} name
 */
async function toggleAdmin(uid, isAdmin, name) {
  // isAdmin has been a string since the data-arg switch. `!"0"` is false — toggling would
  // then ALWAYS land on "not admin".
  const cur = isAdmin === true || isAdmin === 1 || isAdmin === '1';
  // The dialog names the account: the buttons look the same in every row.
  const title = tRaw(cur ? 'users.role_title_revoke' : 'users.role_title_give', { name });
  const admin_password = await confirmDeleteWithPassword(title, tRaw('users.admin_confirm_text'), 'lock', {
    button: 'confirm.btn.role_change',
    kind: 'bp',
  });
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('PUT', `/v2/auth/users/${uid}/admin`, { is_admin: !cur, admin_password, ...z }),
  );
  if (d === null) return;
  if (d.success) {
    reportResult(d, tRaw('users.role_changed'));
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
}
/**
 * Deactivating signs the account out on every device; the data stays.
 * @param {string} uid
 * @param {string} active
 * @param {string} name
 */
async function toggleActive(uid, active, name) {
  const isActive = String(active) === '1';
  const admin_password = await confirmDeleteWithPassword(
    tRaw(isActive ? 'users.deactivate_title' : 'users.activate_title', { name }),
    tRaw('users.admin_confirm_text'),
    'lock',
    { button: isActive ? 'confirm.btn.deactivate' : 'confirm.btn.activate', kind: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('PUT', `/v2/auth/users/${uid}/active`, { is_active: !isActive, admin_password, ...z }),
  );
  if (d === null) return;
  if (d.success) {
    reportResult(d, tRaw(isActive ? 'users.deactivated' : 'users.activated'));
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function unlockAccount(uid, name) {
  const admin_password = await confirmDeleteWithPassword(
    tRaw('users.unlock_title', { name }),
    tRaw('users.unlock_text', { name }),
    'ok',
    { button: 'confirm.btn.unlock', kind: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z => api('PUT', `/v2/auth/users/${uid}/approve`, { admin_password, ...z }));
  if (d === null) return;
  if (d.success) {
    toast(tRaw('users.unlocked', { name }), 'success');
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function delUser(uid, name) {
  const admin_password = await confirmDeleteWithPassword(
    tRaw('users.delete.title', { name }),
    tRaw('users.delete.text'),
    'profile',
    { button: 'confirm.btn.account_name_delete', values: { name }, kind: 'bd' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z => api('DELETE', `/v2/auth/users/${uid}`, { admin_password, ...z }));
  if (d === null) return;
  if (d.success) {
    reportResult(d, tRaw('users.deleted', { name }));
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
}

registerActions({
  delUser,
  unlockAccount,
  openRpw,
  toggleAdmin,
  toggleActive,
});
