import { genuine, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setHtml } from './dom.js';
import { fmtDate } from './format.js';
import { toast } from './messages.js';
import { loggedInAccount } from './state.js';
import { html } from './escaping.js';
import { confirmDeleteWithPassword, withSecondFactor, fetchSetPasskey } from './confirm-prompt.js';

// ═══ Passkeys (server: src/factors/repository/passkeys.ts, routes/auth.ts) ═══════════════
// No third-party script: the server sends the options as JSON (Base64URL), the browser needs an
// ArrayBuffer — the conversion both ways lives here.

const toBuffer = (/** @type {string} */ b64u) => {
  const b64 = b64u
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64u.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
};
const toText = (/** @type {ArrayBuffer} */ buffer) => {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/**
 * The server's options as JSON: buffers sit there as Base64url. The contract (PasskeyOptions) leaves their
 * fields open; those are WebAuthn's.
 * @typedef {{ id: string, type?: string, transports?: string[] }} IdJson
 * @typedef {{ challenge: string, user?: { id: string, name: string, displayName: string },
 *   excludeCredentials?: IdJson[], allowCredentials?: IdJson[], [field: string]: unknown }} OptionsJson
 */
const withIds = (/** @type {IdJson[] | null | undefined} */ list) =>
  /** @type {PublicKeyCredentialDescriptor[]} */ ((list || []).map(c => ({ ...c, id: toBuffer(c.id) })));

/** Can this browser do passkeys? (Only in a secure context, i.e. over HTTPS.) */
export const passkeysPossible = () => !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);

/** @param {OptionsJson & { user: { id: string, name: string, displayName: string } }} o */
async function createPasskey(o) {
  const c = /** @type {PublicKeyCredential} */ (
    await navigator.credentials.create({
      publicKey: /** @type {PublicKeyCredentialCreationOptions} */ ({
        ...o,
        challenge: toBuffer(o.challenge),
        user: { ...o.user, id: toBuffer(o.user.id) },
        excludeCredentials: withIds(o.excludeCredentials),
      }),
    })
  );
  const r = /** @type {AuthenticatorAttestationResponse} */ (c.response);
  return {
    id: c.id,
    rawId: toText(c.rawId),
    type: c.type,
    clientExtensionResults: c.getClientExtensionResults(),
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toText(r.clientDataJSON),
      attestationObject: toText(r.attestationObject),
      transports: r.getTransports ? r.getTransports() : [],
    },
  };
}

/**
 * Get a sign-in response for `purpose`; null if cancelled.
 * @param {string} purpose
 */
async function getAssertion(purpose) {
  const o = await api('POST', '/v2/auth/passkey/login/options', { purpose: purpose });
  if (!o?.success) {
    toast(o?.error || tRaw('settings.error'), 'error');
    return null;
  }
  const p = /** @type {OptionsJson} */ (o.options);
  /** @type {PublicKeyCredential} */
  let c;
  try {
    c = /** @type {PublicKeyCredential} */ (
      await navigator.credentials.get({
        publicKey: /** @type {PublicKeyCredentialRequestOptions} */ ({
          ...p,
          challenge: toBuffer(p.challenge),
          allowCredentials: withIds(p.allowCredentials),
        }),
      })
    );
  } catch {
    toast(tRaw('pk.cancelled'), 'info');
    return null;
  }
  const r = /** @type {AuthenticatorAssertionResponse} */ (c.response);
  return {
    id: c.id,
    rawId: toText(c.rawId),
    type: c.type,
    clientExtensionResults: c.getClientExtensionResults(),
    response: {
      clientDataJSON: toText(r.clientDataJSON),
      authenticatorData: toText(r.authenticatorData),
      signature: toText(r.signature),
      ...(r.userHandle ? { userHandle: toText(r.userHandle) } : {}),
    },
  };
}

// ── Login page ─────────────────────────────────────────────────────────────

/** No password: the browser offers this site's passkeys. */
export async function passkeyLogin() {
  const answer = await getAssertion('login');
  if (!answer) return;
  const d = await api('POST', '/v2/auth/passkey/login', { response: answer });
  if (!d?.success) {
    G('lerr').textContent = d?.error || tRaw('settings.error');
    G('lerr').style.display = 'block';
    return;
  }
  if (cookieMissing(d)) return;
  // Startup re-reads the session (GET /auth/me) — same path as after a reload.
  location.reload();
}

/** Second factor: passkey instead of a code, together with the name and password entered above. */
export async function passkeySecondFactor() {
  const passkey = await getAssertion('second_factor');
  if (!passkey) return;
  const d = await api('POST', '/v2/auth/login', {
    username: G('lu').value,
    password: G('lp').value,
    without_token: true,
    passkey,
  });
  if (!d?.success) {
    G('lerr').textContent = d?.error || tRaw('settings.error');
    G('lerr').style.display = 'block';
    return;
  }
  if (cookieMissing(d)) return;
  location.reload();
}

