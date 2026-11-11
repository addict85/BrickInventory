// Hier allein: wessen Daten eine Anfrage sieht.
import { logAndContinue } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import type { Db, DbSchnittstelle } from '../../db/database';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import { getSetting } from '../einstellungen';
import * as repo from './repository';
import type { ErfassungsArt } from './repository';
import { fachfehler } from '../infra/fehlerTexte';
import crypto from 'crypto';

/** Lang genug für „später am Abend", kurz genug, dass ein liegen gebliebener
 * Code nicht dauerhaft öffnet. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const OFFENE_EINLADUNGEN_MAX = 5;

export interface Household {
  /** Eigene zuerst, dann die direkten Unterkonten. */
  memberIds: number[];
  isMain: boolean;
  /** Ein Konto kann mehreren Haushalten angehören. */
  elternIds: number[];
}

export const HAUSHALT_KANAL = 'haushalt_geaendert';
const HAUSHALT_TTL_MS = 5 * 60 * 1000;
const HAUSHALT_MAX = 500;
const _haushalte = new Zwischenspeicher<number, Household>(HAUSHALT_MAX, HAUSHALT_TTL_MS);

const _abhaengige: Array<() => void> = [];
/** Rückruf statt Import: Module, die den Haushalt brauchen, würden sonst einen Zyklus bilden. */
export function beiHaushaltsaenderung(leere: () => void): void { _abhaengige.push(leere); }

export function leereHaushaltCache(): void {
  _haushalte.leere();
  for (const leere of _abhaengige) leere();
}

/** Fehler werden verschluckt: Das Signal ist die Beschleunigung, die Frist
 * die Zusicherung. */
export function meldeHaushaltsaenderung(db: DbSchnittstelle): void {
  leereHaushaltCache();
  repo.sendeSignal(db, HAUSHALT_KANAL).catch(logAndContinue('haushalt:notify'));
}

/** Nur die direkten Unterkonten: Jedes Konto im Blickfeld hat selbst einer
 * Einladung DIESES Kontos zugestimmt. Ein Unterkonto sieht nur sich selbst —
 * der Hauptaccount ist kein gemeinsamer Topf, sondern eine Sicht. */
const kinder = (db: DbSchnittstelle, id: number) => repo.unterkonten(db, id);

export async function resolveHousehold(db: DbSchnittstelle, uid: number): Promise<Household> {
  const id = parseInt(String(uid));
  const treffer = _haushalte.hole(id);
  // Kopien zurückgeben: Ein Aufrufer, der die Liste verändert, veränderte
  // sonst den gemerkten Stand aller folgenden Anfragen.
  if (treffer) return { ...treffer, memberIds: [...treffer.memberIds], elternIds: [...treffer.elternIds] };

  const [unten, eltern] = await Promise.all([kinder(db, id), repo.elternkonten(db, id)]);
  const haushalt: Household = { memberIds: [id, ...unten], isMain: unten.length > 0, elternIds: eltern };
  _haushalte.setze(id, haushalt);
  return { ...haushalt, memberIds: [...haushalt.memberIds], elternIds: [...haushalt.elternIds] };
}

/** Frisch abgefragt, nicht aus dem Gedächtnis: Nach dem Lösen darf kein
 * früheres Elternkonto noch minutenlang schreiben. */
export async function canWriteFor(db: DbSchnittstelle, actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId));
  const owner = parseInt(String(ownerId));
  if (actor === owner) return true;
  return repo.istVerknuepft(db, actor, owner);
}

/** Frisch, aus demselben Grund wie canWriteFor. */
export async function writableIds(db: DbSchnittstelle, uid: number): Promise<number[]> {
  const id = parseInt(String(uid));
  return [id, ...(await kinder(db, id))];
}

/** `tiefe` bleibt für ältere App-Fassungen im Feld (0 = eigenes, 1 = Unterkonto). */
export async function householdMembers(db: DbSchnittstelle, uid: number) {
  const h = await resolveHousehold(db, uid);
  const self = parseInt(String(uid));
  const rows = await repo.kontoNamen(db, h.memberIds);
  return h.memberIds
    .map(id => rows.find(r => r.id === id))
    .filter((r): r is repo.KontoName => !!r)
    .map(r => ({ id: r.id, username: r.username, is_self: r.id === self, tiefe: r.id === self ? 0 : 1 }));
}

