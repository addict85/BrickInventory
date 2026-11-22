import { emit } from './events.js';
import { loadHousehold } from './household.js';
import { loadUsers } from './user-management.js';
import { registerTarget } from './targets.js';
import { registerActions } from './registry.js';
import { I18N, LANG, applyLang, locale, t, tRaw } from '../i18n.js';
import { api } from './api.js';
import { ico, G, buttonBusy, setHtml } from './dom.js';
import { responseError, fieldError, passwordRuleText } from './form.js';
import { _updateLangSelect, applyTheme, initDefaultCondition, showUsernames } from './account.js';
import { reportAtField, toast } from './messages.js';
import { loadParts } from './parts.js';
import { loadMinifigs } from './minifigs.js';
import { reportSection } from './router.js';
import { clearerReason } from './components.js';
import {
  accountCurrency,
  loggedInAccount,
  settingsSnapshot,
  setAccountCurrency,
  setSettingsSnapshot,
} from './state.js';
import { html } from './escaping.js';
import {
  confirmDelete,
  confirmDeleteWithPassword,
  withSecondFactor,
  confirmWithPassword,
  saveSettings,
} from './confirm-prompt.js';
import { COUNTRY_TO_CURRENCY } from './vouchers.js';
// Settings: profile, theme, source credentials, mail, cache, QR login and config
// import/export. Household, user management, alerts and storage locations have their own files.

// ── SETTINGS ──────────────────────────────────────────
// SMTP + Registration settings load/save
/** @param {Record<string, string> | null | undefined} settings */
async function loadSmtpSettings(settings) {
  if (!settings) return;
  const s = settings;
  if (G('smtp-host')) G('smtp-host').value = s.smtp_host || '';
  if (G('smtp-port')) G('smtp-port').value = s.smtp_port || '587';
  if (G('smtp-user')) G('smtp-user').value = s.smtp_user || '';
  if (G('smtp-pass')) G('smtp-pass').value = s.smtp_pass || '';
  if (G('smtp-from')) G('smtp-from').value = s.smtp_from || '';
  if (G('smtp-secure')) G('smtp-secure').checked = s.smtp_secure === '1';
  if (G('smtp-tls-fp')) G('smtp-tls-fp').value = s.smtp_tls_fingerprint || '';
  if (G('smtp-tls-ca')) G('smtp-tls-ca').value = s.smtp_tls_ca || '';
  if (G('smtp-tls-legacy')) G('smtp-tls-legacy').style.display = s.smtp_insecure_tls === '1' ? '' : 'none';
  if (G('reg-enabled')) G('reg-enabled').checked = s.registration_enabled === '1';
  loadedSmtp = JSON.stringify(smtpFormValues());
  registrationMailHint();
}

/** Without mail delivery every registration would stay unconfirmed; the toggle says so instead of staying silent. */
async function registrationMailHint() {
  const box = G('reg-enabled'),
    hint = G('reg-mail-hint');
  if (!box || !hint) return;
  const d = await api('GET', '/v2/auth/registration-status');
  const none = d?.mail_delivery === false;
  box.disabled = none && !box.checked;
  hint.hidden = !none;
  hint.textContent = none ? tRaw(box.checked ? 'settings.reg_paused' : 'settings.reg_needs_mail') : '';
}

// The server requires the admin password whenever an SMTP value changes; it is only asked for
// then, not on every save or test.
let loadedSmtp = '';
function smtpFormValues() {
  return {
    smtp_host: G('smtp-host')?.value.trim() || '',
    smtp_port: G('smtp-port')?.value || '587',
    smtp_user: G('smtp-user')?.value.trim() || '',
    smtp_pass: G('smtp-pass')?.value || '',
    smtp_from: G('smtp-from')?.value.trim() || '',
    smtp_secure: G('smtp-secure')?.checked ? '1' : '0',
    smtp_tls_fingerprint: G('smtp-tls-fp')?.value.trim() || '',
    smtp_tls_ca: G('smtp-tls-ca')?.value.trim() || '',
  };
}
/** Save SMTP; null if the password prompt was cancelled. */
/** @returns {Promise<{ success: boolean, error?: string | null } | null>} */
async function saveSmtp() {
  const values = smtpFormValues();
  // Save unchanged too when the old-exception hint is still showing: only a save clears it.
  const legacy = G('smtp-tls-legacy');
  if (JSON.stringify(values) === loadedSmtp && (!legacy || legacy.style.display === 'none')) return { success: true };
  const admin_password = await confirmDeleteWithPassword(
    tRaw('smtp.confirm_title'),
    tRaw('smtp.confirm_text'),
    'lock',
    {
      button: 'confirm.btn.save',
      kind: 'bp',
    },
  );
  if (admin_password === null) return null;
  const d = await withSecondFactor(z => api('POST', '/v2/settings', { ...values, admin_password, ...z }));
  if (d === null) return null;
  if (d.success) {
    loadedSmtp = JSON.stringify(values);
    if (legacy) legacy.style.display = 'none';
    registrationMailHint();
  }
  return d;
}

