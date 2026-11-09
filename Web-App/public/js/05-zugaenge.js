import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { fmtDatum } from './01-format.js';
import { fehlerMeldung, api } from './01-api.js';
import { ico, G, knopfBesetzt, setzeHtml } from './01-dom.js';
import { toast } from './01-meldungen.js';
import { html, sichereUrl } from './00-escapen.js';
import { confirmDelete, bestaetigeMitPasswort, mitZweitemFaktor } from './01-rueckfrage.js';

// Zugänge des Kontos: App-Tokens, QR-Anmeldung und das TLS-Zertifikat für die App.
// Nach dem Scan meldet sich die App mit einem Gerätenamen und zeigt einen Code; erst wenn er hier eingetippt
// ist, bekommt sie ihren Zugang. Ein abfotografierter QR-Code allein öffnet so kein Konto.
/** @type {{ id: number, timer: ReturnType<typeof setInterval> } | null} */
let _kopplung = null;

function kopplungBeenden() {
  if (_kopplung) clearInterval(_kopplung.timer);
  _kopplung = null;
}

/** @param {string} text @param {boolean} mitFeld */
function zeigeKopplung(text, mitFeld) {
  const kasten = G('qr-kopplung');
  if (!kasten) return;
  kasten.hidden = false;
  G('qr-kopplung-text').textContent = text;
  G('qr-kopplung-feld').hidden = G('qr-kopplung-knoepfe').hidden = !mitFeld;
}

async function kopplungPruefen() {
  const k = _kopplung;
  if (!k) return;
  const d = await api('GET', `/v1/auth/qr-kopplung/${k.id}`);
  if (!d.success || _kopplung !== k) return;
  const geraet = d.geraet || '—';
  if (d.stand === 'wartet') {
    // Der Code ist verbraucht; stehen bliebe nur ein Bild, das nichts mehr öffnet.
    G('qr-code').replaceChildren();
    if (G('qr-kopplung').hidden || G('qr-kopplung-feld').hidden)
      zeigeKopplung(tRaw('qr.kopplung_frage', { geraet, netz: d.ip_bereich || '—' }), true);
  } else if (d.stand === 'bestaetigt') zeigeKopplung(tRaw('qr.kopplung_bestaetigt', { geraet }), false);
  else if (d.stand === 'abgeholt') {
    kopplungBeenden();
    G('qr-code').replaceChildren();
    zeigeKopplung(tRaw('qr.kopplung_fertig', { geraet }), false);
    loadTokens();
  } else if (d.stand === 'abgelehnt' || d.stand === 'abgelaufen') {
    kopplungBeenden();
    G('qr-code').replaceChildren();
    zeigeKopplung(tRaw('qr.kopplung_abgelehnt'), false);
  }
}

async function qrKopplungBestaetigen() {
  const k = _kopplung;
  const feld = G('qr-kopplung-code');
  if (!k || !feld) return;
  const d = await api('POST', `/v1/auth/qr-kopplung/${k.id}/bestaetigen`, { code: feld.value.trim() });
  feld.value = '';
  if (!d.success) toast(d.error || t('settings.error'), 'error');
  kopplungPruefen();
}

async function qrKopplungAblehnen() {
  const k = _kopplung;
  if (!k) return;
  await api('POST', `/v1/auth/qr-kopplung/${k.id}/ablehnen`, {});
  kopplungPruefen();
}

// QR-Code über QRCode.js aus public/vendor/qrcode (npm qrcodejs, scripts/qrcode-kopieren.js); ohne die
// Bibliothek steht der Inhalt als Text da.
/** @param {HTMLElement} container @param {string} qrData */
function zeichneQr(container, qrData) {
  container.replaceChildren();
  if (typeof QRCode === 'undefined') { container.textContent = qrData; return; }
  new QRCode(container, { text: qrData, width: 220, height: 220, colorDark: '#1e293b', colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M });
}

