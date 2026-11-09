import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { fmtDatum } from './01-format.js';
import { fehlerMeldung, api } from './01-api.js';
import { ico, G, knopfBesetzt, setzeHtml } from './01-dom.js';
import { toast } from './01-meldungen.js';
import { html, sichereUrl, ungeprueft } from './00-escapen.js';
import { confirmDelete, bestaetigeMitPasswort, mitZweitemFaktor } from './01-rueckfrage.js';

// Zugänge des Kontos: App-Tokens, QR-Anmeldung und das TLS-Zertifikat für die App.
// QR-Code über QRCode.js aus public/vendor/qrcode (npm qrcodejs, scripts/qrcode-kopieren.js)
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
    // Clear and render QR code
    container.replaceChildren();
    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: qrData,
        width: 220, height: 220,
        colorDark: '#1e293b', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      // Fallback: show as text
      container.textContent = qrData;
    }
    // Countdown timer
    //
    // Dauer vom Server nehmen, nicht fest verdrahten: /qr-token liefert expires_in mit. Hier stand 1800 (30
    // Minuten), während der Token seit der Sicherheitshärtung nach 5 Minuten abläuft — der Zähler lief also
    // 25 Minuten weiter, obwohl der Code längst ungültig war.
    let secs = Number(d.expires_in) || 300;
    const fmt = (/** @type {number} */ v) => `${Math.floor(v/60)}:${(v%60).toString().padStart(2,'0')}`;
    const timer = setInterval(() => {
      secs--;
      hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
      if (secs <= 0) { clearInterval(timer); hint.textContent = tRaw('qr.expired'); container.replaceChildren(); }
    }, 1000);
    hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
    // Die Laufzeit aus der Serverantwort, nicht aus der Auswahl: Kennt er den Wert nicht, gilt die
    // Gleitfrist. Drei Fälle — 0 heisst unbegrenzt, null nichts gewählt; ein einfacher Wahrheitstest würfe
    // beide zusammen.
    // Ausführlich: docs/begruendungen/public/js/05-zugaenge.js.md#klartext
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
      <td>${ungeprueft(tokenDatum(tk.created_at))}</td>
      <td>${ungeprueft(tokenDatum(tk.last_used))}</td>
      <td>${tk.scope === 'voll' ? tRaw('tokens.scope.voll') : tRaw('tokens.scope.app')}</td>
      <td>${tk.ip_bereich || '—'}</td>
      <td>${tk.never_expires ? tRaw('tokens.never') : ungeprueft(tokenDatum(tk.expires_at))}${tk.hard_expires_at ? html` <span class="rb ra" title="${tokenDatum(tk.hard_expires_at)}">${tRaw('tokens.fixed')}</span>` : ''}</td>
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
  revokeOtherTokens,
  revokeToken,
});
