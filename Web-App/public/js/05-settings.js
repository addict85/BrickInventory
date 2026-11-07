import { loadHousehold } from './05-haushalt.js';
import { loadUsers } from './05-nutzerverwaltung.js';
import { stelleZielBereit } from './00-ziele.js';
import { echt, registerActions } from './00-registry.js';
import { I18N, LANG, applyLang, locale, t, tRaw } from '../i18n.js';
import { fmtDatum } from './01-format.js';
import { fehlerMeldung, api } from './01-api.js';
import { ico, G, knopfBesetzt, setzeHtml } from './01-dom.js';
import { antwortFehler, feldFehler, passwortRegelText } from './01-formular.js';
import { _updateLangSelect, applyTheme, initDefaultCondition, zeigeBenutzernamen } from './01-konto.js';
import { toast } from './01-meldungen.js';
import { loadGallery, loadStats } from './02-gallery.js';
import { loadParts } from './03-parts.js';
import { loadMinifigs } from './06-minifigs.js';
import { meldeAbschnitt } from './24-router.js';
import { verstaendlicherGrund } from './01-bausteine.js';
import { CURRENCY, ME, _settingsCache, set_CURRENCY, set_settingsCache } from './00-zustand.js';
import { html, sichereUrl, ungeprueft } from './00-escapen.js';
import { confirmDelete, bestaetigeMitPasswort, mitZweitemFaktor, mitPasswortBestaetigen, speichereEinstellungen } from './01-rueckfrage.js';
import { loadFinance } from './04-finance.js';
import { LAND_ZUR_WAEHRUNG } from './17-gutscheine.js';
// Einstellungen: Profil, Design, Zugangsdaten der Quellen, Mail, Zwischenspeicher, QR-Anmeldung und
// Konfigurations-Import/-Export. Haushalt, Verwaltung, Alarme und Lagerorte haben eigene Dateien.

// ── SETTINGS ──────────────────────────────────────────
// SMTP + Registration settings load/save
/** @param {Record<string, string> | null | undefined} settings */
async function loadSmtpSettings(settings){
  if(!settings) return;
  const s=settings;
  if(G('smtp-host'))   G('smtp-host').value   = s.smtp_host||'';
  if(G('smtp-port'))   G('smtp-port').value   = s.smtp_port||'587';
  if(G('smtp-user'))   G('smtp-user').value   = s.smtp_user||'';
  if(G('smtp-pass'))   G('smtp-pass').value   = s.smtp_pass||'';
  if(G('smtp-from'))   G('smtp-from').value   = s.smtp_from||'';
  if(G('smtp-secure')) G('smtp-secure').checked = s.smtp_secure==='1';
  if(G('smtp-tls-fp')) G('smtp-tls-fp').value = s.smtp_tls_fingerprint||'';
  if(G('smtp-tls-ca')) G('smtp-tls-ca').value = s.smtp_tls_ca||'';
  if(G('smtp-tls-altlast')) G('smtp-tls-altlast').style.display = s.smtp_insecure_tls==='1' ? '' : 'none';
  if(G('reg-enabled')) G('reg-enabled').checked = s.registration_enabled==='1';
  geladeneSmtp = JSON.stringify(smtpFormular());
  regMailHinweis();
}

/** Ohne Mailversand bliebe jede Registrierung unbestätigt; der Schalter sagt das, statt still zu ruhen. */
async function regMailHinweis(){
  const box = G('reg-enabled'), hinweis = G('reg-mail-hinweis');
  if (!box || !hinweis) return;
  const d = await api('GET', '/v1/auth/registration-status');
  const ohne = d?.mail_versand === false;
  box.disabled = ohne && !box.checked;
  hinweis.hidden = !ohne;
  hinweis.textContent = ohne ? tRaw(box.checked ? 'settings.reg_ruht' : 'settings.reg_braucht_mail') : '';
}