/** Ohne 0/O, 1/I/L: Der Code wird oft abgetippt. 16 Zeichen tragen rund 79 Bit. */
const CODE_ZEICHEN = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function neuerCode(): string {
  const z = Array.from({ length: 16 }, () => CODE_ZEICHEN[crypto.randomInt(CODE_ZEICHEN.length)]).join('');
  return z.match(/.{4}/g)!.join('-');
}

/** Neue Codes ohne Striche und Gross/Klein; ältere (base64url) bleiben wörtlich gültig. */
function einladungsSchluessel(code: string): string {
  const kurz = code.trim().replace(/[\s-]/g, '').toUpperCase();
  return new RegExp(`^[${CODE_ZEICHEN}]{16}$`).test(kurz) ? kurz : code.trim();
}

/** Im Klartext steht der Code nirgends. */
function hash(token: string) {
  return crypto.createHash('sha256').update(einladungsSchluessel(token)).digest('hex');
}

/** Abgelaufene und verbrauchte Codes werden dabei entsorgt; die Tabelle bleibt
 * so von selbst klein. */
export async function createInvite(db: DbSchnittstelle, uid: number) {
  // Absagen als CODE: Erst die Route weiss, welche Sprache der Anfragende sieht.
  const id = parseInt(String(uid));
  // Jedes Konto darf einladen, auch ein Unterkonto: Ein Zwischenkonto ist Vater
  // UND Kind.
  await repo.raeumeEinladungenAuf(db).catch(logAndContinue('haushalt:id'));
  // Jede offene Einladung ist ein Zugang zum Haushalt; beliebig viele braucht niemand.
  if (await repo.offeneEinladungen(db, id) >= OFFENE_EINLADUNGEN_MAX)
    return { fehler: 'einladungen_zu_viele' as const, vars: { n: OFFENE_EINLADUNGEN_MAX } };

  const code = neuerCode();
  await repo.legeEinladungAn(db, hash(code), id, new Date(Date.now() + INVITE_TTL_MS));
  return { code, expires_in: INVITE_TTL_MS / 1000 };
}

/** Wer einlädt, bevor jemand mit dem Passwort zustimmt; nur wer den Code hat, erfährt den Namen. */
export async function pruefeEinladung(db: DbSchnittstelle, uid: number, code: string) {
  if (typeof code !== 'string' || code.trim().length < 8) return { fehler: 'einladungscode_ungueltig' as const };
  const subId = parseInt(String(uid));
  const mainId = await repo.einladenderZuCode(db, hash(code));
  if (mainId === null) return { fehler: 'einladungscode_abgelaufen' as const };
  if (mainId === subId) return { fehler: 'konto_mit_sich_selbst' as const };
  if (await repo.istVerknuepft(db, mainId, subId)) return { fehler: 'konto_bereits_verknuepft' as const };
  if (await repo.istVerknuepft(db, subId, mainId)) return { fehler: 'verknuepfung_erzeugt_kreis' as const };
  return { inviter: { id: mainId, username: (await repo.kontoName(db, mainId)) || String(mainId) } };
}

// Atomar entwertet, bei Fehlschlag frei.
export async function redeemInvite(db: Db, uid: number, code: string) {
  const subId = parseInt(String(uid));
  if (typeof code !== 'string' || code.length < 8) {
    return { fehler: 'einladungscode_ungueltig' as const };
  }
  const th = hash(code);

  // Ein Lesefehler ist kein abgelaufener Code: Er geht weiter.
  const mainId = await repo.belegeEinladung(db, th, subId);
  if (mainId === null) return { fehler: 'einladungscode_abgelaufen' as const };

  const release = async () => {
    await repo.gibEinladungFrei(db, th).catch(logAndContinue('haushalt:release'));
  };

  if (mainId === subId) {
    await release();
    return { fehler: 'konto_mit_sich_selbst' as const };
  }

  // Frisch: Ein fünf Minuten alter Stand könnte einen Kreis durchlassen, den
  // eine gleichzeitige Einlösung gerade erst möglich gemacht hat.
  const [schonDa, umgekehrt] = await Promise.all([repo.istVerknuepft(db, mainId, subId), repo.istVerknuepft(db, subId, mainId)]);
  if (schonDa) {
    await release();
    return { fehler: 'konto_bereits_verknuepft' as const };
  }
  // Gegenseitig verknüpft gäbe es kein Unterkonto mehr, nur zwei Hauptkonten,
  // die einander schreiben dürfen.
  if (umgekehrt) {
    await release();
    return { fehler: 'verknuepfung_erzeugt_kreis' as const };
  }

  // Zwei Währungen ergäben eine Summe, der man den Fehler nicht ansieht. Unter
  // derselben Sperre wie ein Währungswechsel, damit keiner dazwischenrutscht.
  const ungleich = await db.transaction(async (tx) => {
    await sperreHaushaltswaehrung(tx);
    const [curMain, curSub] = await Promise.all([
      getSetting(mainId, 'currency', 'EUR'),
      getSetting(subId, 'currency', 'EUR'),
    ]);
    if (String(curMain) !== String(curSub))
      return { haupt: String(curMain), unter: String(curSub) };
    await repo.verknuepfe(tx, mainId, subId);
    return null;
  });
  if (ungleich) {
    await release();
    return { fehler: 'waehrung_ungleich' as const, vars: ungleich };
  }
  meldeHaushaltsaenderung(db);
  // Die Verknüpfung steht schon; fehlt nur der Name, trägt die Antwort die ID und sagt es.
  const ab = new Abstriche();
  const name = await ab.oder('kontoname', repo.kontoName(db, mainId), null);
  return { linked_to: { id: mainId, username: name || String(mainId) }, ...ab.angabe() };
}

