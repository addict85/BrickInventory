import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './01-api.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { fmtDatum } from './01-format.js';
import { feldFehler, passwortRegelText } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { ME } from './00-zustand.js';
import { html, ungeprueft } from './00-escapen.js';
import { bestaetigeMitPasswort, mitZweitemFaktor } from './01-rueckfrage.js';
// Einstellungen, Abschnitt Verwaltung: Konten anlegen, sperren, freischalten, Rechte. Nur Verwalter sehen
// ihn, der Server prüft jede Aktion selbst.
/** @typedef {import('../../frontend-typen/vertrag').KontoInListe} Konto */

// ── USER MGMT ─────────────────────────────────────────
export async function loadUsers(){
  const d=await api('GET','/v1/auth/users'); if(!d.success) return;
  // Der Name zuerst: Am Telefon ist er der Kartentitel (data-label leer), die ID steht nur am Rechner.
  setzeHtml(G('users-tbl'), html`<div class="tw"><table class="dt user-tbl" aria-label="${tRaw('settings.users_title')}"><thead><tr><th>${tRaw('users.col.username')}</th><th class="nutzer-id">ID</th><th>${tRaw('users.col.role')}</th><th>${tRaw('users.col.created')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.users.map(u=>html`<tr><td class="nutzer-name" data-label=""><strong>${u.username}</strong></td><td class="nutzer-id">${u.id}</td>
      <td><span class="rb ${u.is_admin ? 'rv' : 'ru'}">${u.is_admin ? tRaw('users.role.admin') : tRaw('users.role.user')}</span>
        ${u.is_active === false ? html`<span class="rb ru">${tRaw('users.status.inaktiv')}</span>` : ''}
        ${u.wartet_auf_bestaetigung ? html`<span class="rb ru">${tRaw('users.status.wartet')}</span>` : ''}</td>
      <td>${fmtDatum(u.created_at)}</td>
      <td>${nutzerAktionen(u)}</td></tr>`)}</tbody></table></div>`);
  ladeProtokoll();
}
// Ausgeschrieben statt zusammengesetzt, damit jeder Schlüssel als Aufruf im Quelltext steht und die
// Wörterbuchprüfung ihn findet.
const AKTIONEN = {
  konto_angelegt:          () => tRaw('users.aktion.konto_angelegt'),
  einstellungen_geaendert: () => tRaw('users.aktion.einstellungen_geaendert'),
  passwort_gesetzt:        () => tRaw('users.aktion.passwort_gesetzt'),
  zweiter_faktor_entfernt: () => tRaw('users.aktion.zweiter_faktor_entfernt'),
  verwalter_ernannt:       () => tRaw('users.aktion.verwalter_ernannt'),
  verwalter_entzogen:      () => tRaw('users.aktion.verwalter_entzogen'),
  konto_geloescht:         () => tRaw('users.aktion.konto_geloescht'),
  konto_deaktiviert:       () => tRaw('users.aktion.konto_deaktiviert'),
  konto_reaktiviert:       () => tRaw('users.aktion.konto_reaktiviert'),
  konto_freigeschaltet:    () => tRaw('users.aktion.konto_freigeschaltet'),
  gutschein_klartext:      () => tRaw('users.aktion.gutschein_klartext'),
  gutschein_pdf:           () => tRaw('users.aktion.gutschein_pdf'),
  gutschein_export:        () => tRaw('users.aktion.gutschein_export'),
};
/** Wer hat an welchem fremden Konto was geändert — die letzten Einträge. */
async function ladeProtokoll(){
  const d=await api('GET','/v1/admin/protokoll'); if(!d.success) return;
  const eintraege = d.eintraege || [];
  setzeHtml(G('vw-protokoll'), eintraege.length ? html`<div class="tw"><table class="dt" aria-label="${tRaw('users.protokoll')}"><thead><tr><th>${tRaw('users.protokoll.zeit')}</th><th>${tRaw('users.protokoll.verwalter')}</th><th>${tRaw('users.protokoll.aktion')}</th><th>${tRaw('users.protokoll.konto')}</th></tr></thead><tbody>${eintraege.map(e=>html`<tr><td>${fmtDatum(String(e.zeit), 'tagzeit')}</td><td>${e.verwalter_name||'—'}</td>
      <td>${((/** @type {Record<string, () => string>} */ (AKTIONEN))[String(e.aktion)] || (() => String(e.aktion)))()}${e.einzelheiten ? html`: ${e.einzelheiten}` : ''}</td><td>${e.ziel_name||'#'+e.ziel_id}</td></tr>`)}</tbody></table></div>` : html`<p data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('users.protokoll.leer')}</p>`);
}
/**
 * Gegen das eigene Konto gibt es hier nichts zu tun (der Server lehnt es ohnehin ab); das sagt die Zeile. Die
 * seltenen und harten Aktionen stehen hinter „Weitere“, damit eine Zeile nicht aus fünf Rahmenknöpfen
 * besteht.
 * @param {Konto} u
 */