// Der Server verlangt das Verwalterpasswort, sobald sich ein SMTP-Wert ändert; gefragt wird deshalb nur dann,
// nicht bei jedem Speichern oder Testen.
let geladeneSmtp = '';
function smtpFormular() {
  return {
    smtp_host:   G('smtp-host')?.value.trim() || '',
    smtp_port:   G('smtp-port')?.value || '587',
    smtp_user:   G('smtp-user')?.value.trim() || '',
    smtp_pass:   G('smtp-pass')?.value || '',
    smtp_from:   G('smtp-from')?.value.trim() || '',
    smtp_secure: G('smtp-secure')?.checked ? '1' : '0',
    smtp_tls_fingerprint: G('smtp-tls-fp')?.value.trim() || '',
    smtp_tls_ca: G('smtp-tls-ca')?.value.trim() || '',
  };
}
/** SMTP speichern; null, wenn die Passwortabfrage abgebrochen wurde. */
/** @returns {Promise<{ success: boolean, error?: string | null } | null>} */
async function speichereSmtp() {
  const werte = smtpFormular();
  // Mit dem Hinweis auf die alte Ausnahme auch unverändert speichern: Erst das räumt sie ab.
  const altlast = G('smtp-tls-altlast');
  if (JSON.stringify(werte) === geladeneSmtp && (!altlast || altlast.style.display === 'none')) return { success: true };
  const admin_password = await bestaetigeMitPasswort(tRaw('smtp.confirm_title'), tRaw('smtp.confirm_text'), 'schloss', { knopf: 'confirm.btn.speichern', art: 'bp' });
  if (admin_password === null) return null;
  const d = await mitZweitemFaktor(z => api('POST','/v1/settings', { ...werte, admin_password, ...z }));
  if (d === null) return null;
  if (d.success) { geladeneSmtp = JSON.stringify(werte); if (altlast) altlast.style.display = 'none'; regMailHinweis(); }
  return d;
}

G('btn-test-smtp')?.addEventListener('click', async()=>{
  const btn = G('btn-test-smtp');
  const res = G('smtp-test-result');
  const frei = knopfBesetzt(btn);
  // Erst speichern, damit der Test mit genau diesen Werten läuft.
  const gespeichert = await speichereSmtp();
  if (!gespeichert?.success) {
    frei();
    if (gespeichert) toast(gespeichert.error || t('settings.error'), 'error');
    return;
  }
  const to = G('smtp-test-email')?.value?.trim() || ME?.email || '';
  // Eine fremde Adresse bestätigt der Verwalter mit dem Passwort; die eigene nicht.
  const fremd = to.toLowerCase() !== (ME?.email || '').toLowerCase();
  const d = fremd
    ? await mitPasswortBestaetigen(tRaw('smtp.test_confirm_title'), (password, z) => api('POST','/v1/settings/smtp-test', { to, password, ...z }), tRaw('smtp.test_confirm_text'))
    : await mitZweitemFaktor(z => api('POST','/v1/settings/smtp-test', { to, ...z }));
  frei();
  if (!d) return;
  res.style.display = 'block';
  if(d.success) {
    res.style.background = 'var(--g50)'; res.style.color = 'var(--g700)'; res.style.border = '1px solid var(--g300)';
    // Die Kennung des Mailservers hilft, die Nachricht in dessen Protokoll zu finden.
    res.textContent = d.mode === 'console' ? tRaw('smtp.console')
      : [d.message || t('smtp.ok'), d.messageId].filter(Boolean).join(' · ');
  } else {
    res.style.background = 'var(--r100)'; res.style.color = 'var(--r500)'; res.style.border = '1px solid var(--r300)';
    res.textContent = d.error || tRaw('settings.error');
  }
});

G('btn-sav-smtp')?.addEventListener('click', async()=>{
  const d = await speichereSmtp();
  if (!d) return;
  toast(d.success ? t('smtp.saved') : (d.error || t('settings.error')), d.success ? 'success' : 'error');
});