/** Von BEIDEN Seiten erlaubt. Ohne `subUserId` und `mainUserId` löst sich das
 * Konto von allen — so verhält sich eine ältere App mit nur einem Elternkonto. */
export async function unlink(db: DbSchnittstelle, uid: number, subUserId?: number | null, mainUserId?: number | null) {
  const id = parseInt(String(uid));
  const gesetzt = (v: unknown) => v != null && String(v) !== '';
  const removed = gesetzt(subUserId) ? await repo.trenne(db, id, parseInt(String(subUserId)))
    : gesetzt(mainUserId) ? await repo.trenne(db, parseInt(String(mainUserId)), id)
    : await repo.trenne(db, null, id);
  meldeHaushaltsaenderung(db);
  return { removed };
}

export async function verwerfeGetrennt(db: DbSchnittstelle, uid: number, subUserId: number) {
  return { removed: await repo.loescheGetrenntHinweis(db, parseInt(String(uid)), parseInt(String(subUserId))) };
}

export async function householdStatus(db: DbSchnittstelle, uid: number) {
  const id = parseInt(String(uid));
  const h = await resolveHousehold(db, id);
  const members = await householdMembers(db, id);
  const ab = new Abstriche();
  const [eltern, openInvites, currency, getrennt] = await Promise.all([
    repo.kontoNamen(db, h.elternIds, 'username'),
    ab.oder('einladungen', repo.offeneEinladungen(db, id), 0),
    getSetting(id, 'currency', 'EUR'),
    repo.getrennteKetten(db, id),
  ]);
  const elternListe = eltern;
  return {
    is_main: h.isMain,
    is_sub: elternListe.length > 0,
    currency,
    parents: elternListe,
    // Ältere App-Fassungen kennen nur ein Elternkonto.
    linked_to: elternListe[0] ?? null,
    sub_accounts: members.filter(m => !m.is_self),
    blickfeld: members,
    open_invites: openInvites,
    former_links: getrennt,
    ...ab.angabe(),
  };
}

// Der Kontofilter wird hier zu IDs, damit Liste und Summen dieselben Konten zählen.
export type ScopeMode = 'all' | 'own' | 'subs' | number;

/** Unbekanntes ergibt 'all'. Eine Zahl wird NICHT hier geprüft: Ob sie zum
 * Haushalt gehört, weiss erst scopeIds(). */
