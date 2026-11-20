// Hier allein: wessen Daten eine Anfrage sieht.
import { logAndContinue } from '../infra/fehler';
import { Degradations } from '../infra/ergebnis';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import { processEvent } from '../infra/ereignis';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import type { HouseholdContext } from './kontext';
import * as repo from './repository';
import type { ErfassungsArt } from './repository';
import { fachfehler, type ErrorCode } from '../infra/fehlerTexte';
import { inSystemContext, checkRequester } from '../infra/kontoKontext';
import {
  HOUSEHOLD_CHANNEL,
  HOUSEHOLD_MAX,
  HOUSEHOLD_TTL_MS,
  INVITE_TTL_MS,
  OPEN_INVITATIONS_MAX,
  asIds,
  einladungsHash,
  newCode,
  scopeKind,
  type Blickfeld,
  type ScopeInput,
  type Household,
  type ScopeMode,
  type Schreiber,
  type Sicht,
} from './regeln';

/** Je Satz Dienste: Der Stand zählt die Änderungen, die Abhängigen (Bilder) horchen mit. */
const stand = (k: HouseholdContext) => k.faecher.fach('haushaltStand', () => ({ wert: 0 }));
const haushaltsaenderung = (k: HouseholdContext) =>
  k.faecher.fach('haushaltsaenderung', () => {
    const e = processEvent('haushaltsaenderung', HOUSEHOLD_CHANNEL);
    e.horche(() => {
      stand(k).wert++;
    });
    return e;
  });

/** Rückruf statt Import: Bereiche, die den Haushalt brauchen, bildeten sonst einen Zyklus. */
export function atHouseholdChange(k: HouseholdContext, leere: () => void): () => void {
  return haushaltsaenderung(k).horche(leere);
}

/** Web und Jobs halten je eigene Gedächtnisse; was der eine ändert, leert der andere hierüber. */
export function listenOnChanges(k: HouseholdContext): () => void {
  return haushaltsaenderung(k).connect(k.db.notification);
}

/** Je Zugang (zwei Datenbanken, gleiche Konto-IDs); in einer Transaktion keins, sonst bliebe nach ROLLBACK ein nie gültiger Stand. */
function memory(k: HouseholdContext): Zwischenspeicher<number, Household> {
  if (k.db.inTransaction()) return new Zwischenspeicher<number, Household>(HOUSEHOLD_MAX, HOUSEHOLD_TTL_MS);
  const jetzt = stand(k).wert;
  const g = k.faecher.fach('haushalt', () => ({
    stand: jetzt,
    speicher: new Zwischenspeicher<number, Household>(HOUSEHOLD_MAX, HOUSEHOLD_TTL_MS),
  }));
  if (g.stand !== jetzt) {
    g.stand = jetzt;
    g.speicher = new Zwischenspeicher<number, Household>(HOUSEHOLD_MAX, HOUSEHOLD_TTL_MS);
  }
  return g.speicher;
}

/** Hier sofort, anderswo nach dem COMMIT; ein verlorenes Signal heilt die Frist des Gedächtnisses. */
export function reportHouseholdChange(k: HouseholdContext): void {
  void haushaltsaenderung(k).melde(k.db.notification);
}

/** Nur die direkten Unterkonten: Jedes Konto im Blickfeld hat selbst einer
 * Einladung DIESES Kontos zugestimmt. Ein Unterkonto sieht nur sich selbst —
 * der Hauptaccount ist kein gemeinsamer Topf, sondern eine Sicht. */
const kinder = (k: HouseholdContext, id: number) => repo.subAccounts(k.db, id);

/** Wer fragt, ist das Konto des Zeilenschutzes (checkRequester); fremde über den Systemrahmen. */
export async function householdOf(k: HouseholdContext, uid: number): Promise<Household> {
  const id = parseInt(String(uid), 10);
  checkRequester(id);
  const speicher = memory(k);
  const treffer = speicher.hole(id);
  // Kopien zurückgeben: Ein Aufrufer, der die Liste verändert, veränderte
  // sonst den gemerkten Stand aller folgenden Anfragen.
  if (treffer) return { ...treffer, memberIds: [...treffer.memberIds], parentIds: [...treffer.parentIds] };

  const [unten, eltern] = await Promise.all([kinder(k, id), repo.elternkonten(k.db, id)]);
  const haushalt: Household = { memberIds: [id, ...unten], isMain: unten.length > 0, parentIds: eltern };
  speicher.setze(id, haushalt);
  return { ...haushalt, memberIds: [...haushalt.memberIds], parentIds: [...haushalt.parentIds] };
}

