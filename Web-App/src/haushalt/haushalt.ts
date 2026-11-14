// Hier allein: wessen Daten eine Anfrage sieht.
import { logAndContinue } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { Zwischenspeicher } from '../infra/zwischenspeicher';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import type { HaushaltKontext } from './kontext';
import * as repo from './repository';
import type { ErfassungsArt } from './repository';
import { fachfehler } from '../infra/fehlerTexte';
import { imSystemkontext, pruefeAnfragender } from '../infra/kontoKontext';
import {
  HAUSHALT_KANAL,
  HAUSHALT_MAX,
  HAUSHALT_TTL_MS,
  INVITE_TTL_MS,
  OFFENE_EINLADUNGEN_MAX,
  asIds,
  einladungsHash,
  neuerCode,
  parseScopeMode,
  type Blickfeld,
  type BlickfeldEingabe,
  type Household,
  type ScopeMode,
  type Schreiber,
  type Sicht,
} from './regeln';

/** Je Satz Dienste: Der Stand zählt die Änderungen, die Abhängigen (Bilder) leeren mit. */
const aenderungen = (k: HaushaltKontext) =>
  k.faecher.fach('haushaltStand', () => ({ stand: 0, abhaengige: new Set<() => void>() }));

/** Rückruf statt Import: Bereiche, die den Haushalt brauchen, bildeten sonst einen Zyklus. */
export function beiHaushaltsaenderung(k: HaushaltKontext, leere: () => void): void {
  aenderungen(k).abhaengige.add(leere);
}

export function leereHaushaltCache(k: HaushaltKontext): void {
  const a = aenderungen(k);
  a.stand++;
  for (const leere of a.abhaengige) leere();
}

/** Je Zugang (zwei Datenbanken, gleiche Konto-IDs); in einer Transaktion keins, sonst bliebe nach ROLLBACK ein nie gültiger Stand. */
function gedaechtnis(k: HaushaltKontext): Zwischenspeicher<number, Household> {
  if (k.db.inTransaktion()) return new Zwischenspeicher<number, Household>(HAUSHALT_MAX, HAUSHALT_TTL_MS);
  const stand = aenderungen(k).stand;
  const g = k.faecher.fach('haushalt', () => ({
    stand,
    speicher: new Zwischenspeicher<number, Household>(HAUSHALT_MAX, HAUSHALT_TTL_MS),
  }));
  if (g.stand !== stand) {
    g.stand = stand;
    g.speicher = new Zwischenspeicher<number, Household>(HAUSHALT_MAX, HAUSHALT_TTL_MS);
  }
  return g.speicher;
}

/** Fehler werden verschluckt: Das Signal ist die Beschleunigung, die Frist
 * die Zusicherung. */
export function meldeHaushaltsaenderung(k: HaushaltKontext): void {
  leereHaushaltCache(k);
  repo.sendeSignal(k.db, HAUSHALT_KANAL).catch(logAndContinue('haushalt:notify'));
}

/** Nur die direkten Unterkonten: Jedes Konto im Blickfeld hat selbst einer
 * Einladung DIESES Kontos zugestimmt. Ein Unterkonto sieht nur sich selbst —
 * der Hauptaccount ist kein gemeinsamer Topf, sondern eine Sicht. */
const kinder = (k: HaushaltKontext, id: number) => repo.unterkonten(k.db, id);

/** Wer fragt, ist das Konto des Zeilenschutzes (pruefeAnfragender); fremde über den Systemrahmen. */
export async function haushaltVon(k: HaushaltKontext, uid: number): Promise<Household> {
  const id = parseInt(String(uid), 10);
  pruefeAnfragender(id);
  const speicher = gedaechtnis(k);
  const treffer = speicher.hole(id);
  // Kopien zurückgeben: Ein Aufrufer, der die Liste verändert, veränderte
  // sonst den gemerkten Stand aller folgenden Anfragen.
  if (treffer) return { ...treffer, memberIds: [...treffer.memberIds], elternIds: [...treffer.elternIds] };

  const [unten, eltern] = await Promise.all([kinder(k, id), repo.elternkonten(k.db, id)]);
  const haushalt: Household = { memberIds: [id, ...unten], isMain: unten.length > 0, elternIds: eltern };
  speicher.setze(id, haushalt);
  return { ...haushalt, memberIds: [...haushalt.memberIds], elternIds: [...haushalt.elternIds] };
}

