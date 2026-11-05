// Einstellungen, Konto, Benutzerverwaltung, Haushalt, Lagerorte und
// Konfigurations-Import/-Export.
import { stelleZielBereit } from './00-ziele.js';
import { echt, registerActions } from './00-registry.js';
import { I18N, LANG, applyLang, locale, t, tRaw} from '../i18n.js';
import { fehlerMeldung, api } from './01-api.js';
import { bildTag, platzhalterInhalt, imgUrl, thumbUrl } from './01-bilder.js';
import { ico, G, knopfBesetzt } from './01-dom.js';
import { fmtN, fmtDatum, leseBetrag, betragFuerFeld } from './01-format.js';
import { antwortFehler, feldFehler, passwortRegelText } from './01-formular.js';
import { _updateLangSelect, applyTheme, initDefaultCondition, zeigeBenutzernamen } from './01-konto.js';
import { toast } from './01-meldungen.js';
import { loadGallery, loadStats } from './02-gallery.js';
import { loadParts } from './03-parts.js';
import { loadMinifigs } from './06-minifigs.js';
import { meldeAbschnitt } from './24-router.js';
import { verstaendlicherGrund, csvHochladen } from './01-bausteine.js';
import { CURRENCY, ME, _settingsCache, set_CURRENCY, set_settingsCache, allSets } from './00-zustand.js';
import { esc } from './00-escapen.js';
import { confirmDelete, bestaetigeMitPasswort, mitZweitemFaktor, mitPasswortBestaetigen, speichereEinstellungen } from './01-rueckfrage.js';
import { loadFinance } from './04-finance.js';
import { ladeLagerortVorgabe } from './02-konten-orte.js';
import { ladeLagerorte } from './02-detailfelder.js';
import { LAND_ZUR_WAEHRUNG } from './17-gutscheine.js';
/** @typedef {import('../../frontend-typen/vertrag').KontoInListe} Konto */

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