/** Frisch abgefragt, nicht aus dem Gedächtnis: Nach dem Lösen darf kein
 * früheres Elternkonto noch minutenlang schreiben. */
export async function darfSchreibenFuer(k: HouseholdContext, actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId), 10);
  const owner = parseInt(String(ownerId), 10);
  checkRequester(actor);
  if (actor === owner) return true;
  return repo.isLinked(k.db, actor, owner);
}

/** Frisch, aus demselben Grund wie darfSchreibenFuer. */
export async function schreibbereich(k: HouseholdContext, uid: number): Promise<number[]> {
  const id = parseInt(String(uid), 10);
  checkRequester(id);
  return [id, ...(await kinder(k, id))];
}

/** `tiefe` bleibt für ältere App-Fassungen im Feld (0 = eigenes, 1 = Unterkonto). */
export async function householdMembers(k: HouseholdContext, uid: number) {
  const h = await householdOf(k, uid);
  const self = parseInt(String(uid), 10);
  const rows = await repo.accountNames(k.db, k.lesevertrag, h.memberIds);
  return h.memberIds
    .map(id => rows.find(r => r.id === id))
    .filter((r): r is repo.KontoName => !!r)
    .map(r => ({ id: r.id, username: r.username, is_self: r.id === self, tiefe: r.id === self ? 0 : 1 }));
}

/** Abgelaufene und verbrauchte Codes werden dabei entsorgt; die Tabelle bleibt
 * so von selbst klein. */
export async function createInvitation(k: HouseholdContext, uid: number) {
  const id = parseInt(String(uid), 10);
  // Jedes Konto darf einladen, auch ein Unterkonto: Ein Zwischenkonto ist Vater
  // UND Kind.
  await k.repository.cleanInvitationsOn();
  // Jede offene Einladung ist ein Zugang zum Haushalt; beliebig viele braucht niemand.
  if ((await repo.openInvitations(k.db, id)) >= OPEN_INVITATIONS_MAX)
    fachfehler('konflikt', 'einladungen_zu_viele', { n: OPEN_INVITATIONS_MAX });

  const code = newCode();
  await repo.putInvitationAn(k.db, einladungsHash(code), id, new Date(k.uhr.jetzt() + INVITE_TTL_MS));
  return { code, expires_in: INVITE_TTL_MS / 1000 };
}

/** Wer einlädt, bevor jemand mit dem Passwort zustimmt; nur wer den Code hat, erfährt den Namen. */
export async function checkInvitation(k: HouseholdContext, uid: number, code: string) {
  if (typeof code !== 'string' || code.trim().length < 8) fachfehler('konflikt', 'einladungscode_ungueltig');
  const subId = parseInt(String(uid), 10);
  const mainId = await k.repository.inviterToCode(einladungsHash(code));
  if (mainId === null) fachfehler('konflikt', 'einladungscode_abgelaufen');
  if (mainId === subId) fachfehler('konflikt', 'konto_mit_sich_selbst');
  if (await repo.isLinked(k.db, mainId, subId)) fachfehler('konflikt', 'konto_bereits_verknuepft');
  if (await repo.isLinked(k.db, subId, mainId)) fachfehler('konflikt', 'verknuepfung_erzeugt_kreis');
  return { inviter: { id: mainId, username: (await k.repository.inviterName(mainId)) || String(mainId) } };
}

