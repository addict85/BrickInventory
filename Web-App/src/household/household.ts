// Here alone: whose data a request sees.
import { logAndContinue } from '../infra/error';
import { Degradations } from '../infra/result';
import { Cache } from '../infra/cache';
import { processEvent } from '../infra/event';
import { lockHouseholdCurrency } from '../../db/txLock';
import type { HouseholdContext } from './context';
import * as repo from './repository';
import type { AcquisitionKind } from './repository';
import { failDomain, type ErrorCode } from '../infra/errorTexts';
import { inSystemContext, checkRequester } from '../infra/accountContext';
import {
  HOUSEHOLD_CHANNEL,
  HOUSEHOLD_MAX,
  HOUSEHOLD_TTL_MS,
  INVITE_TTL_MS,
  OPEN_INVITATIONS_MAX,
  asIds,
  invitationHash,
  newCode,
  scopeKind,
  type Scope,
  type ScopeInput,
  type Household,
  type ScopeMode,
  type Writer,
  type Sicht,
} from './rules';

/** Per set of services: the state counts the changes, the dependents (images) listen in. */
const stand = (k: HouseholdContext) => k.faecher.slot('haushaltStand', () => ({ wert: 0 }));
const householdChange = (k: HouseholdContext) =>
  k.faecher.slot('haushaltsaenderung', () => {
    const e = processEvent('haushaltsaenderung', HOUSEHOLD_CHANNEL);
    e.listen(() => {
      stand(k).wert++;
    });
    return e;
  });

/** Callback instead of import: areas that need the household would otherwise form a cycle. */
export function atHouseholdChange(k: HouseholdContext, empty: () => void): () => void {
  return householdChange(k).listen(empty);
}

/** Web and jobs each keep their own memories; what one changes, the other clears through this. */
export function listenOnChanges(k: HouseholdContext): () => void {
  return householdChange(k).connect(k.db.notification);
}

/** Per access (two databases, same account IDs); none within a transaction, otherwise a never-valid state would remain after ROLLBACK. */
function memory(k: HouseholdContext): Cache<number, Household> {
  if (k.db.inTransaction()) return new Cache<number, Household>(HOUSEHOLD_MAX, HOUSEHOLD_TTL_MS);
  const now = stand(k).wert;
  const g = k.faecher.slot('haushalt', () => ({
    stand: now,
    speicher: new Cache<number, Household>(HOUSEHOLD_MAX, HOUSEHOLD_TTL_MS),
  }));
  if (g.stand !== now) {
    g.stand = now;
    g.speicher = new Cache<number, Household>(HOUSEHOLD_MAX, HOUSEHOLD_TTL_MS);
  }
  return g.speicher;
}

/** Here immediately, elsewhere after the COMMIT; a lost signal is healed by the memory's expiry. */
export function reportHouseholdChange(k: HouseholdContext): void {
  void householdChange(k).report(k.db.notification);
}

/** Only the direct sub-accounts: every account in scope has itself agreed to an
 * invitation of THIS account. A sub-account only sees itself —
 * the main account is not a shared pot but a view. */
const kinder = (k: HouseholdContext, id: number) => repo.subAccounts(k.db, id);

/** Whoever asks is the row security's account (checkRequester); others via the system frame. */
export async function householdOf(k: HouseholdContext, uid: number): Promise<Household> {
  const id = parseInt(String(uid), 10);
  checkRequester(id);
  const store = memory(k);
  const hits = store.hole(id);
  // Return copies: a caller that modifies the list would otherwise modify
  // the remembered state of all following requests.
  if (hits) return { ...hits, memberIds: [...hits.memberIds], parentIds: [...hits.parentIds] };

  const [bottom, parents] = await Promise.all([kinder(k, id), repo.parentAccounts(k.db, id)]);
  const household: Household = { memberIds: [id, ...bottom], isMain: bottom.length > 0, parentIds: parents };
  store.set(id, household);
  return { ...household, memberIds: [...household.memberIds], parentIds: [...household.parentIds] };
}

/** Freshly queried, not from memory: after unlinking, no former parent account
 * may keep writing for minutes. */