/** Frisch abgefragt, nicht aus dem Gedächtnis: Nach dem Lösen darf kein
 * früheres Elternkonto noch minutenlang schreiben. */
export async function darfSchreibenFuer(k: HaushaltKontext, actorId: number, ownerId: number): Promise<boolean> {
  const actor = parseInt(String(actorId), 10);
  const owner = parseInt(String(ownerId), 10);
  pruefeAnfragender(actor);
  if (actor === owner) return true;
  return repo.istVerknuepft(k.db, actor, owner);
}

/** Frisch, aus demselben Grund wie darfSchreibenFuer. */
export async function schreibbereich(k: HaushaltKontext, uid: number): Promise<number[]> {
  const id = parseInt(String(uid), 10);
  pruefeAnfragender(id);
  return [id, ...(await kinder(k, id))];
}

/** `tiefe` bleibt für ältere App-Fassungen im Feld (0 = eigenes, 1 = Unterkonto). */
export async function haushaltsMitglieder(k: HaushaltKontext, uid: number) {
  const h = await haushaltVon(k, uid);
  const self = parseInt(String(uid), 10);
  const rows = await repo.kontoNamen(k.db, h.memberIds);
  return h.memberIds
    .map(id => rows.find(r => r.id === id))
    .filter((r): r is repo.KontoName => !!r)
    .map(r => ({ id: r.id, username: r.username, is_self: r.id === self, tiefe: r.id === self ? 0 : 1 }));
}

/** Abgelaufene und verbrauchte Codes werden dabei entsorgt; die Tabelle bleibt
 * so von selbst klein. */
export async function einladungAnlegen(k: HaushaltKontext, uid: number) {
  // Absagen als CODE: Erst die Route weiss, welche Sprache der Anfragende sieht.
  const id = parseInt(String(uid), 10);
  // Jedes Konto darf einladen, auch ein Unterkonto: Ein Zwischenkonto ist Vater
  // UND Kind.
  await k.repository.raeumeEinladungenAuf();
  // Jede offene Einladung ist ein Zugang zum Haushalt; beliebig viele braucht niemand.
  if ((await repo.offeneEinladungen(k.db, id)) >= OFFENE_EINLADUNGEN_MAX)
    return { fehler: 'einladungen_zu_viele' as const, vars: { n: OFFENE_EINLADUNGEN_MAX } };

  const code = neuerCode();
  await repo.legeEinladungAn(k.db, einladungsHash(code), id, new Date(Date.now() + INVITE_TTL_MS));
  return { code, expires_in: INVITE_TTL_MS / 1000 };
}

/** Wer einlädt, bevor jemand mit dem Passwort zustimmt; nur wer den Code hat, erfährt den Namen. */
export async function pruefeEinladung(k: HaushaltKontext, uid: number, code: string) {
  if (typeof code !== 'string' || code.trim().length < 8) return { fehler: 'einladungscode_ungueltig' as const };
  const subId = parseInt(String(uid), 10);
  const mainId = await k.repository.einladenderZuCode(einladungsHash(code));
  if (mainId === null) return { fehler: 'einladungscode_abgelaufen' as const };
  if (mainId === subId) return { fehler: 'konto_mit_sich_selbst' as const };
  if (await repo.istVerknuepft(k.db, mainId, subId)) return { fehler: 'konto_bereits_verknuepft' as const };
  if (await repo.istVerknuepft(k.db, subId, mainId)) return { fehler: 'verknuepfung_erzeugt_kreis' as const };
  return { inviter: { id: mainId, username: (await repo.kontoName(k.db, mainId)) || String(mainId) } };
}

