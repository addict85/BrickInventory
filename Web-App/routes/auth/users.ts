/** User management for administrators: every change is logged. The admin login is
 * enough; the owner decided against asking for the password again. */
import { guardFor } from '../api/middleware';
import { userId, signedInUserId, userName } from '../../src/account/http/login';
import { passwordLack } from '../../src/infra/passwordRule';
import { contractRouter } from '../../src/http/contractRouter';
import { USERNAME_RE } from '../../src/account';
import type { Services } from '../../src/services';
import { failDomain, notFound } from '../../src/infra/errorTexts';

export function buildUserRouter(d: Pick<Services, 'account'>) {
  const { requireApiAdmin: requireAdmin } = guardFor(d.account);
  const router = contractRouter('/api/v2/auth');

  router.endpoint('GET /api/v2/auth/users', requireAdmin, async _req => {
    const users = await d.account.accountsList();
    return { users };
  });

  router.endpoint('POST /api/v2/auth/users', requireAdmin, async req => {
    const { username, password } = req.input;
    if (!username || !password) failDomain('invalid', 'username_password');
    if (!USERNAME_RE.test(String(username))) failDomain('invalid', 'username_invalid');
    const lack = passwordLack(password, username);
    if (lack) failDomain('invalid', lack);
    // Strict: the string "false" is truthy in JavaScript and would create an
    // administrator.
    const asAdmin = req.input.is_admin ?? req.input.isAdmin ?? false;
    const admin = signedInUserId(req);
    if ((await d.account.addAccount(admin, username, password, asAdmin)) === null)
      failDomain('conflict', 'username_taken');
    if (asAdmin)
      d.account.adminHintInBackground('admin_appointed', {
        account: String(username),
        actor: userName(req) ?? '',
      });
    return {};
  });

  router.endpoint('PUT /api/v2/auth/users/:id/admin', requireAdmin, async req => {
    const targetId = req.pathArgs.id;
    // Strict: "false" is truthy in JavaScript and would otherwise revoke no rights.
    const expected = req.input.is_admin;
    if (targetId === userId(req) && !expected) failDomain('invalid', 'own_admin_role');
    if (!(await d.account.givesAccount(targetId))) notFound('user_not_found');
    const r = await d.account.admin.setAdminRole(signedInUserId(req), targetId, expected);
    if (r.effectiveFrom) return { effective_at: r.effectiveFrom.toISOString() };
    if (r.changed && expected)
      d.account.adminHintInBackground('admin_appointed', {
        account: (await d.account.accountShortOf(targetId))?.username ?? String(targetId),
        actor: userName(req) ?? '',
      });

    // Sessions end, because istVerwalter() first asks the never updated
    // `req.session.isAdmin`; a revocation would otherwise not take effect in the open window.
    return {};
  });

  router.endpoint('PUT /api/v2/auth/users/:id/active', requireAdmin, async req => {
    const targetId = req.pathArgs.id;
    const expected = req.input.is_active;
    if (targetId === userId(req)) failDomain('invalid', 'deactivate_own_account');
    if (!(await d.account.givesAccount(targetId))) notFound('user_not_found');
    const r = await d.account.admin.setActive(signedInUserId(req), targetId, expected);
    return r.effectiveFrom ? { is_active: true, effective_at: r.effectiveFrom.toISOString() } : { is_active: expected };
  });

  // For registrations whose confirmation mail never arrived: the administrator vouches for the address.
  router.endpoint('PUT /api/v2/auth/users/:id/approve', requireAdmin, async req => {
    const targetId = req.pathArgs.id;
    if (!(await d.account.givesAccount(targetId))) notFound('user_not_found');
    await d.account.admin.unlockRegistration(signedInUserId(req), targetId);
    return {};
  });

  /** Without the target's current password: the administrator sets a new one. */
  router.endpoint('PUT /api/v2/auth/users/:id/password', requireAdmin, async req => {
    const { password } = req.input || {};
    const targetId = req.pathArgs.id;
    if (targetId === userId(req)) failDomain('invalid', 'own_account_password');
    const lack = passwordLack(password, (await d.account.accountShortOf(targetId))?.username);
    if (lack) failDomain('invalid', lack);

    const r = await d.account.admin.passwordByAdmin(signedInUserId(req), targetId, password ?? '');
    if (!r) notFound('user_not_found');
    return r.effectiveFrom ? { effective_at: r.effectiveFrom.toISOString() } : {};
  });

  router.endpoint('DELETE /api/v2/auth/users/:id', requireAdmin, async req => {
    const effective = await d.account.removeAccount(req.pathArgs.id, signedInUserId(req));
    return effective ? { effective_at: effective.toISOString() } : {};
  });

  // Emergency exit when phone AND recovery codes are gone.
  router.endpoint('DELETE /api/v2/auth/users/:id/second-factor', requireAdmin, async req => {
    const id = req.pathArgs.id;
    if (id === userId(req)) failDomain('invalid', 'own_second_factor');
    const r = await d.account.admin.factorByAdmin(signedInUserId(req), id);
    return r.effectiveFrom ? { effective_at: r.effectiveFrom.toISOString() } : {};
  });
  return router;
}
