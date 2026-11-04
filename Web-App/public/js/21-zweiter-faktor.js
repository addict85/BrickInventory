import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { ico, G, api, esc, toast, formularFehler } from './01-core.js';
import { confirmDelete, bestaetigeMitPasswort, mitPasswortBestaetigen, mitZweitemFaktor } from './07-admin.js';
import { loadUsers } from './05-settings.js';

// ═══ Zweiter Faktor im Profil (Server: src/konto/zweiterFaktor.ts) ══════════════
// Ablauf: Passwort → QR-Code und Schlüssel → Code bestätigen → die zehn
// Wiederherstellungscodes einmal zeigen. Danach: abschalten oder neue Codes.

// Im Anmeldebildschirm, solange ein Verwalter ihn einrichten muss (js/01-core.js).
let pflicht = false;
const flaeche = () => pflicht ? G('zf-pflicht-flaeche') : G('zf-flaeche');
if (typeof document !== 'undefined') document.addEventListener('zweitpflicht', () => { pflicht = true; pflichtHinweis('zfpflicht.hint'); void ladeZweitenFaktor(); });

/** Die Einleitung über der Fläche: erst „bitte einrichten“, nach dem Code „fertig, Codes sichern“. */
function pflichtHinweis(schluessel) {
  const h = G('zfpflicht-hinweis'); if (!h) return;
  h.dataset.i18n = schluessel; h.textContent = tRaw(schluessel);
}

function zeichne(html) { const f = flaeche(); if (f) f.innerHTML = html; }

// Im Anmeldebildschirm stehen die Knöpfe breit untereinander wie „Abmelden“ darunter.
const knopfArt = () => pflicht ? 'knopf-breit' : 'btn-sm';
const knopf = (aktion, text, art = 'bs') =>
  `<button type="button" class="btn ${art} ${knopfArt()}" data-click="${aktion}"${echt()}>${text}</button>`;
const reihe = (inhalt) => `<div class="${pflicht ? 'zf-knoepfe-breit' : 'zf-knoepfe'}">${inhalt}</div>`;
// Die Felder stehen ausgeschrieben da, nicht über einen Helfer: test/dom-ids.test.js
// findet nur wörtliche id-Angaben. Das Passwort fragt der Dialog beim Auslösen.
const CODEFELD = (label, laenge = 24) =>
  `<div class="fg"><label for="zf-code">${label}</label><input type="text" id="zf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${laenge}" data-erstfokus /></div>`;

export async function ladeZweitenFaktor() {
  if (!flaeche()) return;
  const d = await api('GET', '/v1/auth/zweiter-faktor');
  if (!d?.success) { zeichne(`<div class="voucher-leer">${t('settings.error')}</div>`); return; }
  if (!d.aktiv) {
    zeichne(`<form class="sform" data-submit="zf-start" data-stil="max-width:420px">
      <div><button type="button" class="btn bp ${knopfArt()}" id="zf-start" data-click="zfEinrichten"${echt()}>${t('zf.setup')}</button></div>
    </form>`);
    // Im Anmeldebildschirm ist „Einrichten“ der einzige nächste Schritt.
    if (pflicht) G('zf-start')?.focus();
    return;
  }
  zeichne(`<p data-stil="font-size:var(--fs-3);margin:0 0 .75rem 0">${ico('ok')} ${esc(tRaw('zf.active', { n: d.codes_uebrig }))}</p>
    <form class="sform" data-stil="max-width:420px">
      ${CODEFELD(t('login.code'))}
      <div data-stil="display:flex;gap:.5rem;flex-wrap:wrap">
        ${knopf('zfNeueCodes', t('zf.new_codes'))}
        ${knopf('zfAbschalten', t('zf.disable'), 'bd')}
      </div>
    </form>`);
}