async function generateQrCode() {
  const btn = G('btn-gen-qr');
  const hint = G('qr-hint');
  const container = G('qr-code');
  const frei = knopfBesetzt(btn);
  try {
    // POST, weil der Aufruf eine Nonce anlegt: Als GET löste ihn eine fremde Seite per Navigation aus
    // (SameSite=lax). Die Laufzeit des späteren Tokens reist mit der Erzeugung, sonst wählte sich der Finder
    // eines Codes die längste.
    // Ausführlich: docs/begruendungen/public/js/05-zugaenge.js.md#gueltigkeit
    const gueltigkeit = G('qr-validity')?.value || '';
    const pw = G('qr-password');
    const password = pw?.value || '';
    if (pw) pw.value = '';
    kopplungBeenden();
    if (G('qr-kopplung')) G('qr-kopplung').hidden = true;
    const d = await mitZweitemFaktor(z => api('POST', '/v1/auth/qr-token', { gueltigkeit, password, ...z }));
    if (d === null) { frei(); return; }
    if (!d.success) {
      hint.textContent = tRaw('toast.error')+': ' + (d.error||t('common.unknown'));
      // Den alten Code wegraeumen: Er ist vielleicht noch gueltig, und ein sichtbarer Code neben einer
      // Fehlermeldung sieht aus wie ein Code, der trotzdem geht. Beim Ablaufzaehler weiter unten wird aus
      // demselben Grund geleert.
      container.replaceChildren();
      frei(); return;
    }
    // Nur die Adresse, die der Server nennt (APP_BASE_URL): Die in der Browserzeile ist die des Betrachters,
    // etwa eine LAN-Adresse, die ausser Haus nicht existiert. Lieber kein Code als einer, der sich falsch
    // scannen lässt.
    // Ausführlich: docs/begruendungen/public/js/05-zugaenge.js.md#serverurl
    const serverUrl = d.url;

    // Mit `fp` (Fingerabdruck der CA-Wurzel) pinnt die App das Zertifikat; der Server schickt ihn nur zu
    // einer https-Adresse.
    const qrData = JSON.stringify({ url: serverUrl, token: d.token, ...(d.fp ? { fp: d.fp } : {}) });
    zeichneQr(container, qrData);
    // Die Dauer nennt der Server (expires_in): Ein fester Wert lief am Ende des Codes vorbei.
    let secs = Number(d.expires_in) || 300;
    const fmt = (/** @type {number} */ v) => `${Math.floor(v/60)}:${(v%60).toString().padStart(2,'0')}`;
    const timer = setInterval(() => {
      secs--;
      hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
      if (secs <= 0) { clearInterval(timer); hint.textContent = tRaw('qr.expired'); container.replaceChildren(); }
    }, 1000);
    _kopplung = { id: d.kopplung, timer: setInterval(kopplungPruefen, 2000) };
    hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
    // Die Laufzeit aus der Serverantwort, nicht aus der Auswahl: Kennt er den Wert nicht, gilt die
    // Gleitfrist. Drei Fälle — 0 heisst unbegrenzt, null nichts gewählt; ein einfacher Wahrheitstest würfe
    // beide zusammen.
    // Ausführlich: docs/begruendungen/public/js/05-zugaenge.js.md#klartext
    const caFp = G('qr-ca-fp');
    if (caFp) {
      caFp.hidden = !d.zert_sha256;
      caFp.textContent = d.zert_sha256 ? tRaw('qr.ca_fp', { fp: d.zert_sha256 }) : '';
    }
    const klartext = G('qr-tls-hint');
    if (klartext) {
      klartext.hidden = !/^http:\/\//i.test(serverUrl || '');
      klartext.textContent = klartext.hidden ? '' : tRaw('qr.klartext_hinweis');
    }
    const zugang = G('qr-access-hint');
    if (zugang) zugang.textContent =
      d.token_days === 0    ? tRaw('qr.access_unlimited')
      : (d.token_days ?? 0) > 0 ? tRaw('qr.access_days', { n: d.token_days })
                            : tRaw('qr.access_default');
    // Nach dem ersten Erzeugen heisst der Knopf „Neu generieren" — die eine Stelle, an der die Beschriftung
    // sich absichtlich ändert.
    frei(tRaw('qr.regenerate'));
  } catch(e) { hint.textContent = tRaw('toast.error')+': ' + fehlerMeldung(e); frei(); }
}

G('btn-gen-qr').onclick = generateQrCode;

// Angemeldete Geräte einzeln aussperren: Sonst blieb für ein verlorenes Telefon nur das Passwort zu ändern,
// und das wirft alle Zugänge hinaus. Der Browser selbst hängt an der Sitzung, nicht an einem Token.
// Ausführlich: docs/begruendungen/public/js/05-zugaenge.js.md#die-endpunkte-v1-settings-tokens-gab-es

/**
 * „—", wenn nie benutzt: `new Date(null)` wäre der 1.1.1970.
 * @param {string | null | undefined} wert
 */
function tokenDatum(wert) {
  if (!wert) return '—';
  return fmtDatum(wert, 'tagzeit');
}

export async function loadTokens() {
  const ziel = G('tokens-tbl');
  if (!ziel) return;
  const d = await api('GET', '/v1/settings/tokens');
  if (!d.success) { setzeHtml(ziel, html`<p data-stil="color:var(--mut)">${d.error || t('settings.error')}</p>`); return; }
  if (!d.tokens.length) { setzeHtml(ziel, html`<p data-stil="color:var(--mut)">${tRaw('tokens.none')}</p>`); return; }
  setzeHtml(ziel, html`<div class="tw"><table class="dt" aria-label="${tRaw('tokens.title')}"><thead><tr>
      <th>${tRaw('tokens.col.label')}</th><th>${tRaw('tokens.col.created')}</th>
      <th>${tRaw('tokens.col.last_used')}</th><th>${tRaw('tokens.col.scope')}</th><th>${tRaw('tokens.col.ip')}</th>
      <th>${tRaw('tokens.col.expires')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.tokens.map(tk => html`<tr>
      <td><strong>${tk.label || '—'}</strong>${tk.aktuell ? html` <span class="rb ra">${tRaw('tokens.current')}</span>` : ''}</td>
      <td>${tokenDatum(tk.created_at)}</td>
      <td>${tokenDatum(tk.last_used)}</td>
      <td>${tk.scope === 'voll' ? tRaw('tokens.scope.voll') : tRaw('tokens.scope.app')}</td>
      <td>${tk.ip_bereich || '—'}</td>
      <td>${tk.never_expires ? tRaw('tokens.never') : tokenDatum(tk.expires_at)}${tk.hard_expires_at ? html` <span class="rb ra" title="${tokenDatum(tk.hard_expires_at)}">${tRaw('tokens.fixed')}</span>` : ''}</td>
      <td>${tk.aktuell ? '' : html`<button class="btn bd btn-sm" data-click="revokeToken"${echt()} data-arg="${tk.token_id}" data-arg2="${tk.label || ''}" aria-label="${tRaw('common.delete')}">${ico('loeschen')}</button>`}</td>
    </tr>`)}</tbody></table></div>`);
}

