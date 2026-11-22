/** /api/v2/settings — one router, because the order before and after router.use(requireLogin)
 * is decided here in one place; settingsGlobal.ts hangs behind it. */
import { bearerToken, guardFor } from './middleware';
import { buildSettingsGlobalRouter } from './settingsGlobal';
import { userIdTheRequest, confirmWithFactor, perSession } from '../../src/account/http/login';
import { tlsInfo } from '../../src/infra/tlsRoot';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';
import { ownAccess } from '../../src/account';

export function buildSettingsRouter(
  d: Pick<Services, 'settings' | 'mail' | 'household' | 'account' | 'profile' | 'management'>,
) {
  const { requireToken, requireLoginOrToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  const requireLogin = requireLoginOrToken;

  // Before router.use(requireLogin): login and start screen need the
  // theme, and it reveals nothing about accounts.
  router.endpoint('GET /api/v2/settings/theme', async (req, res) => {
    const uid = await userIdTheRequest(d.account, req);
    res.set('Cache-Control', 'no-cache');
    res.set('Vary', 'Cookie, Authorization');
    return { ...(await d.settings.themeFor(uid)) };
  });

  // Before router.use(requireLogin): the app manages its accesses with a token, not with a session.
  router.endpoint('GET /api/v2/settings/tokens', requireToken, async req => {
    const own = bearerToken(req);
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
        current: ownAccess(own, t.token),
      })),
    };
  });

  /** The row is gone immediately, but the token cache still applies briefly.
   * A FOREIGN access is only revoked by whoever knows password and factor: a
   * captured token should not lock the owner out of their devices. */
  router.endpoint('DELETE /api/v2/settings/tokens/:tokenId', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    const own = bearerToken(req);
    const ownDevice = ownAccess(own, req.pathArgs.tokenId);
    if (!ownDevice && !(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    return { deleted: await d.account.sitzungen.endAccess(uid, req.pathArgs.tokenId, ownDevice) };
  });

  // With password: a captured session must not be able to lock out the owner.
  // `zugaenge` includes the app accesses, so one code is enough for everything.
  router.endpoint('POST /api/v2/settings/sessions/end-others', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password))) return;
    const { sitzungen, accesses, version } = await d.account.sitzungen.endOther(uid, {
      sitzung: req.sessionID,
      token: bearerToken(req),
      accesses: !!req.input.accesses,
    });
    // Only a real session remembers the version; otherwise the app would get one.
    if (perSession(req)) req.session.sitzungsVersion = version;
    if (sitzungen || accesses) d.account.hintInBackground(uid, 'zugaenge_beendet');
    return { deleted: sitzungen, accesses };
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

  router.endpoint('GET /api/v2/settings', requireToken, async req => {
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

  router.endpoint('PUT /api/v2/settings', requireToken, async req => {
    const uid = req.apiUser.user_id;
    const allowed = ['currency', 'price_cache_ttl'];
    let updated = 0;
    for (const key of allowed) {
      if (req.input[key] !== undefined) {
        // Central place: a REAL currency change triggers the price job.
        await d.settings.setUserSetting(uid, key, req.input[key]);
        updated++;
      }
    }
    return { updated };
  });

  // The GLOBAL default; the effective one is returned by GET /settings (effective_condition).
  router.endpoint('GET /api/v2/settings/default-condition', requireToken, async _req => {
    return { condition: await d.settings.globalDefaultCondition() };
  });

  // The effective value, for webapp and app from one route.
  router.endpoint('GET /api/v2/settings/user/default-condition', requireToken, async req => {
    return { condition: await d.settings.userDefaultCondition(req.apiUser.user_id) };
  });

  router.endpoint('POST /api/v2/settings/user/default-condition', requireToken, async req => {
    const condition = req.input.condition ?? '';
    if (condition === '') {
      await d.settings.deleteUserSetting(req.apiUser.user_id, 'user_default_condition');
    } else {
      // setUserSetting(): EXACTLY ONE write path for user settings.
      await d.settings.setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
    }
    return { condition: condition || null };
  });

  // ── Household: linking accounts (rules in src/household/household.ts) ───────────
  router.endpoint('GET /api/v2/settings/household', requireToken, async req => {
    return { ...(await d.household.householdStatus(req.apiUser.user_id)) };
  });

  router.endpoint('POST /api/v2/settings/household/invite', requireToken, async req => {
    return { ...(await d.household.createInvitation(req.apiUser.user_id)) };
  });

  router.endpoint('POST /api/v2/settings/household/redeem/check', requireToken, async req => {
    const zuOft = await d.account.accountThrottled('haushalt-pruefen', req.apiUser.user_id, 30, 60 * 60 * 1000);
    if (zuOft) failDomain('zu_viele', 'too_many_requests', { minutes: zuOft.waitMin });
    return { ...(await d.household.checkInvitation(req.apiUser.user_id, req.input.code)) };
  });

  // With password: the main account then writes this account's inventory; a
  // captured token alone must not be able to set that up.
  router.endpoint('POST /api/v2/settings/household/redeem', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    // The link is an access to the collection like a passkey: with an active second factor only with a code.
    if (!(await confirmWithFactor(d.account, req, res, uid, req.input.password, 'factor_code'))) return;
    return { ...(await d.account.joinHousehold(uid, req.input.code)) };
  });

  router.endpoint('POST /api/v2/settings/household/unlink', requireToken, async req => {
    return {
      ...(await d.household.unlinkAccounts(req.apiUser.user_id, req.input.sub_user_id, req.input.main_user_id)),
    };
  });

  router.endpoint('POST /api/v2/settings/household/former/dismiss', requireToken, async req => {
    return { ...(await d.household.discardSeparated(req.apiUser.user_id, req.input.sub_user_id)) };
  });

  router.use('/settings', requireLogin);

  /** For manual comparison; the same value is `fp` in the app's QR code. */
  router.endpoint('GET /api/v2/settings/tls', requireToken, async _req => {
    return { ...(await tlsInfo()) };
  });

  // Empty means "the administrator's default".
  router.endpoint('POST /api/v2/settings/user/theme', requireToken, async req => {
    const uid = req.apiUser.user_id;
    await d.settings.setOwnTheme(uid, req.input.theme);
    return { ...(await d.settings.themeFor(uid)) };
  });

  router.attachOne(buildSettingsGlobalRouter(d));
  return router;
}
