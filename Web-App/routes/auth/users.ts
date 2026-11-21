/** User management for administrators: every change requires the administrator's password and
 * second factor and is logged. */
import { guardFor } from '../api_v1/middleware';
import { nutzerId, signedInUserId, confirmWithFactor, nutzerName } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwordRule';
import { vertragsRouter } from '../../src/http/contractRouter';
import { USERNAME_RE } from '../../src/account';
import type { Dienste } from '../../src/services';
import { fachfehler, notFound } from '../../src/infra/errorTexts';

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
    // Strict: the string "false" is truthy in JavaScript and would create an
    // administrator.
    const asAdmin = req.eingabe.is_admin ?? req.eingabe.isAdmin ?? false;
    // Confirm the password and log it — a captured session must not create an
    // administrator.
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
    // Strict: "false" is truthy in JavaScript and would otherwise revoke no rights.
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

    // Sessions end, because istVerwalter() first asks the never updated
    // `req.session.isAdmin`; a revocation would otherwise not take effect in the open window.
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

  // For registrations whose confirmation mail never arrived: the administrator vouches for the address.
  router.endpunkt('PUT /api/v1/auth/users/:id/freischalten', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    await d.account.verwalter.unlockRegistration(signedInUserId(req), targetId);
    return {};
  });

  /** Without the target's current password, but with the administrator's. */
  router.endpunkt('PUT /api/v1/auth/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.eingabe || {};
    const targetId = req.pfad.id;
    if (targetId === nutzerId(req)) fachfehler('ungueltig', 'eigenes_konto_passwort');
    const mangel = passwordLack(password, (await d.account.accountShortOf(targetId))?.username);
    if (mangel) fachfehler('ungueltig', mangel);

    // With the password of another account this one can be taken over —
    // an open administrator session alone is not enough for that.
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

  // Emergency exit when phone AND recovery codes are gone.
  router.endpunkt('DELETE /api/v1/auth/users/:id/zweiter-faktor', requireAdmin, async (req, res) => {
    const id = req.pfad.id;
    if (id === nutzerId(req)) fachfehler('ungueltig', 'eigener_zweiter_faktor');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.factorByAdmin(signedInUserId(req), id);
    return r.effectiveAb ? { effective_at: r.effectiveAb.toISOString() } : {};
  });
  return router;
}