// Atomar entwertet, bei Fehlschlag frei.
export async function redeemInvitation(k: HouseholdContext, uid: number, code: string) {
  const subId = parseInt(String(uid), 10);
  if (typeof code !== 'string' || code.length < 8) fachfehler('konflikt', 'einladungscode_ungueltig');
  const th = einladungsHash(code);

  // Ein Lesefehler ist kein abgelaufener Code: Er geht weiter.
  const mainId = await k.repository.receiptsInvitation(th, subId);
  if (mainId === null) fachfehler('konflikt', 'einladungscode_abgelaufen');

  /** Eine Absage gibt den Code wieder frei. */
  const absage = async (code: ErrorCode, vars?: Record<string, string>): Promise<never> => {
    await k.repository.giveInvitationFree(th).catch(logAndContinue('haushalt:release'));
    return fachfehler('konflikt', code, vars);
  };

  if (mainId === subId) await absage('konto_mit_sich_selbst');

  // Frisch: Ein fünf Minuten alter Stand könnte einen Kreis durchlassen, den
  // eine gleichzeitige Einlösung gerade erst möglich gemacht hat.
  const [schonDa, umgekehrt] = await Promise.all([
    k.repository.isLinked(mainId, subId),
    k.repository.isLinked(subId, mainId),
  ]);
  if (schonDa) await absage('konto_bereits_verknuepft');
  // Gegenseitig verknüpft gäbe es kein Unterkonto mehr, nur zwei Hauptkonten,
  // die einander schreiben dürfen.
  if (umgekehrt) await absage('verknuepfung_erzeugt_kreis');

  // Zwei Währungen ergäben eine Summe, der man den Fehler nicht ansieht. Unter
  // derselben Sperre wie ein Währungswechsel, damit keiner dazwischenrutscht. Im
  // Systemrahmen, weil das Hauptkonto (noch) nicht im Blickfeld des Einlösenden ist.
  const ungleich = await inSystemContext('haushalt beitreten', () =>
    k.transaktion(async t => {
      await sperreHaushaltswaehrung(t.db);
      const [curMain, curSub] = await Promise.all([
        t.einstellungen.userValue(mainId, 'currency', 'EUR'),
        t.einstellungen.userValue(subId, 'currency', 'EUR'),
      ]);
      if (String(curMain) !== String(curSub)) return { haupt: String(curMain), unter: String(curSub) };
      await t.repository.link(mainId, subId);
      return null;
    }),
  );
  if (ungleich) await absage('waehrung_ungleich', ungleich);
  reportHouseholdChange(k);
  // Die Verknüpfung steht schon; fehlt nur der Name, trägt die Antwort die ID und sagt es.
  const ab = new Degradations();
  const name = await ab.oder('kontoname', k.repository.accountName(mainId), null);
  return { linked_to: { id: mainId, username: name || String(mainId) }, ...ab.angabe() };
}

/** Von BEIDEN Seiten erlaubt. Ohne `subUserId` und `mainUserId` löst sich das
 * Konto von allen — so verhält sich eine ältere App mit nur einem Elternkonto. */
export async function unlinkAccounts(
  k: HouseholdContext,
  uid: number,
  subUserId?: number | null,
  mainUserId?: number | null,
) {
  const id = parseInt(String(uid), 10);
  const gesetzt = (v: unknown) => v != null && String(v) !== '';
  const removed = gesetzt(subUserId)
    ? await repo.separate(k.db, id, parseInt(String(subUserId), 10))
    : gesetzt(mainUserId)
      ? await repo.separate(k.db, parseInt(String(mainUserId), 10), id)
      : await repo.separate(k.db, null, id);
  reportHouseholdChange(k);
  return { removed };
}

/** Ein Hauptkonto über `uid` sieht und ändert dessen Bestand; die Gegenrichtung gibt nur `uid`
 * Einblick und bleibt. @returns die gelösten Hauptkonten und die verworfenen Einladungen */
export async function unlinkForeignAccess(k: HouseholdContext, uid: number) {
  const r = await k.repository.resolveSubAccountAndInvitations(parseInt(String(uid), 10));
  const namen = r.hauptkonten.length ? await k.repository.accountNames(r.hauptkonten, 'username') : [];
  if (r.hauptkonten.length || r.einladungen) reportHouseholdChange(k);
  return { hauptkonten: namen.map(n => n.username), einladungen: r.einladungen };
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
  const [eltern, openInvites, currency, getrennt] = await Promise.all([
    k.repository.accountNames(h.parentIds, 'username'),
    ab.oder('einladungen', k.repository.openInvitations(id), 0),
    k.einstellungen.userValue(id, 'currency', 'EUR'),
    k.repository.separateChains(id),
  ]);
  const parentList = eltern;
  return {
    is_main: h.isMain,
    is_sub: parentList.length > 0,
    currency,
    parents: parentList,
    // Ältere App-Fassungen kennen nur ein Elternkonto.
    linked_to: parentList[0] ?? null,
    sub_accounts: members.filter(m => !m.is_self),
    blickfeld: members,
    open_invites: openInvites,
    former_links: getrennt,
    ...ab.angabe(),
  };
}