// Atomar entwertet, bei Fehlschlag frei.
export async function einladungEinloesen(k: HaushaltKontext, uid: number, code: string) {
  const subId = parseInt(String(uid), 10);
  if (typeof code !== 'string' || code.length < 8) {
    return { fehler: 'einladungscode_ungueltig' as const };
  }
  const th = einladungsHash(code);

  // Ein Lesefehler ist kein abgelaufener Code: Er geht weiter.
  const mainId = await k.repository.belegeEinladung(th, subId);
  if (mainId === null) return { fehler: 'einladungscode_abgelaufen' as const };

  const release = async () => {
    await k.repository.gibEinladungFrei(th).catch(logAndContinue('haushalt:release'));
  };

  if (mainId === subId) {
    await release();
    return { fehler: 'konto_mit_sich_selbst' as const };
  }

  // Frisch: Ein fünf Minuten alter Stand könnte einen Kreis durchlassen, den
  // eine gleichzeitige Einlösung gerade erst möglich gemacht hat.
  const [schonDa, umgekehrt] = await Promise.all([
    k.repository.istVerknuepft(mainId, subId),
    k.repository.istVerknuepft(subId, mainId),
  ]);
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
  // derselben Sperre wie ein Währungswechsel, damit keiner dazwischenrutscht. Im
  // Systemrahmen, weil das Hauptkonto (noch) nicht im Blickfeld des Einlösenden ist.
  const ungleich = await imSystemkontext('haushalt beitreten', () =>
    k.transaktion(async t => {
      await sperreHaushaltswaehrung(t.db);
      const [curMain, curSub] = await Promise.all([
        t.einstellungen.getSetting(mainId, 'currency', 'EUR'),
        t.einstellungen.getSetting(subId, 'currency', 'EUR'),
      ]);
      if (String(curMain) !== String(curSub)) return { haupt: String(curMain), unter: String(curSub) };
      await t.repository.verknuepfe(mainId, subId);
      return null;
    }),
  );
  if (ungleich) {
    await release();
    return { fehler: 'waehrung_ungleich' as const, vars: ungleich };
  }
  meldeHaushaltsaenderung(k);
  // Die Verknüpfung steht schon; fehlt nur der Name, trägt die Antwort die ID und sagt es.
  const ab = new Abstriche();
  const name = await ab.oder('kontoname', k.repository.kontoName(mainId), null);
  return { linked_to: { id: mainId, username: name || String(mainId) }, ...ab.angabe() };
}

/** Von BEIDEN Seiten erlaubt. Ohne `subUserId` und `mainUserId` löst sich das
 * Konto von allen — so verhält sich eine ältere App mit nur einem Elternkonto. */
export async function kontenTrennen(
  k: HaushaltKontext,
  uid: number,
  subUserId?: number | null,
  mainUserId?: number | null,
) {
  const id = parseInt(String(uid), 10);
  const gesetzt = (v: unknown) => v != null && String(v) !== '';
  const removed = gesetzt(subUserId)
    ? await repo.trenne(k.db, id, parseInt(String(subUserId), 10))
    : gesetzt(mainUserId)
      ? await repo.trenne(k.db, parseInt(String(mainUserId), 10), id)
      : await repo.trenne(k.db, null, id);
  meldeHaushaltsaenderung(k);
  return { removed };
}

export async function verwerfeGetrennt(k: HaushaltKontext, uid: number, subUserId: number) {
  return {
    removed: await repo.loescheGetrenntHinweis(k.db, parseInt(String(uid), 10), parseInt(String(subUserId), 10)),
  };
}