async function saveRegEnabled(){
  // Der Haken folgt dem Server: Während der Passwortfrage gilt noch der alte Stand.
  const box = G('reg-enabled'), soll = box.checked;
  box.checked = !soll;
  const d=await speichereEinstellungen(tRaw('settings.reg_title'), { registration_enabled: soll?'1':'0' });
  if(!d) return;
  if(d.success) box.checked = soll;
  toast(d.success?t('settings.reg_saved'):(d.error||t('settings.error')),d.success?'success':'error');
  regMailHinweis();
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
  const fmt = (/** @type {import('../../frontend-typen/vertrag').RateLimit | null | undefined} */ rl) => rl ? `${rl.count.toLocaleString(locale())} / ${rl.limit.toLocaleString(locale())}` : '—';
  for (const dienst of /** @type {const} */ (['bricklink', 'rebrickable', 'brickset'])) {
    const rl = d.rate_limits[dienst];
    if (G('rl-' + dienst)) G('rl-' + dienst).textContent = fmt(rl);
    const balken = G('rl-' + dienst + '-balken');
    if (balken) balken.style.width = rl?.limit ? Math.min(100, 100 * rl.count / rl.limit) + '%' : '0';
  }
}
export async function loadCacheStats(){
  const d = await api('GET','/v1/admin/cache-stats');
  if(!d.success) return;
  if(G('cs-prices'))  G('cs-prices').textContent  = String(d.prices  || 0);
  if(G('cs-subsets')) G('cs-subsets').textContent = String(d.subsets || 0);
  if(G('cs-catalog')) G('cs-catalog').textContent = String(d.catalog || 0);
}
export async function loadApiLimits() {
  const d = await api('GET', '/v1/admin/api-limits');
  if (!d.success) return;
  G('lim-rb').value = String(d.limits.rebrickable);
  G('lim-bl').value = String(d.limits.bricklink);
  G('lim-bs').value = String(d.limits.brickset);
}

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
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#gueltigkeit
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
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#serverurl
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
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#klartext
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
// Ausführlich: docs/begruendungen/public/js/05-settings.js.md#die-endpunkte-v1-settings-tokens-gab-es

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
 * Ausführlich: docs/begruendungen/public/js/05-settings.js.md#revokeothertokens
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

export async function loadProfile() {
  const dw = G('dunkel-wahl');
  if (dw && window.__bimDunkelWert) dw.value = window.__bimDunkelWert();
  ladeEigenesDesign();
  const d = await api('GET', '/v1/auth/profile');
  const u = d.success ? d.user : null;
  if (!u) return;
  G('prof-first').value = u.first_name || '';
  G('prof-last').value  = u.last_name  || '';
  G('prof-user').value  = u.username   || '';
  G('prof-email').value = u.email      || '';
  G('prof-email').dataset.bisher = u.email || '';
  // Ohne Adresse gibt es nichts zu bestätigen — „verifiziert“ neben einem leeren Feld widerspräche sich.
  const vEl = G('prof-email-verified');
  if (vEl) setzeHtml(vEl, !u.email ? '' : u.email_verified ? html`<span class="email-ok">${tRaw('profile.verified')}</span>` : html`<span class="email-offen">${tRaw('profile.not_verified')}</span>`);
  // Die neue Adresse gilt erst nach dem Link; bis dahin steht sie nur hier.
  const hint = G('prof-email-hint');
  if (hint) hint.textContent = u.email_neu ? tRaw('profile.email_pending', { email: u.email_neu }) : '';
}

/** Design-Wahl des Kontos: eigenes Design oder die Vorgabe des Verwalters. */
async function ladeEigenesDesign() {
  const sel = G('design-wahl');
  if (!sel) return;
  const d = await api('GET', '/v1/settings/theme');
  if (!d.success) return;
  zeigeDesignWahl(d);
}

