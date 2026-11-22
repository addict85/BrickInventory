/** Administrator actions on foreign accounts: change and log entry in one
 * transaction. A missing entry would conceal the change, an entry without a
 * change would claim one that never happened. */
import crypto from 'node:crypto';
import { accountDisplayName, setzeAktiv, setzeVerwalterRolle, endAccesses } from './accounts';
import { withAccessEnd, accessTransaction } from './accessEnd';
import { duplicateAs, failDomain, notFound } from '../infra/errorTexts';
import { rememberAdminAction } from './adminLog';
import { hintInBackground, adminHintInBackground } from './accountNotice';
import { hashPassword } from './passwordHash';
import { forgetSessionVersion } from './sessionVersion';
import { tokenDigest } from './deviceToken';
import { removeAccount } from './removeAccount';
import { approveLogin } from './loginLimiter';
import type { Takeover, TakeoverKind } from './repository/takeovers';
import type { AccountContext } from './context';

export function writeRole(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  return withAccessEnd(k, ziel, async t => {
    const r = await setzeVerwalterRolle(t, ziel, soll);
    if (r.changed) await rememberAdminAction(t, durch, ziel, soll ? 'admin_appointed' : 'admin_revoked');
    return r;
  });
}

export function persistActive(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  return withAccessEnd(k, ziel, async t => {
    const r = await setzeAktiv(t, ziel, soll);
    if (r.changed) await rememberAdminAction(t, durch, ziel, soll ? 'account_reactivated' : 'account_deactivated');
    return r;
  });
}

export async function verwalterRolleSetzen(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  const effectiveAb = soll ? null : await announceTeardown(k, durch, ziel, 'revoke_role');
  return effectiveAb ? { changed: false, effectiveAb } : { ...(await writeRole(k, durch, ziel, soll)), effectiveAb };
}

/** An active administrator is only deactivated after the deadline; an already deactivated account stays so. */
export async function aktivSetzen(k: AccountContext, durch: number, ziel: number, soll: boolean) {
  const active = !soll && (await k.konten.accountFull(ziel))?.is_active === true;
  const effectiveAb = active ? await announceTeardown(k, durch, ziel, 'deactivate') : null;
  return effectiveAb
    ? { changed: false, effectiveAb }
    : { ...(await persistActive(k, durch, ziel, soll)), effectiveAb };
}

/** Deletion by an administrator: for an administrator only after the deadline; the own account immediately. */
export async function accountRemoveBy(k: AccountContext, ziel: number, durch: number | null): Promise<Date | null> {
  const fremd = durch !== null && durch !== ziel && (await k.konten.accountExists(ziel));
  const effectiveAb = fremd ? await announceTeardown(k, durch, ziel, 'delete') : null;
  if (!effectiveAb) await removeAccount(k, ziel, durch);
  return effectiveAb;
}

/** 23505 means: another account got the address at the same time. */
export async function unlockRegistration(k: AccountContext, durch: number, ziel: number): Promise<void> {
  const r = await accessTransaction(k, async t => {
    const r = await t.konten.switchRegistrationFree(ziel);
    if (r === 'ok') await rememberAdminAction(t, durch, ziel, 'account_unlocked');
    return r;
  }).catch(duplicateAs('vergeben' as const));
  if (r !== 'ok') failDomain('konflikt', r === 'vergeben' ? 'email_taken' : 'account_not_pending');
}

/** A captured administrator session must not immediately take over another account
 * (password, second factor) or remove an administrator account: only after TAKEOVER_HOURS, with a
 * mail and a cancel link to the target; a login of the target or the link cancels the change. */
export const TAKEOVER_HOURS = 24;
type AdminRoute = { effectiveAb: Date | null };
export type Teardown = Extract<TakeoverKind, 'deactivate' | 'revoke_role' | 'delete'>;
const isTakeover = (a: TakeoverKind) => a === 'password' || a === 'second_factor';

/** For every account, not only administrators: with the new password the account is someone
 * else's, whatever rights it carries. null: the account does not exist. */
export async function passwordByAdmin(
  k: AccountContext,
  durch: number,
  ziel: number,
  password: string,
): Promise<AdminRoute | null> {
  if (!(await k.konten.accountExists(ziel))) return null;
  const password_hash = await hashPassword(password);
  return { effectiveAb: await announce(k, { target_id: ziel, type: 'password', initiated_by: durch, password_hash }) };
}

export async function factorByAdmin(k: AccountContext, durch: number, ziel: number): Promise<AdminRoute> {
  if (!(await k.konten.accountExists(ziel))) notFound('user_not_found');
  const u: Takeover = { target_id: ziel, type: 'second_factor', initiated_by: durch, password_hash: null };
  return { effectiveAb: await announce(k, u) };
}

/** Announce deactivating, revoking the role or deleting an administrator (or one who just was).
 * @returns from when it applies, or null: the target is no administrator, the caller acts immediately. */
