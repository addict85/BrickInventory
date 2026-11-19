import { echt, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { formularFehler } from './formular.js';
import { toast } from './meldungen.js';
import { loadUsers } from './user-management.js';
import { html, rawHtml } from './escaping.js';
import { fmtDatum } from './format.js';
import { emit } from './events.js';
import { loggedInAccount } from './state.js';
import { bestaetigeMitPasswort, frageCode, mitZweitemFaktor, mitPasswortBestaetigen } from './rueckfrage.js';

// ═══ Second factor in the profile (server: src/factors/secondFactor.ts) ══════════════
// Flow: password → QR code and key → confirm code → show the ten recovery codes once. After that: disable
// or get new codes.

// On the login screen, while an admin still has to set it up (js/api.js reports it).
let mandatory = false;
/** The setup an admin's "set up again" has already started. @type {import('../../frontend-typen/vertrag').ZweiterFaktorEinrichtung | null} */
let started = null;
const area = () => (mandatory ? G('zf-pflicht-flaeche') : G('zf-flaeche'));
if (typeof document !== 'undefined')
  document.addEventListener('zweitpflicht', () => {
    mandatory = true;
    mandatoryHint('zfpflicht.hint');
    const d = started;
    started = null;
    void (d ? showSetup(d) : ladeZweitenFaktor());
  });

/**
 * The intro above the area: first "please set up", after the code "done, save the codes".
 * @param {string} key
 */
function mandatoryHint(key) {
  const h = G('zfpflicht-hinweis');
  if (!h) return;
  h.dataset.i18n = key;
  h.textContent = tRaw(key);
}

/**
 * @param {import('./escaping.js').Markup} markup
 */
function render(markup) {
  const f = area();
  if (f) setzeHtml(f, markup);
}
// On the login screen the buttons stack wide, same as "log out" below them.
const buttonKind = () => (mandatory ? 'knopf-breit' : 'btn-sm');

const button = (/** @type {string} */ action, /** @type {string} */ text, kind = 'bs') =>
  html`<button type="button" class="btn ${kind} ${rawHtml(buttonKind())}" data-click="${action}"${echt()}>${rawHtml(text)}</button>`;
const row = (/** @type {string} */ content) =>
  html`<div class="${mandatory ? 'zf-knoepfe-breit' : 'zf-knoepfe'}">${rawHtml(content)}</div>`;
// The fields are spelled out here rather than behind a helper: test/dom-ids.test.js only finds literal id
// attributes. The dialog asks for the password when triggered.
const CODE_FIELD = (/** @type {string} */ label, length = 24) =>
  html`<div class="fg"><label for="zf-code">${rawHtml(label)}</label><input type="text" id="zf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${length}" data-erstfokus /></div>`;

export async function ladeZweitenFaktor() {
  if (!area()) return;
  const d = await api('GET', '/v1/auth/zweiter-faktor');
  if (!d?.success) {
    render(html`<div class="voucher-leer">${tRaw('settings.error')}</div>`);
    return;
  }
  if (!d.aktiv) {
    render(html`<form class="sform" data-submit="zf-start" data-stil="max-width:420px">
      <div><button type="button" class="btn bp ${buttonKind()}" id="zf-start" data-click="zfEinrichten"${echt()}>${tRaw('zf.setup')}</button></div>
    </form>`);
    // On the login screen "set up" is the only next step.
    if (mandatory) G('zf-start')?.focus();
    return;
  }
  // Every action asks for the code in its own dialog: one field for two buttons would leave open what it
  // applies to. Old-style codes expire (migration 0122); only the owner knows whether the open ones are old.
  const old = d.alte_codes_bis
    ? html`<p role="note" data-stil="margin:0 0 .75rem 0">${ico('warnung')} ${tRaw('zf.alte_codes', { bis: fmtDatum(d.alte_codes_bis) })}</p>`
    : '';
  render(html`<p data-stil="font-size:var(--fs-3);margin:0 0 .75rem 0">${ico('ok')} ${tRaw('zf.active', { n: d.codes_uebrig })}</p>
    ${old}
    <div class="zf-knoepfe">
      ${button('zfNeueCodes', tRaw('zf.new_codes'))}
      ${button('zfAbschalten', tRaw(loggedInAccount?.isAdmin ? 'zf.neu_einrichten' : 'zf.disable'), 'bd')}
    </div>`);
}

export async function zfEinrichten() {
  // Shortly after login the server skips the password (grace period); otherwise it answers without a
  // counter with aktuelles_passwort_erforderlich.
  const first = await api('POST', '/v1/auth/zweiter-faktor/einrichten', {});
  const d =
    first?.code !== 'aktuelles_passwort_erforderlich'
      ? first
      : await mitPasswortBestaetigen(tRaw('zf.title'), (password, z) =>
          api('POST', '/v1/auth/zweiter-faktor/einrichten', { password, ...z }),
        );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  showSetup(d);
}

/** @param {import('../../frontend-typen/vertrag').ZweiterFaktorEinrichtung} d */
function showSetup(d) {
  // Grouped for readability, in case someone types the key in by hand.
  const readable = (d.geheimnis ?? '').replace(/(.{4})/g, '$1 ').trim();
  render(html`<form class="sform" data-submit="zf-bestaetigen" data-stil="max-width:420px">
      <p data-stil="font-size:var(--fs-2);margin:0">${tRaw('zf.scan')}</p>
      <div id="zf-qr" class="zf-qr"></div>
      <div data-stil="font-size:var(--fs-1);color:var(--mut)">${tRaw('zf.manual')}<br><code id="zf-schluessel" data-stil="user-select:all;font-size:var(--fs-3)">${readable}</code></div>
      <div class="zf-knoepfe">${button('zfSchluesselKopieren', tRaw('zf.schluessel_kopieren'))}<a class="btn bs ${buttonKind()}" id="zf-otpauth" hidden>${tRaw('zf.in_app_oeffnen')}</a></div>
      <div class="lerr" id="zf-fehler" role="alert"></div>
      ${CODE_FIELD(tRaw('zf.confirm_code'), 6)}
      ${row(`<button type="button" class="btn bp ${buttonKind()}" id="zf-bestaetigen" data-click="zfBestaetigen">${t('zf.confirm')}</button>
        ${mandatory ? '' : button('ladeZweitenFaktor', tRaw('common.cancel'))}`)}
    </form>`);
  const qr = G('zf-qr');
  if (qr && typeof QRCode !== 'undefined') {
    new QRCode(qr, {
      text: d.otpauth,
      width: 200,
      height: 200,
      colorDark: '#1e293b',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
    // The library creates the canvas and image with no name; what's read aloud is their purpose.
    qr.querySelector('img')?.setAttribute('alt', tRaw('zf.qr_alt'));
    qr.querySelector('canvas')?.setAttribute('aria-hidden', 'true');
  } else if (qr) qr.textContent = d.otpauth ?? '';
  // On the phone you can't scan your own screen: the link opens the authenticator app directly.
  const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('zf-otpauth'));
  if (link && /^otpauth:\/\/totp\//i.test(d.otpauth ?? '')) {
    link.href = d.otpauth ?? '';
    link.hidden = false;
  }
  G('zf-code')?.focus();
}

export async function zfSchluesselKopieren() {
  const text = (G('zf-schluessel')?.textContent || '').replace(/\s+/g, '');
  try {
    await navigator.clipboard.writeText(text);
    toast(tRaw('zf.schluessel_kopiert'), 'success');
  } catch {
    toast(tRaw('zf.copy_failed'), 'error');
  }
}

/** @param {string[]} codes */
function showCodes(codes) {
  if (mandatory) mandatoryHint('zfpflicht.fertig');
  render(html`<div class="sform" data-stil="max-width:420px">
      <p data-stil="font-size:var(--fs-2);margin:0"><strong>${tRaw('zf.codes_title')}</strong><br>${tRaw('zf.codes_hint')}</p>
      <pre id="zf-codes" data-stil="font-size:var(--fs-3);line-height:1.6;background:var(--s50,#f8fafc);border:1px solid var(--bdr);border-radius:8px;padding:.6rem .9rem;margin:0;user-select:all">${codes.join('\n')}</pre>
      ${row(`${button('zfCodesKopieren', tRaw('zf.copy'))}${button('zfCodesSpeichern', tRaw('zf.codes_datei'))}
        <button type="button" class="btn bp ${buttonKind()}" id="zf-gespeichert" data-click="${mandatory ? 'zfPflichtFertig' : 'ladeZweitenFaktor'}">${t('zf.codes_done')}</button>`)}
    </div>`);
  G('zf-gespeichert')?.focus();
}

export async function zfBestaetigen() {
  const field = G('zf-code'),
    error = G('zf-fehler');
  const code = (field?.value || '').trim();
  if (!code) {
    if (error) formularFehler(error, tRaw('zf.code_leer'), ['zf-code']);
    return;
  }
  const d = await api('POST', '/v1/auth/zweiter-faktor/bestaetigen', { code });
  if (!d?.success) {
    // At the field instead of a toast: the error belongs to the code, and a toast would still sit next to
    // "set up" after the correct code.
    if (error) {
      formularFehler(error, d?.error || tRaw('settings.error'), ['zf-code']);
      field?.select?.();
    } else toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('zf.enabled'), 'success');
  showCodes(d.codes ?? []);
}

export async function zfNeueCodes() {
  const code = await frageCode(tRaw('zf.new_codes'), tRaw('zf.code_fuer_codes'));
  if (!code) return;
  const d = await api('POST', '/v1/auth/zweiter-faktor/codes', { code });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  showCodes(d.codes ?? []);
}

// An admin without a second factor may do nothing except set it up: for them, disabling is therefore
// called "set up again", and the setup starts with that same password right in the mandatory field.
export async function zfAbschalten() {
  const isAdmin = !!loggedInAccount?.isAdmin;
  let adminPassword = '';
  const d = await mitPasswortBestaetigen(
    tRaw(isAdmin ? 'zf.neu_einrichten' : 'zf.disable'),
    (password, z) => {
      adminPassword = password;
      return api('POST', '/v1/auth/zweiter-faktor/abschalten', { password, ...z });
    },
    tRaw(isAdmin ? 'zf.neu_einrichten_text' : 'zf.disable_confirm'),
    { knopf: isAdmin ? 'zf.neu_einrichten' : 'confirm.btn.abschalten', art: 'bd', mitCode: true },
  );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('zf.disabled'), 'success');
  if (!isAdmin) return ladeZweitenFaktor();
  const started_ = await api('POST', '/v1/auth/zweiter-faktor/einrichten', { password: adminPassword });
  started = started_?.success ? started_ : null;
  emit('zweiterFaktorPflicht');
}

export async function zfCodesKopieren() {
  const text = G('zf-codes')?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast(tRaw('zf.copied'), 'success');
  } catch {
    toast(tRaw('zf.copy_failed'), 'error');
  }
}