export async function scopeIds(k: HouseholdContext, uid: number, mode: ScopeMode = 'all'): Promise<number[]> {
  const h = await householdOf(k, uid);
  const id = parseInt(String(uid), 10);
  // Ohne Unterkonten wäre 'subs' eine leere Ansicht ohne erkennbaren Grund.
  if (!h.isMain) return h.memberIds;
  if (mode === 'own') return [id];
  if (mode === 'subs') return h.memberIds.filter(m => m !== id);
  if (typeof mode === 'number') {
    // NUR dieses Konto, ohne dessen Unterkonten: Wer „Kind" wählt, will die
    // Sammlung des Kindes sehen, nicht samt Enkeln.
    return h.memberIds.includes(mode) ? [mode] : h.memberIds;
  }
  return h.memberIds;
}

/** IDs kommen nur von innen (Jobs, andere Dienste); von aussen kommt eine Sicht. */
export async function scopeFrom(k: HouseholdContext, v: Sicht | ScopeInput): Promise<Blickfeld> {
  return typeof v === 'object' && !Array.isArray(v) ? scopeIds(k, v.nutzer, scopeKind(v.konten)) : asIds(v);
}

export async function writeAreaFrom(k: HouseholdContext, v: Schreiber | number[]): Promise<number[]> {
  return Array.isArray(v) ? v : schreibbereich(k, v.schreiber);
}

/** Hauptkonten sehen die Dateien ihrer Unterkonten, nicht umgekehrt. Frisch
 * gefragt wie darfSchreibenFuer: Ein gelöstes Unterkonto soll nicht bis zum Ablauf
 * des Gedächtnisses lesbar bleiben, falls die Benachrichtigung ausbleibt. */
export async function seesAccount(k: HouseholdContext, nutzer: number, besitzer: number): Promise<boolean> {
  checkRequester(nutzer);
  return besitzer === nutzer || repo.isLinked(k.db, nutzer, besitzer);
}

/** Für wen geschrieben wird; ohne Recht 403 mit dem Code der Route. */
export async function schreibziel(
  k: HouseholdContext,
  nutzer: number,
  wish: unknown,
  absage: 'kein_schreibrecht' | 'kein_zugriff_konto' = 'kein_schreibrecht',
): Promise<number> {
  const ziel = await writeTargetOrNull(k, nutzer, wish);
  if (ziel === null) fachfehler('verboten', absage);
  return ziel;
}

/** Prüft die RICHTUNG (Haupt- für Unterkonto), nicht nur die Mitgliedschaft.
 * @returns die Ziel-ID, oder null wenn nicht erlaubt (Aufrufer antwortet 403) */
export async function writeTargetOrNull(
  k: HouseholdContext,
  actorId: number,
  requested: unknown,
): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return actorId;
  const target = parseInt(String(requested), 10);
  if (!Number.isFinite(target)) return null;
  return (await darfSchreibenFuer(k, actorId, target)) ? target : null;
}

/** Aus der Erfassungszeile, nicht aus der Anfrage: Die Datenbank weiss besser
 * als jeder Dialog, wem die Zeile gehört. Eine fremde Zeile antwortet wie eine
 * fehlende, sonst verriete 403 neben 404, welche IDs vergeben sind.
 * @throws 404 kaufpreis_nicht_gefunden, wenn die Zeile fehlt oder nicht beschreibbar ist */
export async function moveSource(
  k: HouseholdContext,
  actorId: number,
  kind: ErfassungsArt,
  acqId: number,
): Promise<number> {
  const owner = await repo.ownerTheEntry(k.db, k.lesevertrag, kind, acqId);
  if (owner === null || !(await darfSchreibenFuer(k, actorId, owner)))
    fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');
  return owner;
}

/** Beide Formen hier, damit die Namensauflösung nur einmal existiert. */
// biome-ignore lint/suspicious/noExplicitAny: Die Aufrufer reichen Zeilen verschiedener Form und brauchen ihre Form zurück; owner_ids und user_id liest die Funktion ungeprüft.
export async function besitzerAnhaengen(k: HouseholdContext, uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await repo.userNames(k.db, k.lesevertrag, uids);
  const nameById = new Map<number, string>(owners.map(u => [parseInt(String(u.id), 10), u.username]));
  const disk = (id: number) => ({ id, username: nameById.get(id) || String(id) });
  return rows.map(r => {
    // array_agg liefert NULL, wenn der FILTER alles ausschliesst — dann eine
    // LEERE Plakettenliste, nicht keine.
    if ('owner_ids' in r)
      return { ...r, owners: (r.owner_ids || []).map((n: unknown) => disk(parseInt(String(n), 10))) };
    if (r.user_id != null) return { ...r, owners: [disk(parseInt(String(r.user_id), 10))] };
    return r;
  });
}