/** @param {import('../../frontend-typen/vertrag').AppThemeResponse} d */
function zeigeDesignWahl(d) {
  const sel = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (G('design-wahl')));
  const NAMEN = { classic: 'settings.theme_classic', brick: 'settings.theme_brick', werkbank: 'settings.theme_werkbank',
    farbfaecher: 'settings.theme_farbfaecher', noppe: 'settings.theme_noppe', hochglanz: 'settings.theme_hochglanz' };
  const vorgabeName = tRaw(/** @type {Record<string, string>} */ (NAMEN)[d.vorgabe ?? ''] || NAMEN.classic);
  sel.options[0].textContent = tRaw('settings.own_theme_default', { name: vorgabeName });
  sel.value = d.eigenes || '';
  // Ein Satz zum gewählten Design: Namen wie „Noppe“ und „Hochglanz“ sagen allein nicht, wie es aussieht.
  // Werkbank hat keine helle Fassung; das steht dabei.
  const hinweis = G('design-hinweis');
  const aktiv = d.eigenes || d.vorgabe || 'classic';
  const BESCHREIBUNG = { classic: 'settings.theme_desc.classic', brick: 'settings.theme_desc.brick', werkbank: 'settings.theme_desc.werkbank',
    farbfaecher: 'settings.theme_desc.farbfaecher', noppe: 'settings.theme_desc.noppe', hochglanz: 'settings.theme_desc.hochglanz' };
  const beschreibung = /** @type {Record<string, string>} */ (BESCHREIBUNG)[aktiv];
  if (hinweis) hinweis.textContent = beschreibung ? tRaw(beschreibung) : '';
  // Bei einem Design ohne helle Fassung wirkt die Wahl darunter nicht; das steht dort, wo man sie trifft.
  const nurDunkel = !!window.__bimNurDunkel?.(aktiv), dw = G('dunkel-wahl'), dh = G('dunkel-hinweis');
  if (dw) dw.disabled = nurDunkel;
  if (dh) dh.hidden = !nurDunkel;
}

async function setzeEigenesDesign() {
  const theme = G('design-wahl').value;
  const d = await api('POST', '/v1/settings/user/theme', { theme });
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  applyTheme(d.theme);
  if (_settingsCache) _settingsCache.app_theme = d.theme;
  zeigeDesignWahl(d);
  toast(tRaw('settings.theme_saved'), 'success');
}

// Darstellung wirkt sofort: Währung und Standard-Zustand speichern beim Wählen.
async function speichereWaehrung() {
  const wert = G('s-cur').value;
  // Marktpreise gibt es je Währung; nach dem Wechsel fehlen sie, bis der Preisauftrag sie geholt hat. Ohne
  // Rückfrage sah das aus, als seien alle Werte verloren.
  if (wert !== CURRENCY && !await confirmDelete(tRaw('konto.waehrung_wechsel_titel'),
    tRaw('konto.waehrung_wechsel_text', { alt: CURRENCY, neu: wert }), 'finanzen', { knopf: 'konto.waehrung_wechsel_knopf', art: 'bp' })) {
    G('s-cur').value = CURRENCY;
    return;
  }
  const d = await api('POST', '/v1/settings', { currency: wert });
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  set_CURRENCY(wert);
  if (_settingsCache) _settingsCache.currency = wert;
  await loadHousehold().catch(() => {});
  loadStats(); if (document.getElementById('tab-gallery')?.classList.contains('active')) loadGallery();
  toast(tRaw('konto.waehrung_gespeichert_markt', { w: wert }), 'success');
}

async function speichereZustand() {
  const condVal = G('s-default-condition')?.value || 'N';
  const d = await api('POST', '/v1/settings/user/default-condition', { condition: condVal }).catch(() => null);
  if (!d?.success) { toast(d?.error || t('settings.error'), 'error'); return; }
  initDefaultCondition();
  toast(tRaw('settings.saved'), 'success');
}

/** Eine neue E-Mail-Adresse verlangt das aktuelle Passwort; das Feld steht erst dann da. */

