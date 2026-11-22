/** User management for administrators: every change requires the administrator's password and
 * second factor and is logged. */
import { guardFor } from '../api_v1/middleware';
import { userId, signedInUserId, confirmWithFactor, userName } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwordRule';
import { contractRouter } from '../../src/http/contractRouter';
import { USERNAME_RE } from '../../src/account';
import type { Services } from '../../src/services';
import { failDomain, notFound } from '../../src/infra/errorTexts';

export function buildUserRouter(d: Pick<Services, 'account'>) {
  const { requireApiAdmin: requireAdmin } = guardFor(d.account);
  const router = contractRouter('/api/v1/auth');

  router.endpoint('GET /api/v1/auth/users', requireAdmin, async _req => {
    const users = await d.account.accountsList();
    return { users };
  });

  router.endpoint('POST /api/v1/auth/users', requireAdmin, async (req, res) => {
    const { username, password } = req.eingabe;
    if (!username || !password) failDomain('ungueltig', 'benutzername_passwort');
    if (!USERNAME_RE.test(String(username))) failDomain('ungueltig', 'benutzername_ungueltig');
    const mangel = passwordLack(password, username);
    if (mangel) failDomain('ungueltig', mangel);
    // Strict: the string "false" is truthy in JavaScript and would create an
    // administrator.
    const asAdmin = req.eingabe.is_admin ?? req.eingabe.isAdmin ?? false;
    // Confirm the password and log it — a captured session must not create an
    // administrator.
    const admin = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, admin, req.eingabe.admin_password))) return;
    if ((await d.account.addAccount(admin, username, password, asAdmin)) === null)
      failDomain('konflikt', 'benutzername_vergeben');
    if (asAdmin)
      d.account.adminHintInBackground('verwalter_ernannt', {
        konto: String(username),
        durch: userName(req) ?? '',
      });
    return {};
  });

  router.endpoint('PUT /api/v1/auth/users/:id/admin', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    // Strict: "false" is truthy in JavaScript and would otherwise revoke no rights.
    const expected = req.eingabe.is_admin;
    if (targetId === userId(req) && !expected) failDomain('ungueltig', 'eigene_adminrolle');
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.setAdminRole(signedInUserId(req), targetId, expected);
    if (r.effectiveAb) return { effective_at: r.effectiveAb.toISOString() };
    if (r.geaendert && expected)
      d.account.adminHintInBackground('verwalter_ernannt', {
        konto: (await d.account.accountShortOf(targetId))?.username ?? String(targetId),
        durch: userName(req) ?? '',
      });

    // Sessions end, because istVerwalter() first asks the never updated
    // `req.session.isAdmin`; a revocation would otherwise not take effect in the open window.
    return {};
  });

  router.endpoint('PUT /api/v1/auth/users/:id/aktiv', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    const expected = req.eingabe.is_active;
    if (targetId === userId(req)) failDomain('ungueltig', 'eigenes_konto_deaktivieren');
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.setActive(signedInUserId(req), targetId, expected);
    return r.effectiveAb ? { is_active: true, effective_at: r.effectiveAb.toISOString() } : { is_active: expected };
  });

  // For registrations whose confirmation mail never arrived: the administrator vouches for the address.
  router.endpoint('PUT /api/v1/auth/users/:id/freischalten', requireAdmin, async (req, res) => {
    const targetId = req.pfad.id;
    if (!(await d.account.givesAccount(targetId))) notFound('benutzer_nicht_gefunden');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    await d.account.verwalter.unlockRegistration(signedInUserId(req), targetId);
    return {};
  });

  /** Without the target's current password, but with the administrator's. */
  router.endpoint('PUT /api/v1/auth/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.eingabe || {};
    const targetId = req.pfad.id;
    if (targetId === userId(req)) failDomain('ungueltig', 'eigenes_konto_passwort');
    const mangel = passwordLack(password, (await d.account.accountShortOf(targetId))?.username);
    if (mangel) failDomain('ungueltig', mangel);

    // With the password of another account this one can be taken over —
    // an open administrator session alone is not enough for that.
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.passwordByAdmin(signedInUserId(req), targetId, password ?? '');
    if (!r) notFound('benutzer_nicht_gefunden');
    return r.effectiveAb ? { effective_at: r.effectiveAb.toISOString() } : {};
  });

  router.endpoint('DELETE /api/v1/auth/users/:id', requireAdmin, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const effective = await d.account.removeAccount(req.pfad.id, signedInUserId(req));
    return effective ? { effective_at: effective.toISOString() } : {};
  });

  // Emergency exit when phone AND recovery codes are gone.
  router.endpoint('DELETE /api/v1/auth/users/:id/zweiter-faktor', requireAdmin, async (req, res) => {
    const id = req.pfad.id;
    if (id === userId(req)) failDomain('ungueltig', 'eigener_zweiter_faktor');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.eingabe.admin_password))) return;
    const r = await d.account.verwalter.factorByAdmin(signedInUserId(req), id);
    return r.effectiveAb ? { effective_at: r.effectiveAb.toISOString() } : {};
  });
  return router;
}
