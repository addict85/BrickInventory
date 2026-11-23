import { genuine, registerActions } from './registry.js';
import { t, tRaw } from '../i18n.js';
import { fmtDate } from './format.js';
import { errorMessage, api } from './api.js';
import { ico, G, buttonBusy, setHtml } from './dom.js';
import { toast } from './messages.js';
import { html, safeUrl } from './escaping.js';
import { confirmDeleteWithPassword, withSecondFactor } from './confirm-prompt.js';

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
  const box = G('qr-pairing');
  if (!box) return;
  box.hidden = false;
  G('qr-pairing-text').textContent = text;
  G('qr-pairing-field').hidden = G('qr-pairing-buttons').hidden = !withField;
}

async function checkPairing() {
  const k = _pairing;
  if (!k) return;
  const d = await api('GET', `/v2/auth/qr-pairing/${k.id}`);
  if (!d.success || _pairing !== k) return;
  const device = d.device || '—';
  if (d.state === 'waiting') {
    // The code is used up; otherwise only an image would remain that opens nothing anymore.
    G('qr-code').replaceChildren();
    if (G('qr-pairing').hidden || G('qr-pairing-field').hidden)
      showPairing(tRaw('qr.pairing_question', { device: device, network: d.ip_range || '—' }), true);
  } else if (d.state === 'confirmed') showPairing(tRaw('qr.pairing_confirmed', { device: device }), false);
  else if (d.state === 'collected') {
    endPairing();
    G('qr-code').replaceChildren();
    showPairing(tRaw('qr.pairing_done', { device: device }), false);
    loadTokens();
  } else if (d.state === 'rejected' || d.state === 'expired') {
    endPairing();
    G('qr-code').replaceChildren();
    showPairing(tRaw('qr.pairing_rejected'), false);
  }
}

async function confirmQrPairing() {
  const k = _pairing;
  const field = G('qr-pairing-code');
  if (!k || !field) return;
  const d = await api('POST', `/v2/auth/qr-pairing/${k.id}/confirm`, { code: field.value.trim() });
  field.value = '';
  if (!d.success) toast(d.error || t('settings.error'), 'error');
  checkPairing();
}

async function rejectQrPairing() {
  const k = _pairing;
  if (!k) return;
  await api('POST', `/v2/auth/qr-pairing/${k.id}/reject`, {});
  checkPairing();
}

// QR code via QRCode.js from public/vendor/qrcode (npm qrcodejs, scripts/copy-qrcode.js); without the
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

/** @param {import('../../frontend-types/api').ApiResponse<'POST', '/v2/auth/qr-token'>} d the QR response @param {string | undefined} serverUrl */
function showQrHints(d, serverUrl) {
  // The lifetime from the server's response, not from the selection: if it doesn't know the value, the
  // sliding default applies. Three cases — 0 means unlimited, null means nothing was chosen; a plain
  // truthiness check would lump both together.
  const caFp = G('qr-ca-fp');
  if (caFp) {
    caFp.hidden = !d.cert_sha256;
    caFp.textContent = d.cert_sha256 ? tRaw('qr.ca_fp', { fp: d.cert_sha256 }) : '';
  }
  const plainHint = G('qr-tls-hint');
  if (plainHint) {
    plainHint.hidden = !/^http:\/\//i.test(serverUrl || '');
    plainHint.textContent = plainHint.hidden ? '' : tRaw('qr.plain_text_hint');
  }
  const access = G('qr-access-hint');
  if (access)
    access.textContent =
      d.token_days === 0
        ? tRaw('qr.access_unlimited')
        : (d.token_days ?? 0) > 0
          ? tRaw('qr.access_days', { n: d.token_days })
          : tRaw('qr.access_default');
}

/** The duration comes from the server (expires_in): a fixed value would drift past the code's actual end.
 * @param {HTMLElement} hint @param {HTMLElement} container @param {number} secs */