export async function zfEinrichten() {
  // Kurz nach der Anmeldung lässt der Server das Passwort weg (Gnadenfrist);
  // sonst antwortet er ohne Zählen mit aktuelles_passwort_erforderlich.
  let d = await api('POST', '/v1/auth/zweiter-faktor/einrichten', {});
  if (d?.code === 'aktuelles_passwort_erforderlich')
    d = await mitPasswortBestaetigen(tRaw('zf.title'), (password, z) => api('POST', '/v1/auth/zweiter-faktor/einrichten', { password, ...z }));
  if (!d) return;
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Gruppiert lesbar, falls jemand den Schlüssel von Hand eintippt.
  const lesbar = d.geheimnis.replace(/(.{4})/g, '$1 ').trim();
  zeichne(`<form class="sform" data-submit="zf-bestaetigen" data-stil="max-width:420px">
      <p data-stil="font-size:var(--fs-2);margin:0">${t('zf.scan')}</p>
      <div id="zf-qr" data-stil="background:#fff;padding:8px;align-self:flex-start;border-radius:8px"></div>
      <div data-stil="font-size:var(--fs-1);color:var(--mut)">${t('zf.manual')}<br><code data-stil="user-select:all;font-size:var(--fs-3)">${esc(lesbar)}</code></div>
      <div class="lerr" id="zf-fehler" role="alert"></div>
      ${CODEFELD(t('zf.confirm_code'), 6)}
      ${reihe(`<button type="button" class="btn bp ${knopfArt()}" id="zf-bestaetigen" data-click="zfBestaetigen">${t('zf.confirm')}</button>
        ${pflicht ? '' : knopf('ladeZweitenFaktor', t('common.cancel'))}`)}
    </form>`);
  const qr = G('zf-qr');
  if (qr && typeof QRCode !== 'undefined') {
    new QRCode(qr, { text: d.otpauth, width: 200, height: 200, colorDark: '#1e293b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    // Die Bibliothek legt Leinwand und Bild ohne Namen an; vorgelesen wird der Zweck.
    qr.querySelector('img')?.setAttribute('alt', tRaw('zf.qr_alt'));
    qr.querySelector('canvas')?.setAttribute('aria-hidden', 'true');
  } else if (qr) qr.textContent = d.otpauth;
  G('zf-code')?.focus();
}

function zeigeCodes(codes) {
  if (pflicht) pflichtHinweis('zfpflicht.fertig');
  zeichne(`<div class="sform" data-stil="max-width:420px">
      <p data-stil="font-size:var(--fs-2);margin:0"><strong>${t('zf.codes_title')}</strong><br>${t('zf.codes_hint')}</p>
      <pre id="zf-codes" data-stil="font-size:var(--fs-3);line-height:1.6;background:var(--s50,#f8fafc);border:1px solid var(--bdr);border-radius:8px;padding:.6rem .9rem;margin:0;user-select:all">${codes.map(esc).join('\n')}</pre>
      ${reihe(`${knopf('zfCodesKopieren', t('zf.copy'))}
        <button type="button" class="btn bp ${knopfArt()}" id="zf-gespeichert" data-click="${pflicht ? 'zfPflichtFertig' : 'ladeZweitenFaktor'}">${t('zf.codes_done')}</button>`)}
    </div>`);
  G('zf-gespeichert')?.focus();
}

export async function zfBestaetigen() {
  const feld = G('zf-code'), fehler = G('zf-fehler');
  const code = (feld?.value || '').trim();
  if (!code) { if (fehler) formularFehler(fehler, tRaw('zf.code_leer'), ['zf-code']); return; }
  const d = await api('POST', '/v1/auth/zweiter-faktor/bestaetigen', { code });
  if (!d?.success) {
    // Am Feld statt als Toast: Der Fehler gehört zum Code, und ein Toast stünde
    // nach dem richtigen Code noch neben „eingerichtet“.
    if (fehler) { formularFehler(fehler, d?.error || tRaw('settings.error'), ['zf-code']); feld?.select?.(); }
    else toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('zf.enabled'), 'success');
  zeigeCodes(d.codes);
}

export async function zfNeueCodes() {
  const d = await api('POST', '/v1/auth/zweiter-faktor/codes', { code: G('zf-code')?.value || '' });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  zeigeCodes(d.codes);
}

export async function zfAbschalten() {
  const code = G('zf-code')?.value || '';
  if (!await confirmDelete(tRaw('zf.disable'), t('zf.disable_confirm'), 'schloss', { knopf: 'confirm.btn.abschalten', art: 'bd' })) return;
  const d = await mitPasswortBestaetigen(tRaw('zf.disable'), (password, z) =>
    api('POST', '/v1/auth/zweiter-faktor/abschalten', { password, ...(code ? { code } : {}), ...z }));
  if (!d) return;
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
  const admin_password = await bestaetigeMitPasswort(tRaw('zf.reset_title_name', { name }), tRaw('zf.reset_text', { name }), 'schloss', { knopf: 'confirm.btn.zuruecksetzen', art: 'bp' });
  if (admin_password === null) return;
  const d = await mitZweitemFaktor(z => api('DELETE', `/v1/auth/users/${uid}/zweiter-faktor`, { admin_password, ...z }));
  if (d === null) return;
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw('zf.disabled'), 'success');
  loadUsers();
}

/** Eingerichtet: Mit dem Neuladen öffnet sich die Anwendung. */
function zfPflichtFertig() { location.reload(); }

registerActions({ ladeZweitenFaktor, zfPflichtFertig, zfEinrichten, zfBestaetigen, zfNeueCodes, zfAbschalten, zfCodesKopieren, zfZuruecksetzen });
