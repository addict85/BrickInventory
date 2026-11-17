/** /api/v1/settings — ein Router, weil die Reihenfolge vor und nach router.use(requireLogin)
 * hier an einer Stelle entschieden wird; settingsGlobal.ts hängt dahinter. */
import { bearerToken, waechterFuer } from './middleware';
import { baueSettingsGlobalRouter } from './settingsGlobal';
import { nutzerIdDerAnfrage, bestaetigeMitFaktor, perSitzung } from '../../src/konto/http/anmeldung';
import { tlsAuskunft } from '../../src/infra/tlsWurzel';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { fachfehler } from '../../src/infra/fehlerTexte';
import { eigenerZugang } from '../../src/konto';

export function baueSettingsRouter(
  d: Pick<Dienste, 'einstellungen' | 'mail' | 'haushalt' | 'konto' | 'profile' | 'verwaltung'>,
) {
  const { requireToken, requireLoginOrToken } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1');

  const requireLogin = requireLoginOrToken;

  // Vor router.use(requireLogin): Anmelde- und Startbildschirm brauchen das
  // Design, und es verrät nichts über Konten.
  router.endpunkt('GET /api/v1/settings/theme', async (req, res) => {
    const uid = await nutzerIdDerAnfrage(d.konto, req);
    res.set('Cache-Control', 'no-cache');
    res.set('Vary', 'Cookie, Authorization');
    return { ...(await d.einstellungen.designFuer(uid)) };
  });

  // Vor router.use(requireLogin): Die App verwaltet ihre Zugänge mit Token, nicht mit Sitzung.
  router.endpunkt('GET /api/v1/settings/tokens', requireToken, async req => {
    const eigener = bearerToken(req);
    // LEAST über beide Fristen: Den Nutzer interessiert der Tag, an dem dieses
    // Gerät ausgesperrt wird.
    const tokens = await d.konto.sitzungen.zugaengeListe(req.apiUser.user_id);
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
        aktuell: eigenerZugang(eigener, t.token),
      })),
    };
  });

  /** Die Zeile ist sofort weg, der Token-Cache gilt aber noch kurz nach.
   * Einen FREMDEN Zugang widerruft nur, wer Passwort und Faktor kennt: Ein
   * erbeuteter Token soll den Inhaber nicht von seinen Geräten aussperren. */
  router.endpunkt('DELETE /api/v1/settings/tokens/:tokenId', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    const eigener = bearerToken(req);
    const eigenesGeraet = eigenerZugang(eigener, req.pfad.tokenId);
    if (!eigenesGeraet && !(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
    return { deleted: await d.konto.sitzungen.zugangBeenden(uid, req.pfad.tokenId, eigenesGeraet) };
  });

  // Mit Passwort: Eine erbeutete Sitzung soll den Inhaber nicht aussperren können.
  // `zugaenge` nimmt die App-Zugänge mit, damit ein Code für alles reicht.
  router.endpunkt('POST /api/v1/settings/sessions/andere-beenden', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password))) return;
    const { sitzungen, zugaenge, version } = await d.konto.sitzungen.beendeAndere(uid, {
      sitzung: req.sessionID,
      token: bearerToken(req),
      zugaenge: !!req.eingabe.zugaenge,
    });
    // Nur eine echte Sitzung merkt sich die Version; sonst bekäme die App eine.
    if (perSitzung(req)) req.session.sitzungsVersion = version;
    if (sitzungen || zugaenge) d.konto.hinweisNebenher(uid, 'zugaenge_beendet');
    return { deleted: sitzungen, zugaenge };
  });

  /** Ausdrücklich aufgezählt: Die App bekommt nur, was sie liest, keine globalen
   * oder Verwalterfelder. */
  const APP_FELDER = [
    'currency',
    'price_condition',
    'price_cache_ttl',
    'default_price_condition',
    'user_default_condition',
  ] as const;

  const APP_VORGABEN: Record<string, string> = {
    currency: 'EUR',
    price_condition: 'N',
    price_cache_ttl: '24',
    default_price_condition: 'N',
    user_default_condition: '',
  };

  router.endpunkt('GET /api/v1/settings', requireToken, async req => {
    const uid = req.apiUser.user_id;
    // einstellungenLesen(): price_cache_ttl und default_price_condition sind global.
    const alle = await d.einstellungen.einstellungenLesen(uid, false);
    const gespeichert = Object.fromEntries(APP_FELDER.map(feld => [feld, alle[feld] ?? APP_VORGABEN[feld] ?? '']));
    return {
      settings: {
        ...(gespeichert as Record<(typeof APP_FELDER)[number], string>),
        // Die Regel steht einmal, in src/einstellungen/settings.ts.
        effective_condition: await d.einstellungen.nutzerStandardZustand(uid),
        // Das wirksame Design des Kontos, nicht die Vorgabe des Verwalters.
        app_theme: (await d.einstellungen.designFuer(uid)).theme,
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
        await d.einstellungen.nutzerEinstellungSetzen(uid, key, req.eingabe[key]);
        updated++;
      }
    }
    return { updated };
  });

  // Der GLOBALE Default; den effektiven liefert GET /settings (effective_condition).
  router.endpunkt('GET /api/v1/settings/default-condition', requireToken, async _req => {
    return { condition: await d.einstellungen.globalerStandardZustand() };
  });

  // Der wirksame Wert, für Webapp und App aus einer Route.
  router.endpunkt('GET /api/v1/settings/user/default-condition', requireToken, async req => {
    return { condition: await d.einstellungen.nutzerStandardZustand(req.apiUser.user_id) };
  });

  router.endpunkt('POST /api/v1/settings/user/default-condition', requireToken, async req => {
    const condition = req.eingabe.condition ?? '';
    if (condition === '') {
      await d.einstellungen.nutzerEinstellungLoeschen(req.apiUser.user_id, 'user_default_condition');
    } else {
      // nutzerEinstellungSetzen(): GENAU EINE Schreibstelle für Benutzereinstellungen.
      await d.einstellungen.nutzerEinstellungSetzen(req.apiUser.user_id, 'user_default_condition', condition);
    }
    return { condition: condition || null };
  });

  // ── Haushalt: Konten verknüpfen (Regeln in src/haushalt/haushalt.ts) ─────────────
  router.endpunkt('GET /api/v1/settings/household', requireToken, async req => {
    return { ...(await d.haushalt.haushaltsStand(req.apiUser.user_id)) };
  });

  router.endpunkt('POST /api/v1/settings/household/invite', requireToken, async req => {
    return { ...(await d.haushalt.einladungAnlegen(req.apiUser.user_id)) };
  });

  router.endpunkt('POST /api/v1/settings/household/redeem/pruefen', requireToken, async req => {
    const zuOft = await d.konto.kontoGedrosselt('haushalt-pruefen', req.apiUser.user_id, 30, 60 * 60 * 1000);
    if (zuOft) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: zuOft.waitMin });
    return { ...(await d.haushalt.pruefeEinladung(req.apiUser.user_id, req.eingabe.code)) };
  });

  // Mit Passwort: Das Hauptkonto schreibt danach den Bestand dieses Kontos; ein
  // erbeutetes Token allein soll das nicht einrichten können.
  router.endpunkt('POST /api/v1/settings/household/redeem', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    // Die Verknüpfung ist ein Zugang zur Sammlung wie ein Passkey: bei aktivem zweitem Faktor nur mit Code.
    if (!(await bestaetigeMitFaktor(d.konto, req, res, uid, req.eingabe.password, 'faktor_code'))) return;
    return { ...(await d.konto.haushaltBeitreten(uid, req.eingabe.code)) };
  });

  router.endpunkt('POST /api/v1/settings/household/unlink', requireToken, async req => {
    return {
      ...(await d.haushalt.kontenTrennen(req.apiUser.user_id, req.eingabe.sub_user_id, req.eingabe.main_user_id)),
    };
  });

  router.endpunkt('POST /api/v1/settings/household/former/dismiss', requireToken, async req => {
    return { ...(await d.haushalt.verwerfeGetrennt(req.apiUser.user_id, req.eingabe.sub_user_id)) };
  });

  router.use('/settings', requireLogin);

  /** Zum Abgleich von Hand; derselbe Wert steht als `fp` im QR-Code der App. */
  router.endpunkt('GET /api/v1/settings/tls', requireToken, async _req => {
    return { ...(await tlsAuskunft()) };
  });

  // Leer heisst „Vorgabe des Verwalters".
  router.endpunkt('POST /api/v1/settings/user/theme', requireToken, async req => {
    const uid = req.apiUser.user_id;
    await d.einstellungen.setzeEigenesDesign(uid, req.eingabe.theme);
    return { ...(await d.einstellungen.designFuer(uid)) };
  });

  router.haengeEin(baueSettingsGlobalRouter(d));
  return router;
}