/**
 * Der Fingerabdruck der CA-Wurzel zum Abgleich von Hand — derselbe Wert steht als `fp` im QR-Code. Ohne
 * interne CA (fremder Proxy) steht nur, ob HTTPS gilt.
 */
export async function ladeTls() {
  const ziel = G('tls-flaeche');
  if (!ziel) return;
  const d = await api('GET', '/v1/settings/tls');
  if (!d?.success) { setzeHtml(ziel, html`<p class="hinweis-absatz">${d?.error || t('settings.error')}</p>`); return; }
  if (!d.fp) {
    setzeHtml(ziel, html`<p class="hinweis-absatz">${d.https ? tRaw('tls.ohne_ca') : tRaw('tls.ohne_https')}</p>`);
    return;
  }
  setzeHtml(ziel, html`<p class="hinweis-absatz">${tRaw('tls.hint')}</p>
    <div class="text-klein">${tRaw('tls.subject')}: ${d.subject}<br>${tRaw('tls.valid_until')}: ${tokenDatum(d.gueltig_bis)}</div>
    <div class="text-klein abstand-o-075">${tRaw('tls.zert_sha256')}</div>
    <code id="tls-zert-sha256" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.zert_sha256 || ''}</code>
    <div class="text-klein abstand-o-075">${tRaw('tls.fp_sha256')}</div>
    <code id="tls-fp-hex" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.fp_hex}</code>
    <div class="text-klein abstand-o-075">${tRaw('tls.fp_base64')}</div>
    <code id="tls-fp" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.fp}</code>
    <div class="abstand-o-075"><a class="btn bs btn-sm" href="${sichereUrl(d.download)}" download>${tRaw('tls.download')}</a></div>`);
}

/**
 * @param {string} tokenId
 * @param {string} label
 */
async function revokeToken(tokenId, label) {
  if (!await confirmDelete(tRaw('tokens.revoke.title'), tRaw('tokens.revoke.text', { name: label || '—' }), 'schluessel', { knopf: 'confirm.btn.geraet_abmelden', art: 'bp' })) return;
  const d = await api('DELETE', `/v1/settings/tokens/${encodeURIComponent(tokenId)}`);
  if (d.success) { toast(tRaw('tokens.revoked'), 'success'); loadTokens(); }
  else toast(d.error || t('settings.error'), 'error');
}

/**
 * Alle Zugänge ausser dem eigenen entwerten, nacheinander über den bestehenden Endpunkt: Eine zweite Adresse
 * für „dasselbe, mehrfach“ wäre Doppelung. Gezählt wird, was wirklich weg ist.
 * Ausführlich: docs/begruendungen/public/js/05-zugaenge.js.md#revokeothertokens
 */
async function revokeOtherTokens() {
  const d = await api('GET', '/v1/settings/tokens');
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  const andere = d.tokens.filter(tk => !tk.aktuell);
  const password = await bestaetigeMitPasswort(tRaw('tokens.revoke_others.title'),
                                               tRaw('tokens.revoke_others.text', { n: andere.length }), 'abmelden', { knopf: 'confirm.btn.abmelden', art: 'bp' });
  if (password === null) return;
  // Zuerst die übrigen Browser: Dort prüft der Server das Passwort.
  const s = await mitZweitemFaktor(z => api('POST', '/v1/settings/sessions/andere-beenden', { password, ...z }));
  if (s === null) return;
  if (!s.success) { toast(s.error || t('settings.error'), 'error'); return; }
  let weg = 0;
  for (const tk of andere) {
    const r = await api('DELETE', `/v1/settings/tokens/${encodeURIComponent(tk.token_id)}`);
    weg += r.deleted || 0;
  }
  toast(tRaw('tokens.revoked_n', { n: weg + (s.deleted || 0) }), weg === andere.length ? 'success' : 'error');
  loadTokens();
}


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  loadTokens,
  qrKopplungAblehnen,
  qrKopplungBestaetigen,
  revokeOtherTokens,
  revokeToken,
});