// Der Server verlangt das Verwalterpasswort, sobald sich ein SMTP-Wert ändert;
// gefragt wird deshalb nur dann, nicht bei jedem Speichern oder Testen.
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
  const d = await api('POST','/v1/settings/smtp-test', { to: G('smtp-test-email')?.value?.trim() || ME?.email || '' });
  frei();
  res.style.display = 'block';
  if(d.success) {
    res.style.background = 'var(--g50)'; res.style.color = 'var(--g700)'; res.style.border = '1px solid var(--g300)';
    // Die Kennung des Mailservers hilft, die Nachricht in dessen Protokoll zu finden.
    res.textContent = d.mode === 'console' ? t('smtp.console')
      : [d.message || t('smtp.ok'), d.messageId].filter(Boolean).join(' · ');
  } else {
    res.style.background = 'var(--r100)'; res.style.color = 'var(--r500)'; res.style.border = '1px solid var(--r300)';
    res.textContent = d.error || t('settings.error');
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

// QR Code generation using qrcode.js CDN
async function generateQrCode() {
  const btn = G('btn-gen-qr');
  const hint = G('qr-hint');
  const container = G('qr-code');
  const frei = knopfBesetzt(btn);
  try {
    // POST, weil der Aufruf eine Nonce anlegt: Als GET löste ihn eine fremde Seite per Navigation aus
    // (SameSite=lax). Die Laufzeit des späteren Tokens reist mit der Erzeugung, sonst wählte sich der
    // Finder eines Codes die längste.
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#gueltigkeit
    const gueltigkeit = G('qr-validity')?.value || '';
    const pw = G('qr-password');
    const password = pw?.value || '';
    if (pw) pw.value = '';
    const d = await mitZweitemFaktor(z => api('POST', '/v1/auth/qr-token', { gueltigkeit, password, ...z }));
    if (d === null) { frei(); return; }
    if (!d.success) {
      hint.textContent = tRaw('toast.error')+': ' + (d.error||t('common.unknown'));
      // Den alten Code wegraeumen: Er ist vielleicht noch gueltig, und ein
      // sichtbarer Code neben einer Fehlermeldung sieht aus wie ein Code, der
      // trotzdem geht. Beim Ablaufzaehler weiter unten wird aus demselben
      // Grund geleert.
      container.innerHTML = '';
      frei(); return;
    }
    // Nur die Adresse, die der Server nennt (APP_BASE_URL): Die in der Browserzeile ist die des
    // Betrachters, etwa eine LAN-Adresse, die ausser Haus nicht existiert. Lieber kein Code als einer, der
    // sich falsch scannen lässt.
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#serverurl
    const serverUrl = d.url;

    // Mit `fp` (Fingerabdruck der CA-Wurzel) pinnt die App das Zertifikat;
    // der Server schickt ihn nur zu einer https-Adresse.
    const qrData = JSON.stringify({ url: serverUrl, token: d.token, ...(d.fp ? { fp: d.fp } : {}) });
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
    let secs = Number(d.expires_in) || 300;
    const fmt = (/** @type {number} */ v) => `${Math.floor(v/60)}:${(v%60).toString().padStart(2,'0')}`;
    const timer = setInterval(() => {
      secs--;
      hint.textContent = tRaw('qr.valid_for',{t:fmt(secs)});
      if (secs <= 0) { clearInterval(timer); hint.textContent = tRaw('qr.expired'); container.innerHTML=''; }
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
    // Nach dem ersten Erzeugen heisst der Knopf „Neu generieren" — die eine
    // Stelle, an der die Beschriftung sich absichtlich ändert.
    frei(tRaw('qr.regenerate'));
  } catch(e) { hint.textContent = tRaw('toast.error')+': ' + fehlerMeldung(e); frei(); }
}

G('btn-gen-qr').onclick = generateQrCode;

// Angemeldete Geräte einzeln aussperren: Sonst blieb für ein verlorenes Telefon nur das Passwort zu
// ändern, und das wirft alle Zugänge hinaus. Der Browser selbst hängt an der Sitzung, nicht an einem
// Token.
// Ausführlich: docs/begruendungen/public/js/05-settings.js.md#die-endpunkte-v1-settings-tokens-gab-es

/**
 * „—", wenn nie benutzt: `new Date(null)` wäre der 1.1.1970.
 * @param {string | null | undefined} wert
 */
function tokenDatum(wert) {
  if (!wert) return '—';
  return new Date(wert).toLocaleString(locale());
}

export async function loadTokens() {
  const ziel = G('tokens-tbl');
  if (!ziel) return;
  const d = await api('GET', '/v1/settings/tokens');
  if (!d.success) { ziel.innerHTML = `<p data-stil="color:var(--mut)">${esc(d.error || t('settings.error'))}</p>`; return; }
  if (!d.tokens.length) { ziel.innerHTML = `<p data-stil="color:var(--mut)">${t('tokens.none')}</p>`; return; }
  ziel.innerHTML = `<div class="tw"><table class="dt"><thead><tr>
      <th>${t('tokens.col.label')}</th><th>${t('tokens.col.created')}</th>
      <th>${t('tokens.col.last_used')}</th><th>${t('tokens.col.scope')}</th><th>${t('tokens.col.ip')}</th>
      <th>${t('tokens.col.expires')}</th><th>${t('users.col.actions')}</th></tr></thead><tbody>${
    d.tokens.map(tk => `<tr>
      <td><strong>${esc(tk.label || '—')}</strong>${tk.aktuell ? ` <span class="rb ra">${t('tokens.current')}</span>` : ''}</td>
      <td>${tokenDatum(tk.created_at)}</td>
      <td>${tokenDatum(tk.last_used)}</td>
      <td>${tk.scope === 'voll' ? t('tokens.scope.voll') : t('tokens.scope.app')}</td>
      <td>${esc(tk.ip_bereich || '—')}</td>
      <td>${tk.never_expires ? t('tokens.never') : tokenDatum(tk.expires_at)}${
        // Plakette „fest": Ohne sie stuenden beide Fristen als dasselbe Datum
        // da, und sie bedeuten Verschiedenes. Die gleitende rueckt bei jeder
        // Benutzung nach; die feste, die beim QR-Code gewaehlt wurde, nicht.
        tk.hard_expires_at ? ` <span class="rb ra" title="${esc(tokenDatum(tk.hard_expires_at))}">${t('tokens.fixed')}</span>` : ''}</td>
      <td>${tk.aktuell ? '' :
        `<button class="btn bd btn-sm" data-click="revokeToken"${echt()} data-arg="${esc(tk.token_id)}" data-arg2="${esc(tk.label || '')}" aria-label="${esc(tRaw('common.delete'))}">${ico('loeschen')}</button>`}</td>
    </tr>`).join('')
  }</tbody></table></div>`;
}

/**
 * Der Fingerabdruck der CA-Wurzel zum Abgleich von Hand — derselbe Wert steht
 * als `fp` im QR-Code. Ohne interne CA (fremder Proxy) steht nur, ob HTTPS gilt.
 */
export async function ladeTls() {
  const ziel = G('tls-flaeche');
  if (!ziel) return;
  const d = await api('GET', '/v1/settings/tls');
  if (!d?.success) { ziel.innerHTML = `<p class="hinweis-absatz">${esc(d?.error || t('settings.error'))}</p>`; return; }
  if (!d.fp) {
    ziel.innerHTML = `<p class="hinweis-absatz">${d.https ? t('tls.ohne_ca') : t('tls.ohne_https')}</p>`;
    return;
  }
  ziel.innerHTML = `<p class="hinweis-absatz">${t('tls.hint')}</p>
    <div class="text-klein">${t('tls.subject')}: ${esc(d.subject)}<br>${t('tls.valid_until')}: ${esc(tokenDatum(d.gueltig_bis))}</div>
    <div class="text-klein abstand-o-075">${t('tls.fp_sha256')}</div>
    <code id="tls-fp-hex" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${esc(d.fp_hex)}</code>
    <div class="text-klein abstand-o-075">${t('tls.fp_base64')}</div>
    <code id="tls-fp" data-stil="user-select:all;word-break:break-all;font-size:var(--fs-2)">${esc(d.fp)}</code>
    <div class="abstand-o-075"><a class="btn bs btn-sm" href="${esc(d.download)}" download>${t('tls.download')}</a></div>`;
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
 * Alle Zugänge ausser dem eigenen entwerten, nacheinander über den bestehenden Endpunkt: Eine zweite
 * Adresse für „dasselbe, mehrfach“ wäre Doppelung. Gezählt wird, was wirklich weg ist.
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
  // Ohne Adresse gibt es nichts zu bestätigen — „verifiziert“ neben einem
  // leeren Feld widerspräche sich.
  const vEl = G('prof-email-verified');
  if (vEl) vEl.innerHTML = !u.email ? ''
    : u.email_verified ? `<span class="email-ok">${t('profile.verified')}</span>`
    : `<span class="email-offen">${t('profile.not_verified')}</span>`;
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
  // Ein Satz zum gewählten Design: Namen wie „Noppe“ und „Hochglanz“ sagen allein
  // nicht, wie es aussieht. Werkbank hat keine helle Fassung; das steht dabei.
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
  const d = await api('POST', '/v1/settings', { currency: wert });
  if (!d.success) { toast(d.error || t('settings.error'), 'error'); return; }
  set_CURRENCY(wert);
  if (_settingsCache) _settingsCache.currency = wert;
  await loadHousehold().catch(() => {});
  loadStats(); if (document.getElementById('tab-gallery')?.classList.contains('active')) loadGallery();
  toast(tRaw('konto.waehrung_gespeichert', { w: wert }), 'success');
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
    // Jede Profiländerung bestätigt der Server mit dem Passwort; sonst verriete sie, ob ein Name vergeben ist.
    // Eine neue Adresse nennt der Dialog, damit man sieht, was man bestätigt.
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
  // Only apply if the settings tab fields are present in the DOM
  if(!G('s-cur') && !G('bl-ck')) return;
  set_CURRENCY(s.currency||'EUR');
  // Apply language preference from server only if explicitly set
  if(s.language && I18N[s.language] && s.language !== LANG) applyLang(s.language, false);
  _updateLangSelect();
  const _set = (/** @type {string} */ id, /** @type {string} */ v) => { const el=G(id); if(el) el.value=v; };
  _set('s-cur',          CURRENCY);
  _set('s-default-condition', s.user_default_condition || s.default_price_condition || 'N');
  // Das Ausgabeland der Gutscheine. AUSSERHALB des isAdmin-Blocks: Der Wert
  // ist kein Geheimnis und wird allen ausgeliefert (sanitizeGlobal laesst
  // ihn durch) — gesetzt werden darf er nur von einem Verwalter, und
  // deshalb ist das Feld selbst `admin-only` (index.html). Ohne diese Zeile
  // stuende im Auswahlfeld immer der erste Eintrag, egal was gespeichert ist.
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
  // Show cached data instantly so the tab never appears empty
  if(_settingsCache) applySettings(_settingsCache);
  loadHousehold();
  const d=await api('GET','/v1/settings/raw'); if(!d.success) return;
  set_settingsCache(d.settings);
  applySettings(d.settings);
}

// ═══════════════════════════════════════════════════════════════════════════
// HAUSHALT — Konten verknüpfen
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Einladen und Beitreten brauchen beide Seiten: das Hauptkonto erzeugt, das andere löst ein. Je nach
 * Rolle steht nur einer der Kästen da — ein Knopf, den der Server immer ablehnt, ist schlimmer als
 * keiner.
 * Ausführlich: docs/begruendungen/public/js/05-settings.js.md#loadhousehold
 */
export async function loadHousehold(){
  const [d, zf] = await Promise.all([api('GET','/v1/settings/household').catch(()=>null),
                                     api('GET','/v1/auth/zweiter-faktor').catch(()=>null)]);
  if(!d?.success) return;
  renderHousehold(d);
  // Mit zweitem Faktor verlangt der Server beim Einlösen auch den Code.
  const faktor = G('household-redeem-faktor');
  if(faktor) faktor.style.display = zf?.aktiv ? '' : 'none';
}

/**
 * Die Haushaltskarte: Elternkonten und Unterkonten sind zwei unabhängige
 * Abschnitte, weil ein Konto beides zugleich sein kann. Darunter der Hinweis
 * auf Konten, die nur über eine Kette sichtbar waren und es nicht mehr sind.
 * @param {import('../../frontend-typen/vertrag').HouseholdStatusResponse} d
 */
function renderHousehold(d){
  const stateEl  = G('household-state');
  const inviteEl = G('household-invite-box');
  const redeemEl = G('household-redeem-box');
  if(!stateEl) return;

  // Ein Raster auf der Liste, die Zeilen als display:contents: So stehen alle
  // Namen und alle Knöpfe in denselben zwei Spalten.
  // Namen und alle Knöpfe in denselben zwei Spalten; das Sinnbild macht die Namen als Konten kenntlich.
  const liste = (/** @type {{ id: number, username?: string | null, via?: string | null }[]} */ eintraege, /** @type {(a: { id: number, username?: string | null, via?: string | null }) => string} */ aktion) => `<ul class="haushalt-liste">${
    eintraege.map(a => `<li data-stil="display:contents">
      <span class="haushalt-name"><svg class="ico" aria-hidden="true"><use href="#i-profil"/></svg>${esc(a.username)}</span>
      <span class="haushalt-aktion">${aktion(a)}</span>
    </li>`).join('')}</ul>`;

  const teile = [];
  const eltern = d.parents || (d.linked_to ? [d.linked_to] : []);
  if(eltern.length){
    teile.push(`<div>${t('household.state_parents', { n: eltern.length })}${liste(eltern,
      a => `<button class="btn bs btn-sm" data-click="unlinkFromParent"${echt()} data-arg="${a.id}" data-arg2="${esc(a.username || '')}">${t('household.unlink_self')}</button>`)}</div>`);
  }
  if(d.sub_accounts?.length){
    teile.push(`${eltern.length ? '<div data-stil="margin-top:.6rem">' : '<div>'}${t('household.state_main', { n: d.sub_accounts.length })}${liste(d.sub_accounts,
      a => `<button class="btn bs btn-sm" data-click="unlinkHousehold"${echt()} data-arg="${a.id}" data-arg2="${esc(a.username || '')}">${t('household.unlink_sub')}</button>`)}</div>`);
  }
  if(!teile.length){
    teile.push(`<div data-stil="color:var(--mut)">${t('household.state_none', { cur: esc(d.currency||'') })}</div>`);
  }
  if(d.former_links?.length){
    teile.push(`<div role="note" data-stil="margin-top:.8rem;padding:.6rem .8rem;border-radius:8px;background:var(--b100);color:var(--b600)">
      ${t('household.former_intro')}${liste(d.former_links,
        a => `<span data-stil="color:var(--mut)">${a.via ? t('household.former_via', { via: esc(a.via) }) : ''}</span>
              <button class="btn bs btn-sm" data-click="dismissFormerLink" data-arg="${a.id}">${t('household.former_dismiss')}</button>`)}
    </div>`);
  }
  stateEl.innerHTML = teile.join('');

  // Einladen und Einlösen darf jedes Konto: Ein Konto kann mehrere
  // Elternkonten haben, und jedes braucht seine eigene Einladung.
  if(inviteEl) inviteEl.style.display = '';
  if(redeemEl) redeemEl.style.display = '';
}

export async function createHouseholdInvite(){
  const d = await api('POST','/v1/settings/household/invite',{});
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  const out = G('household-invite-out');
  G('household-invite-code').value = d.code ?? '';
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
  // Erst den Code auflösen: Wer zustimmt, soll wissen, wem er Zugriff gibt.
  const p = await api('POST','/v1/settings/household/redeem/pruefen',{ code });
  if(!p.success){ toast(p.error || t('settings.error'),'error'); return; }
  const name = p.inviter.username;
  // Das Hauptkonto sieht und ändert danach die eigene Sammlung — deshalb mit Passwort.
  const password = await bestaetigeMitPasswort(tRaw('household.redeem_frage', { name }), tRaw('household.redeem_confirm_text', { name }), 'link', { knopf: 'confirm.btn.einladung_annehmen', art: 'bp' });
  if(password === null) return;
  const faktor_code = (G('household-redeem-faktor-code')?.value || '').trim();
  const d = await mitZweitemFaktor(z => api('POST','/v1/settings/household/redeem',
    { code, password, ...(z.code || faktor_code ? { faktor_code: z.code || faktor_code } : {}), ...(z.passkey ? { passkey: z.passkey } : {}) }));
  if(d === null) return;
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  G('household-redeem-code').value = '';
  if(G('household-redeem-faktor-code')) G('household-redeem-faktor-code').value = '';
  // tRaw + roher Name: Der Toast setzt Text, keine HTML — mit esc() stünde
  // dort "Marco &amp; Co" statt "Marco & Co".
  const verknuepft = /** @type {{ linked_to?: { username?: string } }} */ (d).linked_to;
  toast(tRaw('household.redeem_ok', { name: verknuepft?.username || '' }),'success');
  loadHousehold();
}

/**
 * @param {string} mainUserId
 * @param {string} name
 */
export async function unlinkFromParent(mainUserId, name){
  if(!await confirmDelete(tRaw('household.unlink_confirm_title', { name }), tRaw('household.unlink_confirm_text_eltern', { name }), 'link', { knopf: 'confirm.btn.verknuepfung_loesen', art: 'bp' })) return;
  const d = await api('POST','/v1/settings/household/unlink', { main_user_id: parseInt(mainUserId) });
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  toast(tRaw('household.unlink_ok'),'success');
  loadHousehold();
}

/**
 * @param {string} subUserId
 */
export async function dismissFormerLink(subUserId){
  const d = await api('POST','/v1/settings/household/former/dismiss', { sub_user_id: parseInt(subUserId) });
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  loadHousehold();
}

/**
 * @param {string} subUserId
 * @param {string} name
 */
export async function unlinkHousehold(subUserId, name){
  if(!await confirmDelete(tRaw('household.unlink_confirm_title', { name }), tRaw('household.unlink_confirm_text', { name }), 'link', { knopf: 'confirm.btn.verknuepfung_loesen', art: 'bp' })) return;
  const d = await api('POST','/v1/settings/household/unlink', subUserId ? { sub_user_id: parseInt(subUserId) } : {});
  if(!d.success){ toast(d.error || t('settings.error'),'error'); return; }
  toast(tRaw('household.unlink_ok'),'success');
  loadHousehold();
}
G('btn-sav-bl').onclick=async()=>{ const d=await speichereEinstellungen(tRaw('settings.api_key_title'),{bricklink_consumer_key:G('bl-ck').value,bricklink_consumer_secret:G('bl-cs').value,bricklink_token:G('bl-tok').value,bricklink_token_secret:G('bl-ts').value}); if(!d) return; if(d.success) await api('PUT','/v1/admin/api-limits',{bricklink:parseInt(G('lim-bl').value)}); toast(d.success?t('settings.bl_saved'):t('settings.error'),d.success?'success':'error'); if(d.success){loadRateLimitStats();} };
G('btn-sav-rb').onclick=async()=>{ const d=await speichereEinstellungen(tRaw('settings.api_key_title'),{rebrickable_api_key:G('rb-key').value}); if(!d) return; if(d.success) await api('PUT','/v1/admin/api-limits',{rebrickable:parseInt(G('lim-rb').value)}); toast(d.success?t('settings.rb_saved'):t('settings.error'),d.success?'success':'error'); if(d.success){loadRateLimitStats();} };
G('btn-sav-bs').onclick=async()=>{ const d=await speichereEinstellungen(tRaw('settings.api_key_title'),{brickset_api_key:G('bs-key').value}); if(!d) return; if(d.success) await api('PUT','/v1/admin/api-limits',{brickset:parseInt(G('lim-bs').value)}); toast(d.success?t('settings.bs_saved'):t('settings.error'),d.success?'success':'error'); if(d.success){loadRateLimitStats();} };
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
  // Alles in den Papierkorb: 30 Tage wiederherstellbar, deshalb eine Rückfrage
  // statt des früheren Eintippens von „LÖSCHEN". Nur das EIGENE Konto (Server).
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


// ── USER MGMT ─────────────────────────────────────────
export async function loadUsers(){
  const d=await api('GET','/v1/auth/users'); if(!d.success) return;
  // Der Name zuerst: Am Telefon ist er der Kartentitel (data-label leer), die ID steht nur am Rechner.
  G('users-tbl').innerHTML=`<div class="tw"><table class="dt user-tbl"><thead><tr><th>${t('users.col.username')}</th><th class="nutzer-id">ID</th><th>${t('users.col.role')}</th><th>${t('users.col.created')}</th><th>${t('users.col.actions')}</th></tr></thead><tbody>${
    d.users.map(u=>`<tr><td class="nutzer-name" data-label=""><strong>${esc(u.username)}</strong></td><td class="nutzer-id">${u.id}</td>
      <td><span class="rb ${u.is_admin?'rv':'ru'}">${u.is_admin?t('users.role.admin'):t('users.role.user')}</span>
        ${u.is_active === false ? `<span class="rb ru">${t('users.status.inaktiv')}</span>` : ''}
        ${u.wartet_auf_bestaetigung ? `<span class="rb ru">${t('users.status.wartet')}</span>` : ''}</td>
      <td>${fmtDatum(u.created_at)}</td>
      <td>${nutzerAktionen(u)}</td></tr>`).join('')
  }</tbody></table></div>`;
  ladeProtokoll();
}
// Ausgeschrieben statt zusammengesetzt, damit jeder Schlüssel als Aufruf im
// Quelltext steht und die Wörterbuchprüfung ihn findet.
const AKTIONEN = {
  konto_angelegt:          () => t('users.aktion.konto_angelegt'),
  einstellungen_geaendert: () => t('users.aktion.einstellungen_geaendert'),
  passwort_gesetzt:        () => t('users.aktion.passwort_gesetzt'),
  zweiter_faktor_entfernt: () => t('users.aktion.zweiter_faktor_entfernt'),
  verwalter_ernannt:       () => t('users.aktion.verwalter_ernannt'),
  verwalter_entzogen:      () => t('users.aktion.verwalter_entzogen'),
  konto_geloescht:         () => t('users.aktion.konto_geloescht'),
  konto_deaktiviert:       () => t('users.aktion.konto_deaktiviert'),
  konto_reaktiviert:       () => t('users.aktion.konto_reaktiviert'),
  konto_freigeschaltet:    () => t('users.aktion.konto_freigeschaltet'),
  gutschein_klartext:      () => t('users.aktion.gutschein_klartext'),
  gutschein_pdf:           () => t('users.aktion.gutschein_pdf'),
  gutschein_export:        () => t('users.aktion.gutschein_export'),
};
/** Wer hat an welchem fremden Konto was geändert — die letzten Einträge. */
async function ladeProtokoll(){
  const d=await api('GET','/v1/admin/protokoll'); if(!d.success) return;
  const eintraege = d.eintraege || [];
  G('vw-protokoll').innerHTML = eintraege.length ? `<div class="tw"><table class="dt"><thead><tr><th>${t('users.protokoll.zeit')}</th><th>${t('users.protokoll.verwalter')}</th><th>${t('users.protokoll.aktion')}</th><th>${t('users.protokoll.konto')}</th></tr></thead><tbody>${
    eintraege.map(e=>`<tr><td>${new Date(String(e.zeit)).toLocaleString(locale())}</td><td>${esc(e.verwalter_name||'—')}</td>
      <td>${(/** @type {Record<string, () => string>} */ (AKTIONEN)[String(e.aktion)] || (() => esc(e.aktion)))()}${e.einzelheiten ? `: ${esc(e.einzelheiten)}` : ''}</td><td>${esc(e.ziel_name||'#'+e.ziel_id)}</td></tr>`).join('')
  }</tbody></table></div>` : `<p data-stil="color:var(--mut);font-size:var(--fs-2)">${t('users.protokoll.leer')}</p>`;
}
/**
 * Gegen das eigene Konto gibt es hier nichts zu tun (der Server lehnt es
 * ohnehin ab); das sagt die Zeile. Die seltenen und harten Aktionen stehen
 * hinter „Weitere“, damit eine Zeile nicht aus fünf Rahmenknöpfen besteht.
 * @param {Konto} u
 */
function nutzerAktionen(u) {
  if (ME && u.id === ME.id) return `<span class="text-klein">${t('users.selbst')}</span>`;
  const selten = [
    nutzerKnopf(u, 'bs', 'toggleAktiv', u.is_active === false ? 'ok' : 'pause',
      u.is_active === false ? 'users.action.activate' : 'users.action.deactivate',
      u.is_active === false ? 'users.action.activate_title' : 'users.action.deactivate_title', u.is_active === false ? 0 : 1, u.username),
    u.zweiter_faktor ? nutzerKnopf(u, 'bs', 'zfZuruecksetzen', 'schloss', 'users.action.2fa', 'zf.reset_title', u.username) : '',
    nutzerKnopf(u, 'bd', 'delUser', 'loeschen', 'common.delete', 'users.action.delete_title', u.username),
  ].join('');
  return `<div class="nutzer-aktionen">
    ${u.wartet_auf_bestaetigung ? nutzerKnopf(u, 'bp', 'kontoFreischalten', 'ok', 'users.action.freischalten', 'users.action.freischalten_title', u.username) : ''}
    ${nutzerKnopf(u, 'bs', 'openRpw', 'schluessel', 'users.action.password', 'users.pw_reset_title', u.username)}
    ${nutzerKnopf(u, 'bs', 'toggleAdmin', u.is_admin ? 'runter' : 'hoch',
      u.is_admin ? 'users.action.make_user' : 'users.action.make_admin',
      u.is_admin ? 'users.action.make_user_title' : 'users.action.make_admin_title', u.is_admin ? 1 : 0, u.username)}
    <details class="mehr-menue v-mehr"><summary class="btn bs btn-sm" aria-label="${esc(tRaw('users.weitere', { name: u.username }))}">${ico('menue')}<span>${t('users.weitere_kurz')}</span></summary>
      <div class="mehr-liste">${selten}</div></details>
  </div>`;
}

/**
 * Ein Knopf der Benutzertabelle: Symbol und Wort sichtbar, die längere
 * Beschreibung als Tooltip, der Name des Kontos für Vorleser im Namen.
 * @param {Konto} u
 * @param {string} art
 * @param {string} klick
 * @param {string} symbol
 * @param {string} wortKey
 * @param {string} titelKey
 * @param {unknown} [arg2]
 * @param {unknown} [arg3]
 */
function nutzerKnopf(u, art, klick, symbol, wortKey, titelKey, arg2, arg3) {
  const wort = tRaw(wortKey), titel = tRaw(titelKey);
  return `<button type="button" class="btn ${art} btn-sm" data-click="${klick}"${echt()} data-arg="${u.id}"` +
    `${arg2 !== undefined ? ` data-arg2="${esc(String(arg2))}"` : ''}` +
    `${arg3 !== undefined ? ` data-arg3="${esc(String(arg3))}"` : ''} title="${esc(titel)}"` +
    ` aria-label="${esc(`${wort}: ${u.username}`)}">${ico(symbol)}<span>${esc(wort)}</span></button>`;
}
G('btn-cu').onclick=async()=>{
  const n=G('nu-n').value.trim(),p=G('nu-p').value,a=G('nu-a').checked;
  if(!n||!p){toast(tRaw('users.name_pw_req'),'error');return;}
  const regel = passwortRegelText(p);
  if (regel) { toast(regel,'error');return;}
  const admin_password = await bestaetigeMitPasswort(tRaw('users.create_title'), tRaw('users.admin_confirm_text'), 'schloss', { knopf: 'confirm.btn.konto_anlegen', art: 'bp' });
  if (admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('POST','/v1/auth/users',{username:n,password:p,is_admin:a,admin_password,...z}));
  if(d===null) return;
  if(d.success){toast(tRaw('users.created',{name:n}),'success');G('nu-n').value=G('nu-p').value='';G('nu-a').checked=false;loadUsers();} else toast(d.error||t('settings.error'),'error');
};
/**
 * @param {string} uid
 * @param {string} name
 */
function openRpw(uid, name){
  G('rpw-uid').value=uid; G('rpw-uid').dataset.name = name || ''; G('rpw-v').value='';
  G('pw-tit').textContent = name ? tRaw('users.pw_reset_title_name', { name }) : tRaw('users.pw_reset_title');
  G('pw-modal').classList.add('open');
}
G('btn-rpw').onclick=async()=>{
  const neuesPw = G('rpw-v').value;
  const regel = passwortRegelText(neuesPw);
  if (regel) { toast(regel,'error');return;}
  const name = G('rpw-uid').dataset.name;
  const admin_password = await bestaetigeMitPasswort(name ? tRaw('users.reset_pw_title_name', { name }) : tRaw('users.reset_pw_title'), tRaw('users.admin_confirm_text'), 'schloss', { knopf: 'confirm.btn.passwort_setzen', art: 'bp' });
  if (admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('PUT',`/v1/auth/users/${G('rpw-uid').value}/password`,{password:neuesPw, admin_password, ...z}));
  if(d===null) return;
  if(d.success){toast(tRaw('users.pw_reset'),'success');G('pw-modal').classList.remove('open');} else toast(d.error||t('settings.error'),'error');
};
/**
 * @param {string} uid
 * @param {string | number | boolean} isAdmin
 * @param {string} name
 */
async function toggleAdmin(uid,isAdmin,name){
  // isAdmin kommt seit der data-arg-Umstellung als Zeichenkette. `!"0"` ist
  // false — das Umschalten hätte damit IMMER auf "kein Admin" gesetzt.
  const cur = isAdmin === true || isAdmin === 1 || isAdmin === '1';
  // Der Dialog nennt das Konto: Die Knöpfe sehen in jeder Zeile gleich aus.
  const titel = tRaw(cur ? 'users.role_title_entziehen' : 'users.role_title_geben', { name });
  const admin_password = await bestaetigeMitPasswort(titel, tRaw('users.admin_confirm_text'), 'schloss', { knopf: 'confirm.btn.rolle_aendern', art: 'bp' });
  if (admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('PUT',`/v1/auth/users/${uid}/admin`,{is_admin:!cur, admin_password, ...z})); if(d===null) return; if(d.success){toast(tRaw('users.role_changed'),'success');loadUsers();} else toast(d.error||t('settings.error'),'error'); }
/**
 * Deaktivieren meldet das Konto auf allen Geräten ab; die Daten bleiben.
 * @param {string} uid
 * @param {string} aktiv
 * @param {string} name
 */
async function toggleAktiv(uid, aktiv, name){
  const istAktiv = String(aktiv) === '1';
  const admin_password = await bestaetigeMitPasswort(
    tRaw(istAktiv ? 'users.deactivate_title' : 'users.activate_title', { name }), tRaw('users.admin_confirm_text'), 'schloss', { knopf: istAktiv ? 'confirm.btn.deaktivieren' : 'confirm.btn.aktivieren', art: 'bp' });
  if (admin_password === null) return;
  const d = await mitZweitemFaktor(z => api('PUT', `/v1/auth/users/${uid}/aktiv`, { is_active: !istAktiv, admin_password, ...z }));
  if (d === null) return;
  if (d.success) { toast(tRaw(istAktiv ? 'users.deactivated' : 'users.activated'), 'success'); loadUsers(); }
  else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function kontoFreischalten(uid, name){
  const admin_password = await bestaetigeMitPasswort(tRaw('users.freischalten_title', { name }), tRaw('users.freischalten_text', { name }), 'ok',
    { knopf: 'confirm.btn.freischalten', art: 'bp' });
  if (admin_password === null) return;
  const d = await mitZweitemFaktor(z => api('PUT', `/v1/auth/users/${uid}/freischalten`, { admin_password, ...z }));
  if (d === null) return;
  if (d.success) { toast(tRaw('users.freigeschaltet', { name }), 'success'); loadUsers(); }
  else toast(d.error || t('settings.error'), 'error');
}
/**
 * @param {string} uid
 * @param {string} name
 */
async function delUser(uid,name){
  const admin_password = await bestaetigeMitPasswort(tRaw('users.delete.title', { name }), tRaw('users.delete.text'), 'profil',
    { knopf: 'confirm.btn.konto_name_loeschen', werte: { name }, art: 'bd' });
  if(admin_password === null) return;
  const d=await mitZweitemFaktor(z => api('DELETE',`/v1/auth/users/${uid}`,{admin_password, ...z}));
  if(d===null) return;
  if(d.success){toast(tRaw('users.deleted', { name }),'success');loadUsers();} else toast(d.error||t('settings.error'),'error');
}


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
      st.textContent = d.error || t('settings.error');
      st.style.color = 'var(--r500)';
    }
  } catch(e) { st.textContent = tRaw('common.network_error'); }
  fi.value = '';
}

// Lagerorte verwalten. Nur die eigenen: Ein Ort ist ein Regal in der eigenen Wohnung, fremde
// umzubenennen wäre ein Versehen. Die Auswahl selbst steckt im Detailfenster (ladeOrtAuswahl).
// Ausführlich: docs/begruendungen/public/js/05-settings.js.md#der-lagerort-soll-ein-auswahlfeld-mit-ei

/** Ein Preisalarm direkt in der Übersicht, ohne Umweg über das Set. */
async function legeAlarmAn() {
  const roh = String(G('alarm-neu-set')?.value || '').trim();
  const sn = /^\d+$/.test(roh) ? roh + '-1' : roh;
  const schwelle = leseBetrag(G('alarm-neu-preis')?.value);
  if (!sn) { feldFehler('alarm-neu-set', tRaw('alerts.new_set_fehlt')); return; }
  if (!(Number(schwelle) > 0)) { feldFehler('alarm-neu-preis', tRaw('alerts.new_preis_fehlt')); return; }
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`,
    { richtung: G('alarm-neu-richtung').value, schwelle, condition: G('alarm-neu-zustand').value });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  G('alarm-neu-set').value = ''; G('alarm-neu-preis').value = '';
  toast(tRaw('alerts.new_ok', { set: sn }), 'success');
  await ladeAlarmUebersicht();
}

/**
 * Alle Preisalarme an einem Ort: Im Set-Detail findet man einen Alarm nur, wenn man das Set schon
 * gefunden hat. Schwelle als Feld (speichert beim Verlassen), dazu der letzte Preis, ohne den sie
 * nicht zu beurteilen ist.
 * Ausführlich: docs/begruendungen/public/js/05-settings.js.md#alle-preisalarme-des-kontos-die-uebersic
 */
export async function ladeAlarmUebersicht() {
  const el = G('alerts-list');
  if (!el) return;
  const vorschlag = G('alarm-neu-sets');
  if (vorschlag) vorschlag.innerHTML = allSets.map(x => `<option value="${esc(x.set_number)}">${esc(x.name || '')}</option>`).join('');
  const d = await api('GET', '/v1/alerts');
  if (!d?.success) return;
  const alarme = d.alerts || [];
  if (!alarme.length) {
    el.innerHTML = `<p class="text-mut">${esc(tRaw('alerts.empty'))}</p>`;
    return;
  }
  el.innerHTML = alarme.map(a => {
    const zustand = a.condition === 'U' ? tRaw('common.condition_used') : tRaw('common.condition_new');
    const richtung = a.richtung === 'unter' ? tRaw('alerts.below') : tRaw('alerts.above');
    // Der Schluessel ist (Set, Zustand) — beides muss mit, sonst trifft das
    // Aendern den falschen der beiden moeglichen Alarme eines Sets.
    const schluessel = `${a.set_number}|${a.condition}`;
    const stand = a.zuletzt_preis == null
      ? ''
      : t('alerts.last', { preis: fmtN(a.zuletzt_preis, a.currency_code) });
    // „scharf“ gegen „unscharf“ nicht über die Farbe allein, denn grün und grau sind für Rot-Grün-Schwache
    // gleich: Wort, Fläche (gefüllt/umrandet) und Zeichen (●/○) tragen es je für sich, wie in der App.
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#marke
    const marke = a.ausgeloest
      ? `<span class="alarm-marke alarm-marke-aus">${esc(tRaw('alerts.fired'))}</span>`
      : `<span class="alarm-marke alarm-marke-an">${esc(tRaw('alerts.armed'))}</span>`;
    // Bild wie in den Finanzen: erst die heruntergeladene Kopie, dann die
    // Adresse aus der eigenen Sammlung, zuletzt die des Katalogs. Ein Alarm
    // auf ein Set, das man NICHT besitzt, hat nur die letzte — deshalb steht
    // sie ueberhaupt in der Antwort.
    const bildQuelle = a.image_local || a.image_url || a.set_img_url || '';
    const bild = bildQuelle
      ? bildTag({ src: imgUrl(thumbUrl(bildQuelle) || bildQuelle, true), alt: '', klasse: 'bild-38', ph: 'set' })
      : `<span class="bild-ph bild-38" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
    // Die Zeile öffnet das Set-Detail, aber nur wenn das Set im Bestand ist — sonst käme statt Dialog ein
    // Fehler. Feld und Löschknopf haben eigenes data-click, sonst öffnete jeder Klick ins Feld den Dialog
    // darüber.
    // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#oeffnet
    const oeffnet = a.besitzt
      ? ` class="zeiger" data-click="openModal" data-arg="${esc(a.set_number)}"`
      : '';
    return `<div class="alarm-ue"${oeffnet}>
      ${bild}
      <div class="alarm-ue-text">
        <div><strong>${esc(a.name || a.set_number)}</strong></div>
        <div class="alarm-ue-unter">${a.name ? esc(a.set_number) + ' · ' : ''}${esc(zustand)}</div>
      </div>
      <div class="alarm-ue-stand">${marke}<span class="alarm-ue-zuletzt">${esc(stand)}</span></div>
      <div class="alarm-ue-schwelle">
        <span class="alarm-ue-richtung">${esc(richtung)}</span>
        <input inputmode="decimal" type="text" autocomplete="off" value="${esc(betragFuerFeld(a.schwelle))}" aria-label="${esc(tRaw('detail.alert_price'))} ${esc(a.set_number)}"
               data-change="aendereAlarmSchwelle" data-arg="${esc(schluessel)}" data-val="1" data-click="stopEvent" class="alarm-ue-feld" />
        <span class="alarm-ue-waehrung">${esc(a.currency_code)}</span>
      </div>
      <button class="btn bs btn-sm alarm-ue-loeschen" data-click="loescheAlarm"${echt()} data-arg="${esc(schluessel)}"
              aria-label="${esc(tRaw('common.delete'))}: ${esc(a.set_number)}" title="${esc(tRaw('common.delete'))}"
              data-arg2="${esc(a.set_number)}">${ico('loeschen')}</button>
    </div>`;
  }).join('');
}