G('btn-sav-prof').onclick = async () => {
  const first_name = G('prof-first').value.trim();
  const last_name  = G('prof-last').value.trim();
  const username   = G('prof-user').value.trim();
  const email      = G('prof-email').value.trim();
  if (!username) { toast(tRaw('profile.username_empty'), 'error'); return; }
  const btn = G('btn-sav-prof'); btn.disabled = true;
  try {
    // Jede Profiländerung bestätigt der Server mit dem Passwort; sonst verriete sie, ob ein Name vergeben
    // ist. Eine neue Adresse nennt der Dialog, damit man sieht, was man bestätigt.
    const neueAdresse = email && email !== (G('prof-email').dataset.bisher || '');
    const d = await mitPasswortBestaetigen(tRaw(neueAdresse ? 'profile.email_aendern_titel' : 'profile.speichern_titel'), (pwC, z) => api('PUT', '/v1/auth/profile',
      { username, email, first_name, last_name, password_current: pwC, ...z }),
      neueAdresse ? tRaw('profile.email_aendern_text', { email }) : undefined);
    if (!d) return;
    if (!d.success) { toast(d.error || t('profile.save_error'), 'error'); return; }
    await loadProfile();
    // Der Namenszug in der Kopfzeile wird sonst nur beim Start gesetzt.
    if (ME) { ME.username = username; zeigeBenutzernamen(); }
    if (d.emailChanged && !d.emailSent) toast(tRaw('profile.mail_not_sent'), 'error');
    else toast(d.emailChanged ? t('profile.saved_mail') : t('settings.saved'), 'success');
  } finally {
    btn.disabled = false;
  }
};

G('btn-sav-pw').onclick = async () => {
  const pwN = G('pw-n').value, pwR = G('pw-r').value;
  if (!pwN) { feldFehler('pw-n', tRaw('settings.password.fill_all')); return; }
  if (pwN !== pwR)  { feldFehler('pw-r', tRaw('settings.password.mismatch')); return; }
  const regel = passwortRegelText(pwN);
  if (regel) { feldFehler('pw-n', regel); return; }
  const btn = G('btn-sav-pw'); btn.disabled = true;
  try {
    const dPw = await mitPasswortBestaetigen(tRaw('settings.password.change'), (pwC, z) => api('POST', '/v1/auth/change-password',
      { current: pwC, newPassword: pwN, passkeys_widerrufen: !!G('pw-pk')?.checked, ...z }));
    if (!dPw) return;
    if (!dPw.success) {
      antwortFehler(dPw, { alle_felder_erforderlich: 'pw-n',
        passwort_zu_kurz: 'pw-n', passwort_zu_lang: 'pw-n', passwort_zu_haeufig: 'pw-n' }, tRaw('settings.error'));
      return;
    }
    G('pw-n').value = G('pw-r').value = '';
    if (G('pw-pk')) G('pw-pk').checked = false;
    toast(tRaw('konto.passwort_geaendert'), 'success');
  } finally {
    btn.disabled = false;
  }
};

