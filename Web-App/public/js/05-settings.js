import { registerActions } from './00-registry.js';
import { I18N, LANG, applyLang, locale, t, tRaw} from '../i18n.js';
import { CURRENCY, G, ME, _settingsCache, _updateLangSelect, api, applyTheme, esc, initDefaultCondition, knopfBesetzt, toast , set_CURRENCY, set_settingsCache} from './01-core.js';
import { loadGallery, loadStats } from './02-gallery.js';
import { loadParts } from './03-parts.js';
import { loadMinifigs } from './06-minifigs.js';
import { confirmDelete } from './07-admin.js';

// ═══ Einstellungen, SMTP, Profil, API-Keys, Benutzerverwaltung ═══
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── SETTINGS ──────────────────────────────────────────
// SMTP + Registration settings load/save
async function loadSmtpSettings(settings){
  if(!settings) return;
  const s=settings;
  if(G('smtp-host'))   G('smtp-host').value   = s.smtp_host||'';
  if(G('smtp-port'))   G('smtp-port').value   = s.smtp_port||'587';
  if(G('smtp-user'))   G('smtp-user').value   = s.smtp_user||'';
  if(G('smtp-pass'))   G('smtp-pass').value   = s.smtp_pass||'';
  if(G('smtp-from'))   G('smtp-from').value   = s.smtp_from||'';
  if(G('smtp-secure')) G('smtp-secure').checked = s.smtp_secure==='1';
  if(G('smtp-insecure')) G('smtp-insecure').checked = s.smtp_insecure_tls==='1';
  if(G('reg-enabled')) G('reg-enabled').checked = s.registration_enabled!=='0';
}

G('btn-test-smtp')?.addEventListener('click', async()=>{
  const btn = G('btn-test-smtp');
  const res = G('smtp-test-result');
  const frei = knopfBesetzt(btn);
  // Save first
  await api('POST','/v1/settings',{
    smtp_host: G('smtp-host').value.trim(), smtp_port: G('smtp-port').value||'587',
    smtp_user: G('smtp-user').value.trim(), smtp_pass: G('smtp-pass').value,
    smtp_from: G('smtp-from').value.trim(), smtp_secure: G('smtp-secure').checked?'1':'0',
    smtp_insecure_tls: G('smtp-insecure')?.checked?'1':'0',
  });
  const d = await api('POST','/v1/settings/smtp-test', { to: G('smtp-test-email')?.value?.trim() || ME?.email || '' });
  frei();
  res.style.display = 'block';
  if(d.success) {
    res.style.background = 'var(--g50)'; res.style.color = 'var(--g700)'; res.style.border = '1px solid var(--g300)';
    res.textContent = d.mode === 'console' ? t('smtp.console') : '✅ ' + (d.message || t('smtp.ok'));
  } else {
    res.style.background = 'var(--r100)'; res.style.color = 'var(--r500)'; res.style.border = '1px solid var(--r300)';
    res.textContent = '❌ ' + (d.error || t('settings.error'));
  }
});

G('btn-sav-smtp')?.addEventListener('click', async()=>{
  const d=await api('POST','/v1/settings',{
    smtp_host:   G('smtp-host').value.trim(),
    smtp_port:   G('smtp-port').value||'587',
    smtp_user:   G('smtp-user').value.trim(),
    smtp_pass:   G('smtp-pass').value,
    smtp_from:   G('smtp-from').value.trim(),
    smtp_secure: G('smtp-secure').checked?'1':'0',
    smtp_insecure_tls: G('smtp-insecure')?.checked?'1':'0',
  });
  toast(d.success?t('smtp.saved'):t('settings.error'),d.success?'success':'error');
});

async function saveRegEnabled(){
  const d=await api('POST','/v1/settings',{ registration_enabled: G('reg-enabled').checked?'1':'0' });
  toast(d.success?t('settings.reg_saved'):t('settings.error'),d.success?'success':'error');
}