/**
 * (Set, Zustand) aus dem Schluessel der Zeile — eine Stelle, zwei Leser.
 * @param {string} s
 */
function alarmSchluessel(s) {
  const i = String(s).lastIndexOf('|');
  return { setNumber: String(s).slice(0, i), condition: String(s).slice(i + 1) };
}

/**
 * @param {string} schluessel
 * @param {string} wert
 */
async function aendereAlarmSchwelle(schluessel, wert) {
  const schwelle = leseBetrag(wert);
  // Kein stilles Zurueckschreiben bei Unsinn: Wer 0 oder Text eingibt, soll
  // sehen, dass nichts passiert ist, statt spaeter einen Alarm zu suchen, den
  // es nicht gibt.
  if (!(schwelle != null && schwelle > 0)) { toast(tRaw('alerts.bad_value'), 'error'); await ladeAlarmUebersicht(); return; }
  const { setNumber, condition } = alarmSchluessel(schluessel);
  // Geschrieben wird ueber die BESTEHENDE Route zum Set — die Uebersicht
  // bekommt keinen eigenen Schreibweg (siehe routes/api_v1/sets.ts).
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(setNumber)}/alert`,
    { condition, schwelle });
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
  await ladeAlarmUebersicht();
}

/**
 * @param {string} schluessel
 * @param {string} setNumber
 */
async function loescheAlarm(schluessel, setNumber) {
  if (!confirm(tRaw('alerts.confirm_delete', { set: setNumber }))) return;
  const { setNumber: sn, condition } = alarmSchluessel(schluessel);
  const d = await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${encodeURIComponent(condition)}`);
  if (!d?.success) toast(d?.error || tRaw('settings.error'), 'error');
  await ladeAlarmUebersicht();
}