G('btn-test-smtp')?.addEventListener('click', async () => {
  const btn = G('btn-test-smtp');
  const res = G('smtp-test-result');
  const release = buttonBusy(btn);
  // Save first, so the test runs with exactly these values.
  const saved = await saveSmtp();
  if (!saved?.success) {
    release();
    if (saved) toast(saved.error || t('settings.error'), 'error');
    return;
  }
  const own = String(loggedInAccount?.email || '');
  const to = G('smtp-test-email')?.value?.trim() || own;
  // A foreign address needs the admin's password confirmation; their own does not.
  const foreign = to.toLowerCase() !== own.toLowerCase();
  const d = foreign
    ? await confirmWithPassword(
        tRaw('smtp.test_confirm_title'),
        (password, z) => api('POST', '/v2/settings/smtp-test', { to, password, ...z }),
        tRaw('smtp.test_confirm_text'),
      )
    : await withSecondFactor(z => api('POST', '/v2/settings/smtp-test', { to, ...z }));
  release();
  if (!d) return;
  res.style.display = 'block';
  if (d.success) {
    res.style.background = 'var(--g50)';
    res.style.color = 'var(--g700)';
    res.style.border = '1px solid var(--g300)';
    // The mail server's message id helps find the message in its own log.
    res.textContent =
      d.mode === 'console'
        ? tRaw('smtp.console')
        : [d.message || t('smtp.ok'), d.messageId].filter(Boolean).join(' · ');
  } else {
    res.style.background = 'var(--r100)';
    res.style.color = 'var(--r500)';
    res.style.border = '1px solid var(--r300)';
    res.textContent = d.error || tRaw('settings.error');
  }
});

G('btn-sav-smtp')?.addEventListener('click', async () => {
  const d = await saveSmtp();
  if (!d) return;
  if (d.success) reportAtField(G('btn-sav-smtp'));
  else toast(d.error || t('settings.error'), 'error');
});

async function saveRegEnabled() {
  // The checkbox follows the server: during the password prompt it still shows the old state.
  const box = G('reg-enabled'),
    want = box.checked;
  box.checked = !want;
  const d = await saveSettings(tRaw('settings.reg_title'), { registration_enabled: want ? '1' : '0' });
  if (!d) return;
  if (d.success) box.checked = want;
  toast(d.success ? t('settings.reg_saved') : d.error || t('settings.error'), d.success ? 'success' : 'error');
  registrationMailHint();
}

export async function loadCacheTtl() {
  try {
    const d = await api('GET', '/v2/admin/cache-ttl');
    if (d.success) {
      const sel = G('mon-cache-ttl');
      if (sel) sel.value = d.ttl || '24';
    }
  } catch (_) {}
  try {
    const dc = await api('GET', '/v2/settings/default-condition');
    if (dc.success) {
      const sel = G('mon-default-condition');
      if (sel) sel.value = dc.condition || 'N';
      // Pre-fill user settings select with effective default (monitoring value for new users)
      const userSel = G('s-default-condition');
      if (userSel && !userSel.dataset.loaded) {
        userSel.value = dc.condition || 'N';
        userSel.dataset.loaded = '1';
      }
    }
  } catch (_) {}
}

/** One value, one save: like every single value, saved right away, confirmed at the field (reportAtField). */
async function saveCacheTtl() {
  const sel = G('mon-cache-ttl');
  const d = await api('POST', '/v2/admin/cache-ttl', { ttl: sel?.value || '24' });
  if (d.success) reportAtField(sel);
  else toast(d.error || t('settings.error'), 'error');
}