async function announceTeardown(k: AccountContext, durch: number, ziel: number, type: Teardown): Promise<Date | null> {
  const admin =
    type === 'revoke_role'
      ? (await k.konten.accountShort(ziel))?.is_admin === true
      : await k.uebernahmen.adminOrJustBeen(ziel, TAKEOVER_HOURS);
  return admin ? announce(k, { target_id: ziel, type, initiated_by: durch, password_hash: null }) : null;
}

async function announce(k: AccountContext, u: Takeover): Promise<Date> {
  const abbruch = crypto.randomBytes(32).toString('base64url');
  const bis = await accessTransaction(k, async t => {
    const b = await t.uebernahmen.scheduleTermination(u, TAKEOVER_HOURS, tokenDigest(abbruch));
    await rememberAdminAction(t, u.initiated_by, u.target_id, 'takeover_announced', u.type);
    return b;
  });
  const details = { durch: await accountDisplayName(k, u.initiated_by), was: u.type, bis: bis.toISOString() };
  // Only the target gets the link: with it, it cancels, even deactivated and without login.
  hintInBackground(k, u.target_id, 'takeover_announced', undefined, { ...details, abbruch });
  adminHintInBackground(k, 'verwaltung_uebernahme_angekuendigt', {
    ...details,
    konto: await accountDisplayName(k, u.target_id),
  });
  return bis;
}

async function afterTheTakeover(k: AccountContext, u: Takeover): Promise<void> {
  const [durch, konto] = [await accountDisplayName(k, u.initiated_by), await accountDisplayName(k, u.target_id)];
  const pw = u.type === 'password';
  hintInBackground(k, u.target_id, pw ? 'passwort_durch_verwalter' : 'second_factor_removed', undefined, { durch });
  adminHintInBackground(k, pw ? 'verwaltung_passwort_gesetzt' : 'verwaltung_faktor_entfernt', { konto, durch });
}

async function executeTeardown(k: AccountContext, u: Takeover): Promise<void> {
  const [durch, konto] = [await accountDisplayName(k, u.initiated_by), await accountDisplayName(k, u.target_id)];
  if (u.type === 'deactivate') await persistActive(k, u.initiated_by, u.target_id, false);
  else if (u.type === 'revoke_role') await writeRole(k, u.initiated_by, u.target_id, false);
  else await removeAccount(k, u.target_id, u.initiated_by);
  if (u.type !== 'delete')
    hintInBackground(k, u.target_id, 'verwalter_aktion_ausgefuehrt', undefined, { durch, was: u.type });
  adminHintInBackground(k, 'verwaltung_aktion_ausgefuehrt', { konto, durch, was: u.type });
}

/** The cleanup run (hourly): due announcements, as long as their administrator still is one. */
export async function runDueTakeoversFrom(k: AccountContext): Promise<number> {
  const { done, teardown } = await withAccessEnd(
    k,
    () => null,
    async t => {
      const { gilt } = await t.uebernahmen.takeDue();
      const done = gilt.filter(u => isTakeover(u.type));
      for (const u of done) {
        if (u.password_hash) await t.konten.setPasswordHash(u.target_id, u.password_hash);
        else await t.factors.disable(u.target_id);
        await endAccesses(t, u.target_id);
        await rememberAdminAction(
          t,
          u.initiated_by,
          u.target_id,
          u.password_hash ? 'password_set' : 'second_factor_removed',
        );
      }
      return { done, teardown: gilt.filter(u => !isTakeover(u.type)) };
    },
  );
  for (const u of done) {
    forgetSessionVersion(k, u.target_id);
    await afterTheTakeover(k, u);
  }
  // Deleting last; a failure (last administrator) does not hold up the others, the run reports it.
  const error: unknown[] = [];
  for (const u of teardown.sort((a, b) => Number(a.type === 'delete') - Number(b.type === 'delete')))
    await executeTeardown(k, u).catch((e: unknown) => error.push(e));
  if (error.length) throw new AggregateError(error, `${error.length} angekündigte Verwalteraktion(en) gescheitert`);
  return done.length + teardown.length;
}

/** After every login: whoever can log in needs no fresh start by another administrator. */
export async function cancelTakeovers(
  k: AccountContext,
  uid: number,
  route: 'anmeldung' | 'link' = 'anmeldung',
): Promise<TakeoverKind[]> {
  const kinds = await k.uebernahmen.abortTakeovers(uid);
  if (!kinds.length) return kinds;
  for (const type of kinds) await rememberAdminAction(k, uid, uid, 'takeover_cancelled', `${route}:${type}`);
  adminHintInBackground(k, 'verwaltung_uebernahme_abgebrochen', {
    konto: await accountDisplayName(k, uid),
    was: kinds.join(', '),
  });
  return kinds;
}

/** The links from mails to the owner, without login; a cancellation applies once, because it deletes the rows. */
export async function redeemMailLink(k: AccountContext, type: 'abbrechen' | 'freigeben', token: string): Promise<void> {
  if (type === 'freigeben') return approveLogin(k, token);
  const ziel = token ? await k.uebernahmen.targetToAbort(tokenDigest(token)) : null;
  if (ziel === null) failDomain('konflikt', 'cancel_link_invalid');
  await cancelTakeovers(k, ziel, 'link');
}