/**
 * Die eigenen Orte samt Belegung.
 */
export async function ladeLagerortVerwaltung() {
  const el = G('storage-list');
  if (!el) return;
  // Beide Listen zusammen: `locations` sagt, was zur WAHL steht, `storage`,
  // was wirklich DRIN liegt. Ohne die zweite stünde neben jedem Ort nichts,
  // und die Absage beim Löschen („da liegt noch was") käme aus dem Nichts.
  const [v, b] = await Promise.all([
    api('GET', '/v1/storage/locations'),
    api('GET', '/v1/storage?accounts=own'),
  ]);
  if (!v?.success) return;
  // Ein neuer oder umbenannter Ort steht gleich in den Auswahlfeldern der Erfassung.
  ladeLagerorte().catch(() => {});
  const belegung = new Map((b?.orte || []).map(o => [o.ort, o]));
  const orte = v.orte || [];
  if (!orte.length) {
    el.innerHTML = `<div data-stil="color:var(--mut)">${esc(tRaw('storage.empty'))}</div>`;
    return;
  }
  // Marcos Stern: „Weiter möchte ich ein Lagerort in den Einstellungen als
  // Default setzen können. […] Ich stelle mir das mit einem Sternicon vor."
  const vorgabeId = v.vorgabe?.id ?? null;
  // Das Raster liegt an der Liste, die Zeilen sind display:contents: So teilen alle Zeilen dieselben
  // Spaltenbreiten, und das Namensfeld wird nicht vom Belegungstext daneben schmal gedrückt.
  // minmax(0,1fr), damit ein langer Name die Spalte nicht sprengt; der Trennstrich liegt darum an jeder
  // Zelle.
  // Ausführlich: docs/begruendungen/public/js/05-settings.js.md#marcos-befund-dass-die-felder-alle-schoe
  el.innerHTML = `<div data-stil="font-size:var(--fs-1);color:var(--mut);margin-bottom:6px">` +
                 `${esc(tRaw('storage.default_hint'))}</div>` +
                 `<div class="lager-raster" data-stil="display:grid;grid-template-columns:minmax(0,1fr) max-content max-content max-content;align-items:center;column-gap:8px">` +
                 orte.map(o => {
    const n = belegung.get(o.name);
    // Figuren stehen EIGEN da, nicht bei den Teilesorten (src/bestand/lagerort.ts):
    // „18 Teilesorten" hiesse sonst mal 18 Teilesorten und mal 12 plus 6
    // Figuren, und niemand koennte der Zahl ansehen, was gemeint ist.
    const wie = n ? [t('storage.belegt.sets', { n: Number(n.sets) || 0 }), t('storage.belegt.teile', { n: Number(n.teile) || 0 }),
                     t('storage.belegt.figuren', { n: Number(n.figuren) || 0 })].filter(x => !x.startsWith('0 ')).join(', ')
                  : esc(tRaw('storage.leer'));
    return `<div data-stil="display:contents">
      <span class="lager-feld" data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><input type="text" maxlength="60" value="${esc(o.name)}" aria-label="${esc(tRaw('detail.storage'))}"
             data-change="benenneLagerortUm" data-arg="${o.id}" data-val="1" class="lager-eingabe" /></span>
      <span class="lager-belegt" data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center;font-size:var(--fs-1);color:var(--mut);white-space:nowrap;justify-content:flex-end"><span class="lager-marke${n ? '' : ' lager-frei'}">${wie}</span></span>
      <span data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs lager-sinnbild" data-click="schalteLagerortVorgabe" data-arg="${o.id}"
              data-arg2="${o.id === vorgabeId ? 1 : 0}"
              title="${esc(tRaw(o.id === vorgabeId ? 'storage.default_is' : 'storage.default_set'))}"
              aria-label="${esc(tRaw(o.id === vorgabeId ? 'storage.default_is' : 'storage.default_set'))}"
              aria-pressed="${o.id === vorgabeId ? 'true' : 'false'}">${ico(o.id === vorgabeId ? 'stern-voll' : 'merkliste')}</button></span>
      <span data-stil="padding:6px 0;border-bottom:1px solid var(--bdr);display:flex;align-items:center"><button class="btn bs lager-sinnbild" data-click="loescheLagerort"${echt()} data-arg="${o.id}"
              aria-label="${esc(tRaw('common.delete'))}: ${esc(o.name)}" title="${esc(tRaw('common.delete'))}"
              data-arg2="${esc(o.name)}">${ico('loeschen')}</button></span>
    </div>`;
  }).join('') + `</div>`;
}

