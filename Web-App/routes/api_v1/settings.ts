/** /api/v1/settings — one router, because the order before and after router.use(requireLogin)
 * is decided here in one place; settingsGlobal.ts hangs behind it. */
import { bearerToken, guardFor } from './middleware';
import { buildSettingsGlobalRouter } from './settingsGlobal';
import { userIdTheRequest, confirmWithFactor, perSession } from '../../src/account/http/login';
import { tlsInfo } from '../../src/infra/tlsWurzel';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { fachfehler } from '../../src/infra/errorTexts';
import { ownAccess } from '../../src/account';

export function buildSettingsRouter(
  d: Pick<Services, 'settings' | 'mail' | 'household' | 'account' | 'profile' | 'management'>,
) {
  const { requireToken, requireLoginOrToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  const requireLogin = requireLoginOrToken;

  // Before router.use(requireLogin): login and start screen need the
  // theme, and it reveals nothing about accounts.
  router.endpunkt('GET /api/v1/settings/theme', async (req, res) => {
    const uid = await userIdTheRequest(d.account, req);
    res.set('Cache-Control', 'no-cache');
    res.set('Vary', 'Cookie, Authorization');
    return { ...(await d.settings.themeFor(uid)) };
  });

  // Before router.use(requireLogin): the app manages its accesses with a token, not with a session.
  router.endpunkt('GET /api/v1/settings/tokens', requireToken, async req => {
    const eigener = bearerToken(req);
    // LEAST over both deadlines: the user cares about the day on which this
    // device gets locked out.
    const tokens = await d.account.sitzungen.accessesList(req.apiUser.user_id);
    return {
      tokens: tokens.map(t => ({
        token_prefix: t.token.substring(0, 8),
        token_id: t.token.substring(0, 16),
        label: t.label,
        created_at: t.created_at,
        last_used: t.last_used,
        expires_at: t.expires_at,
        hard_expires_at: t.hard_expires_at,
        never_expires: !t.expires_at,
        scope: t.scope,
        ip_range: t.ip_range,
        rotated_at: t.rotated_at,
        aktuell: ownAccess(eigener, t.token),
      })),
    };
  });

  /** The row is gone immediately, but the token cache still applies briefly.
   * A FOREIGN access is only revoked by whoever knows password and factor: a
   * captured token should not lock the owner out of their devices. */
  router.endpunkt('DELETE /api/v1/settings/tokens/:tokenId', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    const eigener = bearerToken(req);
    const ownDevice = ownAccess(eigener, req.pfad.tokenId);
    if (!ownDevice && !(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    return { deleted: await d.account.sitzungen.endAccess(uid, req.pfad.tokenId, ownDevice) };
  });

  // With password: a captured session must not be able to lock out the owner.
  // `zugaenge` includes the app accesses, so one code is enough for everything.
  router.endpunkt('POST /api/v1/settings/sessions/andere-beenden', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    const { sitzungen, zugaenge, version } = await d.account.sitzungen.endOther(uid, {
      sitzung: req.sessionID,
      token: bearerToken(req),
      zugaenge: !!req.eingabe.zugaenge,
    });
    // Only a real session remembers the version; otherwise the app would get one.
    if (perSession(req)) req.session.sitzungsVersion = version;
    if (sitzungen || zugaenge) d.account.hintInBackground(uid, 'zugaenge_beendet');
    return { deleted: sitzungen, zugaenge };
  });

  /** Listed explicitly: the app only gets what it reads, no global
   * or administrator fields. */
  const APP_FIELDS = [
    'currency',
    'price_condition',
    'price_cache_ttl',
    'default_price_condition',
    'user_default_condition',
  ] as const;

  const APP_DEFAULTS: Record<string, string> = {
    currency: 'EUR',
    price_condition: 'N',
    price_cache_ttl: '24',
    default_price_condition: 'N',
    user_default_condition: '',
  };

  router.endpunkt('GET /api/v1/settings', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // readSettings(): price_cache_ttl and default_price_condition are global.
    const all = await d.settings.readSettings(uid, false);
    const saved = Object.fromEntries(APP_FIELDS.map(field => [field, all[field] ?? APP_DEFAULTS[field] ?? '']));
    return {
      settings: {
        ...(saved as Record<(typeof APP_FIELDS)[number], string>),
        // The rule stands once, in src/settings/settings.ts.
        effective_condition: await d.settings.userDefaultCondition(uid),
        // The account's effective theme, not the administrator's default.
        app_theme: (await d.settings.themeFor(uid)).theme,
      },
    };
  });

  router.endpunkt('PUT /api/v1/settings', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const allowed = ['currency', 'price_cache_ttl'];
    let updated = 0;
    for (const key of allowed) {
      if (req.eingabe[key] !== undefined) {
        // Central place: a REAL currency change triggers the price job.
        await d.settings.setUserSetting(uid, key, req.eingabe[key]);
        updated++;
      }
    }
    return { updated };
  });

  // The GLOBAL default; the effective one is returned by GET /settings (effective_condition).
  router.endpunkt('GET /api/v1/settings/default-condition', requireToken, async _req => {
    return { condition: await d.settings.globalDefaultCondition() };
  });

  // The effective value, for webapp and app from one route.
  router.endpunkt('GET /api/v1/settings/user/default-condition', requireToken, async req => {
    return { condition: await d.settings.userDefaultCondition(req.apiUser.user_id) };
  });

  router.endpunkt('POST /api/v1/settings/user/default-condition', requireToken, async req => {
    const condition = req.eingabe.condition ?? '';
    if (condition === '') {
      await d.settings.deleteUserSetting(req.apiUser.user_id, 'user_default_condition');
    } else {
      // setUserSetting(): EXACTLY ONE write path for user settings.
      await d.settings.setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
    }
    return { condition: condition || null };
  });

  // ── Household: linking accounts (rules in src/household/household.ts) ───────────
  router.endpunkt('GET /api/v1/settings/household', requireToken, async req => {
    return { ...(await d.household.householdStatus(req.apiUser.user_id)) };
  });

  router.endpunkt('POST /api/v1/settings/household/invite', requireToken, async req => {
    return { ...(await d.household.createInvitation(req.apiUser.user_id)) };
  });

  router.endpunkt('POST /api/v1/settings/household/redeem/pruefen', requireToken, async req => {
    const zuOft = await d.account.accountThrottled('haushalt-pruefen', req.apiUser.user_id, 30, 60 * 60 * 1000);
    if (zuOft) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: zuOft.waitMin });
    return { ...(await d.household.checkInvitation(req.apiUser.user_id, req.eingabe.code)) };
  });

  // With password: the main account then writes this account's inventory; a
  // captured token alone must not be able to set that up.
  router.endpunkt('POST /api/v1/settings/household/redeem', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    // The link is an access to the collection like a passkey: with an active second factor only with a code.
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password, 'faktor_code'))) return;
    return { ...(await d.account.joinHousehold(uid, req.eingabe.code)) };
  });

  router.endpunkt('POST /api/v1/settings/household/unlink', requireToken, async req => {
    return {
      ...(await d.household.unlinkAccounts(req.apiUser.user_id, req.eingabe.sub_user_id, req.eingabe.main_user_id)),
    };
  });

  router.endpunkt('POST /api/v1/settings/household/former/dismiss', requireToken, async req => {
    return { ...(await d.household.discardSeparated(req.apiUser.user_id, req.eingabe.sub_user_id)) };
  });

  router.use('/settings', requireLogin);

  /** For manual comparison; the same value is `fp` in the app's QR code. */
  router.endpunkt('GET /api/v1/settings/tls', requireToken, async _req => {
    return { ...(await tlsInfo()) };
  });

  // Empty means "the administrator's default".
  router.endpunkt('POST /api/v1/settings/user/theme', requireToken, async req => {
    const uid = req.apiUser.user_id;
    await d.settings.setOwnTheme(uid, req.eingabe.theme);
    return { ...(await d.settings.themeFor(uid)) };
  });

  router.attachOne(buildSettingsGlobalRouter(d));
  return router;
}