/** @param {Record<string, string>} s */
function applySettings(s){
  // Nur anwenden, wenn die Felder des Einstellungsreiters im DOM stehen
  if(!G('s-cur') && !G('bl-ck')) return;
  set_CURRENCY(s.currency||'EUR');
  // Apply language preference from server only if explicitly set
  if(s.language && I18N[s.language] && s.language !== LANG) applyLang(s.language, false);
  _updateLangSelect();
  const _set = (/** @type {string} */ id, /** @type {string} */ v) => { const el=G(id); if(el) el.value=v; };
  _set('s-cur',          CURRENCY);
  _set('s-default-condition', s.user_default_condition || s.default_price_condition || 'N');
  // Das Ausgabeland der Gutscheine. AUSSERHALB des isAdmin-Blocks: Der Wert ist kein Geheimnis und wird allen
  // ausgeliefert (sanitizeGlobal laesst ihn durch) — gesetzt werden darf er nur von einem Verwalter, und
  // deshalb ist das Feld selbst `admin-only` (index.html). Ohne diese Zeile stuende im Auswahlfeld immer der
  // erste Eintrag, egal was gespeichert ist.
  _set('gutschein-land', s.gutschein_land || /** @type {Record<string, string>} */ (LAND_ZUR_WAEHRUNG)[CURRENCY] || 'de-CH');
  if(ME?.isAdmin){
    _set('bl-ck',  s.bricklink_consumer_key||'');
    _set('bl-cs',  s.bricklink_consumer_secret||'');
    _set('bl-tok', s.bricklink_token||'');
    _set('bl-ts',  s.bricklink_token_secret||'');
    _set('rb-key', s.rebrickable_api_key||'');
    _set('bs-key', s.brickset_api_key||'');
    _set('mon-app-theme', s.app_theme||'classic');
    // s.app_theme ist das wirksame Design DIESES Kontos; der Verwalter stellt hier die Vorgabe.
    api('GET', '/v1/settings/theme').then(d => { if (d.success) _set('mon-app-theme', d.vorgabe ?? 'classic'); });
    loadUsers(); loadSmtpSettings(s);
  }
  if(ME?.isAdmin) loadRateLimitStats();
}
export async function loadSettings(){
  // Zwischengespeicherte Daten sofort zeigen, damit der Reiter nie leer erscheint
  if(_settingsCache) applySettings(_settingsCache);
  loadHousehold();
  const d=await api('GET','/v1/settings/raw'); if(!d.success) return;
  set_settingsCache(d.settings);
  applySettings(d.settings);
}

/**
 * Einen Zugang speichern. Alle Felder leer heisst „Zugang entfernt“, nicht „gespeichert“: Das klang, als sei
 * ein Schlüssel hinterlegt.
 * @param {Record<string, string>} werte @param {'bricklink'|'rebrickable'|'brickset'} dienst @param {string} grenze @param {string} okText
 */
async function speichereZugang(werte, dienst, grenze, okText) {
  const d = await speichereEinstellungen(tRaw('settings.api_key_title'), werte);
  if (!d) return;
  if (!d.success) { toast(tRaw('settings.error'), 'error'); return; }
  await api('PUT', '/v1/admin/api-limits', { [dienst]: parseInt(G(grenze).value) });
  const leer = Object.values(werte).every(w => !String(w).trim());
  toast(leer ? tRaw('settings.zugang_entfernt') : okText, leer ? 'info' : 'success');
  loadRateLimitStats();
}
G('btn-sav-bl').onclick = () => speichereZugang({ bricklink_consumer_key: G('bl-ck').value, bricklink_consumer_secret: G('bl-cs').value,
  bricklink_token: G('bl-tok').value, bricklink_token_secret: G('bl-ts').value }, 'bricklink', 'lim-bl', tRaw('settings.bl_saved'));
G('btn-sav-rb').onclick = () => speichereZugang({ rebrickable_api_key: G('rb-key').value }, 'rebrickable', 'lim-rb', tRaw('settings.rb_saved'));
G('btn-sav-bs').onclick = () => speichereZugang({ brickset_api_key: G('bs-key').value }, 'brickset', 'lim-bs', tRaw('settings.bs_saved'));
G('btn-save-theme').onclick=async()=>{
  const theme=G('mon-app-theme')?.value||'classic';
  const d=await api('POST','/v1/settings/admin/theme',{theme});
  // Angewendet wird, was für DIESES Konto gilt — ein eigenes Design bleibt.
  if(d.success){ const w=await api('GET','/v1/settings/theme'); if(w.success){ applyTheme(w.theme); if(_settingsCache) _settingsCache.app_theme=w.theme; } }
  toast(d.success?t('settings.theme_saved'):t('settings.error'),d.success?'success':'error');
};
G('btn-clr').onclick=async()=>{ await api('POST','/v1/admin/cache-clear'); toast(tRaw('settings.cache_cleared'),'info'); loadCacheStats(); loadFinance(); };
/**
 * Vor dem Leeren steht da, was verloren geht und was der Neuabruf kostet — mit den Zahlen von jetzt.
 * @param {boolean} alle
 */