async function legeLagerortAn() {
  const feld = G('storage-new');
  const name = String(feld?.value || '').trim();
  if (!name) { feldFehler('storage-new', tRaw('storage.name_fehlt')); return; }
  const d = await api('POST', '/v1/storage/locations', { name });
  if (!d?.success) {
    antwortFehler(d, { lagerort_leer: 'storage-new', lagerort_zu_lang: 'storage-new', lagerort_doppelt: 'storage-new' }, tRaw('settings.error'));
    return;
  }
  feld.value = '';
  await ladeLagerortVerwaltung();
}

/**
 * Enter im Eingabefeld legt an — dieselbe Geste wie überall sonst im Baum.
 * @param {string} id
 * @param {KeyboardEvent} ev
 */
function lagerortTaste(id, ev) {
  if (ev?.key === 'Enter') { ev.preventDefault(); legeLagerortAn(); }
}

/**
 * @param {string} id
 * @param {string} wert
 */
async function benenneLagerortUm(id, wert) {
  const name = String(wert || '').trim();
  // Leer heisst hier NICHT löschen: Beim Umbenennen ist ein leergeräumtes Feld
  // fast immer ein Versehen, und das Löschen hat seinen eigenen Knopf daneben.
  // (Beim Lagerort AM SET ist es umgekehrt — dort ist Leeren die natürliche
  // Geste, um die Zuordnung loszuwerden.)
  if (!name) { await ladeLagerortVerwaltung(); return; }
  const d = await api('PUT', `/v1/storage/locations/${encodeURIComponent(id)}`, { name });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); }
  await ladeLagerortVerwaltung();
  // Die Zuordnungen sind mitgewandert (benenneOrtUm im Server) — die Galerie
  // zeigt sonst weiter den alten Namen.
  loadGallery();
}

