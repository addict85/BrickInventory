/** Every path that changes a password ends all accesses afterwards — in one
 * place, so no path forgets the step. */
import { hashPassword } from './passwordHash';
import * as repo from './repository/accounts';
import { emptyTokenCache } from './tokenCache';
import { withAccessEnd, endAllSessions, accessTransaction } from './accessEnd';
import { tokenDigest, revokeAllTokens } from './deviceToken';
import { emailValid } from '../infra/validate';
import { removeStartPassword } from '../infra/startPassword';
import { rememberAdminAction } from './adminLog';
import { asDuplicate, failDomain, notFound } from '../infra/errorTexts';
import type { ResetSideEffects } from '../mail';
import { hintInBackground } from './accountNotice';
import { deleteDailyLimit } from './loginLimiter';
import type { AccountContext } from './context';
import type { TakeoverKind } from './repository/takeovers';

/** Only report, change nothing: only the owner knows which address was meant. */
export async function reportInvalidAddresses(k: AccountContext): Promise<number[]> {
  const ids = (await k.konten.allAddresses()).filter(z => !emailValid(z.email)).map(z => z.id);
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer E-Mail-Adresse, die keine einzelne reine Adresse ist ` +
        `(IDs ${ids.join(', ')}). An sie geht keine Mail; Adresse im Konto neu eintragen oder das Konto löschen (UPGRADE.md).`,
    );
  return ids;
}

/** H5: an address from the legacy stock that was never confirmed no longer counts; the owner must know. */
export async function reportPendingAddresses(k: AccountContext): Promise<number[]> {
  const ids = await k.konten.pendingWithoutLink();
  if (ids.length)
    console.warn(
      `⚠️  [konto] ${ids.length} Konto/Konten mit einer nie bestätigten Adresse (IDs ${ids.join(', ')}). ` +
        'Sie gilt erst nach Bestätigung; im Profil neu eintragen, dann kommt der Link (UPGRADE.md).',
    );
  return ids;
}

export async function accountsList(k: AccountContext) {
  const konten = await k.konten.allAccounts();
  const withFactor = await k.factors.activeAmong(konten.map(z => z.id));
  // Announced changes to administrators (24 h): the other administrators should see them, not only by mail.
  const announced = new Map<number, { type: TakeoverKind; effective_at: string }[]>();
  for (const a of await k.uebernahmen.announced())
    announced.set(a.target_id, [
      ...(announced.get(a.target_id) ?? []),
      { type: a.type, effective_at: new Date(a.effective_at).toISOString() },
    ]);
  return konten.map(z => ({ ...z, zweiter_faktor: withFactor.has(z.id), angekuendigt: announced.get(z.id) ?? [] }));
}

export async function profile(k: AccountContext, id: number) {
  return k.konten.profileRow(id);
}

export function accountShortOf(k: AccountContext, id: number) {
  return k.konten.accountShort(id);
}

export function accountFullOf(k: AccountContext, id: number) {
  return k.konten.accountFull(id);
}

export function givesAccount(k: AccountContext, id: number): Promise<boolean> {
  return k.konten.accountExists(id);
}

/** For notices to administrators: a just deleted account is at least named by its id. */
export async function accountDisplayName(k: AccountContext, id: number): Promise<string> {
  return (await k.konten.accountShort(id))?.username ?? String(id);
}

/** The password alone does not carry administrator rights; a passkey does not replace TOTP here. */
export async function openFactorRequired(k: AccountContext, uid: number, admin: boolean): Promise<boolean> {
  return admin && !(await k.factors.isActive(uid));
}

/** The setup step "account": one exists, and an administrator has replaced the start password. */
export async function accountConfigured(k: AccountContext, admin: boolean): Promise<boolean> {
  const s = await k.einrichtung.accountsStatus();
  return s.vorhanden && (!admin || !s.startpasswort);
}

export function passwordSwitchDue(k: AccountContext, id: number): Promise<boolean> {
  return k.konten.mustChangePassword(id);
}

const hashe = (passwort: string) => hashPassword(passwort);

export async function endAccesses(k: AccountContext, uid: number): Promise<void> {
  await revokeAllTokens(k, uid);
  await endAllSessions(k, uid);
}

async function startPasswordDone(k: AccountContext, uid: number): Promise<void> {
  if ((await k.konten.accountShort(uid))?.is_admin) removeStartPassword();
}

/** Password, accesses and log entry of the administrator `durch` together or not at all. */
export async function setForeignPassword(
  k: AccountContext,
  uid: number,
  passwort: string,
  through: number | null = null,
): Promise<boolean> {
  const hash = await hashe(passwort);
  return withAccessEnd(k, uid, async t => {
    if (!(await t.konten.setPasswordHash(uid, hash))) return false;
    await endAccesses(t, uid);
    if (through !== null) await rememberAdminAction(t, through, uid, 'passwort_gesetzt');
    return true;
  });
}

/** The token just used falls too. Passkeys only on request: whoever merely
 * renews the password should not have to set up their devices again. */
export async function changeOwnPassword(
  k: AccountContext,
  uid: number,
  passwort: string,
  o: { passkeysWiderrufen?: boolean } = {},
): Promise<void> {
  const hash = await hashe(passwort);
  await withAccessEnd(k, uid, async t => {
    await t.konten.setOwnPassword(uid, hash);
    await endAccesses(t, uid);
    if (o.passkeysWiderrufen) await t.factors.revokePasskeys(uid);
  });
  await startPasswordDone(k, uid);
}

/** The link carries the token in plaintext; only its hash is stored. */
export function setPasswordPerLink(k: AccountContext, token: string, passwort: string): Promise<number | null> {
  return setPasswordBack(k, tokenDigest(token), passwort);
}

/** Here one wants to get rid of an intruder: passkeys, main accounts above this account, open
 * invitations and an address change fall too (not on a normal change: that is triggered by the
 * signed-in owner). @returns the account, or null if the link is already used or expired */
export async function setPasswordBack(k: AccountContext, tokenHash: string, passwort: string): Promise<number | null> {
  const hash = await hashe(passwort);
  const r = await withAccessEnd(
    k,
    (e: { uid: number; resolved: ResetSideEffects } | null) => e?.uid ?? null,
    async t => {
      const uid = (await t.konten.resetSetPasswordAfter(tokenHash, hash))?.id;
      if (!uid) return null;
      await endAccesses(t, uid);
      await t.factors.revokePasskeys(uid);
      const household = await t.household.unlinkForeignAccess(uid);
      const adresse = await t.konten.discardPendingAddress(uid);
      await deleteDailyLimit(t, uid);
      return { uid, resolved: { haushalt: household.hauptkonten, einladungen: household.einladungen, adresse } };
    },
  );
  if (!r) return null;
  k.household.reportHouseholdChange();
  await startPasswordDone(k, r.uid);
  hintInBackground(k, r.uid, 'passwort_zurueckgesetzt', undefined, { resolved: r.resolved });
  return r.uid;
}

/** The same computing time as registriere(): otherwise the response time would reveal a taken address. */
export async function computeHowRegistration(passwort: string): Promise<void> {
  await hashe(passwort);
}

/** Longer than any confirmation link is valid; after that name and address are free again. */
export const REGISTRATION_DEADLINE_DAYS = 7;
export function cleanOpenRegistrationsOn(k: AccountContext): Promise<number> {
  return accessTransaction(k, t => t.konten.deleteOpenRegistrations(REGISTRATION_DEADLINE_DAYS));
}

/** Account and log entry in one transaction: an account without an entry
 * would conceal who created it. Hashing happens before, so bcrypt holds no
 * connection. @returns the new id, or null if the name is taken */
export async function addAccount(
  k: AccountContext,
  admin: number,
  username: string,
  passwort: string,
  asAdmin: boolean,
): Promise<number | null> {
  const hash = await hashe(passwort);
  return accessTransaction(k, async t => {
    // Also against the addresses: the login searches both columns.
    if (await t.konten.nameTaken(username, 0)) return null;
    const fresh = await t.konten.addAccountOne(username, hash, asAdmin);
    if (fresh === null) return null;
    await rememberAdminAction(t, admin, fresh, 'konto_angelegt');
    if (asAdmin) await rememberAdminAction(t, admin, fresh, 'verwalter_ernannt');
    return fresh;
  }).catch(asDuplicate('benutzername_vergeben'));
}

export async function register(
  k: AccountContext,
  d: {
    username: string;
    email: string;
    first_name?: string | null | undefined;
    last_name?: string | null | undefined;
    passwort: string;
    tokenHash: string;
    bis: Date;
  },
): Promise<number | null> {
  return k.konten.registerAccount({
    username: d.username,
    email: d.email,
    first_name: d.first_name,
    last_name: d.last_name,
    hash: await hashe(d.passwort),
    tokenHash: d.tokenHash,
    bis: d.bis,
  });
}

/** Lock first, then delete accesses (the token query checks is_active). Sessions
 * fall through the session version, even a row written again. */
export async function setzeAktiv(k: AccountContext, uid: number, expected: boolean): Promise<{ geaendert: boolean }> {
  const r = await accessTransaction(k, t => t.konten.writeActive(uid, expected));
  if (!r) notFound('benutzer_nicht_gefunden');
  if (r === repo.LAST_ADMIN) failDomain('konflikt', 'letzter_verwalter');
  if (!expected) await endAccesses(k, uid);
  return { geaendert: r.vorher !== expected };
}

/** If the role changes, the browser sessions end: they carry the role
 * since login. The token cache is only cleared — the app should see the new
 * role, not be signed out. */
export async function setzeVerwalterRolle(
  k: AccountContext,
  uid: number,
  expected: boolean,
): Promise<{ geaendert: boolean }> {
  const vorher = await accessTransaction(k, t => t.konten.setAdmin(uid, expected));
  if (!vorher) notFound('benutzer_nicht_gefunden');
  if (vorher === repo.LAST_ADMIN) failDomain('konflikt', 'letzter_verwalter');
  const geaendert = vorher.vorher !== expected;
  if (geaendert) {
    await endAllSessions(k, uid);
    emptyTokenCache(k);
  }
  return { geaendert };
}
