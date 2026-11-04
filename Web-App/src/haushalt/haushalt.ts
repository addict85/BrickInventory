// Ausführlich: docs/begruendungen/src/haushalt/haushalt.ts.md#abschnitt
import { logAndContinue, meldeUndLiefere } from '../infra/httpError';
import * as db from '../../db/database';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import { getSetting } from '../konto/settings';
import * as repo from './repository';
import type { ErfassungsArt } from './repository';
import { fehlerWerfen } from '../infra/fehlerTexte';
import * as pgNotify from '../../db/pgNotify';
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
const _haushalte = new Map<number, { wert: Household; zeit: number }>();

export function leereHaushaltCache(): void { _haushalte.clear(); }

/** Fehler werden verschluckt: Das Signal ist die Beschleunigung, die Frist
 * die Zusicherung. */
export function meldeHaushaltsaenderung(): void {
  leereHaushaltCache();
  pgNotify.notify(HAUSHALT_KANAL).catch(logAndContinue('haushalt:notify'));
}

/** Nur die direkten Unterkonten: Jedes Konto im Blickfeld hat selbst einer
 * Einladung DIESES Kontos zugestimmt. Ein Unterkonto sieht nur sich selbst —
 * der Hauptaccount ist kein gemeinsamer Topf, sondern eine Sicht. */
const kinder = repo.unterkonten;

export async function resolveHousehold(uid: number): Promise<Household> {
  const id = parseInt(String(uid));
  const treffer = _haushalte.get(id);
  // Kopien zurückgeben: Ein Aufrufer, der die Liste verändert, veränderte
  // sonst den gemerkten Stand aller folgenden Anfragen.
  if (treffer && Date.now() - treffer.zeit < HAUSHALT_TTL_MS)
    return { ...treffer.wert, memberIds: [...treffer.wert.memberIds], elternIds: [...treffer.wert.elternIds] };

  const [unten, eltern] = await Promise.all([kinder(id), repo.elternkonten(id)]);
  const haushalt: Household = { memberIds: [id, ...unten], isMain: unten.length > 0, elternIds: eltern };
  if (_haushalte.size >= HAUSHALT_MAX) _haushalte.clear();
  _haushalte.set(id, { wert: haushalt, zeit: Date.now() });
  return { ...haushalt, memberIds: [...haushalt.memberIds], elternIds: [...haushalt.elternIds] };
}

/** Frisch abgefragt, nicht aus dem Gedächtnis: Nach dem Lösen darf kein
 * früheres Elternkonto noch minutenlang schreiben. */
export async function canWriteFor(actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId));
  const owner = parseInt(String(ownerId));
  if (actor === owner) return true;
  return repo.istVerknuepft(actor, owner);
}

/** Frisch, aus demselben Grund wie canWriteFor. */
export async function writableIds(uid: number): Promise<number[]> {
  const id = parseInt(String(uid));
  return [id, ...(await kinder(id))];
}