export async function mayWriteFor(k: HouseholdContext, actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId), 10);
  const owner = parseInt(String(ownerId), 10);
  checkRequester(actor);
  if (actor === owner) return true;
  return repo.isLinked(k.db, actor, owner);
}

/** Fresh, for the same reason as darfSchreibenFuer. */
export async function writeScope(k: HouseholdContext, uid: number): Promise<number[]> {
  const id = parseInt(String(uid), 10);
  checkRequester(id);
  return [id, ...(await kinder(k, id))];
}

/** `tiefe` stays in the field for older app versions (0 = own, 1 = sub-account). */
export async function householdMembers(k: HouseholdContext, uid: number) {
  const h = await householdOf(k, uid);
  const self = parseInt(String(uid), 10);
  const rows = await repo.accountNames(k.db, k.lesevertrag, h.memberIds);
  return h.memberIds
    .map(id => rows.find(r => r.id === id))
    .filter((r): r is repo.AccountName => !!r)
    .map(r => ({ id: r.id, username: r.username, is_self: r.id === self, tiefe: r.id === self ? 0 : 1 }));
}

/** Expired and used codes are disposed of along the way; that keeps the table
 * small by itself. */
export async function createInvitation(k: HouseholdContext, uid: number) {
  const id = parseInt(String(uid), 10);
  // Every account may invite, even a sub-account: an intermediate account is parent
  // AND child.
  await k.repository.cleanInvitationsOn();
  // Every open invitation is an access to the household; nobody needs arbitrarily many.
  if ((await repo.openInvitations(k.db, id)) >= OPEN_INVITATIONS_MAX)
    failDomain('konflikt', 'einladungen_zu_viele', { n: OPEN_INVITATIONS_MAX });

  const code = newCode();
  await repo.createInvitation(k.db, invitationHash(code), id, new Date(k.uhr.jetzt() + INVITE_TTL_MS));
  return { code, expires_in: INVITE_TTL_MS / 1000 };
}

/** Who invites, before anyone agrees with the password; only whoever has the code learns the name. */
export async function checkInvitation(k: HouseholdContext, uid: number, code: string) {
  if (typeof code !== 'string' || code.trim().length < 8) failDomain('konflikt', 'einladungscode_ungueltig');
  const subId = parseInt(String(uid), 10);
  const mainId = await k.repository.inviterToCode(invitationHash(code));
  if (mainId === null) failDomain('konflikt', 'einladungscode_abgelaufen');
  if (mainId === subId) failDomain('konflikt', 'konto_mit_sich_selbst');
  if (await repo.isLinked(k.db, mainId, subId)) failDomain('konflikt', 'konto_bereits_verknuepft');
  if (await repo.isLinked(k.db, subId, mainId)) failDomain('konflikt', 'verknuepfung_erzeugt_kreis');
  return { inviter: { id: mainId, username: (await k.repository.inviterName(mainId)) || String(mainId) } };
}