async function saveStandardState() {
  const sel = G('mon-default-condition');
  const d = await api('POST', '/v2/admin/default-condition', { condition: sel?.value || 'N' });
  if (d.success) reportAtField(sel);
  else toast(d.error || t('settings.error'), 'error');
}

export async function loadRateLimitStats() {
  const d = await api('GET', '/v2/admin/cache-stats');
  if (!d.success || !d.rate_limits) return;
  const fmt = (/** @type {import('../../frontend-types/contract').RateLimit | null | undefined} */ rl) =>
    rl ? `${rl.count.toLocaleString(locale())} / ${rl.limit.toLocaleString(locale())}` : '—';
  for (const service of /** @type {const} */ (['bricklink', 'rebrickable', 'brickset'])) {
    const rl = d.rate_limits[service];
    if (G('rl-' + service)) G('rl-' + service).textContent = fmt(rl);
    const bar = G('rl-' + service + '-bar');
    if (bar) bar.style.width = rl?.limit ? Math.min(100, (100 * rl.count) / rl.limit) + '%' : '0';
  }
}
export async function loadCacheStats() {
  const d = await api('GET', '/v2/admin/cache-stats');
  if (!d.success) return;
  if (G('cs-prices')) G('cs-prices').textContent = String(d.prices || 0);
  if (G('cs-subsets')) G('cs-subsets').textContent = String(d.subsets || 0);
  if (G('cs-catalog')) G('cs-catalog').textContent = String(d.catalog || 0);
  // After a read error this shows 0; the hint says that it is not a real 0.
  if (d.degraded?.length) toast(tRaw('monitor.degraded', { parts: d.degraded.join(', ') }), 'info');
}
export async function loadApiLimits() {
  const d = await api('GET', '/v2/admin/api-limits');
  if (!d.success) return;
  G('lim-rb').value = String(d.limits.rebrickable);
  G('lim-bl').value = String(d.limits.bricklink);
  G('lim-bs').value = String(d.limits.brickset);
}

export async function loadProfile() {
  const dw = G('dark-choice');
  if (dw && window.__bimDarkValue) dw.value = window.__bimDarkValue();
  loadOwnTheme();
  const d = await api('GET', '/v2/auth/profile');
  const u = d.success ? d.user : null;
  if (!u) return;
  G('prof-first').value = u.first_name || '';
  G('prof-last').value = u.last_name || '';
  G('prof-user').value = u.username || '';
  G('prof-email').value = u.email || '';
  G('prof-email').dataset.soFar = u.email || '';
  // Without an address there is nothing to confirm — "verified" next to an empty field would contradict itself.
  const vEl = G('prof-email-verified');
  if (vEl)
    setHtml(
      vEl,
      !u.email
        ? ''
        : u.email_verified
          ? html`<span class="email-ok">${tRaw('profile.verified')}</span>`
          : html`<span class="email-open">${tRaw('profile.not_verified')}</span>`,
    );
  // The new address only takes effect after the confirmation link; until then it only shows here.
  const hint = G('prof-email-hint');
  if (hint) hint.textContent = u.new_email ? tRaw('profile.email_pending', { email: u.new_email }) : '';
}

/** Account theme choice: own theme or the admin's default. */
async function loadOwnTheme() {
  const sel = G('design-choice');
  if (!sel) return;
  const d = await api('GET', '/v2/settings/theme');
  if (!d.success) return;
  showThemeChoice(d);
}

/** @param {import('../../frontend-types/contract').AppThemeResponse} d */
function showThemeChoice(d) {
  const sel = /** @type {HTMLSelectElement} */ (/** @type {unknown} */ (G('design-choice')));
  const NAMES = {
    classic: 'settings.theme_classic',
    brick: 'settings.theme_brick',
    werkbank: 'settings.theme_werkbank',
    farbfaecher: 'settings.theme_farbfaecher',
    noppe: 'settings.theme_noppe',
    hochglanz: 'settings.theme_hochglanz',
  };
  const defaultName = tRaw(/** @type {Record<string, string>} */ (NAMES)[d.preset ?? ''] || NAMES.classic);
  sel.options[0].textContent = tRaw('settings.own_theme_default', { name: defaultName });
  sel.value = d.own || '';
  // A sentence about the chosen theme: theme names alone don't say what it looks like.
  // Werkbank has no light variant; that is noted here too.
  const hint = G('design-hint');
  const active = d.own || d.preset || 'classic';
  const DESCRIPTIONS = {
    classic: 'settings.theme_desc.classic',
    brick: 'settings.theme_desc.brick',
    werkbank: 'settings.theme_desc.werkbank',
    farbfaecher: 'settings.theme_desc.farbfaecher',
    noppe: 'settings.theme_desc.noppe',
    hochglanz: 'settings.theme_desc.hochglanz',
  };
  const description = /** @type {Record<string, string>} */ (DESCRIPTIONS)[active];
  if (hint) hint.textContent = description ? tRaw(description) : '';
  // For a theme with no light variant, the choice below has no effect; the note shows right where it is made.
  const darkOnly = !!window.__bimOnlyDark?.(active),
    dw = G('dark-choice'),
    dh = G('dark-hint');
  if (dw) dw.disabled = darkOnly;
  if (dh) dh.hidden = !darkOnly;
}