/** `tiefe` bleibt für ältere App-Fassungen im Feld (0 = eigenes, 1 = Unterkonto). */
export async function householdMembers(uid: number) {
  const h = await resolveHousehold(uid);
  const self = parseInt(String(uid));
  const rows = await repo.kontoNamen(h.memberIds);
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
export async function createInvite(uid: number) {
  // Absagen als CODE: Erst die Route weiss, welche Sprache der Anfragende sieht.
  const id = parseInt(String(uid));
  // Jedes Konto darf einladen, auch ein Unterkonto: Ein Zwischenkonto ist Vater
  // UND Kind.
  await repo.raeumeEinladungenAuf().catch(logAndContinue('haushalt:id'));
  // Jede offene Einladung ist ein Zugang zum Haushalt; beliebig viele braucht niemand.
  if (await repo.offeneEinladungen(id) >= OFFENE_EINLADUNGEN_MAX)
    return { fehler: 'einladungen_zu_viele' as const, vars: { n: OFFENE_EINLADUNGEN_MAX } };

  const code = neuerCode();
  await repo.legeEinladungAn(hash(code), id, new Date(Date.now() + INVITE_TTL_MS));
  return { code, expires_in: INVITE_TTL_MS / 1000 };
}

/** Wer einlädt, bevor jemand mit dem Passwort zustimmt; nur wer den Code hat, erfährt den Namen. */
export async function pruefeEinladung(uid: number, code: string) {
  if (typeof code !== 'string' || code.trim().length < 8) return { fehler: 'einladungscode_ungueltig' as const };
  const subId = parseInt(String(uid));
  const mainId = await repo.einladenderZuCode(hash(code));
  if (mainId === null) return { fehler: 'einladungscode_abgelaufen' as const };
  if (mainId === subId) return { fehler: 'konto_mit_sich_selbst' as const };
  if (await repo.istVerknuepft(mainId, subId)) return { fehler: 'konto_bereits_verknuepft' as const };
  if (await repo.istVerknuepft(subId, mainId)) return { fehler: 'verknuepfung_erzeugt_kreis' as const };
  return { inviter: { id: mainId, username: (await repo.kontoName(mainId)) || String(mainId) } };
}

// Ausführlich: docs/begruendungen/src/haushalt/haushalt.ts.md#redeeminvite
export async function redeemInvite(uid: number, code: string) {
  const subId = parseInt(String(uid));
  if (typeof code !== 'string' || code.length < 8) {
    return { fehler: 'einladungscode_ungueltig' as const };
  }
  const th = hash(code);

  const mainId = await repo.belegeEinladung(th, subId).catch(meldeUndLiefere('haushalt:claimed', null));
  if (mainId === null) return { fehler: 'einladungscode_abgelaufen' as const };

  const release = async () => {
    await repo.gibEinladungFrei(th).catch(logAndContinue('haushalt:release'));
  };

  if (mainId === subId) {
    await release();
    return { fehler: 'konto_mit_sich_selbst' as const };
  }

  // Frisch: Ein fünf Minuten alter Stand könnte einen Kreis durchlassen, den
  // eine gleichzeitige Einlösung gerade erst möglich gemacht hat.
  const [schonDa, umgekehrt] = await Promise.all([repo.istVerknuepft(mainId, subId), repo.istVerknuepft(subId, mainId)]);
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
  meldeHaushaltsaenderung();
  const name = await repo.kontoName(mainId).catch(meldeUndLiefere('haushalt:get', null));
  return { linked_to: { id: mainId, username: name || String(mainId) } };
}

/** Von BEIDEN Seiten erlaubt. Ohne `subUserId` und `mainUserId` löst sich das
 * Konto von allen — so verhält sich eine ältere App mit nur einem Elternkonto. */
export async function unlink(uid: number, subUserId?: number | null, mainUserId?: number | null) {
  const id = parseInt(String(uid));
  const gesetzt = (v: unknown) => v != null && String(v) !== '';
  const removed = gesetzt(subUserId) ? await repo.trenne(id, parseInt(String(subUserId)))
    : gesetzt(mainUserId) ? await repo.trenne(parseInt(String(mainUserId)), id)
    : await repo.trenne(null, id);
  meldeHaushaltsaenderung();
  return { removed };
}

export async function verwerfeGetrennt(uid: number, subUserId: number) {
  return { removed: await repo.loescheGetrenntHinweis(parseInt(String(uid)), parseInt(String(subUserId))) };
}

export async function householdStatus(uid: number) {
  const id = parseInt(String(uid));
  const h = await resolveHousehold(id);
  const members = await householdMembers(id);
  const [eltern, openInvites, currency, getrennt] = await Promise.all([
    repo.kontoNamen(h.elternIds, 'username'),
    repo.offeneEinladungen(id).catch(meldeUndLiefere('haushalt:einladungen', 0)),
    getSetting(id, 'currency', 'EUR'),
    repo.getrennteKetten(id),
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
  };
}

// Ausführlich: docs/begruendungen/src/haushalt/haushalt.ts.md#abschnitt-2
export type ScopeMode = 'all' | 'own' | 'subs' | number;

/** Unbekanntes ergibt 'all'. Eine Zahl wird NICHT hier geprüft: Ob sie zum
 * Haushalt gehört, weiss erst scopeIds(). */
export function parseScopeMode(v: any): ScopeMode {
  if (v === 'own' || v === 'subs') return v;
  const n = parseInt(String(v));
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

export async function scopeIds(uid: number, mode: ScopeMode = 'all'): Promise<number[]> {
  const h = await resolveHousehold(uid);
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
 * damit eine Signatur sagt, in welchem Moment sie steht.
 * Ausführlich: docs/begruendungen/src/haushalt/haushalt.ts.md#blickfeldeingabe */
export type BlickfeldEingabe = number | number[];

export type Blickfeld = number[];

export function asIds(v: BlickfeldEingabe): Blickfeld {
  return Array.isArray(v) ? v.map(x => parseInt(String(x))) : [parseInt(String(v))];
}

/** Prüft die RICHTUNG (Haupt- für Unterkonto), nicht nur die Mitgliedschaft.
 * Ausführlich: docs/begruendungen/src/haushalt/haushalt.ts.md#resolvewritetarget
 * @returns die Ziel-ID, oder null wenn nicht erlaubt (Aufrufer antwortet 403) */
export async function resolveWriteTarget(
  actorId: number, requested: any
): Promise<number | null> {
  if (requested === undefined || requested === null || requested === '') return actorId;
  const target = parseInt(String(requested));
  if (!Number.isFinite(target)) return null;
  return (await canWriteFor(actorId, target)) ? target : null;
}

/** Aus der Erfassungszeile, nicht aus der Anfrage: Die Datenbank weiss besser
 * als jeder Dialog, wem die Zeile gehört. Eine fremde Zeile antwortet wie eine
 * fehlende, sonst verriete 403 neben 404, welche IDs vergeben sind.
 * @throws 404 kaufpreis_nicht_gefunden, wenn die Zeile fehlt oder nicht beschreibbar ist */
export async function acquisitionMoveSource(
  actorId: number, kind: ErfassungsArt, acqId: number
): Promise<number> {
  const owner = await repo.besitzerDerErfassung(kind, acqId);
  if (owner === null || !(await canWriteFor(actorId, owner))) fehlerWerfen('kaufpreis_nicht_gefunden', 404);
  return owner;
}