export async function loadCacheTtl() {
  initCacheTtlBtn();
  try {
    const d = await api('GET', '/v1/admin/cache-ttl');
    if (d.success) { const sel = G('mon-cache-ttl'); if (sel) sel.value = d.ttl || '24'; }
  } catch(_) {}
  try {
    const dc = await api('GET', '/v1/settings/default-condition');
    if (dc.success) {
      const sel = G('mon-default-condition'); if (sel) sel.value = dc.condition || 'N';
      // Pre-fill user settings select with effective default (monitoring value for new users)
      const userSel = G('s-default-condition');
      if (userSel && !userSel.dataset.loaded) {
        userSel.value = dc.condition || 'N';
        userSel.dataset.loaded = '1';
      }
    }
  } catch(_) {}
}

function initCacheTtlBtn() {
  const btn = G('btn-save-cache-ttl');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', async () => {
      const ttl = G('mon-cache-ttl')?.value || '24';
      const d = await api('POST', '/v1/admin/cache-ttl', { ttl });
      // Gleichzeitig den Default-Preiszustand speichern
      const cond = G('mon-default-condition')?.value;
      if (cond) await api('POST', '/v1/admin/default-condition', { condition: cond }).catch(()=>{});
      toast(d.success ? t('settings.cache_ttl_saved') : t('settings.error'), d.success ? 'success' : 'error');
    });
  }
}

export async function loadRateLimitStats(){
  const d = await api('GET','/v1/admin/cache-stats');
  if(!d.success || !d.rate_limits) return;
  const fmt = (rl) => rl ? `${rl.count.toLocaleString(locale())} / ${rl.limit.toLocaleString(locale())}` : '—';
  if(G('rl-bricklink'))   G('rl-bricklink').textContent   = fmt(d.rate_limits.bricklink);
  if(G('rl-rebrickable')) G('rl-rebrickable').textContent = fmt(d.rate_limits.rebrickable);
  if(G('rl-brickset'))    G('rl-brickset').textContent    = fmt(d.rate_limits.brickset);
}
export async function loadCacheStats(){
  const d = await api('GET','/v1/admin/cache-stats');
  if(!d.success) return;
  if(G('cs-prices'))  G('cs-prices').textContent  = d.prices  || 0;
  if(G('cs-subsets')) G('cs-subsets').textContent = d.subsets || 0;
  if(G('cs-catalog')) G('cs-catalog').textContent = d.catalog || 0;
}
export async function loadApiLimits() {
  const d = await api('GET', '/v1/admin/api-limits');
  if (!d.success) return;
  G('lim-rb').value = d.limits.rebrickable;
  G('lim-bl').value = d.limits.bricklink;
  G('lim-bs').value = d.limits.brickset;
}

// QR Code generation using qrcode.js CDN
async function generateQrCode() {
  const btn = G('btn-gen-qr');
  const urlInput = G('qr-server-url');
  if (urlInput) urlInput.value = window.location.origin;
  const hint = G('qr-hint');
  const container = G('qr-code');
  const frei = knopfBesetzt(btn);
  try {
    // POST, nicht GET (Nachtrag 154): Der Aufruf LEGT eine Nonce AN. Als GET war
    // er über eine Navigation von einer fremden Seite auslösbar, weil
    // SameSite=lax das Cookie dort mitschickt.
    const d = await api('POST', '/v1/auth/qr-token');
    if (!d.success) { hint.textContent = tRaw('toast.error')+': ' + (d.error||t('common.unknown')); frei(); return; }
    // Get current server URL
    // Use the URL from the input field, fallback to window.location.origin
    const inputUrl = G('qr-server-url')?.value?.trim();
    let serverUrl = inputUrl || window.location.origin;
    serverUrl = serverUrl.replace(/\/$/, ''); // remove trailing slash

    // Full payload: server URL + token
    const qrData = JSON.stringify({ url: serverUrl, token: d.token });
    // Clear and render QR code
    container.innerHTML = '';
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
    // Dauer vom Server nehmen, nicht fest verdrahten: /qr-token liefert
    // expires_in mit. Hier stand 1800 (30 Minuten), während der Token seit der
    // Sicherheitshärtung nach 5 Minuten abläuft — der Zähler lief also 25
    // Minuten weiter, obwohl der Code längst ungültig war.
    let secs = parseInt(d.expires_in) || 300;
    const fmt = (v) => `${Math.floor(v/60)}:${(v%60).toString().padStart(2,'0')}`;
    const timer = setInterval(() => {
      secs--;
      hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
      if (secs <= 0) { clearInterval(timer); hint.textContent = tRaw('qr.expired'); container.innerHTML=''; }
    }, 1000);
    hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
    // Nach dem ersten Erzeugen heisst der Knopf „Neu generieren" — die eine
    // Stelle, an der die Beschriftung sich absichtlich ändert.
    frei(tRaw('qr.regenerate'));
  } catch(e) { hint.textContent = tRaw('toast.error')+': ' + e.message; frei(); }
}