// Invalidated atomically, free again on failure.
export async function redeemInvitation(k: HouseholdContext, uid: number, code: string) {
  const subId = parseInt(String(uid), 10);
  if (typeof code !== 'string' || code.length < 8) failDomain('konflikt', 'einladungscode_ungueltig');
  const th = invitationHash(code);

  // A read error is not an expired code: it propagates.
  const mainId = await k.repository.receiptsInvitation(th, subId);
  if (mainId === null) failDomain('konflikt', 'einladungscode_abgelaufen');

  /** A refusal frees the code again. */
  const refusal = async (code: ErrorCode, vars?: Record<string, string>): Promise<never> => {
    await k.repository.giveInvitationFree(th).catch(logAndContinue('haushalt:release'));
    return failDomain('konflikt', code, vars);
  };

  if (mainId === subId) await refusal('konto_mit_sich_selbst');

  // Fresh: a five-minute-old state could let through a cycle that
  // a concurrent redemption has only just made possible.
  const [alreadyThere, reverse] = await Promise.all([
    k.repository.isLinked(mainId, subId),
    k.repository.isLinked(subId, mainId),
  ]);
  if (alreadyThere) await refusal('konto_bereits_verknuepft');
  // Linked mutually there would be no sub-account any more, only two main accounts
  // that may write for each other.
  if (reverse) await refusal('verknuepfung_erzeugt_kreis');

  // Two currencies would yield a sum whose error cannot be seen. Under
  // the same lock as a currency change, so that nothing slips in between. In
  // the system frame, because the main account is not (yet) in the redeemer's scope.
  const unequal = await inSystemContext('haushalt beitreten', () =>
    k.transact(async t => {
      await lockHouseholdCurrency(t.db);
      const [curMain, curSub] = await Promise.all([
        t.einstellungen.userValue(mainId, 'currency', 'EUR'),
        t.einstellungen.userValue(subId, 'currency', 'EUR'),
      ]);
      if (String(curMain) !== String(curSub)) return { haupt: String(curMain), unter: String(curSub) };
      await t.repository.link(mainId, subId);
      return null;
    }),
  );
  if (unequal) await refusal('waehrung_ungleich', unequal);
  reportHouseholdChange(k);
  // The link already exists; if only the name is missing, the response carries the ID and says so.
  const ab = new Degradations();
  const name = await ab.orElse('kontoname', k.repository.accountName(mainId), null);
  return { linked_to: { id: mainId, username: name || String(mainId) }, ...ab.detail() };
}

/** Allowed from BOTH sides. Without `subUserId` and `mainUserId` the account
 * unlinks from all — that is how an older app with only one parent account behaves. */
export async function unlinkAccounts(
  k: HouseholdContext,
  uid: number,
  subUserId?: number | null,
  mainUserId?: number | null,
) {
  const id = parseInt(String(uid), 10);
  const assigned = (v: unknown) => v != null && String(v) !== '';
  const removed = assigned(subUserId)
    ? await repo.separate(k.db, id, parseInt(String(subUserId), 10))
    : assigned(mainUserId)
      ? await repo.separate(k.db, parseInt(String(mainUserId), 10), id)
      : await repo.separate(k.db, null, id);
  reportHouseholdChange(k);
  return { removed };
}

/** A main account above `uid` sees and changes its inventory; the opposite direction only gives `uid`
 * insight and stays. @returns the unlinked main accounts and the discarded invitations */
export async function unlinkForeignAccess(k: HouseholdContext, uid: number) {
  const r = await k.repository.resolveSubAccountAndInvitations(parseInt(String(uid), 10));
  const names = r.hauptkonten.length ? await k.repository.accountNames(r.hauptkonten, 'username') : [];
  if (r.hauptkonten.length || r.einladungen) reportHouseholdChange(k);
  return { hauptkonten: names.map(n => n.username), einladungen: r.einladungen };
}

export async function discardSeparated(k: HouseholdContext, uid: number, subUserId: number) {
  return {
    removed: await repo.deleteSeparatedHint(k.db, parseInt(String(uid), 10), parseInt(String(subUserId), 10)),
  };
}

export async function householdStatus(k: HouseholdContext, uid: number) {
  const id = parseInt(String(uid), 10);
  const h = await householdOf(k, id);
  const members = await householdMembers(k, id);
  const ab = new Degradations();
  const [parents, openInvites, currency, separated] = await Promise.all([
    k.repository.accountNames(h.parentIds, 'username'),
    ab.orElse('einladungen', k.repository.openInvitations(id), 0),
    k.einstellungen.userValue(id, 'currency', 'EUR'),
    k.repository.separateChains(id),
  ]);
  const parentList = parents;
  return {
    is_main: h.isMain,
    is_sub: parentList.length > 0,
    currency,
    parents: parentList,
    // Older app versions only know one parent account.
    linked_to: parentList[0] ?? null,
    sub_accounts: members.filter(m => !m.is_self),
    blickfeld: members,
    open_invites: openInvites,
    former_links: separated,
    ...ab.detail(),
  };
}