export function parseScopeMode(v: unknown): ScopeMode {
  if (v === 'own' || v === 'subs') return v;
  const n = parseInt(String(v));
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

export async function scopeIds(db: DbSchnittstelle, uid: number, mode: ScopeMode = 'all'): Promise<number[]> {
  const h = await resolveHousehold(db, uid);
  const id = parseInt(String(uid));
  // Ohne Unterkonten wäre 'subs' eine leere Ansicht ohne erkennbaren Grund.
  if (!h.isMain) return h.memberIds;
  if (mode === 'own')  return [id];
  if (mode === 'subs') return h.memberIds.filter(m => m !== id);
  if (typeof mode === 'number') {
    // NUR dieses Konto, ohne dessen Unterkonten: Wer „Kind" wählt, will die
    // Sammlung des Kindes sehen, nicht samt Enkeln.
    return h.memberIds.includes(mode) ? [mode] : h.memberIds;
  }
  return h.memberIds;
}

/** Vor `asIds()` ID oder Liste, danach `Blickfeld` (immer Liste): zwei Namen,
 * damit eine Signatur sagt, in welchem Moment sie steht. */
export type BlickfeldEingabe = number | number[];

export type Blickfeld = number[];

export function asIds(v: BlickfeldEingabe): Blickfeld {
  return Array.isArray(v) ? v.map(x => parseInt(String(x))) : [parseInt(String(v))];
}

/** Wer fragt und welche Konten seines Haushalts er sehen will (`accounts`). Den
 * Bereich löst der Dienst auf, nicht die Route: Jeder Aufrufer bekommt dieselbe Regel. */
export interface Sicht { readonly nutzer: number; readonly konten?: string | undefined }
/** Wer schreibt; sein Schreibbereich sind er selbst und seine Unterkonten. */
export interface Schreiber { readonly schreiber: number }

/** IDs kommen nur von innen (Jobs, andere Dienste); von aussen kommt eine Sicht. */
export async function blickfeldAus(db: DbSchnittstelle, v: Sicht | BlickfeldEingabe): Promise<Blickfeld> {
  return typeof v === 'object' && !Array.isArray(v) ? scopeIds(db, v.nutzer, parseScopeMode(v.konten)) : asIds(v);
}

export async function schreibbereichAus(db: DbSchnittstelle, v: Schreiber | number[]): Promise<number[]> {
  return Array.isArray(v) ? v : writableIds(db, v.schreiber);
}

/** Hauptkonten sehen die Dateien ihrer Unterkonten, nicht umgekehrt. Frisch
 * gefragt wie canWriteFor: Ein gelöstes Unterkonto soll nicht bis zum Ablauf
 * des Gedächtnisses lesbar bleiben, falls die Benachrichtigung ausbleibt. */
export async function siehtKonto(db: DbSchnittstelle, nutzer: number, besitzer: number): Promise<boolean> {
  return besitzer === nutzer || repo.istVerknuepft(db, nutzer, besitzer);
}

/** Für wen geschrieben wird; ohne Recht 403 mit dem Code der Route. */
export async function schreibziel(db: DbSchnittstelle, nutzer: number, wunsch: unknown,
                                  absage: 'kein_schreibrecht' | 'kein_zugriff_konto' = 'kein_schreibrecht'): Promise<number> {
  const ziel = await resolveWriteTarget(db, nutzer, wunsch);
  if (ziel === null) fachfehler('verboten', absage);
  return ziel;
}

/** Prüft die RICHTUNG (Haupt- für Unterkonto), nicht nur die Mitgliedschaft.
 * @returns die Ziel-ID, oder null wenn nicht erlaubt (Aufrufer antwortet 403) */
export async function resolveWriteTarget(db: DbSchnittstelle, 
  actorId: number, requested: unknown
): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return actorId;
  const target = parseInt(String(requested));
  if (!Number.isFinite(target)) return null;
  return (await canWriteFor(db, actorId, target)) ? target : null;
}

/** Aus der Erfassungszeile, nicht aus der Anfrage: Die Datenbank weiss besser
 * als jeder Dialog, wem die Zeile gehört. Eine fremde Zeile antwortet wie eine
 * fehlende, sonst verriete 403 neben 404, welche IDs vergeben sind.
 * @throws 404 kaufpreis_nicht_gefunden, wenn die Zeile fehlt oder nicht beschreibbar ist */
export async function acquisitionMoveSource(db: DbSchnittstelle, 
  actorId: number, kind: ErfassungsArt, acqId: number
): Promise<number> {
  const owner = await repo.besitzerDerErfassung(db, kind, acqId);
  if (owner === null || !(await canWriteFor(db, actorId, owner))) fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');
  return owner;
}

/** Beide Formen hier, damit die Namensauflösung nur einmal existiert. */
export async function withOwners(db: DbSchnittstelle, uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await repo.benutzerNamen(db, uids);
  const nameById = new Map<number, string>(owners.map(u => [parseInt(String(u.id)), u.username]));
  const platte = (id: number) => ({ id, username: nameById.get(id) || String(id) });
  return rows.map(r => {
    // array_agg liefert NULL, wenn der FILTER alles ausschliesst — dann eine
    // LEERE Plakettenliste, nicht keine.
    if ('owner_ids' in r) return { ...r, owners: (r.owner_ids || []).map((n: unknown) => platte(parseInt(String(n)))) };
    if (r.user_id != null) return { ...r, owners: [platte(parseInt(String(r.user_id)))] };
    return r;
  });
}