G('btn-gen-qr').onclick = generateQrCode;

// ── ANGEMELDETE GERÄTE ────────────────────────────────────────────────────
//
// Die Endpunkte /v1/settings/tokens gab es schon, einen Weg dorthin nicht:
// Ein verlorenes Telefon war nur loszuwerden, indem man das Passwort ändert
// (das verwirft ALLE Zugänge). Wer nur eines aussperren wollte, sperrte alle
// aus.
//
// Der eigene Zugang wird MITGESCHICKT — anders kann der Server nicht sagen,
// welche Zeile zu diesem Browser gehört, und der Knopf „alle anderen
// abmelden" wüsste nicht, wovon er absehen soll. api() setzt den
// Authorization-Header nicht (die Webapp arbeitet über die Sitzung), deshalb
// hier ein eigener fetch — dieselbe Stelle wie beim Abmelden in 01-core.js.
async function tokenRuf(pfad, method = 'GET') {
  const wt = sessionStorage.getItem('webToken');
  const r = await fetch('/api/v1/settings' + pfad, {
    method,
    headers: wt ? { 'Authorization': 'Bearer ' + wt } : {},
  });
  return r.json().catch(() => ({ success: false, error: 'HTTP ' + r.status }));
}

/** „—", wenn nie benutzt: `new Date(null)` wäre der 1.1.1970. */
function tokenDatum(wert) {
  if (!wert) return '—';
  return new Date(wert).toLocaleString(locale());
}

