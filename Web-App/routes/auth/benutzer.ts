/** Benutzerverwaltung für Verwalter: Jede Änderung verlangt Passwort und
 * zweiten Faktor des Verwalters und steht im Protokoll. */
import { waechterFuer } from '../api_v1/middleware';
import { nutzerId, angemeldeteNutzerId, bestaetigeMitFaktor, nutzerName } from '../../src/konto/http/anmeldung';
import { passwortMangel } from '../../src/infra/passwortRegel';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import { USERNAME_RE } from '../../src/konto';
import type { Dienste } from '../../src/dienste';
import { fachfehler, nichtGefunden } from '../../src/infra/fehlerTexte';

export function baueBenutzerRouter(d: Pick<Dienste, 'konto'>) {
  const { requireApiAdmin: requireAdmin } = waechterFuer(d.konto);
  const router = vertragsRouter('/api/v1/auth');

  router.endpunkt('GET /api/v1/auth/users', requireAdmin, async _req => {
    const users = await d.konto.kontenListe();
    return { users };
  });

  router.endpunkt('POST /api/v1/auth/users', requireAdmin, async (req, res) => {
    const { username, password } = req.eingabe;
    if (!username || !password) fachfehler('ungueltig', 'benutzername_passwort');
    if (!USERNAME_RE.test(String(username))) fachfehler('ungueltig', 'benutzername_ungueltig');
    const mangel = passwortMangel(password, username);
    if (mangel) fachfehler('ungueltig', mangel);
    // Streng: Die Zeichenkette "false" ist in JavaScript wahr und legte einen
    // Verwalter an.
    const alsVerwalter = req.eingabe.is_admin ?? req.eingabe.isAdmin ?? false;
    // Passwort bestätigen und protokollieren — eine erbeutete Sitzung soll keinen
    // Verwalter anlegen.
    const verwalter = angemeldeteNutzerId(req);
    if (!(await bestaetigeMitFaktor(d.konto, req, res, verwalter, req.eingabe.admin_password))) return;
    if ((await d.konto.legeKontoAn(verwalter, username, password, alsVerwalter)) === null)
      fachfehler('konflikt', 'benutzername_vergeben');
    if (alsVerwalter)
      d.konto.verwalterHinweisNebenher('verwalter_ernannt', {
        konto: String(username),
        durch: nutzerName(req) ?? '',
      });
    return {};
  });

  router.endpunkt('PUT /api/v1/auth/users/:id/admin', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    // Streng: "false" ist in JavaScript wahr und entzöge sonst keine Rechte.
    const soll = req.eingabe.is_admin;
    if (targetId === nutzerId(req) && !soll) fachfehler('ungueltig', 'eigene_adminrolle');
    if (!(await d.konto.gibtKonto(targetId))) nichtGefunden('benutzer_nicht_gefunden');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await d.konto.verwalter.verwalterRolleSetzen(angemeldeteNutzerId(req), targetId, soll);
    if (r.wirksamAb) return { effective_at: r.wirksamAb.toISOString() };
    if (r.geaendert && soll)
      d.konto.verwalterHinweisNebenher('verwalter_ernannt', {
        konto: (await d.konto.kontoKurzVon(targetId))?.username ?? String(targetId),
        durch: nutzerName(req) ?? '',
      });

    // Sitzungen enden, weil istVerwalter() zuerst das nie nachgeführte
    // `req.session.isAdmin` fragt; ein Entzug wirkte sonst im offenen Fenster nicht.
    return {};
  });

  router.endpunkt('PUT /api/v1/auth/users/:id/aktiv', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    const soll = req.eingabe.is_active;
    if (targetId === nutzerId(req)) fachfehler('ungueltig', 'eigenes_konto_deaktivieren');
    if (!(await d.konto.gibtKonto(targetId))) nichtGefunden('benutzer_nicht_gefunden');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await d.konto.verwalter.aktivSetzen(angemeldeteNutzerId(req), targetId, soll);
    return r.wirksamAb ? { is_active: true, effective_at: r.wirksamAb.toISOString() } : { is_active: soll };
  });

  // Für Registrierungen, deren Bestätigungsmail nie ankam: Der Verwalter bürgt für die Adresse.
  router.endpunkt('PUT /api/v1/auth/users/:id/freischalten', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    if (!(await d.konto.gibtKonto(targetId))) nichtGefunden('benutzer_nicht_gefunden');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    await d.konto.verwalter.registrierungFreischalten(angemeldeteNutzerId(req), targetId);
    return {};
  });

  /** Ohne aktuelles Passwort des Ziels, aber mit dem des Verwalters. */
  router.endpunkt('PUT /api/v1/auth/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.eingabe || {};
    const targetId = req.pfad.id;
    if (targetId === nutzerId(req)) fachfehler('ungueltig', 'eigenes_konto_passwort');
    const mangel = passwortMangel(password, (await d.konto.kontoKurzVon(targetId))?.username);
    if (mangel) fachfehler('ungueltig', mangel);

    // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
    // eine offene Verwaltersitzung allein genügt dafür nicht.
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await d.konto.verwalter.passwortDurchVerwalter(angemeldeteNutzerId(req), targetId, password ?? '');
    if (!r) nichtGefunden('benutzer_nicht_gefunden');
    return r.wirksamAb ? { effective_at: r.wirksamAb.toISOString() } : {};
  });

  router.endpunkt('DELETE /api/v1/auth/users/:id', requireAdmin, async (req, res) => {
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const wirksam = await d.konto.kontoEntfernen(req.pfad.id, angemeldeteNutzerId(req));
    return wirksam ? { effective_at: wirksam.toISOString() } : {};
  });

  // Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
  router.endpunkt('DELETE /api/v1/auth/users/:id/zweiter-faktor', requireAdmin, async (req, res) => {
    const id = req.pfad.id;
    if (id === nutzerId(req)) fachfehler('ungueltig', 'eigener_zweiter_faktor');
    if (!(await bestaetigeMitFaktor(d.konto, req, res, angemeldeteNutzerId(req), req.eingabe.admin_password))) return;
    const r = await d.konto.verwalter.faktorDurchVerwalter(angemeldeteNutzerId(req), id);
    return r.wirksamAb ? { effective_at: r.wirksamAb.toISOString() } : {};
  });
  return router;
}