/** Without the cookie, reloading would only bring back the mask, with no reason given; the notice stays put.
 * @param {{ cookie_missing?: boolean }} d */
function cookieMissing(d) {
  if (!d.cookie_missing) return false;
  const h = G('login-hint');
  h.textContent = tRaw('auth.cookie_missing');
  h.hidden = false;
  return true;
}

// ── Account ────────────────────────────────────────────────────────────────────

const area = () => G('pk-surface');

export async function loadPasskeys() {
  const f = area();
  if (!f) return;
  const [d, sf] = await Promise.all([api('GET', '/v2/auth/passkeys'), api('GET', '/v2/auth/second-factor')]);
  if (!d?.success || !Array.isArray(d.passkeys)) {
    setHtml(f, html`<div class="voucher-empty">${tRaw('settings.error')}</div>`);
    return;
  }
  const list = d.passkeys.length
    ? html`<div class="tw"><table class="dt" aria-label="${tRaw('pk.title')}"><thead><tr><th>${tRaw('pk.col.name')}</th><th>${tRaw('tokens.col.created')}</th>
        <th>${tRaw('tokens.col.last_used')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.passkeys.map(
          p => html`<tr><td><strong>${p.name || '—'}</strong></td>
          <td>${fmtDate(p.created_at, 'datetime')}</td>
          <td>${p.last_used ? fmtDate(p.last_used, 'datetime') : '—'}</td>
          <td><button class="btn bd btn-sm" data-click="deletePasskey"${genuine()} data-arg="${p.id}" data-arg2="${p.name || ''}" aria-label="${tRaw('common.delete')}">${ico('delete')}</button></td></tr>`,
        )}</tbody></table></div>`
    : html`<p class="hint-paragraph">${tRaw('pk.none')}</p>`;
  const addForm = !d.available
    ? html`<p class="text-small hint-warning">${tRaw(loggedInAccount?.isAdmin ? 'pk.without_domain_admin' : 'pk.without_domain')}</p>`
    : !passkeysPossible()
      ? html`<p class="text-small hint-warning">${tRaw('pk.browser')}</p>`
      : html`<form class="sform space-top-075" data-submit="pk-new" data-style="max-width:420px">
        <div class="fg"><label for="pk-name">${tRaw('pk.name')}</label><input type="text" id="pk-name" maxlength="60" /></div>
        <div class="fg"><label for="pk-pw">${tRaw('settings.password.current')}</label><input type="password" id="pk-pw" autocomplete="current-password" /></div>
        ${sf?.active ? html`<div class="fg"><label for="pk-code">${tRaw('login.code')}</label><input type="text" id="pk-code" inputmode="numeric" autocomplete="one-time-code" maxlength="24" /></div>` : ''}
        <div><button type="button" class="btn bp btn-sm" id="pk-new" data-click="addPasskey"${genuine()}>${tRaw('pk.add')}</button></div>
      </form>`;
  setHtml(f, html`${list}${addForm}`);
}

export async function addPasskey() {
  // With a second factor active, the server also demands the code.
  const o = await api('POST', '/v2/auth/passkey/register/options', {
    password: G('pk-pw')?.value || '',
    ...(G('pk-code') ? { code: G('pk-code').value.trim() } : {}),
  });
  for (const id of ['pk-pw', 'pk-code']) if (G(id)) G(id).value = '';
  if (!o?.success) {
    toast(o?.error || tRaw('settings.error'), 'error');
    return;
  }
  let answer;
  try {
    answer = await createPasskey(
      /** @type {OptionsJson & { user: { id: string, name: string, displayName: string } }} */ (o.options),
    );
  } catch {
    toast(tRaw('pk.cancelled'), 'info');
    return;
  }
  const d = await api('POST', '/v2/auth/passkey/register', { response: answer, name: G('pk-name')?.value || '' });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('pk.added'), 'success');
  loadPasskeys();
}

/** @param {string} id @param {string} name */
export async function deletePasskey(id, name) {
  const password = await confirmDeleteWithPassword(
    tRaw('pk.delete_title'),
    tRaw('pk.delete_text', { name: name || '—' }),
    'key',
    { button: 'confirm.btn.remove', kind: 'bd' },
  );
  if (password === null) return;
  const d = await withSecondFactor(z =>
    api('DELETE', `/v2/auth/passkeys/${encodeURIComponent(id)}`, { password, ...z }),
  );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('pk.deleted'), 'success');
  loadPasskeys();
}

// The button on the login page only shows up where the browser can do passkeys.
{
  const k = G('btn-passkey');
  if (k) k.hidden = !passkeysPossible();
  if (passkeysPossible()) fetchSetPasskey(() => getAssertion('second_factor'));
}

// Names below are registry-exposed (index.html/connection.js) — kept unchanged.
registerActions({ passkeyLogin, passkeySecondFactor, loadPasskeys, addPasskey, deletePasskey });
