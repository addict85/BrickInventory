/** User management for administrators: every change requires the administrator's password and
 * second factor and is logged. */
import { guardFor } from '../api/middleware';
import { userId, signedInUserId, confirmWithFactor, userName } from '../../src/account/http/login';
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

  router.endpoint('POST /api/v2/auth/users', requireAdmin, async (req, res) => {
    const { username, password } = req.input;
    if (!username || !password) failDomain('invalid', 'username_password');
    if (!USERNAME_RE.test(String(username))) failDomain('invalid', 'username_invalid');
    const mangel = passwordLack(password, username);
    if (mangel) failDomain('invalid', mangel);
    // Strict: the string "false" is truthy in JavaScript and would create an
    // administrator.
    const asAdmin = req.input.is_admin ?? req.input.isAdmin ?? false;
    // Confirm the password and log it — a captured session must not create an
    // administrator.
    const admin = signedInUserId(req);
    if (!(await confirmWithFactor(d.account, req, res, admin, req.input.admin_password))) return;
    if ((await d.account.addAccount(admin, username, password, asAdmin)) === null)
      failDomain('conflict', 'username_taken');
    if (asAdmin)
      d.account.adminHintInBackground('admin_appointed', {
        account: String(username),
        actor: userName(req) ?? '',
      });
    return {};
  });

  router.endpoint('PUT /api/v2/auth/users/:id/admin', requireAdmin, async (req, res) => {
    const targetId = req.pathArgs.id;
    // Strict: "false" is truthy in JavaScript and would otherwise revoke no rights.
    const expected = req.input.is_admin;
    if (targetId === userId(req) && !expected) failDomain('invalid', 'own_admin_role');
    if (!(await d.account.givesAccount(targetId))) notFound('user_not_found');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.admin_password))) return;
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

  router.endpoint('PUT /api/v2/auth/users/:id/active', requireAdmin, async (req, res) => {
    const targetId = req.pathArgs.id;
    const expected = req.input.is_active;
    if (targetId === userId(req)) failDomain('invalid', 'deactivate_own_account');
    if (!(await d.account.givesAccount(targetId))) notFound('user_not_found');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.admin_password))) return;
    const r = await d.account.admin.setActive(signedInUserId(req), targetId, expected);
    return r.effectiveFrom ? { is_active: true, effective_at: r.effectiveFrom.toISOString() } : { is_active: expected };
  });

  // For registrations whose confirmation mail never arrived: the administrator vouches for the address.
  router.endpoint('PUT /api/v2/auth/users/:id/approve', requireAdmin, async (req, res) => {
    const targetId = req.pathArgs.id;
    if (!(await d.account.givesAccount(targetId))) notFound('user_not_found');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.admin_password))) return;
    await d.account.admin.unlockRegistration(signedInUserId(req), targetId);
    return {};
  });

  /** Without the target's current password, but with the administrator's. */
  router.endpoint('PUT /api/v2/auth/users/:id/password', requireAdmin, async (req, res) => {
    const { password } = req.input || {};
    const targetId = req.pathArgs.id;
    if (targetId === userId(req)) failDomain('invalid', 'own_account_password');
    const mangel = passwordLack(password, (await d.account.accountShortOf(targetId))?.username);
    if (mangel) failDomain('invalid', mangel);

    // With the password of another account this one can be taken over —
    // an open administrator session alone is not enough for that.
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.admin_password))) return;
    const r = await d.account.admin.passwordByAdmin(signedInUserId(req), targetId, password ?? '');
    if (!r) notFound('user_not_found');
    return r.effectiveFrom ? { effective_at: r.effectiveFrom.toISOString() } : {};
  });

  router.endpoint('DELETE /api/v2/auth/users/:id', requireAdmin, async (req, res) => {
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.admin_password))) return;
    const effective = await d.account.removeAccount(req.pathArgs.id, signedInUserId(req));
    return effective ? { effective_at: effective.toISOString() } : {};
  });

  // Emergency exit when phone AND recovery codes are gone.
  router.endpoint('DELETE /api/v2/auth/users/:id/second-factor', requireAdmin, async (req, res) => {
    const id = req.pathArgs.id;
    if (id === userId(req)) failDomain('invalid', 'own_second_factor');
    if (!(await confirmWithFactor(d.account, req, res, signedInUserId(req), req.input.admin_password))) return;
    const r = await d.account.admin.factorByAdmin(signedInUserId(req), id);
    return r.effectiveFrom ? { effective_at: r.effectiveFrom.toISOString() } : {};
  });
  return router;
}
