import { registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { ico, G, api, esc, toast } from './01-core.js';
import { bestaetigeMitPasswort } from './07-admin.js';

// ═══ Passkeys (Server: utils/passkeys.ts, routes/passkeys.ts) ═══════════════
// Ohne Fremdskript: Der Server schickt die Optionen als JSON (Base64URL), der
// Browser braucht ArrayBuffer — die Umwandlung in beide Richtungen steht hier.

const zuPuffer = (b64u) => {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64u.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
};
const zuText = (puffer) => {
  let s = '';
  for (const b of new Uint8Array(puffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const mitIds = (liste) => (liste || []).map(c => ({ ...c, id: zuPuffer(c.id) }));

/** Kann dieser Browser Passkeys? (Nur in einem sicheren Kontext, also über HTTPS.) */
export const passkeysMoeglich = () => !!(window.PublicKeyCredential && window.isSecureContext && navigator.credentials);

async function erzeuge(o) {
  const c = /** @type {PublicKeyCredential} */ (await navigator.credentials.create({ publicKey: {
    ...o, challenge: zuPuffer(o.challenge), user: { ...o.user, id: zuPuffer(o.user.id) },
    excludeCredentials: mitIds(o.excludeCredentials) } }));
  const r = /** @type {AuthenticatorAttestationResponse} */ (c.response);
  return { id: c.id, rawId: zuText(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(),
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
    response: { clientDataJSON: zuText(r.clientDataJSON), attestationObject: zuText(r.attestationObject),
      transports: r.getTransports ? r.getTransports() : [] } };
}

/** Eine Anmeldeantwort für `zweck` holen; null, wenn abgebrochen. */
async function bestaetige(zweck) {
  const o = await api('POST', '/v1/auth/passkey/anmelden/optionen', { zweck });
  if (!o?.success) { toast(o?.error || tRaw('settings.error'), 'error'); return null; }
  const p = o.optionen;
  /** @type {PublicKeyCredential} */
  let c;
  try {
    c = /** @type {PublicKeyCredential} */ (await navigator.credentials.get({ publicKey: { ...p,
      challenge: zuPuffer(p.challenge), allowCredentials: mitIds(p.allowCredentials) } }));
  } catch { toast(tRaw('pk.abgebrochen'), 'info'); return null; }
  const r = /** @type {AuthenticatorAssertionResponse} */ (c.response);
  return { id: c.id, rawId: zuText(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(),
    response: { clientDataJSON: zuText(r.clientDataJSON),
      authenticatorData: zuText(r.authenticatorData), signature: zuText(r.signature),
      ...(r.userHandle ? { userHandle: zuText(r.userHandle) } : {}) } };
}

// ── Anmeldeseite ─────────────────────────────────────────────────────────────

/** Ohne Passwort: Der Browser bietet die Passkeys dieser Seite an. */
export async function passkeyAnmelden() {
  const antwort = await bestaetige('anmelden');
  if (!antwort) return;
  const d = await api('POST', '/v1/auth/passkey/anmelden', { antwort });
  if (!d?.success) { G('lerr').textContent = d?.error || tRaw('settings.error'); G('lerr').style.display = 'block'; return; }
  // Der Start liest die Sitzung neu (GET /auth/me) — derselbe Weg wie nach einem Neuladen.
  location.reload();
}

/** Zweiter Faktor: Passkey statt Code, zusammen mit Name und Passwort von oben. */
export async function passkeyZweiterFaktor() {
  const passkey = await bestaetige('zweiter_faktor');
  if (!passkey) return;
  const d = await api('POST', '/v1/auth/login',
    { username: G('lu').value, password: G('lp').value, ohne_token: true, passkey });
  if (!d?.success) { G('lerr').textContent = d?.error || tRaw('settings.error'); G('lerr').style.display = 'block'; return; }
  location.reload();
}

// ── Konto ────────────────────────────────────────────────────────────────────

const flaeche = () => G('pk-flaeche');

export async function ladePasskeys() {
  const f = flaeche();
  if (!f) return;
  const d = await api('GET', '/v1/auth/passkeys');
  if (!d?.success || !Array.isArray(d.passkeys)) { f.innerHTML = `<div class="voucher-leer">${t('settings.error')}</div>`; return; }
  const liste = d.passkeys.length
    ? `<div class="tw"><table class="dt"><thead><tr><th>${t('pk.col.name')}</th><th>${t('tokens.col.created')}</th>
        <th>${t('tokens.col.last_used')}</th><th>${t('users.col.actions')}</th></tr></thead><tbody>${
        d.passkeys.map(p => `<tr><td><strong>${esc(p.name || '—')}</strong></td>
          <td>${new Date(p.created_at).toLocaleString()}</td>
          <td>${p.last_used ? new Date(p.last_used).toLocaleString() : '—'}</td>
          <td><button class="btn bd btn-sm" data-click="passkeyLoeschen" data-arg="${esc(p.id)}" data-arg2="${esc(p.name || '')}" aria-label="${esc(tRaw('common.delete'))}">${ico('loeschen')}</button></td></tr>`).join('')
      }</tbody></table></div>`
    : `<p class="hinweis-absatz">${t('pk.none')}</p>`;
  const neu = !d.verfuegbar ? `<p class="text-klein hinweis-warnung">${t('pk.ohne_domain')}</p>`
    : !passkeysMoeglich() ? `<p class="text-klein hinweis-warnung">${t('pk.browser')}</p>`
    : `<form class="sform abstand-o-075" data-submit="pk-neu" data-stil="max-width:420px">
        <div class="fg"><label for="pk-name">${t('pk.name')}</label><input type="text" id="pk-name" maxlength="60" /></div>
        <div class="fg"><label for="pk-pw">${t('settings.password.current')}</label><input type="password" id="pk-pw" autocomplete="current-password" /></div>
        <div><button type="button" class="btn bp btn-sm" id="pk-neu" data-click="passkeyHinzufuegen">${t('pk.add')}</button></div>
      </form>`;
  f.innerHTML = liste + neu;
}

export async function passkeyHinzufuegen() {
  const o = await api('POST', '/v1/auth/passkey/registrieren/optionen', { password: G('pk-pw')?.value || '' });
  if (G('pk-pw')) G('pk-pw').value = '';
  if (!o?.success) { toast(o?.error || tRaw('settings.error'), 'error'); return; }
  let antwort;
  try { antwort = await erzeuge(o.optionen); }
  catch { toast(tRaw('pk.abgebrochen'), 'info'); return; }
  const d = await api('POST', '/v1/auth/passkey/registrieren', { antwort, name: G('pk-name')?.value || '' });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw('pk.added'), 'success');
  ladePasskeys();
}

export async function passkeyLoeschen(id, name) {
  const password = await bestaetigeMitPasswort(tRaw('pk.delete_title'), tRaw('pk.delete_text', { name: name || '—' }), 'schluessel');
  if (password === null) return;
  const d = await api('DELETE', `/v1/auth/passkeys/${encodeURIComponent(id)}`, { password });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw('pk.deleted'), 'success');
  ladePasskeys();
}

// Der Knopf auf der Anmeldeseite erscheint nur, wo der Browser Passkeys kann.
{
  const k = G('btn-passkey');
  if (k) k.hidden = !passkeysMoeglich();
}

registerActions({ passkeyAnmelden, passkeyZweiterFaktor, ladePasskeys, passkeyHinzufuegen, passkeyLoeschen });