async function setOwnDesign() {
  const theme = G('design-choice').value;
  const d = await api('POST', '/v2/settings/user/theme', { theme });
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  applyTheme(d.theme);
  if (settingsSnapshot) settingsSnapshot.app_theme = d.theme;
  showThemeChoice(d);
  reportAtField(G('design-choice'));
}

// Display settings take effect right away: currency and default condition save on selection.
async function saveCurrency() {
  const value = G('s-cur').value;
  // Market prices exist per currency; after a switch they're missing until the price job fetches them. Without
  // this confirmation it looked as if all values had been lost.
  if (
    value !== accountCurrency &&
    !(await confirmDelete(
      tRaw('account.currency_change_title'),
      tRaw('account.currency_change_text', { alt: accountCurrency, new: value }),
      'finances',
      { button: 'account.currency_change_button', kind: 'bp' },
    ))
  ) {
    G('s-cur').value = accountCurrency;
    return;
  }
  const d = await api('POST', '/v2/settings', { currency: value });
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  setAccountCurrency(value);
  if (settingsSnapshot) settingsSnapshot.currency = value;
  await loadHousehold().catch(() => {});
  emit('metricsLoad');
  if (document.getElementById('tab-gallery')?.classList.contains('active')) emit('collectionLoad');
  reportAtField(G('s-cur'));
  toast(tRaw('account.currency_saved_market', { w: value }), 'success');
}

async function saveState() {
  const condVal = G('s-default-condition')?.value || 'N';
  const d = await api('POST', '/v2/settings/user/default-condition', { condition: condVal });
  if (!d?.success) {
    toast(d?.error || t('settings.error'), 'error');
    return;
  }
  initDefaultCondition();
  reportAtField(G('s-default-condition'));
}

G('btn-sav-prof').onclick = async () => {
  const first_name = G('prof-first').value.trim();
  const last_name = G('prof-last').value.trim();
  const username = G('prof-user').value.trim();
  const email = G('prof-email').value.trim();
  if (!username) {
    toast(tRaw('profile.username_empty'), 'error');
    return;
  }
  const btn = G('btn-sav-prof');
  btn.disabled = true;
  try {
    // The server confirms every profile change with the password; otherwise it would reveal whether a
    // name is taken. A new address is named in the dialog so one sees what one is confirming.
    const newAddress = email && email !== (G('prof-email').dataset.soFar || '');
    const d = await confirmWithPassword(
      tRaw(newAddress ? 'profile.email_change_title' : 'profile.save_title'),
      (pwC, z) =>
        api('PUT', '/v2/auth/profile', { username, email, first_name, last_name, password_current: pwC, ...z }),
      newAddress ? tRaw('profile.email_change_text', { email }) : undefined,
    );
    if (!d) return;
    if (!d.success) {
      toast(d.error || t('profile.save_error'), 'error');
      return;
    }
    await loadProfile();
    // The name shown in the header is otherwise only set at startup.
    if (loggedInAccount) {
      loggedInAccount.username = username;
      showUsernames();
    }
    if (d.emailChanged && !d.emailSent) toast(tRaw('profile.mail_not_sent'), 'error');
    else if (d.emailChanged) toast(tRaw('profile.saved_mail'), 'success');
    else reportAtField(btn);
  } finally {
    btn.disabled = false;
  }
};