function startQrCountdown(hint, container, secs) {
  const fmt = (/** @type {number} */ v) => `${Math.floor(v / 60)}:${(v % 60).toString().padStart(2, '0')}`;
  let left = secs;
  _expiry = setInterval(() => {
    left--;
    hint.textContent = tRaw('qr.valid_for', { t: fmt(left) });
    if (left <= 0) {
      clearInterval(_expiry);
      hint.textContent = tRaw('qr.expired');
      container.replaceChildren();
    }
  }, 1000);
  hint.textContent = tRaw('qr.valid_for', { t: fmt(left) });
}

async function generateQrCode() {
  const btn = G('btn-gen-qr');
  const hint = G('qr-hint');
  const container = G('qr-code');
  const release = buttonBusy(btn);
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
    if (G('qr-pairing')) G('qr-pairing').hidden = true;
    const d = await withSecondFactor(z => api('POST', '/v2/auth/qr-token', { validity, password, ...z }));
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
    startQrCountdown(hint, container, Number(d.expires_in) || 300);
    _pairing = { id: d.pairing, timer: setInterval(checkPairing, 2000) };
    showQrHints(d, serverUrl);
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
  return fmtDate(value, 'datetime');
}

export async function loadTokens() {
  const target = G('tokens-tbl');
  if (!target) return;
  const d = await api('GET', '/v2/settings/tokens');
  if (!d.success) {
    setHtml(target, html`<p data-style="color:var(--mut)">${d.error || t('settings.error')}</p>`);
    return;
  }
  if (!d.tokens.length) {
    setHtml(target, html`<p data-style="color:var(--mut)">${tRaw('tokens.none')}</p>`);
    return;
  }
  setHtml(
    target,
    html`<div class="tw"><table class="dt" aria-label="${tRaw('tokens.title')}"><thead><tr>
      <th>${tRaw('tokens.col.label')}</th><th>${tRaw('tokens.col.created')}</th>
      <th>${tRaw('tokens.col.last_used')}</th><th>${tRaw('tokens.col.scope')}</th><th>${tRaw('tokens.col.ip')}</th>
      <th>${tRaw('tokens.col.expires')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.tokens.map(
        tk => html`<tr>
      <td><strong>${tk.label || '—'}</strong>${tk.current ? html` <span class="rb ra">${tRaw('tokens.current')}</span>` : ''}</td>
      <td>${tokenDate(tk.created_at)}</td>
      <td>${tokenDate(tk.last_used)}</td>
      <td>${tk.scope === 'voll' ? tRaw('tokens.scope.full') : tRaw('tokens.scope.app')}</td>
      <td>${tk.ip_range || '—'}</td>
      <td>${tk.never_expires ? tRaw('tokens.never') : tokenDate(tk.expires_at)}${tk.hard_expires_at ? html` <span class="rb ra" title="${tokenDate(tk.hard_expires_at)}">${tRaw('tokens.fixed')}</span>` : ''}</td>
      <td>${tk.current ? '' : html`<button class="btn bd btn-sm" data-click="revokeToken"${genuine()} data-arg="${tk.token_id}" data-arg2="${tk.label || ''}" aria-label="${tRaw('common.delete')}">${ico('delete')}</button>`}</td>
    </tr>`,
      )}</tbody></table></div>`,
  );
}

/**
 * The CA root's fingerprint, for manual comparison — the same value appears as `fp` in the QR code
 * for signing in, and as a QR code of its own for the app's certificate question.
 * Without an internal CA (a foreign proxy), only whether HTTPS applies is shown.
 */
