import { echt, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum } from './format.js';
import { toast } from './meldungen.js';
import { loggedInAccount } from './state.js';
import { html } from './escaping.js';
import { bestaetigeMitPasswort, mitZweitemFaktor, setzePasskeyHolen } from './rueckfrage.js';

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
 * The server's options as JSON: buffers sit there as Base64url. The contract (PasskeyOptionen) leaves their
 * fields open; those are WebAuthn's.
 * @typedef {{ id: string, type?: string, transports?: string[] }} IdJson
 * @typedef {{ challenge: string, user?: { id: string, name: string, displayName: string },
 *   excludeCredentials?: IdJson[], allowCredentials?: IdJson[], [field: string]: unknown }} OptionsJson
 */
const withIds = (/** @type {IdJson[] | null | undefined} */ list) =>
  /** @type {PublicKeyCredentialDescriptor[]} */ ((list || []).map(c => ({ ...c, id: toBuffer(c.id) })));

/** Can this browser do passkeys? (Only in a secure context, i.e. over HTTPS.) */
export const passkeysMoeglich = () => !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);

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
  const o = await api('POST', '/v1/auth/passkey/anmelden/optionen', { zweck: purpose });
  if (!o?.success) {
    toast(o?.error || tRaw('settings.error'), 'error');
    return null;
  }
  const p = /** @type {OptionsJson} */ (o.optionen);
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
    toast(tRaw('pk.abgebrochen'), 'info');
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
export async function passkeyAnmelden() {
  const answer = await getAssertion('anmelden');
  if (!answer) return;
  const d = await api('POST', '/v1/auth/passkey/anmelden', { antwort: answer });
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
export async function passkeyZweiterFaktor() {
  const passkey = await getAssertion('zweiter_faktor');
  if (!passkey) return;
  const d = await api('POST', '/v1/auth/login', {
    username: G('lu').value,
    password: G('lp').value,
    ohne_token: true,
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
 * @param {{ keks_fehlt?: boolean }} d */
function cookieMissing(d) {
  if (!d.keks_fehlt) return false;
  const h = G('login-hinweis');
  h.textContent = tRaw('auth.cookie_fehlt');
  h.hidden = false;
  return true;
}

// ── Account ────────────────────────────────────────────────────────────────────

const area = () => G('pk-flaeche');

export async function ladePasskeys() {
  const f = area();
  if (!f) return;
  const [d, zf] = await Promise.all([api('GET', '/v1/auth/passkeys'), api('GET', '/v1/auth/zweiter-faktor')]);
  if (!d?.success || !Array.isArray(d.passkeys)) {
    setzeHtml(f, html`<div class="voucher-leer">${tRaw('settings.error')}</div>`);
    return;
  }
  const list = d.passkeys.length
    ? html`<div class="tw"><table class="dt" aria-label="${tRaw('pk.title')}"><thead><tr><th>${tRaw('pk.col.name')}</th><th>${tRaw('tokens.col.created')}</th>
        <th>${tRaw('tokens.col.last_used')}</th><th>${tRaw('users.col.actions')}</th></tr></thead><tbody>${d.passkeys.map(
          p => html`<tr><td><strong>${p.name || '—'}</strong></td>
          <td>${fmtDatum(p.created_at, 'tagzeit')}</td>
          <td>${p.last_used ? fmtDatum(p.last_used, 'tagzeit') : '—'}</td>
          <td><button class="btn bd btn-sm" data-click="passkeyLoeschen"${echt()} data-arg="${p.id}" data-arg2="${p.name || ''}" aria-label="${tRaw('common.delete')}">${ico('loeschen')}</button></td></tr>`,
        )}</tbody></table></div>`
    : html`<p class="hinweis-absatz">${tRaw('pk.none')}</p>`;
  const addForm = !d.verfuegbar
    ? html`<p class="text-klein hinweis-warnung">${tRaw(loggedInAccount?.isAdmin ? 'pk.ohne_domain_verwalter' : 'pk.ohne_domain')}</p>`
    : !passkeysMoeglich()
      ? html`<p class="text-klein hinweis-warnung">${tRaw('pk.browser')}</p>`
      : html`<form class="sform abstand-o-075" data-submit="pk-neu" data-stil="max-width:420px">
        <div class="fg"><label for="pk-name">${tRaw('pk.name')}</label><input type="text" id="pk-name" maxlength="60" /></div>
        <div class="fg"><label for="pk-pw">${tRaw('settings.password.current')}</label><input type="password" id="pk-pw" autocomplete="current-password" /></div>
        ${zf?.aktiv ? html`<div class="fg"><label for="pk-code">${tRaw('login.code')}</label><input type="text" id="pk-code" inputmode="numeric" autocomplete="one-time-code" maxlength="24" /></div>` : ''}
        <div><button type="button" class="btn bp btn-sm" id="pk-neu" data-click="passkeyHinzufuegen"${echt()}>${tRaw('pk.add')}</button></div>
      </form>`;
  setzeHtml(f, html`${list}${addForm}`);
}

export async function passkeyHinzufuegen() {
  // With a second factor active, the server also demands the code.
  const o = await api('POST', '/v1/auth/passkey/registrieren/optionen', {
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
      /** @type {OptionsJson & { user: { id: string, name: string, displayName: string } }} */ (o.optionen),
    );
  } catch {
    toast(tRaw('pk.abgebrochen'), 'info');
    return;
  }
  const d = await api('POST', '/v1/auth/passkey/registrieren', { antwort: answer, name: G('pk-name')?.value || '' });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('pk.added'), 'success');
  ladePasskeys();
}

/** @param {string} id @param {string} name */
export async function passkeyLoeschen(id, name) {
  const password = await bestaetigeMitPasswort(
    tRaw('pk.delete_title'),
    tRaw('pk.delete_text', { name: name || '—' }),
    'schluessel',
    { knopf: 'confirm.btn.entfernen', art: 'bd' },
  );
  if (password === null) return;
  const d = await mitZweitemFaktor(z =>
    api('DELETE', `/v1/auth/passkeys/${encodeURIComponent(id)}`, { password, ...z }),
  );
  if (!d) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('pk.deleted'), 'success');
  ladePasskeys();
}

// The button on the login page only shows up where the browser can do passkeys.
{
  const k = G('btn-passkey');
  if (k) k.hidden = !passkeysMoeglich();
  if (passkeysMoeglich()) setzePasskeyHolen(() => getAssertion('zweiter_faktor'));
}

// Names below are registry-exposed (index.html/verbindung.js) — kept unchanged.
registerActions({ passkeyAnmelden, passkeyZweiterFaktor, ladePasskeys, passkeyHinzufuegen, passkeyLoeschen });
