import { echt, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum } from './format.js';
import { feldFehler, passwordRuleText } from './form.js';
import { toast } from './messages.js';
import { loggedInAccount } from './state.js';
import { html, rawHtml } from './escaping.js';
import { bestaetigeMitPasswort, withSecondFactor } from './confirm-prompt.js';
// Settings, Administration section: create, lock, unlock accounts, manage rights. Only
// administrators see it — the server checks every action itself.
/** @typedef {import('../../frontend-typen/vertrag').KontoInListe} Konto */

// ── USER MGMT ─────────────────────────────────────────
export async function loadUsers() {
  const d = await api('GET', '/v1/auth/users');
  if (!d.success) return;
  // The name comes first: on the phone it's the card title (data-label empty), the ID only shows on desktop.
  setzeHtml(
    G('users-tbl'),
    html`<div class="tw"><table class="dt user-tbl" aria-label="${tRaw('settings.users_title')}"><thead><tr><th>${tRaw('users.col.username')}</th><th class="nutzer-id">ID</th><th>${tRaw('users.col.role')}</th><th>${tRaw('users.col.created')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.users.map(
      u => html`<tr><td class="nutzer-name" data-label=""><strong>${u.username}</strong></td><td class="nutzer-id">${u.id}</td>
      <td><div class="rollen-zelle">${role(u)}
        ${u.is_active === false ? html`<span class="rb ru">${tRaw('users.status.inaktiv')}</span>` : ''}
        ${u.wartet_auf_bestaetigung ? html`<span class="rb ru">${tRaw('users.status.wartet')}</span>` : ''}
        ${announced(u)}</div></td>
      <td>${fmtDatum(u.created_at)}</td>
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
 * @param {Konto} u
 */
function role(u) {
  const self = !!loggedInAccount && u.id === loggedInAccount.id;
  const target = html`data-click="toggleAdmin"${echt()} data-arg="${u.id}" data-arg2="${u.is_admin ? '1' : '0'}" data-arg3="${u.username}"`;
  if (!u.is_admin) {
    const name = tRaw('users.rolle.ernennen', { name: u.username });
    return html`<span class="rb ru">${tRaw('users.role.user')}</span>${
      self
        ? ''
        : html`<button type="button" class="btn bs btn-sm" ${target} title="${name}" aria-label="${name}">${ico('plus')}<span>${tRaw('users.role.admin')}</span></button>`
    }`;
  }
  const name = tRaw('users.rolle.entziehen', { name: u.username });
  return html`<span class="rb rv rolle-chip"><span class="rolle-wort">${tRaw('users.role.admin')}</span>${
    self
      ? ''
      : html`<button type="button" class="chip-weg" ${target} title="${name}" aria-label="${name}">${ico('schliessen')}</button>`
  }</span>`;
}
/** @type {Record<string, () => string>} */
const ANNOUNCED = {
  passwort: () => tRaw('users.angekuendigt.passwort'),
  zweiter_faktor: () => tRaw('users.angekuendigt.zweiter_faktor'),
  deaktivieren: () => tRaw('users.angekuendigt.deaktivieren'),
  rolle_entziehen: () => tRaw('users.angekuendigt.rolle_entziehen'),
  loeschen: () => tRaw('users.angekuendigt.loeschen'),
};
/**
 * What is announced on an administrator account (24 h): the other administrators should see
 * it, not only learn of it by mail.
 * @param {Konto} u
 */
function announced(u) {
  return (u.angekuendigt ?? []).map(
    a =>
      html`<span class="rb ru">${tRaw('users.angekuendigt', { was: (ANNOUNCED[a.type] || (() => a.type))(), zeit: fmtDatum(a.effective_at, 'tagzeit') })}</span>`,
  );
}
/** The response to an administrator action: announced (administrator account) or immediate.
 *  @param {{ effective_at?: string }} d @param {string} immediate */
const reportResult = (d, immediate) =>
  toast(
    d.effective_at ? tRaw('users.uebernahme_spaeter', { zeit: fmtDatum(d.effective_at, 'tagzeit') }) : immediate,
    'success',
  );
// Written out rather than assembled, so each key appears as a literal call in the source and
// the dictionary check (i18n-calls.test.js) finds it.
/** @type {Record<string, () => string>} */
const ACTIONS = {
  konto_angelegt: () => tRaw('users.aktion.konto_angelegt'),
  einstellungen_geaendert: () => tRaw('users.aktion.einstellungen_geaendert'),
  passwort_gesetzt: () => tRaw('users.aktion.passwort_gesetzt'),
  zweiter_faktor_entfernt: () => tRaw('users.aktion.zweiter_faktor_entfernt'),
  verwalter_ernannt: () => tRaw('users.aktion.verwalter_ernannt'),
  verwalter_entzogen: () => tRaw('users.aktion.verwalter_entzogen'),
  konto_geloescht: () => tRaw('users.aktion.konto_geloescht'),
  konto_deaktiviert: () => tRaw('users.aktion.konto_deaktiviert'),
  konto_reaktiviert: () => tRaw('users.aktion.konto_reaktiviert'),
  konto_freigeschaltet: () => tRaw('users.aktion.konto_freigeschaltet'),
  gutschein_klartext: () => tRaw('users.aktion.gutschein_klartext'),
  gutschein_pdf: () => tRaw('users.aktion.gutschein_pdf'),
  gutschein_export: () => tRaw('users.aktion.gutschein_export'),
  uebernahme_angekuendigt: () => tRaw('users.aktion.uebernahme_angekuendigt'),
  uebernahme_abgebrochen: () => tRaw('users.aktion.uebernahme_abgebrochen'),
};
/** Who changed what on which other account — the most recent entries. */
async function loadLog() {
  const d = await api('GET', '/v1/admin/protokoll');
  if (!d.success) return;
  const entries = d.eintraege || [];
  setzeHtml(
    G('vw-protokoll'),
    entries.length
      ? html`<div class="tw"><table class="dt" aria-label="${tRaw('users.protokoll')}"><thead><tr><th>${tRaw('users.protokoll.zeit')}</th><th>${tRaw('users.protokoll.verwalter')}</th><th>${tRaw('users.protokoll.aktion')}</th><th>${tRaw('users.protokoll.konto')}</th></tr></thead><tbody>${entries.map(
          e => html`<tr><td>${fmtDatum(String(e.occurred_at), 'tagzeit')}</td><td>${e.verwalter_name || '—'}</td>
      <td>${(ACTIONS[String(e.action)] || (() => String(e.action)))()}${e.details ? html`: ${e.details}` : ''}</td><td>${e.target_name || '#' + e.target_id}</td></tr>`,
        )}</tbody></table></div>`
      : html`<p data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('users.protokoll.leer')}</p>`,
  );
}
/**
 * There's nothing to do here against your own account (the server rejects it regardless);
 * the row says so. The rare and heavy actions sit behind "More", so a row isn't made up of
 * five framed buttons.
 * @param {Konto} u
 */
function userActions(u) {
  if (loggedInAccount && u.id === loggedInAccount.id)
    return html`<span class="text-klein">${tRaw('users.selbst')}</span>`;
  const rare = [
    userButton(
      u,
      'bs',
      'toggleAktiv',
      u.is_active === false ? 'ok' : 'pause',
      u.is_active === false ? 'users.action.activate' : 'users.action.deactivate',
      u.is_active === false ? 'users.action.activate_title' : 'users.action.deactivate_title',
      u.is_active === false ? 0 : 1,
      u.username,
    ),
    u.zweiter_faktor
      ? userButton(u, 'bs', 'zfZuruecksetzen', 'schloss', 'users.action.2fa', 'zf.reset_title', u.username)
      : '',
    userButton(u, 'bd', 'delUser', 'loeschen', 'common.delete', 'users.action.delete_title', u.username),
  ].join('');
  return html`<div class="nutzer-aktionen">
    ${u.wartet_auf_bestaetigung ? userButton(u, 'bp', 'kontoFreischalten', 'ok', 'users.action.freischalten', 'users.action.freischalten_title', u.username) : ''}
    ${userButton(u, 'bs', 'openRpw', 'schluessel', 'users.action.password', 'users.pw_reset_title', u.username)}
    <details class="mehr-menue v-mehr"><summary class="btn bs btn-sm" aria-label="${tRaw('users.weitere', { name: u.username })}">${ico('menue')}<span>${tRaw('users.weitere_kurz')}</span></summary>
      <div class="mehr-liste">${rawHtml(rare)}</div></details>
  </div>`;
}

/**
 * A button of the user table: icon and word visible, the longer description as a tooltip,
 * the account's name in there for screen readers.
 * @param {Konto} u
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
  return html`${html`<button type="button" class="btn ${kind} btn-sm" data-click="${click}"${echt()} data-arg="${u.id}"`}${html`${arg2 !== undefined ? html` data-arg2="${String(arg2)}"` : ''}`}${html`${arg3 !== undefined ? html` data-arg3="${String(arg3)}"` : ''} title="${title}"`}${html` aria-label="${`${word}: ${u.username}`}">${ico(icon)}<span>${word}</span></button>`}`;
}
/**
 * The message takes the place of the rule hint below it: together they'd say the same thing twice.
 * @param {string} id @param {string | null} text
 */
function ruleError(id, text) {
  feldFehler(id, text || '');
  const rule = G(`${id}-regel`);
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
    n && /^[A-Za-z0-9_.-]{3,32}$/.test(n) ? '' : tRaw(n ? 'users.name_regel_fehler' : 'users.name_fehlt');
  const pwError = p ? passwordRuleText(p) : tRaw('users.pw_fehlt');
  ruleError('nu-p', pwError);
  ruleError('nu-n', nameError);
  if (nameError || pwError) return;
  const admin_password = await bestaetigeMitPasswort(
    tRaw('users.create_title'),
    tRaw('users.admin_confirm_text'),
    'schloss',
    { knopf: 'confirm.btn.konto_anlegen', art: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('POST', '/v1/auth/users', { username: n, password: p, is_admin: a, admin_password, ...z }),
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
  const admin_password = await bestaetigeMitPasswort(
    name ? tRaw('users.reset_pw_title_name', { name }) : tRaw('users.reset_pw_title'),
    tRaw('users.admin_confirm_text'),
    'schloss',
    { knopf: 'confirm.btn.passwort_setzen', art: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('PUT', `/v1/auth/users/${G('rpw-uid').value}/password`, { password: newPw, admin_password, ...z }),
  );
  if (d === null) return;
  if (d.success) {
    toast(
      d.effective_at
        ? tRaw('users.uebernahme_spaeter', { zeit: fmtDatum(d.effective_at, 'tagzeit') })
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
  const title = tRaw(cur ? 'users.role_title_entziehen' : 'users.role_title_geben', { name });
  const admin_password = await bestaetigeMitPasswort(title, tRaw('users.admin_confirm_text'), 'schloss', {
    knopf: 'confirm.btn.rolle_aendern',
    art: 'bp',
  });
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('PUT', `/v1/auth/users/${uid}/admin`, { is_admin: !cur, admin_password, ...z }),
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
async function toggleAktiv(uid, active, name) {
  const isActive = String(active) === '1';
  const admin_password = await bestaetigeMitPasswort(
    tRaw(isActive ? 'users.deactivate_title' : 'users.activate_title', { name }),
    tRaw('users.admin_confirm_text'),
    'schloss',
    { knopf: isActive ? 'confirm.btn.deaktivieren' : 'confirm.btn.aktivieren', art: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z =>
    api('PUT', `/v1/auth/users/${uid}/aktiv`, { is_active: !isActive, admin_password, ...z }),
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
async function kontoFreischalten(uid, name) {
  const admin_password = await bestaetigeMitPasswort(
    tRaw('users.freischalten_title', { name }),
    tRaw('users.freischalten_text', { name }),
    'ok',
    { knopf: 'confirm.btn.freischalten', art: 'bp' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z => api('PUT', `/v1/auth/users/${uid}/freischalten`, { admin_password, ...z }));
  if (d === null) return;
  if (d.success) {
    toast(tRaw('users.freigeschaltet', { name }), 'success');
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function delUser(uid, name) {
  const admin_password = await bestaetigeMitPasswort(
    tRaw('users.delete.title', { name }),
    tRaw('users.delete.text'),
    'profil',
    { knopf: 'confirm.btn.konto_name_loeschen', werte: { name }, art: 'bd' },
  );
  if (admin_password === null) return;
  const d = await withSecondFactor(z => api('DELETE', `/v1/auth/users/${uid}`, { admin_password, ...z }));
  if (d === null) return;
  if (d.success) {
    reportResult(d, tRaw('users.deleted', { name }));
    loadUsers();
  } else toast(d.error || t('settings.error'), 'error');
}

registerActions({
  delUser,
  kontoFreischalten,
  openRpw,
  toggleAdmin,
  toggleAktiv,
});