export async function loadTls() {
  const target = G('tls-surface');
  if (!target) return;
  const d = await api('GET', '/v2/settings/tls');
  if (!d?.success) {
    setHtml(target, html`<p class="hint-paragraph">${d?.error || t('settings.error')}</p>`);
    return;
  }
  if (!d.fp) {
    setHtml(
      target,
      html`<p class="hint-paragraph">${d.https ? tRaw('tls.without_ca') : tRaw('tls.without_https')}</p>`,
    );
    return;
  }
  setHtml(
    target,
    html`<p class="hint-paragraph">${tRaw('tls.hint')}</p>
    <div class="text-small">${tRaw('tls.subject')}: ${d.subject}<br>${tRaw('tls.valid_until')}: ${tokenDate(d.valid_until)}</div>
    <div class="text-small space-top-075">${tRaw('tls.zert_sha256')}</div>
    <code id="tls-zert-sha256" data-style="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.cert_sha256 || ''}</code>
    <div class="text-small space-top-075">${tRaw('tls.fp_sha256')}</div>
    <code id="tls-fp-hex" data-style="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.fp_hex}</code>
    <div class="text-small space-top-075">${tRaw('tls.fp_base64')}</div>
    <code id="tls-fp" data-style="user-select:all;word-break:break-all;font-size:var(--fs-2)">${d.fp}</code>
    <div class="text-small space-top-075">${tRaw('tls.qr_hint')}</div>
    <div id="tls-cert-qr" data-style="background:#fff;padding:12px;border-radius:8px;border:1px solid var(--bdr);display:inline-block"></div>
    <div class="space-top-075"><a class="btn bs btn-sm" href="${safeUrl(d.download)}" download>${tRaw('tls.download')}</a></div>`,
  );
  const qr = G('tls-cert-qr');
  const code = certificateCode(d.fp_hex);
  if (qr && code) drawQr(qr, code);
}

/**
 * What the app scans at its certificate question (CertificateCode.kt): versioned, so it can refuse a
 * format it does not know, and with all 32 bytes — a short code could be ground out with a key of
 * one's own. Derived here from `fp_hex` so the API needs no second spelling of the same value.
 * @param {string | undefined} fpHex
 */
function certificateCode(fpHex) {
  const hex = (fpHex || '').replace(/:/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? `brickinventory-cert:v1:spki-sha256:${hex}` : null;
}

/**
 * Sign a foreign device out: the server requires password and second factor, so a stolen access token
 * can't lock the owner out. Our own access has no button here.
 * @param {string} tokenId
 * @param {string} label
 */
async function revokeToken(tokenId, label) {
  const password = await confirmDeleteWithPassword(
    tRaw('tokens.revoke.title'),
    tRaw('tokens.revoke.text', { name: label || '—' }),
    'key',
    { button: 'confirm.btn.device_logout', kind: 'bp' },
  );
  if (password === null) return;
  const d = await withSecondFactor(z =>
    api('DELETE', `/v2/settings/tokens/${encodeURIComponent(tokenId)}`, { password, ...z }),
  );
  if (!d) return;
  if (d.success) {
    toast(tRaw('tokens.revoked'), 'success');
    loadTokens();
  } else toast(d.error || t('settings.error'), 'error');
}

/** All remaining browser and app access in ONE confirmed request: a second-factor code only works once. */
async function revokeOtherTokens() {
  const d = await api('GET', '/v2/settings/tokens');
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  const others = d.tokens.filter(tk => !tk.current);
  const password = await confirmDeleteWithPassword(
    tRaw('tokens.revoke_others.title'),
    tRaw('tokens.revoke_others.text', { n: others.length }),
    'logout',
    { button: 'confirm.btn.logout', kind: 'bp' },
  );
  if (password === null) return;
  const s = await withSecondFactor(z =>
    api('POST', '/v2/settings/sessions/end-others', { password, accesses: true, ...z }),
  );
  if (s === null) return;
  if (!s.success) {
    toast(s.error || t('settings.error'), 'error');
    return;
  }
  toast(tRaw('tokens.revoked_n', { n: (s.accesses || 0) + (s.deleted || 0) }), 'success');
  loadTokens();
}

// ── Register handlers with the dispatcher (see js/registry.js) ──────────────
// Names below are registry-exposed (index.html/connection.js/tests) — kept unchanged.
registerActions({
  loadTokens,
  rejectQrPairing,
  confirmQrPairing,
  revokeOtherTokens,
  revokeToken,
});
