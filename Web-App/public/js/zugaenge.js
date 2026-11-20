import { echt, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { fmtDatum } from './format.js';
import { errorMessage, api } from './api.js';
import { ico, G, knopfBesetzt, setzeHtml } from './dom.js';
import { toast } from './meldungen.js';
import { html, safeUrl } from './escaping.js';
import { bestaetigeMitPasswort, withSecondFactor } from './rueckfrage.js';

// Account access: app tokens, QR sign-in and the TLS certificate for the app.
// After scanning, the app announces itself with a device name and shows a code; only once it is typed in
// here does it get its access. A photographed QR code alone does not open an account this way.
/** @type {{ id: number, timer: ReturnType<typeof setInterval> } | null} */
let _pairing = null;
// Module-wide, so a new code stops the old one's expiry counter; otherwise it would blank out the new code
// at 0.
/** @type {ReturnType<typeof setInterval> | undefined} */
let _expiry;

function endPairing() {
  if (_pairing) clearInterval(_pairing.timer);
  _pairing = null;
}

/** @param {string} text @param {boolean} withField */
function showPairing(text, withField) {
  const box = G('qr-kopplung');
  if (!box) return;
  box.hidden = false;
  G('qr-kopplung-text').textContent = text;
  G('qr-kopplung-feld').hidden = G('qr-kopplung-knoepfe').hidden = !withField;
}

async function checkPairing() {
  const k = _pairing;
  if (!k) return;
  const d = await api('GET', `/v1/auth/qr-kopplung/${k.id}`);
  if (!d.success || _pairing !== k) return;
  const device = d.geraet || '—';
  if (d.stand === 'wartet') {
    // The code is used up; otherwise only an image would remain that opens nothing anymore.
    G('qr-code').replaceChildren();
    if (G('qr-kopplung').hidden || G('qr-kopplung-feld').hidden)
      showPairing(tRaw('qr.kopplung_frage', { geraet: device, netz: d.ip_range || '—' }), true);
  } else if (d.stand === 'bestaetigt') showPairing(tRaw('qr.kopplung_bestaetigt', { geraet: device }), false);
  else if (d.stand === 'abgeholt') {
    endPairing();
    G('qr-code').replaceChildren();
    showPairing(tRaw('qr.kopplung_fertig', { geraet: device }), false);
    loadTokens();
  } else if (d.stand === 'abgelehnt' || d.stand === 'abgelaufen') {
    endPairing();
    G('qr-code').replaceChildren();
    showPairing(tRaw('qr.kopplung_abgelehnt'), false);
  }
}

async function qrKopplungBestaetigen() {
  const k = _pairing;
  const field = G('qr-kopplung-code');
  if (!k || !field) return;
  const d = await api('POST', `/v1/auth/qr-kopplung/${k.id}/bestaetigen`, { code: field.value.trim() });
  field.value = '';
  if (!d.success) toast(d.error || t('settings.error'), 'error');
  checkPairing();
}

async function qrKopplungAblehnen() {
  const k = _pairing;
  if (!k) return;
  await api('POST', `/v1/auth/qr-kopplung/${k.id}/ablehnen`, {});
  checkPairing();
}

// QR code via QRCode.js from public/vendor/qrcode (npm qrcodejs, scripts/qrcode-kopieren.js); without the
// library, the content shows as plain text.
/** @param {HTMLElement} container @param {string} qrData */
function drawQr(container, qrData) {
  container.replaceChildren();
  if (typeof QRCode === 'undefined') {
    container.textContent = qrData;
    return;
  }
  new QRCode(container, {
    text: qrData,
    width: 220,
    height: 220,
    colorDark: '#1e293b',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

async function generateQrCode() {
  const btn = G('btn-gen-qr');
  const hint = G('qr-hint');
  const container = G('qr-code');
  const release = knopfBesetzt(btn);
  try {
    // POST, because the call creates a nonce: as a GET, a foreign page could trigger it via navigation
    // (SameSite=lax). The later token's lifetime travels along with creation, otherwise whoever finds a
    // code would just pick the longest one.
    const validity = G('qr-validity')?.value || '';
    const pw = G('qr-password');
    const password = pw?.value || '';
    if (pw) pw.value = '';
    endPairing();
    clearInterval(_expiry);
    if (G('qr-kopplung')) G('qr-kopplung').hidden = true;
    const d = await withSecondFactor(z => api('POST', '/v1/auth/qr-token', { gueltigkeit: validity, password, ...z }));
    if (d === null) {
      release();
      return;
    }
    if (!d.success) {
      hint.textContent = tRaw('toast.error') + ': ' + (d.error || t('common.unknown'));
      // A code next to an error message would look as if it still worked.
      container.replaceChildren();
      release();
      return;
    }
    // Only the address the server names (APP_BASE_URL): the one in the browser's address bar is the
    // viewer's own, e.g. a LAN address that doesn't exist away from home. Better no code than one that
    // scans to the wrong place.
    const serverUrl = d.url;

    // With `fp` (the CA root's fingerprint), the app pins the certificate; the server only sends it to an
    // https address.
    const qrData = JSON.stringify({ url: serverUrl, token: d.token, ...(d.fp ? { fp: d.fp } : {}) });
    drawQr(container, qrData);
    // The duration comes from the server (expires_in): a fixed value would drift past the code's actual end.
    let secs = Number(d.expires_in) || 300;
    const fmt = (/** @type {number} */ v) => `${Math.floor(v / 60)}:${(v % 60).toString().padStart(2, '0')}`;
    _expiry = setInterval(() => {
      secs--;
      hint.textContent = tRaw('qr.valid_for', { t: fmt(secs) });
      if (secs <= 0) {
        clearInterval(_expiry);
        hint.textContent = tRaw('qr.expired');
        container.replaceChildren();
      }
    }, 1000);
    _pairing = { id: d.kopplung, timer: setInterval(checkPairing, 2000) };
    hint.textContent = tRaw('qr.valid_for', { t: fmt(secs) });
    // The lifetime from the server's response, not from the selection: if it doesn't know the value, the
    // sliding default applies. Three cases — 0 means unlimited, null means nothing was chosen; a plain
    // truthiness check would lump both together.
    const caFp = G('qr-ca-fp');
    if (caFp) {
      caFp.hidden = !d.zert_sha256;
      caFp.textContent = d.zert_sha256 ? tRaw('qr.ca_fp', { fp: d.zert_sha256 }) : '';
    }
    const plainHint = G('qr-tls-hint');
    if (plainHint) {
      plainHint.hidden = !/^http:\/\//i.test(serverUrl || '');
      plainHint.textContent = plainHint.hidden ? '' : tRaw('qr.klartext_hinweis');
    }
    const access = G('qr-access-hint');
    if (access)
      access.textContent =
        d.token_days === 0
          ? tRaw('qr.access_unlimited')
          : (d.token_days ?? 0) > 0
            ? tRaw('qr.access_days', { n: d.token_days })
            : tRaw('qr.access_default');
    // After the first generation, the button reads "regenerate" — the one place where the label
    // deliberately changes.
    release(tRaw('qr.regenerate'));
  } catch (e) {
    hint.textContent = tRaw('toast.error') + ': ' + errorMessage(e);
    release();
  }
}

G('btn-gen-qr').onclick = generateQrCode;

// Sign individual devices out one at a time: otherwise the only option for a lost phone was changing the
// password, which throws out every access. The browser itself hangs off the session, not off a token.

/**
 * "—" if never used: `new Date(null)` would be 1970-01-01.
 * @param {string | null | undefined} value
 */
function tokenDate(value) {
  if (!value) return '—';
  return fmtDatum(value, 'tagzeit');
}

export async function loadTokens() {
  const target = G('tokens-tbl');
  if (!target) return;
  const d = await api('GET', '/v1/settings/tokens');
  if (!d.success) {
    setzeHtml(target, html`<p data-stil="color:var(--mut)">${d.error || t('settings.error')}</p>`);
    return;
  }
  if (!d.tokens.length) {
    setzeHtml(target, html`<p data-stil="color:var(--mut)">${tRaw('tokens.none')}</p>`);
    return;
  }
  setzeHtml(
    target,
    html`<div class="tw"><table class="dt" aria-label="${tRaw('tokens.title')}"><thead><tr>
      <th>${tRaw('tokens.col.label')}</th><th>${tRaw('tokens.col.created')}</th>
      <th>${tRaw('tokens.col.last_used')}</th><th>${tRaw('tokens.col.scope')}</th><th>${tRaw('tokens.col.ip')}</th>
      <th>${tRaw('tokens.col.expires')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.tokens.map(
        tk => html`<tr>
      <td><strong>${tk.label || '—'}</strong>${tk.aktuell ? html` <span class="rb ra">${tRaw('tokens.current')}</span>` : ''}</td>
      <td>${tokenDate(tk.created_at)}</td>
      <td>${tokenDate(tk.last_used)}</td>
      <td>${tk.scope === 'voll' ? tRaw('tokens.scope.voll') : tRaw('tokens.scope.app')}</td>
      <td>${tk.ip_range || '—'}</td>
      <td>${tk.never_expires ? tRaw('tokens.never') : tokenDate(tk.expires_at)}${tk.hard_expires_at ? html` <span class="rb ra" title="${tokenDate(tk.hard_expires_at)}">${tRaw('tokens.fixed')}</span>` : ''}</td>
      <td>${tk.aktuell ? '' : html`<button class="btn bd btn-sm" data-click="revokeToken"${echt()} data-arg="${tk.token_id}" data-arg2="${tk.label || ''}" aria-label="${tRaw('common.delete')}">${ico('loeschen')}</button>`}</td>
    </tr>`,
      )}</tbody></table></div>`,
  );
}

/**
 * The CA root's fingerprint, for manual comparison — the same value appears as `fp` in the QR code.
 * Without an internal CA (a foreign proxy), only whether HTTPS applies is shown.
 */
export async function loadTls() {
  const target = G('tls-flaeche');
  if (!target) return;
  const d = await api('GET', '/v1/settings/tls');
  if (!d?.success) {
    setzeHtml(target, html`<p class="hinweis-absatz">${d?.error || t('settings.error')}</p>`);
    return;
  }
  if (!d.fp) {
    setzeHtml(target, html`<p class="hinweis-absatz">${d.https ? tRaw('tls.ohne_ca') : tRaw('tls.ohne_https')}</p>`);
    return;
  }
  setzeHtml(
    target,
    html`<p class="hinweis-absatz">${tRaw('tls.hint')}</p>
    <div class="text-klein">${tRaw('tls.subject')}: ${d.subject}<br>${tRaw('tls.valid_until')}: ${tokenDate(d.gueltig_bis)}</div>
    <div class="text-klein abstand-o-075">${tRaw('tls.zert_sha256')}</div>
    <code id="tls-zert-sha256" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.zert_sha256 || ''}</code>
    <div class="text-klein abstand-o-075">${tRaw('tls.fp_sha256')}</div>
    <code id="tls-fp-hex" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.fp_hex}</code>
    <div class="text-klein abstand-o-075">${tRaw('tls.fp_base64')}</div>
    <code id="tls-fp" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.fp}</code>
    <div class="abstand-o-075"><a class="btn bs btn-sm" href="${safeUrl(d.download)}" download>${tRaw('tls.download')}</a></div>`,
  );
}

/**
 * Sign a foreign device out: the server requires password and second factor, so a stolen access token
 * can't lock the owner out. Our own access has no button here.
 * @param {string} tokenId
 * @param {string} label
 */
async function revokeToken(tokenId, label) {
  const password = await bestaetigeMitPasswort(
    tRaw('tokens.revoke.title'),
    tRaw('tokens.revoke.text', { name: label || '—' }),
    'schluessel',
    { knopf: 'confirm.btn.geraet_abmelden', art: 'bp' },
  );
  if (password === null) return;
  const d = await withSecondFactor(z =>
    api('DELETE', `/v1/settings/tokens/${encodeURIComponent(tokenId)}`, { password, ...z }),
  );
  if (!d) return;
  if (d.success) {
    toast(tRaw('tokens.revoked'), 'success');
    loadTokens();
  } else toast(d.error || t('settings.error'), 'error');
}

/** All remaining browser and app access in ONE confirmed request: a second-factor code only works once. */
async function revokeOtherTokens() {
  const d = await api('GET', '/v1/settings/tokens');
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  const others = d.tokens.filter(tk => !tk.aktuell);
  const password = await bestaetigeMitPasswort(
    tRaw('tokens.revoke_others.title'),
    tRaw('tokens.revoke_others.text', { n: others.length }),
    'abmelden',
    { knopf: 'confirm.btn.abmelden', art: 'bp' },
  );
  if (password === null) return;
  const s = await withSecondFactor(z =>
    api('POST', '/v1/settings/sessions/andere-beenden', { password, zugaenge: true, ...z }),
  );
  if (s === null) return;
  if (!s.success) {
    toast(s.error || t('settings.error'), 'error');
    return;
  }
  toast(tRaw('tokens.revoked_n', { n: (s.zugaenge || 0) + (s.deleted || 0) }), 'success');
  loadTokens();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
// Names below are registry-exposed (index.html/verbindung.js/tests) — kept unchanged.
registerActions({
  loadTokens,
  qrKopplungAblehnen,
  qrKopplungBestaetigen,
  revokeOtherTokens,
  revokeToken,
});