export async function scopeIds(k: HouseholdContext, uid: number, mode: ScopeMode = 'all'): Promise<number[]> {
  const h = await householdOf(k, uid);
  const id = parseInt(String(uid), 10);
  // Without sub-accounts 'subs' would be an empty view without a recognizable reason.
  if (!h.isMain) return h.memberIds;
  if (mode === 'own') return [id];
  if (mode === 'subs') return h.memberIds.filter(m => m !== id);
  if (typeof mode === 'number') {
    // ONLY this account, without its sub-accounts: whoever picks "child" wants to see
    // the child's collection, not including grandchildren.
    return h.memberIds.includes(mode) ? [mode] : h.memberIds;
  }
  return h.memberIds;
}

/** IDs only come from inside (jobs, other services); from outside comes a view. */
export async function scopeFrom(k: HouseholdContext, v: Sicht | ScopeInput): Promise<Scope> {
  return typeof v === 'object' && !Array.isArray(v) ? scopeIds(k, v.nutzer, scopeKind(v.konten)) : asIds(v);
}

export async function writeAreaFrom(k: HouseholdContext, v: Writer | number[]): Promise<number[]> {
  return Array.isArray(v) ? v : writeScope(k, v.schreiber);
}

/** Main accounts see the files of their sub-accounts, not the other way round. Freshly
 * asked like darfSchreibenFuer: an unlinked sub-account should not stay readable until
 * the memory expires in case the notification fails to arrive. */
export async function seesAccount(k: HouseholdContext, userRow: number, owner: number): Promise<boolean> {
  checkRequester(userRow);
  return owner === userRow || repo.isLinked(k.db, userRow, owner);
}

/** For whom writing happens; without the right 403 with the route's code. */
export async function writeTarget(
  k: HouseholdContext,
  userRow: number,
  wish: unknown,
  refusal: 'kein_schreibrecht' | 'kein_zugriff_konto' = 'kein_schreibrecht',
): Promise<number> {
  const target = await writeTargetOrNull(k, userRow, wish);
  if (target === null) failDomain('verboten', refusal);
  return target;
}

/** Checks the DIRECTION (main for sub-account), not just membership.
 * @returns the target ID, or null if not allowed (caller answers 403) */
export async function writeTargetOrNull(
  k: HouseholdContext,
  actorId: number,
  requested: unknown,
): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return actorId;
  const target = parseInt(String(requested), 10);
  if (!Number.isFinite(target)) return null;
  return (await mayWriteFor(k, actorId, target)) ? target : null;
}

/** From the acquisition row, not from the request: the database knows better
 * than any dialog whom the row belongs to. A foreign row answers like a
 * missing one, otherwise 403 next to 404 would reveal which IDs are taken.
 * @throws 404 kaufpreis_nicht_gefunden if the row is missing or not writable */
export async function moveSource(
  k: HouseholdContext,
  actorId: number,
  kind: AcquisitionKind,
  acqId: number,
): Promise<number> {
  const owner = await repo.ownerTheEntry(k.db, k.lesevertrag, kind, acqId);
  if (owner === null || !(await mayWriteFor(k, actorId, owner)))
    failDomain('nicht_gefunden', 'kaufpreis_nicht_gefunden');
  return owner;
}

/** Both forms here, so that name resolution exists only once. */
// biome-ignore lint/suspicious/noExplicitAny: the callers pass rows of different shapes and need their shape back; the function reads owner_ids and user_id unchecked.
export async function attachOwners(k: HouseholdContext, uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await repo.userNames(k.db, k.lesevertrag, uids);
  const nameById = new Map<number, string>(owners.map(u => [parseInt(String(u.id), 10), u.username]));
  const disk = (id: number) => ({ id, username: nameById.get(id) || String(id) });
  return rows.map(r => {
    // array_agg returns NULL if the FILTER excludes everything — then an
    // EMPTY badge list, not none.
    if ('owner_ids' in r)
      return { ...r, owners: (r.owner_ids || []).map((n: unknown) => disk(parseInt(String(n), 10))) };
    if (r.user_id != null) return { ...r, owners: [disk(parseInt(String(r.user_id), 10))] };
    return r;
  });
}