G('btn-sav-pw').onclick = async () => {
  const pwN = G('pw-n').value,
    pwR = G('pw-r').value;
  // All field errors at once: shown one at a time, fixing the length only then revealed the mismatch.
  const errorN = pwN ? (passwordRuleText(pwN) ?? '') : tRaw('settings.password.fill_all');
  const errorR = pwN && pwN !== pwR ? tRaw('settings.password.mismatch') : '';
  fieldError('pw-n', errorN);
  fieldError('pw-r', errorR);
  if (errorN || errorR) {
    G(errorN ? 'pw-n' : 'pw-r').focus();
    return;
  }
  const btn = G('btn-sav-pw');
  btn.disabled = true;
  try {
    const dPw = await confirmWithPassword(tRaw('settings.password.change'), (pwC, z) =>
      api('POST', '/v2/auth/change-password', {
        current: pwC,
        newPassword: pwN,
        passkeys_revoked: !!G('pw-pk')?.checked,
        ...z,
      }),
    );
    if (!dPw) return;
    if (!dPw.success) {
      responseError(
        dPw,
        {
          all_fields_required: 'pw-n',
          password_too_short: 'pw-n',
          password_too_long: 'pw-n',
          password_too_common: 'pw-n',
        },
        tRaw('settings.error'),
      );
      return;
    }
    G('pw-n').value = G('pw-r').value = '';
    if (G('pw-pk')) G('pw-pk').checked = true;
    toast(tRaw('account.password_changed'), 'success');
  } finally {
    btn.disabled = false;
  }
};

/** @param {Record<string, string>} s */
function applySettings(s) {
  // Only apply when the settings tab's fields are actually in the DOM
  if (!G('s-cur') && !G('bl-ck')) return;
  setAccountCurrency(s.currency || 'EUR');
  // Apply language preference from server only if explicitly set
  if (s.language && I18N[s.language] && s.language !== LANG) applyLang(s.language, false);
  _updateLangSelect();
  const _set = (/** @type {string} */ id, /** @type {string} */ v) => {
    const el = G(id);
    if (el) el.value = v;
  };
  _set('s-cur', accountCurrency);
  _set('s-default-condition', s.user_default_condition || s.default_price_condition || 'N');
  // The vouchers' issuing country. OUTSIDE the isAdmin block: the value is not secret and is shipped
  // to everyone (sanitizeGlobal lets it through) — only an admin may set it, and that is why the field
  // itself is `admin-only` (index.html). Without this line the select would always show its first
  // entry, regardless of what is saved.
  _set(
    'voucher-country',
    s.voucher_country || /** @type {Record<string, string>} */ (COUNTRY_TO_CURRENCY)[accountCurrency] || 'de-CH',
  );
  if (loggedInAccount?.isAdmin) {
    _set('bl-ck', s.bricklink_consumer_key || '');
    _set('bl-cs', s.bricklink_consumer_secret || '');
    _set('bl-tok', s.bricklink_token || '');
    _set('bl-ts', s.bricklink_token_secret || '');
    _set('rb-key', s.rebrickable_api_key || '');
    _set('bs-key', s.brickset_api_key || '');
    _set('mon-app-theme', s.app_theme || 'classic');
    // s.app_theme is the theme in effect for THIS account; here the admin sets the default.
    api('GET', '/v2/settings/theme').then(d => {
      if (d.success) _set('mon-app-theme', d.preset ?? 'classic');
    });
    loadUsers();
    loadSmtpSettings(s);
  }
  if (loggedInAccount?.isAdmin) loadRateLimitStats();
}
export async function loadSettings() {
  // Show cached data right away, so the tab never appears empty
  if (settingsSnapshot) applySettings(settingsSnapshot);
  loadHousehold();
  const d = await api('GET', '/v2/settings/raw');
  if (!d.success) return;
  setSettingsSnapshot(d.settings);
  applySettings(d.settings);
}

/**
 * Save a credential. All fields empty means "credential removed", not "saved": that phrasing sounded
 * as if a key was still stored.
 * @param {Record<string, string>} values @param {'bricklink'|'rebrickable'|'brickset'} service @param {string} limitId @param {string} button
 */
async function saveApiCredential(values, service, limitId, button) {
  const d = await saveSettings(tRaw('settings.api_key_title'), values);
  if (!d) return;
  if (!d.success) {
    toast(tRaw('settings.error'), 'error');
    return;
  }
  await api('PUT', '/v2/admin/api-limits', { [service]: parseInt(G(limitId).value, 10) });
  const empty = Object.values(values).every(w => !String(w).trim());
  reportAtField(G(button), empty ? tRaw('settings.access_removed') : undefined);
  loadRateLimitStats();
}
G('btn-sav-bl').onclick = () =>
  saveApiCredential(
    {
      bricklink_consumer_key: G('bl-ck').value,
      bricklink_consumer_secret: G('bl-cs').value,
      bricklink_token: G('bl-tok').value,
      bricklink_token_secret: G('bl-ts').value,
    },
    'bricklink',
    'lim-bl',
    'btn-sav-bl',
  );