function nutzerAktionen(u) {
  if (ME && u.id === ME.id) return html`<span class="text-klein">${tRaw('users.selbst')}</span>`;
  const selten = [
    nutzerKnopf(u, 'bs', 'toggleAktiv', u.is_active === false ? 'ok' : 'pause',
      u.is_active === false ? 'users.action.activate' : 'users.action.deactivate',
      u.is_active === false ? 'users.action.activate_title' : 'users.action.deactivate_title', u.is_active === false ? 0 : 1, u.username),
    u.zweiter_faktor ? nutzerKnopf(u, 'bs', 'zfZuruecksetzen', 'schloss', 'users.action.2fa', 'zf.reset_title', u.username) : '',
    nutzerKnopf(u, 'bd', 'delUser', 'loeschen', 'common.delete', 'users.action.delete_title', u.username),
  ].join('');
  return html`<div class="nutzer-aktionen">
    ${u.wartet_auf_bestaetigung ? nutzerKnopf(u, 'bp', 'kontoFreischalten', 'ok', 'users.action.freischalten', 'users.action.freischalten_title', u.username) : ''}
    ${nutzerKnopf(u, 'bs', 'openRpw', 'schluessel', 'users.action.password', 'users.pw_reset_title', u.username)}
    ${nutzerKnopf(u, 'bs', 'toggleAdmin', u.is_admin ? 'runter' : 'hoch',
      u.is_admin ? 'users.action.make_user' : 'users.action.make_admin',
      u.is_admin ? 'users.action.make_user_title' : 'users.action.make_admin_title', u.is_admin ? 1 : 0, u.username)}
    <details class="mehr-menue v-mehr"><summary class="btn bs btn-sm" aria-label="${tRaw('users.weitere', { name: u.username })}">${ico('menue')}<span>${tRaw('users.weitere_kurz')}</span></summary>
      <div class="mehr-liste">${ungeprueft(selten)}</div></details>
  </div>`;
}

/**
 * Ein Knopf der Benutzertabelle: Symbol und Wort sichtbar, die längere Beschreibung als Tooltip, der Name des
 * Kontos für Vorleser im Namen.
 * @param {Konto} u
 * @param {string} art
 * @param {string} klick
 * @param {string} symbol
 * @param {string} wortKey
 * @param {string} titelKey
 * @param {unknown} [arg2]
 * @param {unknown} [arg3]
 */
function nutzerKnopf(u, art, klick, symbol, wortKey, titelKey, arg2, arg3) {
  const wort = tRaw(wortKey), titel = tRaw(titelKey);
  return html`${html`<button type="button" class="btn ${art} btn-sm" data-click="${klick}"${echt()} data-arg="${u.id}"`}${html`${arg2 !== undefined ? html` data-arg2="${String(arg2)}"` : ''}`}${html`${arg3 !== undefined ? html` data-arg3="${String(arg3)}"` : ''} title="${titel}"`}${html` aria-label="${`${wort}: ${u.username}`}">${ico(symbol)}<span>${wort}</span></button>`}`;
}
G('btn-cu').onclick=async()=>{
  const n=G('nu-n').value.trim(),p=G('nu-p').value,a=G('nu-a').checked;
  // Die Regeln vor der Rückfrage und am Feld: Vorher kam „nur Buchstaben …“ erst nach Passwort und Code.
  if (!n || !/^[A-Za-z0-9_.-]{3,32}$/.test(n)) { feldFehler('nu-n', tRaw(n ? 'users.name_regel_fehler' : 'users.name_fehlt')); return; }
  const regel = p ? passwortRegelText(p) : tRaw('users.pw_fehlt');
  if (regel) { feldFehler('nu-p', regel); return; }
  const admin_password = await bestaetigeMitPasswort(tRaw('users.create_title'), tRaw('users.admin_confirm_text'), 'schloss', { knopf: 'confirm.btn.konto_anlegen', art: 'bp' });
  if (admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('POST','/v1/auth/users',{username:n,password:p,is_admin:a,admin_password,...z}));
  if(d===null) return;
  if(d.success){toast(tRaw('users.created',{name:n}),'success');G('nu-n').value=G('nu-p').value='';G('nu-a').checked=false;loadUsers();} else toast(d.error||t('settings.error'),'error');
};
/**
 * @param {string} uid
 * @param {string} name
 */
