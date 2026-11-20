/** /api/v1/settings — ein Router, weil die Reihenfolge vor und nach router.use(requireLogin)
 * hier an einer Stelle entschieden wird; settingsGlobal.ts hängt dahinter. */
import { bearerToken, guardFor } from './middleware';
import { buildSettingsGlobalRouter } from './settingsGlobal';
import { userIdTheRequest, confirmWithFactor, perSession } from '../../src/account/http/login';
import { tlsInfo } from '../../src/infra/tlsWurzel';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { fachfehler } from '../../src/infra/fehlerTexte';
import { ownAccess } from '../../src/account';

export function buildSettingsRouter(
  d: Pick<Dienste, 'settings' | 'mail' | 'household' | 'account' | 'profile' | 'management'>,
) {
  const { requireToken, requireLoginOrToken } = guardFor(d.account);
  const router = vertragsRouter('/api/v1');

  const requireLogin = requireLoginOrToken;

  // Vor router.use(requireLogin): Anmelde- und Startbildschirm brauchen das
  // Design, und es verrät nichts über Konten.
  router.endpunkt('GET /api/v1/settings/theme', async (req, res) => {
    const uid = await userIdTheRequest(d.account, req);
    res.set('Cache-Control', 'no-cache');
    res.set('Vary', 'Cookie, Authorization');
    return { ...(await d.settings.themeFor(uid)) };
  });

  // Vor router.use(requireLogin): Die App verwaltet ihre Zugänge mit Token, nicht mit Sitzung.
  router.endpunkt('GET /api/v1/settings/tokens', requireToken, async req => {
    const eigener = bearerToken(req);
    // LEAST über beide Fristen: Den Nutzer interessiert der Tag, an dem dieses
    // Gerät ausgesperrt wird.
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

  /** Die Zeile ist sofort weg, der Token-Cache gilt aber noch kurz nach.
   * Einen FREMDEN Zugang widerruft nur, wer Passwort und Faktor kennt: Ein
   * erbeuteter Token soll den Inhaber nicht von seinen Geräten aussperren. */
  router.endpunkt('DELETE /api/v1/settings/tokens/:tokenId', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    const eigener = bearerToken(req);
    const ownDevice = ownAccess(eigener, req.pfad.tokenId);
    if (!ownDevice && !(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    return { deleted: await d.account.sitzungen.endAccess(uid, req.pfad.tokenId, ownDevice) };
  });

  // Mit Passwort: Eine erbeutete Sitzung soll den Inhaber nicht aussperren können.
  // `zugaenge` nimmt die App-Zugänge mit, damit ein Code für alles reicht.
  router.endpunkt('POST /api/v1/settings/sessions/andere-beenden', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!(await confirmWithFactor(d.account, req, res, uid, req.eingabe.password))) return;
    const { sitzungen, zugaenge, version } = await d.account.sitzungen.endOther(uid, {
      sitzung: req.sessionID,
      token: bearerToken(req),
      zugaenge: !!req.eingabe.zugaenge,
    });
    // Nur eine echte Sitzung merkt sich die Version; sonst bekäme die App eine.
    if (perSession(req)) req.session.sitzungsVersion = version;
    if (sitzungen || zugaenge) d.account.hintInBackground(uid, 'zugaenge_beendet');
    return { deleted: sitzungen, zugaenge };
  });

  /** Ausdrücklich aufgezählt: Die App bekommt nur, was sie liest, keine globalen
   * oder Verwalterfelder. */
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
    // readSettings(): price_cache_ttl und default_price_condition sind global.
    const alle = await d.settings.readSettings(uid, false);
    const gespeichert = Object.fromEntries(APP_FIELDS.map(feld => [feld, alle[feld] ?? APP_DEFAULTS[feld] ?? '']));
    return {
      settings: {
        ...(gespeichert as Record<(typeof APP_FIELDS)[number], string>),
        // Die Regel steht einmal, in src/settings/settings.ts.
        effective_condition: await d.settings.userDefaultCondition(uid),
        // Das wirksame Design des Kontos, nicht die Vorgabe des Verwalters.
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
        // Zentrale Stelle: Eine ECHTE Währungsänderung stösst den Preis-Job an.
        await d.settings.setUserSetting(uid, key, req.eingabe[key]);
        updated++;
      }
    }
    return { updated };
  });

  // Der GLOBALE Default; den effektiven liefert GET /settings (effective_condition).
  router.endpunkt('GET /api/v1/settings/default-condition', requireToken, async _req => {
    return { condition: await d.settings.globalDefaultCondition() };
  });

  // Der wirksame Wert, für Webapp und App aus einer Route.
  router.endpunkt('GET /api/v1/settings/user/default-condition', requireToken, async req => {
    return { condition: await d.settings.userDefaultCondition(req.apiUser.user_id) };
  });

  router.endpunkt('POST /api/v1/settings/user/default-condition', requireToken, async req => {
    const condition = req.eingabe.condition ?? '';
    if (condition === '') {
      await d.settings.deleteUserSetting(req.apiUser.user_id, 'user_default_condition');
    } else {
      // setUserSetting(): GENAU EINE Schreibstelle für Benutzereinstellungen.
      await d.settings.setUserSetting(req.apiUser.user_id, 'user_default_condition', condition);
    }
    return { condition: condition || null };
  });

  // ── Haushalt: Konten verknüpfen (Regeln in src/household/household.ts) ─────────────
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

  // Mit Passwort: Das Hauptkonto schreibt danach den Bestand dieses Kontos; ein
  // erbeutetes Token allein soll das nicht einrichten können.
  router.endpunkt('POST /api/v1/settings/household/redeem', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    // Die Verknüpfung ist ein Zugang zur Sammlung wie ein Passkey: bei aktivem zweitem Faktor nur mit Code.
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

  /** Zum Abgleich von Hand; derselbe Wert steht als `fp` im QR-Code der App. */
  router.endpunkt('GET /api/v1/settings/tls', requireToken, async _req => {
    return { ...(await tlsInfo()) };
  });

  // Leer heisst „Vorgabe des Verwalters".
  router.endpunkt('POST /api/v1/settings/user/theme', requireToken, async req => {
    const uid = req.apiUser.user_id;
    await d.settings.setOwnTheme(uid, req.eingabe.theme);
    return { ...(await d.settings.themeFor(uid)) };
  });

  router.attachOne(buildSettingsGlobalRouter(d));
  return router;
}