G('btn-sav-rb').onclick = () =>
  saveApiCredential({ rebrickable_api_key: G('rb-key').value }, 'rebrickable', 'lim-rb', 'btn-sav-rb');
G('btn-sav-bs').onclick = () =>
  saveApiCredential({ brickset_api_key: G('bs-key').value }, 'brickset', 'lim-bs', 'btn-sav-bs');
/** Saved right away like the other single values, confirmed at the field. */
async function saveAppDesign() {
  const theme = G('mon-app-theme')?.value || 'classic';
  const d = await api('POST', '/v2/settings/admin/theme', { theme });
  // What is applied is what holds for THIS account — an own theme stays.
  if (d.success) {
    const w = await api('GET', '/v2/settings/theme');
    if (w.success) {
      applyTheme(w.theme);
      if (settingsSnapshot) settingsSnapshot.app_theme = w.theme;
    }
  }
  if (d.success) reportAtField(G('mon-app-theme'));
  else toast(tRaw('settings.error'), 'error');
}
G('btn-clr').onclick = async () => {
  await api('POST', '/v2/admin/cache-clear');
  toast(tRaw('settings.cache_cleared'), 'info');
  loadCacheStats();
  emit('financesLoad');
};
/**
 * Before clearing, this shows what is lost and what a fresh fetch costs — with today's numbers.
 * @param {boolean} all
 */
async function clearCache(all) {
  const z = await api('GET', '/v2/admin/cache-stats');
  // Without numbers (fetch failed, `degraded` with placeholder zeros) a text with no number: "Clearing
  // 0 prices" would wrongly promise that nothing is lost.
  const known = !!z?.success && typeof z.prices === 'number' && !z.degraded?.includes('cache');
  const n = { p: z?.prices || 0, s: z?.subsets || 0, c: z?.catalog || 0 };
  const title = tRaw(all ? 'settings.all_cache.confirm_title' : 'settings.cache_prices.confirm_title');
  const text = known
    ? tRaw(all ? 'settings.all_cache.confirm_text' : 'settings.cache_prices.confirm_text', n)
    : tRaw(
        all ? 'settings.all_cache.confirm_text_without_number' : 'settings.cache_prices.confirm_text_without_number',
      );
  if (!(await confirmDelete(title, text, 'delete', { button: 'confirm.btn.empty', kind: 'bd' }))) return;
  const d = await api('POST', '/v2/admin/cache-clear', all ? { all: true } : {});
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw(all ? 'settings.all_cache.cleared' : 'settings.cache_cleared'), 'success');
  loadCacheStats();
}
G('btn-clr-prices').onclick = () => clearCache(false);
G('btn-clr-all-cache').onclick = () => clearCache(true);
G('btn-dall').onclick = async () => {
  // Everything into the trash: restorable for 30 days, hence a confirmation dialog rather than the
  // previous typed "DELETE". Only the OWN account (server-side).
  const password = await confirmDeleteWithPassword(
    tRaw('settings.delete_all.title'),
    tRaw('settings.delete_all.text'),
    'delete',
    { button: 'confirm.btn.all_delete', kind: 'bd' },
  );
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', '/v2/inventory', { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  toast(tRaw('settings.delete_all.done', { n: d.sets + d.parts + d.minifigs }), 'success');
  emit('collectionLoad');
  loadParts();
  loadMinifigs();
  emit('metricsLoad');
};
G('btn-account-delete').onclick = async () => {
  // Final and without a trash: password and, if set up, the second factor.
  const password = await confirmDeleteWithPassword(
    tRaw('settings.delete_account.title'),
    tRaw('settings.delete_account.text'),
    'delete',
    { button: 'confirm.btn.account_delete', kind: 'bd' },
  );
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', '/v2/auth/account', { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  location.href = '/';
};