/**
 * Den Stern umschalten. ★/☆ unterscheiden sich in der Form, nicht in der Farbe, und tragen Titel und
 * aria-pressed. Ein zweiter Druck auf denselben Stern schaltet die Vorgabe ab — ein eigener Knopf
 * dafür wäre zu viel.
 * Ausführlich: docs/begruendungen/public/js/05-settings.js.md#schaltelagerortvorgabe
 * @param {string} id
 * @param {string} war
 */
async function schalteLagerortVorgabe(id, war) {
  const d = await api('PUT', '/v1/storage/default',
                      { id: String(war) === '1' ? null : parseInt(id) });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladeLagerortVerwaltung();
  // Die Erfassungsformulare stehen schon — ohne das Nachziehen zeigten sie
  // den alten Stand, bis jemand die Seite neu laedt. Dieselbe Geste wie beim
  // Erfassungs-Zustand, der nach dem Speichern initDefaultCondition() ruft.
  ladeLagerortVorgabe();
}

/**
 * @param {string} id
 * @param {string} name
 */
async function loescheLagerort(id, name) {
  if (!await confirmDelete(tRaw('storage.delete_title'),
                           `${name} — ${tRaw('storage.delete_text')}`, 'lagerort')) return;
  const d = await api('DELETE', `/v1/storage/locations/${encodeURIComponent(id)}`);
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladeLagerortVerwaltung();
}