export async function loadTokens() {
  const ziel = G('tokens-tbl');
  if (!ziel) return;
  const d = await tokenRuf('/tokens');
  if (!d.success) { ziel.innerHTML = `<p style="color:var(--mut)">${esc(d.error || t('settings.error'))}</p>`; return; }
  if (!d.tokens.length) { ziel.innerHTML = `<p style="color:var(--mut)">${t('tokens.none')}</p>`; return; }
  ziel.innerHTML = `<div class="tw"><table class="dt"><thead><tr>
      <th>${t('tokens.col.label')}</th><th>${t('tokens.col.created')}</th>
      <th>${t('tokens.col.last_used')}</th><th>${t('tokens.col.expires')}</th>
      <th>${t('users.col.actions')}</th></tr></thead><tbody>${
    d.tokens.map(tk => `<tr>
      <td><strong>${esc(tk.label || '—')}</strong>${tk.aktuell ? ` <span class="rb ra">${t('tokens.current')}</span>` : ''}</td>
      <td>${tokenDatum(tk.created_at)}</td>
      <td>${tokenDatum(tk.last_used)}</td>
      <td>${tk.never_expires ? t('tokens.never') : tokenDatum(tk.expires_at)}</td>
      <td>${tk.aktuell ? '' :
        `<button class="btn bd btn-sm" data-click="revokeToken" data-arg="${esc(tk.token_id)}" data-arg2="${esc(tk.label || '')}">🗑️</button>`}</td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

async function revokeToken(tokenId, label) {
  if (!await confirmDelete(tRaw('tokens.revoke.title'), tRaw('tokens.revoke.text', { name: label || '—' }), '🔑')) return;
  const d = await tokenRuf('/tokens/' + encodeURIComponent(tokenId), 'DELETE');
  if (d.success) { toast(tRaw('tokens.revoked'), 'success'); loadTokens(); }
  else toast(d.error || t('settings.error'), 'error');
}

/**
 * Alle Zugänge ausser dem eigenen entwerten.
 *
 * Nacheinander über den bestehenden Endpunkt, statt dafür einen neuen zu
 * bauen: Es sind eine Handvoll Zeilen, und eine zweite Adresse für „dasselbe,
 * nur mehrfach" wäre genau die Art Doppelung, die dieses Projekt sonst
 * abbaut. Gezählt wird, was WIRKLICH weg ist — nicht, wie oft geklickt wurde.
 *
 * Ohne den eigenen Zugang in der Liste (kein webToken im sessionStorage, etwa
 * weil das INSERT beim Anmelden scheiterte) wäre „alle anderen" nicht
 * bestimmbar — dann lieber gar nichts tun als den eigenen mit abräumen.
 */
async function revokeOtherTokens() {
  const d = await tokenRuf('/tokens');
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  const andere = d.tokens.filter(tk => !tk.aktuell);
  if (!andere.length) { toast(tRaw('tokens.no_others'), 'success'); return; }
  if (!d.tokens.some(tk => tk.aktuell)) { toast(tRaw('tokens.self_unknown'), 'error'); return; }
  if (!await confirmDelete(tRaw('tokens.revoke_others.title'),
                           tRaw('tokens.revoke_others.text', { n: andere.length }), '🚪')) return;
  let weg = 0;
  for (const tk of andere) {
    const r = await tokenRuf('/tokens/' + encodeURIComponent(tk.token_id), 'DELETE');
    weg += r.deleted || 0;
  }
  toast(tRaw('tokens.revoked_n', { n: weg }), weg === andere.length ? 'success' : 'error');
  loadTokens();
}

export async function loadProfile() {
  const d = await api('GET', '/v1/auth/profile');
  if (!d.success) return;
  const u = d.user;
  G('prof-first').value = u.first_name || '';
  G('prof-last').value  = u.last_name  || '';
  G('prof-user').value  = u.username   || '';
  G('prof-email').value = u.email      || '';
  const vEl = G('prof-email-verified');
  if (vEl) vEl.innerHTML = u.email_verified
    ? `<span style="color:var(--g500)">${t('profile.verified')}</span>`
    : `<span style="color:var(--a500)">${t('profile.not_verified')}</span>`;
}

G('btn-sav-prof').onclick = async () => {
  const first_name = G('prof-first').value.trim();
  const last_name  = G('prof-last').value.trim();
  const username   = G('prof-user').value.trim();
  const email      = G('prof-email').value.trim();
  const pwC = G('pw-c').value, pwN = G('pw-n').value, pwR = G('pw-r').value;
  const wantsPwChange = !!(pwC || pwN || pwR);

  // Erst ALLES validieren, dann speichern — sonst würde bei einem Passwort-
  // Fehler das Profil trotzdem schon geändert (halber Speichervorgang).
  if (!username) { toast(tRaw('profile.username_empty'), 'error'); return; }
  if (wantsPwChange) {
    if (!pwC || !pwN) { toast(tRaw('settings.password.fill_all'), 'error'); return; }
    if (pwN !== pwR)  { toast(tRaw('settings.password.mismatch'), 'error'); return; }
  }

  const btn = G('btn-sav-prof'); btn.disabled = true;
  try {
    // Währung (Sprache speichert setLang() bereits beim Umschalten)
    const dCur = await api('POST', '/v1/settings', { currency: G('s-cur').value });
    if (!dCur.success) { toast(dCur.error || t('settings.error'), 'error'); return; }
    set_CURRENCY(G('s-cur').value);

    // Benutzerspezifischer Standard-Zustand (immer N oder U, nie leer)
    const condVal = G('s-default-condition')?.value || 'N';
    await api('POST', '/v1/settings/user/default-condition', { condition: condVal }).catch(()=>{});
    // Erfassungsformulare sofort auf den neuen Default umstellen (ohne Reload)
    if (typeof initDefaultCondition === 'function') initDefaultCondition();

    // Profil
    const d = await api('PUT', '/v1/auth/profile', { username, email, first_name, last_name });
    if (!d.success) { toast(d.error || t('profile.save_error'), 'error'); return; }
    if (d.emailChanged) {
      const hint = G('prof-email-hint');
      if (hint) hint.textContent = tRaw('profile.mail_sent_hint');
    }
    await loadProfile();
    // Der Namenszug in der Kopfzeile wird sonst nur EINMAL gesetzt (showApp,
    // 01-core.js) und truege bis zum naechsten Neuladen den alten Namen.
    // Das Element heisst `ubadge`; hier stand `uname`, das es im HTML nicht
    // gibt — die Zeile lief seither ins Leere.
    if (ME) { ME.username = username; const uel = G('ubadge'); if (uel) uel.textContent = username; }

    // Passwort (optional)
    if (wantsPwChange) {
      const dPw = await api('POST', '/v1/auth/change-password', { current: pwC, newPassword: pwN });
      if (!dPw.success) {
        // Profil & Währung sind gespeichert, nur das Passwort schlug fehl —
        // das dem Nutzer explizit so sagen statt pauschal "Fehler".
        toast(tRaw('settings.password.failed_rest_saved', { error: dPw.error || t('settings.error') }), 'error');
        return;
      }
      G('pw-c').value = G('pw-n').value = G('pw-r').value = '';
    }

    toast(d.emailChanged ? t('profile.saved_mail') : t('settings.saved'), 'success');
  } finally {
    btn.disabled = false;
  }
};

function applySettings(s){
  // Only apply if the settings tab fields are present in the DOM
  if(!G('s-cur') && !G('bl-ck')) return;
  set_CURRENCY(s.currency||'EUR');
  // Apply language preference from server only if explicitly set
  if(s.language && I18N[s.language] && s.language !== LANG) applyLang(s.language, false);
  _updateLangSelect();
  const _set = (id, v) => { const el=G(id); if(el) el.value=v; };
  _set('s-cur',          CURRENCY);
  _set('s-default-condition', s.user_default_condition || s.default_price_condition || 'N');
  if(ME?.isAdmin){
    _set('bl-ck',  s.bricklink_consumer_key||'');
    _set('bl-cs',  s.bricklink_consumer_secret||'');
    _set('bl-tok', s.bricklink_token||'');
    _set('bl-ts',  s.bricklink_token_secret||'');
    _set('rb-key', s.rebrickable_api_key||'');
    _set('bs-key', s.brickset_api_key||'');
    _set('mon-app-theme', s.app_theme||'classic');
    loadUsers(); loadSmtpSettings(s);
  }
  if(ME?.isAdmin) loadRateLimitStats();
}
export async function loadSettings(){
  // Show cached data instantly so the tab never appears empty
  if(_settingsCache) applySettings(_settingsCache);
  loadHousehold();
  const d=await api('GET','/v1/settings/raw'); if(!d.success) return;
  set_settingsCache(d.settings);
  applySettings(_settingsCache);
}

// ═══════════════════════════════════════════════════════════════════════════
// HAUSHALT — Konten verknüpfen
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Ablauf: Das Hauptkonto erzeugt einen Einladungscode, das andere Konto gibt
 * ihn hier ein. Zustimmen muss zwingend BEIDE Seiten — der eine durch
 * Erzeugen, der andere durch Einlösen.
 *
 * Die Karte zeigt je nach Rolle nur EINEN der beiden Kästen. Wer schon
 * Unterkonto ist, sieht keinen Einladungsknopf (Konten lassen sich nur über
 * eine Stufe verknüpfen), und wer Unterkonten hat, sieht kein Eingabefeld.
 * Beides würde der Server ohnehin ablehnen — aber ein Knopf, der immer eine
 * Fehlermeldung erzeugt, ist schlimmer als keiner.
 */
export async function loadHousehold(){
  const d = await api('GET','/v1/settings/household').catch(()=>null);
  if(!d?.success) return;
  renderHousehold(d);
}

function renderHousehold(d){
  const stateEl  = G('household-state');
  const inviteEl = G('household-invite-box');
  const redeemEl = G('household-redeem-box');
  if(!stateEl) return;

  if(d.is_sub){
    stateEl.innerHTML = `<div style="padding:.55rem .8rem;border-radius:8px;background:var(--b100);color:var(--b600)">
      ${t('household.state_sub', { name: esc(d.linked_to?.username || '') })}
      <button class="btn" style="margin-left:.6rem" data-click="unlinkHousehold">${t('household.unlink_self')}</button>
    </div>`;
  } else if(d.sub_accounts?.length){
    const rows = d.sub_accounts.map(a => `<li style="display:flex;align-items:center;gap:.6rem;padding:.3rem 0">
      <span style="font-weight:600">${esc(a.username)}</span>
      <button class="btn" data-click="unlinkHousehold" data-arg="${a.id}">${t('household.unlink_sub')}</button>
    </li>`).join('');
    stateEl.innerHTML = `<div>${t('household.state_main', { n: d.sub_accounts.length })}
      <ul style="list-style:none;padding:0;margin:.4rem 0 0">${rows}</ul></div>`;
  } else {
    stateEl.innerHTML = `<div style="color:var(--mut)">${t('household.state_none', { cur: esc(d.currency||'') })}</div>`;
  }

  // Einladen kann, wer nicht selbst Unterkonto ist; einlösen, wer weder
  // Unterkonto noch Hauptkonto ist.
  if(inviteEl) inviteEl.style.display = d.is_sub ? 'none' : '';
  if(redeemEl) redeemEl.style.display = (d.is_sub || d.is_main) ? 'none' : '';
}

export async function createHouseholdInvite(){
  const d = await api('POST','/v1/settings/household/invite',{});
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  const out = G('household-invite-out');
  G('household-invite-code').value = d.code;
  if(out) out.style.display = '';
  toast(tRaw('household.invite_created'),'success');
}

export async function copyHouseholdInvite(){
  const el = G('household-invite-code');
  if(!el?.value) return;
  // Zwischenablage kann fehlschlagen (kein HTTPS, Berechtigung verweigert) —
  // dann markieren statt die Aktion still verpuffen zu lassen.
  try {
    await navigator.clipboard.writeText(el.value);
    toast(tRaw('household.invite_copied'),'success');
  } catch(_) {
    el.select();
    toast(tRaw('household.invite_copy_manual'),'info');
  }
}

export async function redeemHouseholdInvite(){
  const code = (G('household-redeem-code')?.value || '').trim();
  if(!code){ toast(tRaw('household.redeem_empty'),'error'); return; }
  const d = await api('POST','/v1/settings/household/redeem',{ code });
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  G('household-redeem-code').value = '';
  // tRaw + roher Name: Der Toast setzt Text, keine HTML — mit esc() stünde
  // dort "Marco &amp; Co" statt "Marco & Co".
  toast(tRaw('household.redeem_ok', { name: d.linked_to?.username || '' }),'success');
  loadHousehold();
}

export async function unlinkHousehold(subUserId){
  if(!await confirmDelete(tRaw('household.unlink_confirm_title'), t('household.unlink_confirm_text'), '🔗')) return;
  const d = await api('POST','/v1/settings/household/unlink', subUserId ? { sub_user_id: parseInt(subUserId) } : {});
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  toast(tRaw('household.unlink_ok'),'success');
  loadHousehold();
}
G('btn-sav-bl').onclick=async()=>{ const d=await api('POST','/v1/settings',{bricklink_consumer_key:G('bl-ck').value,bricklink_consumer_secret:G('bl-cs').value,bricklink_token:G('bl-tok').value,bricklink_token_secret:G('bl-ts').value}); if(d.success) await api('PUT','/v1/admin/api-limits',{bricklink:parseInt(G('lim-bl').value)}); toast(d.success?t('settings.bl_saved'):t('settings.error'),d.success?'success':'error'); if(d.success){loadRateLimitStats();} };
G('btn-sav-rb').onclick=async()=>{ const d=await api('POST','/v1/settings',{rebrickable_api_key:G('rb-key').value}); if(d.success) await api('PUT','/v1/admin/api-limits',{rebrickable:parseInt(G('lim-rb').value)}); toast(d.success?t('settings.rb_saved'):t('settings.error'),d.success?'success':'error'); if(d.success){loadRateLimitStats();} };
G('btn-sav-bs').onclick=async()=>{ const d=await api('POST','/v1/settings',{brickset_api_key:G('bs-key').value}); if(d.success) await api('PUT','/v1/admin/api-limits',{brickset:parseInt(G('lim-bs').value)}); toast(d.success?t('settings.bs_saved'):t('settings.error'),d.success?'success':'error'); if(d.success){loadRateLimitStats();} };
G('btn-save-theme').onclick=async()=>{ const theme=G('mon-app-theme')?.value||'classic'; const d=await api('POST','/v1/settings/admin/theme',{theme}); if(d.success){ if(typeof applyTheme==='function') applyTheme(theme); if(_settingsCache) _settingsCache.app_theme=theme; } toast(d.success?t('settings.theme_saved'):t('settings.error'),d.success?'success':'error'); };
G('btn-clr-prices').onclick=async()=>{ await api('POST','/v1/admin/cache-clear'); toast(tRaw('settings.cache_cleared'),'success'); loadCacheStats(); };
G('btn-clr-all-cache').onclick=async()=>{
  if(!await confirmDelete(tRaw('settings.all_cache.clear'),t('settings.all_cache.clear'),'🗄️')) return;
  await api('POST','/v1/admin/cache-clear',{all:true});
  toast(tRaw('settings.all_cache.cleared'),'success'); loadCacheStats();
};
G('btn-dall').onclick=async()=>{
  // Two-step confirmation for destructive action
  if(!await confirmDelete(tRaw('settings.delete_all.title'),t('settings.delete_all.text'),'🔥')) return;
  const confirm2 = window.prompt(t('settings.delete_all.prompt'));
  if(confirm2 !== t('settings.delete_all.confirm')) { toast(tRaw('settings.delete_all.cancelled'),'info'); return; }
  toast(tRaw('settings.delete_all.deleting'),'info');
  // accounts=own, zweimal — beim Auflisten UND beim Löschen.
  //
  // Ohne das listete der Knopf im Haushalt auch die Sets der verknüpften
  // Konten, und DELETE löschte jede Nummer im vollen Schreib-Blickfeld.
  // NACHGEMESSEN mit zwei Konten: Das Unterkonto verlor Sets, Teile und
  // Minifiguren vollständig — darunter ein Set, das das Hauptkonto nie besass.
  // Der Knopf heisst „Alle MEINE Sets löschen" und der Text verspricht
  // „Deine gesamte Sammlung".
  //
  // Fest 'own' und nicht scopeQuery(): Das Versprechen des Knopfes hängt nicht
  // davon ab, welchen Kontofilter jemand zuletzt in der Galerie stehen hatte.
  const s=await api('GET','/v1/sets?accounts=own');
  for(const set of s.sets||[]) await api('DELETE',`/v1/sets/${esc(set.set_number)}?accounts=own`);
  toast(tRaw('settings.delete_all.done'),'success'); loadGallery(); loadParts(); loadMinifigs(); loadStats();
};

// ── USER MGMT ─────────────────────────────────────────
async function loadUsers(){
  const d=await api('GET','/v1/auth/users'); if(!d.success) return;
  G('users-tbl').innerHTML=`<div class="tw"><table class="dt user-tbl"><thead><tr><th>ID</th><th>${t('users.col.username')}</th><th>${t('users.col.role')}</th><th>${t('users.col.created')}</th><th>${t('users.col.actions')}</th></tr></thead><tbody>${
    d.users.map(u=>`<tr><td>${u.id}</td><td><strong>${esc(u.username)}</strong></td>
      <td><span class="rb ${u.is_admin?'ra':'ru'}">${u.is_admin?t('users.role.admin'):t('users.role.user')}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString(locale())}</td>
      <td style="display:flex;gap:5px">
        <button class="btn bs btn-sm" data-click="openRpw" data-arg="${u.id}">🔑</button>
        <button class="btn bs btn-sm" data-click="toggleAdmin" data-arg="${u.id}" data-arg2="${u.is_admin}">${u.is_admin?'⬇️':'⬆️'}</button>
        <button class="btn bd btn-sm" data-click="delUser" data-arg="${u.id}" data-arg2="${esc(u.username)}">🗑️</button>
      </td></tr>`).join('')
  }</tbody></table></div>`;
}
G('btn-cu').onclick=async()=>{
  const n=G('nu-n').value.trim(),p=G('nu-p').value,a=G('nu-a').checked;
  if(!n||!p){toast(tRaw('users.name_pw_req'),'error');return;}
  const d=await api('POST','/v1/auth/users',{username:n,password:p,is_admin:a});
  if(d.success){toast(tRaw('users.created',{name:n}),'success');G('nu-n').value=G('nu-p').value='';G('nu-a').checked=false;loadUsers();} else toast(d.error||t('settings.error'),'error');
};
function openRpw(uid){ G('rpw-uid').value=uid; G('rpw-v').value=''; G('pw-modal').classList.add('open'); }
G('btn-rpw').onclick=async()=>{
  const d=await api('PUT',`/v1/auth/users/${G('rpw-uid').value}/password`,{password:G('rpw-v').value});
  if(d.success){toast(tRaw('users.pw_reset'),'success');G('pw-modal').classList.remove('open');} else toast(d.error||t('settings.error'),'error');
};
async function toggleAdmin(uid,isAdmin){
  // isAdmin kommt seit der data-arg-Umstellung als Zeichenkette. `!"0"` ist
  // false — das Umschalten hätte damit IMMER auf "kein Admin" gesetzt.
  const cur = isAdmin === true || isAdmin === 1 || isAdmin === '1';
  const d=await api('PUT',`/v1/auth/users/${uid}/admin`,{is_admin:!cur}); if(d.success){toast(tRaw('users.role_changed'),'success');loadUsers();} else toast(d.error||t('settings.error'),'error'); }
async function delUser(uid,name){ if(!await confirmDelete(tRaw('users.delete.title'),t('users.delete.text'),'👤')) return; const d=await api('DELETE',`/v1/auth/users/${uid}`); if(d.success){toast(name+' '+t('common.updated'),'success');loadUsers();} else toast(d.error||t('settings.error'),'error'); }



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  copyHouseholdInvite,
  createHouseholdInvite,
  delUser,
  loadTokens,
  openRpw,
  redeemHouseholdInvite,
  revokeOtherTokens,
  revokeToken,
  saveRegEnabled,
  toggleAdmin,
  unlinkHousehold,
});