function openRpw(uid, name){
  G('rpw-uid').value=uid; G('rpw-uid').dataset.name = name || ''; G('rpw-v').value='';
  G('pw-tit').textContent = name ? tRaw('users.pw_reset_title_name', { name }) : tRaw('users.pw_reset_title');
  G('pw-modal').classList.add('open');
}
G('btn-rpw').onclick=async()=>{
  const neuesPw = G('rpw-v').value;
  const regel = passwortRegelText(neuesPw);
  if (regel) { toast(regel,'error');return;}
  const name = G('rpw-uid').dataset.name;
  const admin_password = await bestaetigeMitPasswort(name ? tRaw('users.reset_pw_title_name', { name }) : tRaw('users.reset_pw_title'), tRaw('users.admin_confirm_text'), 'schloss', { knopf: 'confirm.btn.passwort_setzen', art: 'bp' });
  if (admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('PUT',`/v1/auth/users/${G('rpw-uid').value}/password`,{password:neuesPw, admin_password, ...z}));
  if(d===null) return;
  if(d.success){toast(tRaw('users.pw_reset'),'success');G('pw-modal').classList.remove('open');} else toast(d.error||t('settings.error'),'error');
};
/**
 * @param {string} uid
 * @param {string | number | boolean} isAdmin
 * @param {string} name
 */
async function toggleAdmin(uid,isAdmin,name){
  // isAdmin kommt seit der data-arg-Umstellung als Zeichenkette. `!"0"` ist false — das Umschalten hätte
  // damit IMMER auf "kein Admin" gesetzt.
  const cur = isAdmin === true || isAdmin === 1 || isAdmin === '1';
  // Der Dialog nennt das Konto: Die Knöpfe sehen in jeder Zeile gleich aus.
  const titel = tRaw(cur ? 'users.role_title_entziehen' : 'users.role_title_geben', { name });
  const admin_password = await bestaetigeMitPasswort(titel, tRaw('users.admin_confirm_text'), 'schloss', { knopf: 'confirm.btn.rolle_aendern', art: 'bp' });
  if (admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('PUT',`/v1/auth/users/${uid}/admin`,{is_admin:!cur, admin_password, ...z})); if(d===null) return; if(d.success){toast(tRaw('users.role_changed'),'success');loadUsers();} else toast(d.error||t('settings.error'),'error'); }
/**
 * Deaktivieren meldet das Konto auf allen Geräten ab; die Daten bleiben.
 * @param {string} uid
 * @param {string} aktiv
 * @param {string} name
 */
async function toggleAktiv(uid, aktiv, name){
  const istAktiv = String(aktiv) === '1';
  const admin_password = await bestaetigeMitPasswort(
    tRaw(istAktiv ? 'users.deactivate_title' : 'users.activate_title', { name }), tRaw('users.admin_confirm_text'), 'schloss', { knopf: istAktiv ? 'confirm.btn.deaktivieren' : 'confirm.btn.aktivieren', art: 'bp' });
  if (admin_password === null) return;
  const d = await mitZweitemFaktor(z => api('PUT', `/v1/auth/users/${uid}/aktiv`, { is_active: !istAktiv, admin_password, ...z }));
  if (d === null) return;
  if (d.success) { toast(tRaw(istAktiv ? 'users.deactivated' : 'users.activated'), 'success'); loadUsers(); }
  else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function kontoFreischalten(uid, name){
  const admin_password = await bestaetigeMitPasswort(tRaw('users.freischalten_title', { name }), tRaw('users.freischalten_text', { name }), 'ok',
    { knopf: 'confirm.btn.freischalten', art: 'bp' });
  if (admin_password === null) return;
  const d = await mitZweitemFaktor(z => api('PUT', `/v1/auth/users/${uid}/freischalten`, { admin_password, ...z }));
  if (d === null) return;
  if (d.success) { toast(tRaw('users.freigeschaltet', { name }), 'success'); loadUsers(); }
  else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function delUser(uid,name){
  const admin_password = await bestaetigeMitPasswort(tRaw('users.delete.title', { name }), tRaw('users.delete.text'), 'profil',
    { knopf: 'confirm.btn.konto_name_loeschen', werte: { name }, art: 'bd' });
  if(admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('DELETE',`/v1/auth/users/${uid}`,{admin_password, ...z}));
  if(d===null) return;
  if(d.success){toast(tRaw('users.deleted', { name }),'success');loadUsers();} else toast(d.error||t('settings.error'),'error');
}

registerActions({
  delUser,
  kontoFreischalten,
  openRpw,
  toggleAdmin,
  toggleAktiv,
});