async function zwischenspeicherLeeren(alle) {
  const z = await api('GET', '/v1/admin/cache-stats');
  const n = { p: z?.prices || 0, s: z?.subsets || 0, c: z?.catalog || 0 };
  const titel = tRaw(alle ? 'settings.all_cache.confirm_title' : 'settings.cache_prices.confirm_title');
  if (!await confirmDelete(titel, tRaw(alle ? 'settings.all_cache.confirm_text' : 'settings.cache_prices.confirm_text', n),
    'loeschen', { knopf: 'confirm.btn.leeren', art: 'bd' })) return;
  const d = await api('POST', '/v1/admin/cache-clear', alle ? { all: true } : {});
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  toast(tRaw(alle ? 'settings.all_cache.cleared' : 'settings.cache_cleared'), 'success'); loadCacheStats();
}
G('btn-clr-prices').onclick = () => zwischenspeicherLeeren(false);
G('btn-clr-all-cache').onclick = () => zwischenspeicherLeeren(true);
G('btn-dall').onclick=async()=>{
  // Alles in den Papierkorb: 30 Tage wiederherstellbar, deshalb eine Rückfrage statt des früheren Eintippens
  // von „LÖSCHEN". Nur das EIGENE Konto (Server).
  const password=await bestaetigeMitPasswort(tRaw('settings.delete_all.title'),tRaw('settings.delete_all.text'),'loeschen', { knopf: 'confirm.btn.alles_loeschen', art: 'bd' });
  if(password===null) return;
  const d=await mitZweitemFaktor(z => api('DELETE','/v1/bestand',{password, ...z}));
  if(d===null) return;
  if(!d?.success){ toast(d?.error||tRaw('settings.error'),'error'); return; }
  toast(tRaw('settings.delete_all.done',{n:d.sets+d.teile+d.figuren}),'success');
  loadGallery(); loadParts(); loadMinifigs(); loadStats();
};
G('btn-konto-loeschen').onclick=async()=>{
  // Endgültig und ohne Papierkorb: Passwort und, falls eingerichtet, der zweite Faktor.
  const password=await bestaetigeMitPasswort(tRaw('settings.delete_account.title'),tRaw('settings.delete_account.text'),'loeschen', { knopf: 'confirm.btn.konto_loeschen', art: 'bd' });
  if(password===null) return;
  const d=await mitZweitemFaktor(z => api('DELETE','/v1/auth/konto',{password, ...z}));
  if(d===null) return;
  if(!d?.success){ toast(d?.error||tRaw('settings.error'),'error'); return; }
  location.href='/';
};