/**
 * Preisalarme aus einer CSV einlesen. Die Schwellen werden nicht umgerechnet (ein falscher Kurs wäre
 * schlimmer), gelten aber in der Kontowährung; ein Währungshinweis meldet deshalb mit „info“ statt im
 * Erfolgston.
 * Ausführlich: docs/begruendungen/public/js/05-settings.js.md#importalarmecsv
 */
async function importAlarmeCsv() {
  const status = G('alerts-csv-status');
  const d = await csvHochladen({ feld: 'alerts-csv-file', pfad: '/v1/alerts/import/csv',
    hinweise: (a) => [a.waehrung_hinweis],
    zeige: (l) => { if (status) status.textContent = l ? tRaw('import.running') : ''; } });
  if (d) await ladeAlarmUebersicht();
}

// Der Import von Wanted-Listen steht bei Sets, Teilen und Figuren (js/18-wanted-xml.js), nicht mehr
// hier: Man importiert dort, wo man die Posten danach sieht.
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
 * Die globalen Einstellungen als Unterseiten: Es steht immer genau ein
 * Abschnitt da, und die Leiste zeigt welcher. Gemerkt je Browser, damit ein
 * Neuladen nicht auf den ersten Abschnitt zurückspringt.
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
  stand.innerHTML = `${ico(d?.success ? 'ok' : 'fehler')}<span>${esc(d?.success ? tRaw('setup.test_ok') : grund || tRaw('setup.test_failed'))}</span>`;
}

stelleZielBereit({ einstAbschnitt });

registerActions({
  einstellungenQuellePruefen,
  legeAlarmAn,
  speichereWaehrung,
  speichereZustand,
  setzeEigenesDesign,
  einstAbschnitt,
  geheimUmschalten,
  aendereAlarmSchwelle,
  importAlarmeCsv,
  loescheAlarm,
  legeLagerortAn,
  lagerortTaste,
  benenneLagerortUm,
  loescheLagerort,
  schalteLagerortVorgabe,
  copyHouseholdInvite,
  createHouseholdInvite,
  delUser,
  kontoFreischalten,
  loadTokens,
  openRpw,
  redeemHouseholdInvite,
  revokeOtherTokens,
  revokeToken,
  saveRegEnabled,
  toggleAdmin,
  toggleAktiv,
  unlinkHousehold,
  unlinkFromParent,
  dismissFormerLink,
  importConfig,
});
