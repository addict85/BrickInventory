import { echt, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { formularFehler } from './formular.js';
import { toast } from './meldungen.js';
import { loadUsers } from './user-management.js';
import { html, ungeprueft } from './escapen.js';
import { fmtDatum } from './format.js';
import { emit } from './events.js';
import { angemeldetesKonto } from './zustand.js';
import { bestaetigeMitPasswort, frageCode, mitZweitemFaktor, mitPasswortBestaetigen } from './rueckfrage.js';

// ═══ Zweiter Faktor im Profil (Server: src/faktoren/zweiterFaktor.ts) ══════════════
// Ablauf: Passwort → QR-Code und Schlüssel → Code bestätigen → die zehn Wiederherstellungscodes einmal
// zeigen. Danach: abschalten oder neue Codes.

// Im Anmeldebildschirm, solange ein Verwalter ihn einrichten muss (js/api.js meldet es).
let pflicht = false;
/** Die Einrichtung, die „Neu einrichten“ eines Verwalters schon begonnen hat. @type {import('../../frontend-typen/vertrag').ZweiterFaktorEinrichtung | null} */
let begonnen = null;
const flaeche = () => (pflicht ? G('zf-pflicht-flaeche') : G('zf-flaeche'));
if (typeof document !== 'undefined')
  document.addEventListener('zweitpflicht', () => {
    pflicht = true;
    pflichtHinweis('zfpflicht.hint');
    const d = begonnen;
    begonnen = null;
    void (d ? zeigeEinrichtung(d) : ladeZweitenFaktor());
  });

/**
 * Die Einleitung über der Fläche: erst „bitte einrichten“, nach dem Code „fertig, Codes sichern“.
 * @param {string} schluessel
 */
function pflichtHinweis(schluessel) {
  const h = G('zfpflicht-hinweis');
  if (!h) return;
  h.dataset.i18n = schluessel;
  h.textContent = tRaw(schluessel);
}

/**
 * @param {import('./escapen.js').Markup} markup
 */
function zeichne(markup) {
  const f = flaeche();
  if (f) setzeHtml(f, markup);
}
// Im Anmeldebildschirm stehen die Knöpfe breit untereinander wie „Abmelden“ darunter.
const knopfArt = () => (pflicht ? 'knopf-breit' : 'btn-sm');

const knopf = (/** @type {string} */ aktion, /** @type {string} */ text, art = 'bs') =>
  html`<button type="button" class="btn ${art} ${ungeprueft(knopfArt())}" data-click="${aktion}"${echt()}>${ungeprueft(text)}</button>`;
const reihe = (/** @type {string} */ inhalt) =>
  html`<div class="${pflicht ? 'zf-knoepfe-breit' : 'zf-knoepfe'}">${ungeprueft(inhalt)}</div>`;
// Die Felder stehen ausgeschrieben da, nicht über einen Helfer: test/dom-ids.test.js findet nur wörtliche
// id-Angaben. findet nur wörtliche id-Angaben. Das Passwort fragt der Dialog beim Auslösen.
const CODEFELD = (/** @type {string} */ label, laenge = 24) =>
  html`<div class="fg"><label for="zf-code">${ungeprueft(label)}</label><input type="text" id="zf-code" inputmode="numeric" autocomplete="one-time-code" maxlength="${laenge}" data-erstfokus /></div>`;

export async function ladeZweitenFaktor() {
  if (!flaeche()) return;
  const d = await api('GET', '/v1/auth/zweiter-faktor');
  if (!d?.success) {
    zeichne(html`<div class="voucher-leer">${tRaw('settings.error')}</div>`);
    return;
  }
  if (!d.aktiv) {
    zeichne(html`<form class="sform" data-submit="zf-start" data-stil="max-width:420px">
      <div><button type="button" class="btn bp ${knopfArt()}" id="zf-start" data-click="zfEinrichten"${echt()}>${tRaw('zf.setup')}</button></div>
    </form>`);
    // Im Anmeldebildschirm ist „Einrichten“ der einzige nächste Schritt.
    if (pflicht) G('zf-start')?.focus();
    return;
  }
  // Den Code fragt jede Aktion in ihrem eigenen Dialog: Ein Feld für zwei Knöpfe liess offen, wofür es gilt.
  // Codes alter Art laufen ab (Migration 0122); ob die offenen alt sind, weiss nur der Inhaber.
  const alt = d.alte_codes_bis
    ? html`<p role="note" data-stil="margin:0 0 .75rem 0">${ico('warnung')} ${tRaw('zf.alte_codes', { bis: fmtDatum(d.alte_codes_bis) })}</p>`
    : '';
  zeichne(html`<p data-stil="font-size:var(--fs-3);margin:0 0 .75rem 0">${ico('ok')} ${tRaw('zf.active', { n: d.codes_uebrig })}</p>
    ${alt}
    <div class="zf-knoepfe">
      ${knopf('zfNeueCodes', tRaw('zf.new_codes'))}
      ${knopf('zfAbschalten', tRaw(angemeldetesKonto?.isAdmin ? 'zf.neu_einrichten' : 'zf.disable'), 'bd')}
    </div>`);
}

export async function zfEinrichten() {
  // Kurz nach der Anmeldung lässt der Server das Passwort weg (Gnadenfrist); sonst antwortet er ohne Zählen
  // mit aktuelles_passwort_erforderlich.
  const erst = await api('POST', '/v1/auth/zweiter-faktor/einrichten', {});
  const d =
    erst?.code !== 'aktuelles_passwort_erforderlich'
      ? erst
      : await mitPasswortBestaetigen(tRaw('zf.title'), (password, z) =>
          api('POST', '/v1/auth/zweiter-faktor/einrichten', { password, ...z }),
        );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  zeigeEinrichtung(d);
}

/** @param {import('../../frontend-typen/vertrag').ZweiterFaktorEinrichtung} d */
function zeigeEinrichtung(d) {
  // Gruppiert lesbar, falls jemand den Schlüssel von Hand eintippt.
  const lesbar = (d.geheimnis ?? '').replace(/(.{4})/g, '$1 ').trim();
  zeichne(html`<form class="sform" data-submit="zf-bestaetigen" data-stil="max-width:420px">
      <p data-stil="font-size:var(--fs-2);margin:0">${tRaw('zf.scan')}</p>
      <div id="zf-qr" class="zf-qr"></div>
      <div data-stil="font-size:var(--fs-1);color:var(--mut)">${tRaw('zf.manual')}<br><code id="zf-schluessel" data-stil="user-select:all;font-size:var(--fs-3)">${lesbar}</code></div>
      <div class="zf-knoepfe">${knopf('zfSchluesselKopieren', tRaw('zf.schluessel_kopieren'))}<a class="btn bs ${knopfArt()}" id="zf-otpauth" hidden>${tRaw('zf.in_app_oeffnen')}</a></div>
      <div class="lerr" id="zf-fehler" role="alert"></div>
      ${CODEFELD(tRaw('zf.confirm_code'), 6)}
      ${reihe(`<button type="button" class="btn bp ${knopfArt()}" id="zf-bestaetigen" data-click="zfBestaetigen">${t('zf.confirm')}</button>
        ${pflicht ? '' : knopf('ladeZweitenFaktor', tRaw('common.cancel'))}`)}
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
    // Die Bibliothek legt Leinwand und Bild ohne Namen an; vorgelesen wird der Zweck.
    qr.querySelector('img')?.setAttribute('alt', tRaw('zf.qr_alt'));
    qr.querySelector('canvas')?.setAttribute('aria-hidden', 'true');
  } else if (qr) qr.textContent = d.otpauth ?? '';
  // Am Telefon lässt sich der eigene Bildschirm nicht scannen: Der Link öffnet die Authenticator-App direkt.
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
function zeigeCodes(codes) {
  if (pflicht) pflichtHinweis('zfpflicht.fertig');
  zeichne(html`<div class="sform" data-stil="max-width:420px">
      <p data-stil="font-size:var(--fs-2);margin:0"><strong>${tRaw('zf.codes_title')}</strong><br>${tRaw('zf.codes_hint')}</p>
      <pre id="zf-codes" data-stil="font-size:var(--fs-3);line-height:1.6;background:var(--s50,#f8fafc);border:1px solid var(--bdr);border-radius:8px;padding:.6rem .9rem;margin:0;user-select:all">${codes.join('\n')}</pre>
      ${reihe(`${knopf('zfCodesKopieren', tRaw('zf.copy'))}${knopf('zfCodesSpeichern', tRaw('zf.codes_datei'))}
        <button type="button" class="btn bp ${knopfArt()}" id="zf-gespeichert" data-click="${pflicht ? 'zfPflichtFertig' : 'ladeZweitenFaktor'}">${t('zf.codes_done')}</button>`)}
    </div>`);
  G('zf-gespeichert')?.focus();
}

export async function zfBestaetigen() {
  const feld = G('zf-code'),
    fehler = G('zf-fehler');
  const code = (feld?.value || '').trim();
  if (!code) {
    if (fehler) formularFehler(fehler, tRaw('zf.code_leer'), ['zf-code']);
    return;
  }
  const d = await api('POST', '/v1/auth/zweiter-faktor/bestaetigen', { code });
  if (!d?.success) {
    // Am Feld statt als Toast: Der Fehler gehört zum Code, und ein Toast stünde nach dem richtigen Code noch
    // neben „eingerichtet“.
    if (fehler) {
      formularFehler(fehler, d?.error || tRaw('settings.error'), ['zf-code']);
      feld?.select?.();
    } else toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('zf.enabled'), 'success');
  zeigeCodes(d.codes ?? []);
}

export async function zfNeueCodes() {
  const code = await frageCode(tRaw('zf.new_codes'), tRaw('zf.code_fuer_codes'));
  if (!code) return;
  const d = await api('POST', '/v1/auth/zweiter-faktor/codes', { code });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  zeigeCodes(d.codes ?? []);
}

// Ein Verwalter ohne zweiten Faktor darf nichts ausser ihn einrichten: Für ihn heisst Abschalten deshalb
// „Neu einrichten“, und die Einrichtung beginnt mit demselben Passwort gleich im Pflichtfeld.
export async function zfAbschalten() {
  const verwalter = !!angemeldetesKonto?.isAdmin;
  let passwort = '';
  const d = await mitPasswortBestaetigen(
    tRaw(verwalter ? 'zf.neu_einrichten' : 'zf.disable'),
    (password, z) => {
      passwort = password;
      return api('POST', '/v1/auth/zweiter-faktor/abschalten', { password, ...z });
    },
    tRaw(verwalter ? 'zf.neu_einrichten_text' : 'zf.disable_confirm'),
    { knopf: verwalter ? 'zf.neu_einrichten' : 'confirm.btn.abschalten', art: 'bd', mitCode: true },
  );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('zf.disabled'), 'success');
  if (!verwalter) return ladeZweitenFaktor();
  const neu = await api('POST', '/v1/auth/zweiter-faktor/einrichten', { password: passwort });
  begonnen = neu?.success ? neu : null;
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

/** Die Codes als Textdatei: Kopieren allein liess sie oft in der Zwischenablage verschwinden. */
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

/** Verwalter: den zweiten Faktor eines Kontos entfernen (Telefon und Codes verloren). */
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

/** Eingerichtet: Mit dem Neuladen öffnet sich die Anwendung. */
function zfPflichtFertig() {
  location.reload();
}

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
