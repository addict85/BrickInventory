/** Benutzerverwaltung für Verwalter: Jede Änderung verlangt Passwort und
 * zweiten Faktor des Verwalters und steht im Protokoll. */
import { guardFor } from '../api_v1/middleware';
import { nutzerId, signedInUserId, confirmWithFactor, nutzerName } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwortRegel';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import { USERNAME_RE } from '../../src/account';
import type { Dienste } from '../../src/dienste';
import { fachfehler, notFound } from '../../src/infra/fehlerTexte';

export function buildUserRouter(d: Pick<Dienste, 'account'>) {
  const { requireApiAdmin: requireAdmin } = guardFor(d.account);
  const router = vertragsRouter('/api/v1/auth');

  router.endpunkt('GET /api/v1/auth/users', requireAdmin, async _req => {
    const users = await d.account.accountsList();
    return { users };
  });

  router.endpunkt('POST /api/v1/auth/users', requireAdmin, async (req, res) => {
    const { username, password } = req.eingabe;
    if (!username || !password) fachfehler('ungueltig', 'benutzername_passwort');
    if (!USERNAME_RE.test(String(username))) fachfehler('ungueltig', 'benutzername_ungueltig');
    const mangel = passwordLack(password, username);
    if (mangel) fachfehler('ungueltig', mangel);
    // Streng: Die Zeichenkette "false" ist in JavaScript wahr und legte einen
    // Verwalter an.
    const asAdmin = req.eingabe.is_admin ?? req.eingabe.isAdmin ?? false;
    // Passwort bestätigen und protokollieren — eine erbeutete Sitzung soll keinen
    // Verwalter anlegen.
    const verwalter = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, verwalter, req.eingabe.admin_password))) return;
    if ((await d.account.putAccountAn(verwalter, username, password, asAdmin)) === null)
      fachfehler('konflikt', 'benutzername_vergeben');
    if (asAdmin)
      d.account.adminHintInBackground('verwalter_ernannt', {
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
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.verwalterRolleSetzen(signedInUserId(req), targetId, soll);
    if (r.effectiveAb) return { effective_at: r.effectiveAb.toISOString() };
    if (r.geaendert && soll)
      d.account.adminHintInBackground('verwalter_ernannt', {
        konto: (await d.account.accountShortOf(targetId))?.username ?? String(targetId),
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
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.aktivSetzen(signedInUserId(req), targetId, soll);
    return r.effectiveAb ? { is_active: true, effective_at: r.effectiveAb.toISOString() } : { is_active: soll };
  });

  // Für Registrierungen, deren Bestätigungsmail nie ankam: Der Verwalter bürgt für die Adresse.
  router.endpunkt('PUT /api/v1/auth/users/:id/freischalten', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    await d.account.verwalter.unlockRegistration(signedInUserId(req), targetId);
    return {};
  });

  /** Ohne aktuelles Passwort des Ziels, aber mit dem des Verwalters. */
  router.endpunkt('PUT /api/v1/auth/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.eingabe || {};
    const targetId = req.pfad.id;
    if (targetId === nutzerId(req)) fachfehler('ungueltig', 'eigenes_konto_passwort');
    const mangel = passwordLack(password, (await d.account.accountShortOf(targetId))?.username);
    if (mangel) fachfehler('ungueltig', mangel);

    // Mit dem Passwort eines anderen Kontos lässt sich dieses übernehmen —
    // eine offene Verwaltersitzung allein genügt dafür nicht.
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.passwordByAdmin(signedInUserId(req), targetId, password ?? '');
    if (!r) notFound('benutzer_nicht_gefunden');
    return r.effectiveAb ? { effective_at: r.effectiveAb.toISOString() } : {};
  });

  router.endpunkt('DELETE /api/v1/auth/users/:id', requireAdmin, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const wirksam = await d.account.kontoEntfernen(req.pfad.id, signedInUserId(req));
    return wirksam ? { effective_at: wirksam.toISOString() } : {};
  });

  // Notausgang, wenn Telefon UND Wiederherstellungscodes weg sind.
  router.endpunkt('DELETE /api/v1/auth/users/:id/zweiter-faktor', requireAdmin, async (req, res) => {
    const id = req.pfad.id;
    if (id === nutzerId(req)) fachfehler('ungueltig', 'eigener_zweiter_faktor');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.factorByAdmin(signedInUserId(req), id);
    return r.effectiveAb ? { effective_at: r.effectiveAb.toISOString() } : {};
  });
  return router;
}
