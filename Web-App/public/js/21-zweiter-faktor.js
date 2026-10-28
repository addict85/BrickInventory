import { registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { ico, G, api, esc, toast } from './01-core.js';
import { confirmDelete, bestaetigeMitPasswort } from './07-admin.js';
import { loadUsers } from './05-settings.js';

// ═══ Zweiter Faktor im Profil (Server: utils/zweiterFaktor.ts) ══════════════
// Ablauf: Passwort → QR-Code und Schlüssel → Code bestätigen → die zehn
// Wiederherstellungscodes einmal zeigen. Danach: abschalten oder neue Codes.

const flaeche = () => G('zf-flaeche');

function zeichne(html) { const f = flaeche(); if (f) f.innerHTML = html; }

const knopf = (aktion, text, art = 'bs') =>
  `<button type="button" class="btn ${art} btn-sm" data-click="${aktion}">${text}</button>`;
// Die Felder stehen ausgeschrieben da, nicht über einen Helfer: test/dom-ids.test.js
// findet nur wörtliche id-Angaben.
const PASSWORTFELD = () =>
  `<div class="fg"><label for="zf-pw">${t('settings.password.current')}</label><input type="password" id="zf-pw" autocomplete="current-password" /></div>`;
const CODEFELD = (label, laenge = 12) =>
  `<div class="fg"><label for="zf-code">${label}</label><input type="text" id="zf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${laenge}" data-erstfokus /></div>`;

export async function ladeZweitenFaktor() {
  if (!flaeche()) return;
  const d = await api('GET', '/v1/auth/zweiter-faktor');
  if (!d?.success) { zeichne(`<div class="voucher-leer">${t('settings.error')}</div>`); return; }
  if (!d.aktiv) {
    zeichne(`<form class="sform" data-submit="zf-start" style="max-width:420px">
      ${PASSWORTFELD()}
      <div><button type="button" class="btn bp btn-sm" id="zf-start" data-click="zfEinrichten">${t('zf.setup')}</button></div>
    </form>`);
    return;
  }
  zeichne(`<p style="font-size:var(--fs-3);margin:0 0 .75rem 0">${ico('ok')} ${esc(tRaw('zf.active', { n: d.codes_uebrig }))}</p>
    <form class="sform" style="max-width:420px">
      ${PASSWORTFELD()}
      ${CODEFELD(t('login.code'))}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${knopf('zfNeueCodes', t('zf.new_codes'))}
        ${knopf('zfAbschalten', t('zf.disable'), 'bd')}
      </div>
    </form>`);
}

export async function zfEinrichten() {
  const d = await api('POST', '/v1/auth/zweiter-faktor/einrichten', { password: G('zf-pw')?.value || '' });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Gruppiert lesbar, falls jemand den Schlüssel von Hand eintippt.
  const lesbar = d.geheimnis.replace(/(.{4})/g, '$1 ').trim();
  zeichne(`<div class="sform" style="max-width:420px">
      <p style="font-size:var(--fs-2);margin:0">${t('zf.scan')}</p>
      <div id="zf-qr" style="background:#fff;padding:8px;align-self:flex-start;border-radius:8px"></div>
      <div style="font-size:var(--fs-1);color:var(--mut)">${t('zf.manual')}<br><code style="user-select:all;font-size:var(--fs-3)">${esc(lesbar)}</code></div>
      ${CODEFELD(t('zf.confirm_code'), 6)}
      <div style="display:flex;gap:.5rem">
        <button type="button" class="btn bp btn-sm" data-click="zfBestaetigen">${t('zf.confirm')}</button>
        ${knopf('ladeZweitenFaktor', t('common.cancel'))}
      </div>
    </div>`);
  const qr = G('zf-qr');
  if (qr && typeof QRCode !== 'undefined') {
    new QRCode(qr, { text: d.otpauth, width: 200, height: 200, colorDark: '#1e293b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } else if (qr) qr.textContent = d.otpauth;
  G('zf-code')?.focus();
}

function zeigeCodes(codes) {
  zeichne(`<div class="sform" style="max-width:420px">
      <p style="font-size:var(--fs-2);margin:0"><strong>${t('zf.codes_title')}</strong><br>${t('zf.codes_hint')}</p>
      <pre id="zf-codes" style="font-size:var(--fs-3);line-height:1.6;background:var(--s50,#f8fafc);border:1px solid var(--bdr);border-radius:8px;padding:.6rem .9rem;margin:0;user-select:all">${codes.map(esc).join('\n')}</pre>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${knopf('zfCodesKopieren', t('zf.copy'))}
        <button type="button" class="btn bp btn-sm" data-click="ladeZweitenFaktor">${t('zf.codes_done')}</button>
      </div>
    </div>`);
}

export async function zfBestaetigen() {
  const d = await api('POST', '/v1/auth/zweiter-faktor/bestaetigen', { code: G('zf-code')?.value || '' });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw('zf.enabled'), 'success');
  zeigeCodes(d.codes);
}

export async function zfNeueCodes() {
  const d = await api('POST', '/v1/auth/zweiter-faktor/codes', { code: G('zf-code')?.value || '' });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  zeigeCodes(d.codes);
}

export async function zfAbschalten() {
  const password = G('zf-pw')?.value || '', code = G('zf-code')?.value || '';
  if (!await confirmDelete(tRaw('zf.disable'), t('zf.disable_confirm'), 'schloss')) return;
  const d = await api('POST', '/v1/auth/zweiter-faktor/abschalten', { password, code });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw('zf.disabled'), 'success');
  await ladeZweitenFaktor();
}

export async function zfCodesKopieren() {
  const text = G('zf-codes')?.textContent || '';
  try { await navigator.clipboard.writeText(text); toast(tRaw('zf.copied'), 'success'); }
  catch { toast(tRaw('zf.copy_failed'), 'error'); }
}

/** Verwalter: den zweiten Faktor eines Kontos entfernen (Telefon und Codes verloren). */
export async function zfZuruecksetzen(uid, name) {
  const admin_password = await bestaetigeMitPasswort(tRaw('zf.reset_title'), tRaw('zf.reset_text', { name }), 'schloss');
  if (admin_password === null) return;
  const d = await api('DELETE', `/v1/auth/users/${uid}/zweiter-faktor`, { admin_password });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw('zf.disabled'), 'success');
  loadUsers();
}

registerActions({ ladeZweitenFaktor, zfEinrichten, zfBestaetigen, zfNeueCodes, zfAbschalten, zfCodesKopieren, zfZuruecksetzen });