// ── CONFIG EXPORT / IMPORT ───────────────────────────────────
G('btn-cfg-export').onclick = async () => {
  const a = document.createElement('a');
  a.href = '/api/v2/settings/export';
  a.download = `brickinventory-manager-config-${new Date().toISOString().substring(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

async function importConfig() {
  const fi = G('cfg-import-file');
  const file = fi.files?.[0];
  if (!file) return;
  const st = G('cfg-import-status');
  st.textContent = tRaw('settings.importing');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const d = await api('POST', '/v2/settings/import', fd);
    if (d.success) {
      // Which SMTP values the file carried is shown here: they are only ever set in the form.
      const smtp = (d.smtp_skipped || []).join(', ');
      st.textContent = tRaw('settings.imported_note', {
        n: d.imported,
        note: [d.note, smtp].filter(Boolean).join(': '),
      });
      st.style.color = 'var(--g500)';
      toast(tRaw('admin.config_imported'), 'success');
      // The import never takes over SMTP values (password confirmation); which ones, is shown here.
      if (d.smtp_skipped?.length) toast(tRaw('settings.smtp_skipped', { keys: d.smtp_skipped.join(', ') }), 'info');
      loadSettings();
      setSettingsSnapshot(null); // invalidate cache so next loadSettings fetches fresh
      if (loggedInAccount?.isAdmin) {
        loadCacheTtl();
        loadApiLimits();
      }
    } else {
      st.textContent = d.error || tRaw('settings.error');
      st.style.color = 'var(--r500)';
    }
  } catch {
    st.textContent = tRaw('common.network_error');
  }
  fi.value = '';
}

// Importing wanted lists lives with sets, parts and minifigs (js/wanted-xml.js), not here any more:
// you import where you see the entries afterwards.

/**
 * Show or re-hide a masked field (the eye button).
 * @param {string} id
 */
function toggleSecret(id) {
  const field = G(id);
  const btn = document.querySelector(`[data-click="toggleSecret"][data-arg="${id}"]`);
  if (!field || !btn) return;
  const reveal = field.type === 'password';
  field.type = reveal ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(reveal));
  btn.querySelector('use')?.setAttribute('href', reveal ? '#i-eye-close' : '#i-eye');
}

const ONCE_KEY = 'bim_settings_section';
/**
 * Global settings as sub-pages: exactly one section shows at a time, and the nav shows which.
 * Remembered per browser so a reload doesn't jump back to the first section.
 * @param {string|null} id  section; unknown or empty means the first
 * @param {Event} [ev]      the link click — it then doesn't jump
 */
export function settingsSection(id, ev) {
  ev?.preventDefault();
  const grid = G('global-settings-grid');
  if (!grid) return;
  const sections = [...grid.querySelectorAll(':scope > .ssec')];
  const target = sections.find(a => a.id === id) || sections[0];
  if (!target) return;
  for (const a of sections) a.classList.toggle('settings-active', a === target);
  for (const l of grid.querySelectorAll('.settings-nav a')) {
    if (l.getAttribute('data-arg') === target.id) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  }
  try {
    localStorage.setItem(ONCE_KEY, target.id);
  } catch (_) {
    /* convenience only */
  }
  if (ev) reportSection();
}
settingsSection(
  (() => {
    try {
      return localStorage.getItem(ONCE_KEY);
    } catch (_) {
      return null;
    }
  })(),
);

/** Checks the stored credential, like the setup wizard — also later, without reopening it.
 * @this {HTMLButtonElement} @param {string} source */
async function checkSettingsSource(source) {
  const status = G('check-' + source);
  if (!status) return;
  const release = buttonBusy(this);
  status.className = 'source-status';
  status.textContent = tRaw('settings.access_running');
  const d = await api('POST', '/v2/settings/test-source', { source: source });
  release();
  const { reason } = d?.success ? { reason: '' } : d?.code ? { reason: d.error } : clearerReason(d);
  status.classList.add(d?.success ? 'source-ok' : 'source-error');
  setHtml(
    status,
    html`${ico(d?.success ? 'ok' : 'error')}<span>${d?.success ? tRaw('setup.test_ok') : reason || tRaw('setup.test_failed')}</span>`,
  );
}

registerTarget({ settingsSection });

registerActions({
  checkSettingsSource,
  saveAppDesign,
  saveCacheTtl,
  saveStandardState,
  saveCurrency,
  saveState,
  setOwnDesign,
  settingsSection,
  toggleSecret,
  saveRegEnabled,
  importConfig,
});