export async function haushaltsStand(k: HaushaltKontext, uid: number) {
  const id = parseInt(String(uid), 10);
  const h = await haushaltVon(k, id);
  const members = await haushaltsMitglieder(k, id);
  const ab = new Abstriche();
  const [eltern, openInvites, currency, getrennt] = await Promise.all([
    k.repository.kontoNamen(h.elternIds, 'username'),
    ab.oder('einladungen', k.repository.offeneEinladungen(id), 0),
    k.einstellungen.getSetting(id, 'currency', 'EUR'),
    k.repository.getrennteKetten(id),
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

export async function blickfeldIds(k: HaushaltKontext, uid: number, mode: ScopeMode = 'all'): Promise<number[]> {
  const h = await haushaltVon(k, uid);
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
export async function blickfeldAus(k: HaushaltKontext, v: Sicht | BlickfeldEingabe): Promise<Blickfeld> {
  return typeof v === 'object' && !Array.isArray(v) ? blickfeldIds(k, v.nutzer, parseScopeMode(v.konten)) : asIds(v);
}

export async function schreibbereichAus(k: HaushaltKontext, v: Schreiber | number[]): Promise<number[]> {
  return Array.isArray(v) ? v : schreibbereich(k, v.schreiber);
}

/** Hauptkonten sehen die Dateien ihrer Unterkonten, nicht umgekehrt. Frisch
 * gefragt wie darfSchreibenFuer: Ein gelöstes Unterkonto soll nicht bis zum Ablauf
 * des Gedächtnisses lesbar bleiben, falls die Benachrichtigung ausbleibt. */
export async function siehtKonto(k: HaushaltKontext, nutzer: number, besitzer: number): Promise<boolean> {
  pruefeAnfragender(nutzer);
  return besitzer === nutzer || repo.istVerknuepft(k.db, nutzer, besitzer);
}

/** Für wen geschrieben wird; ohne Recht 403 mit dem Code der Route. */
export async function schreibziel(
  k: HaushaltKontext,
  nutzer: number,
  wunsch: unknown,
  absage: 'kein_schreibrecht' | 'kein_zugriff_konto' = 'kein_schreibrecht',
): Promise<number> {
  const ziel = await schreibzielOderNull(k, nutzer, wunsch);
  if (ziel === null) fachfehler('verboten', absage);
  return ziel;
}

/** Prüft die RICHTUNG (Haupt- für Unterkonto), nicht nur die Mitgliedschaft.
 * @returns die Ziel-ID, oder null wenn nicht erlaubt (Aufrufer antwortet 403) */
export async function schreibzielOderNull(
  k: HaushaltKontext,
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
export async function umzugsQuelle(
  k: HaushaltKontext,
  actorId: number,
  kind: ErfassungsArt,
  acqId: number,
): Promise<number> {
  const owner = await repo.besitzerDerErfassung(k.db, kind, acqId);
  if (owner === null || !(await darfSchreibenFuer(k, actorId, owner)))
    fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');
  return owner;
}

/** Beide Formen hier, damit die Namensauflösung nur einmal existiert. */
// biome-ignore lint/suspicious/noExplicitAny: Die Aufrufer reichen Zeilen verschiedener Form und brauchen ihre Form zurück; owner_ids und user_id liest die Funktion ungeprüft.
export async function besitzerAnhaengen(k: HaushaltKontext, uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await repo.benutzerNamen(k.db, uids);
  const nameById = new Map<number, string>(owners.map(u => [parseInt(String(u.id), 10), u.username]));
  const platte = (id: number) => ({ id, username: nameById.get(id) || String(id) });
  return rows.map(r => {
    // array_agg liefert NULL, wenn der FILTER alles ausschliesst — dann eine
    // LEERE Plakettenliste, nicht keine.
    if ('owner_ids' in r)
      return { ...r, owners: (r.owner_ids || []).map((n: unknown) => platte(parseInt(String(n), 10))) };
    if (r.user_id != null) return { ...r, owners: [platte(parseInt(String(r.user_id), 10))] };
    return r;
  });
}