/** The codes as a text file: copying alone often made them vanish from the clipboard again. */
export function zfCodesSpeichern() {
  const text = G('zf-codes')?.textContent || '';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }));
  a.download = 'brickinventory-wiederherstellungscodes.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Admin: remove an account's second factor (phone and codes lost). */
/** @param {string} uid @param {string} name */
export async function zfZuruecksetzen(uid, name) {
  const admin_password = await bestaetigeMitPasswort(
    tRaw('zf.reset_title_name', { name }),
    tRaw('zf.reset_text', { name }),
    'schloss',
    { knopf: 'confirm.btn.zuruecksetzen', art: 'bp' },
  );
  if (admin_password === null) return;
  const d = await mitZweitemFaktor(z =>
    api('DELETE', `/v1/auth/users/${uid}/zweiter-faktor`, { admin_password, ...z }),
  );
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(
    d.effective_at
      ? tRaw('users.uebernahme_spaeter', { zeit: fmtDatum(d.effective_at, 'tagzeit') })
      : tRaw('zf.disabled'),
    'success',
  );
  loadUsers();
}

/** Set up: reloading opens the app. */
function zfPflichtFertig() {
  location.reload();
}

// Names below are registry-exposed (index.html/verbindung.js) — kept unchanged.
registerActions({
  ladeZweitenFaktor,
  zfPflichtFertig,
  zfEinrichten,
  zfBestaetigen,
  zfNeueCodes,
  zfAbschalten,
  zfCodesKopieren,
  zfSchluesselKopieren,
  zfCodesSpeichern,
  zfZuruecksetzen,
});