// ── CONFIG EXPORT / IMPORT ───────────────────────────────────
G('btn-cfg-export').onclick = async () => {
  const a = document.createElement('a');
  a.href = '/api/v1/settings/export';
  a.download = `brickinventory-manager-config-${new Date().toISOString().substring(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

async function importConfig() {
  const fi = G('cfg-import-file');
  const datei = fi.files?.[0];
  if (!datei) return;
  const st = G('cfg-import-status');
  st.textContent = tRaw('settings.importing');
  const fd = new FormData(); fd.append('file', datei);
  try {
    const d = await api('POST', '/v1/settings/import', fd);
    if (d.success) {
      // Welche SMTP-Werte die Datei mitbrachte, steht dabei: Sie werden nur im Formular gesetzt.
      const smtp = (d.smtp_uebergangen || []).join(', ');
      st.textContent = tRaw('settings.imported_note',{n:d.imported,note:[d.note, smtp].filter(Boolean).join(': ')});
      st.style.color = 'var(--g500)';
      toast(tRaw('admin.config_imported'), 'success');
      // SMTP-Werte übernimmt der Import nie (Passwortbestätigung); welche, steht hier.
      if (d.smtp_uebergangen?.length) toast(tRaw('settings.smtp_skipped', { keys: d.smtp_uebergangen.join(', ') }), 'info');
      loadSettings();
      set_settingsCache(null); // invalidate cache so next loadSettings fetches fresh
      if (ME?.isAdmin) { loadCacheTtl(); loadApiLimits(); }
    } else {
      st.textContent = d.error || tRaw('settings.error');
      st.style.color = 'var(--r500)';
    }
  } catch(e) { st.textContent = tRaw('common.network_error'); }
  fi.value = '';
}

// Der Import von Wanted-Listen steht bei Sets, Teilen und Figuren (js/18-wanted-xml.js), nicht mehr hier: Man
// importiert dort, wo man die Posten danach sieht.
// Ausführlich: docs/begruendungen/public/js/05-settings.js.md#marcos-vorgabe-bitte-auch-den-import-der

/**
 * Ein verdecktes Feld zeigen oder wieder verdecken (Knopf mit dem Auge).
 * @param {string} id
 */
function geheimUmschalten(id) {
  const feld = G(id);
  const knopf = document.querySelector(`[data-click="geheimUmschalten"][data-arg="${id}"]`);
  if (!feld || !knopf) return;
  const zeigen = feld.type === 'password';
  feld.type = zeigen ? 'text' : 'password';
  knopf.setAttribute('aria-pressed', String(zeigen));
  knopf.querySelector('use')?.setAttribute('href', zeigen ? '#i-auge-zu' : '#i-auge');
}

const EINST_KEY = 'bim_einst_abschnitt';
/**
 * Die globalen Einstellungen als Unterseiten: Es steht immer genau ein Abschnitt da, und die Leiste zeigt
 * welcher. Gemerkt je Browser, damit ein Neuladen nicht auf den ersten Abschnitt zurückspringt.
 * @param {string|null} id  Abschnitt; unbekannt oder leer heisst der erste
 * @param {Event} [ev]      der Klick auf den Link — er springt dann nicht
 */
export function einstAbschnitt(id, ev){
  ev?.preventDefault();
  const raster = G('global-settings-grid'); if(!raster) return;
  const abschnitte = [...raster.querySelectorAll(':scope > .ssec')];
  const ziel = abschnitte.find(a => a.id === id) || abschnitte[0];
  if(!ziel) return;
  for(const a of abschnitte) a.classList.toggle('einst-aktiv', a === ziel);
  for(const l of raster.querySelectorAll('.einst-nav a')){
    if(l.getAttribute('data-arg') === ziel.id) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  }
  try { localStorage.setItem(EINST_KEY, ziel.id); } catch (_) { /* nur Komfort */ }
  if (ev) meldeAbschnitt();
}
einstAbschnitt((() => { try { return localStorage.getItem(EINST_KEY); } catch (_) { return null; } })());

/** Prüft den gespeicherten Zugang, wie der Einrichtungsassistent — auch später, ohne ihn erneut zu öffnen.
 * @this {HTMLButtonElement} @param {string} quelle */
async function einstellungenQuellePruefen(quelle) {
  const stand = G('pruef-' + quelle); if (!stand) return;
  const frei = knopfBesetzt(this);
  stand.className = 'quelle-stand'; stand.textContent = tRaw('settings.zugang_laeuft');
  const d = await api('POST', '/v1/settings/quelle-testen', { quelle });
  frei();
  const { grund } = d?.success ? { grund: '' } : d?.code ? { grund: d.error } : verstaendlicherGrund(d);
  stand.classList.add(d?.success ? 'quelle-ok' : 'quelle-fehler');
  setzeHtml(stand, html`${ico(d?.success ? 'ok' : 'fehler')}<span>${d?.success ? tRaw('setup.test_ok') : grund || tRaw('setup.test_failed')}</span>`);
}

stelleZielBereit({ einstAbschnitt });

registerActions({
  einstellungenQuellePruefen,
  speichereWaehrung,
  speichereZustand,
  setzeEigenesDesign,
  einstAbschnitt,
  geheimUmschalten,
  loadTokens,
  revokeOtherTokens,
  revokeToken,
  saveRegEnabled,
  importConfig,
});
