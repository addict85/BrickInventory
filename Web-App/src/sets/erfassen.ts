/** Sets erfassen: Web, App, CSV und Merkliste gehen durch dieselben Regeln für
 * Blickfeld, Menge und Kaufpreis. Was das Netz braucht (Katalog, Bild,
 * Marktpreis), hält die Anfrage nicht auf, sondern läuft als Auftrag.
 * Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#abschnitt */
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { scopeIds, schreibziel } from '../haushalt/haushalt';
import { recordAcquisitionForDay, setzeGeschaetztenPreis } from '../bestand/acquisitions';
import { withInventoryLock } from '../../db/txLock';
import { downloadSetImage, rebrickableSetBild } from '../katalog/bilder/setImages';
import { getCurrentMarketPrice } from '../finanzen/marketPrice';
import { zustandFuerPreis } from '../einstellungen/settings';
import { getSetInfo } from '../katalog/rebrickableKatalog';
import { brickset } from '../katalog/quellen';
import { generateThumb } from '../katalog/bilder/thumbs';
import { stelleAuftragEin } from '../auftraege/dienst';
import { normalisiereSetNummer, moeglicheSetNummer } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import { setzeLagerort, ortFuerNeuerfassung } from '../bestand/lagerort';
import * as repo from './repository/sets';
import { versuche, wertOder } from '../infra/ergebnis';

/** Eine Erfassung: eine Zeile in set_acquisitions, der einzige Ort für Kaufpreis und Zustand. */
export interface Erfassung {
  konto: number;
  setNumber: string;
  menge: number;
  kaufpreis?: number | null;
  zustand?: string | null;
  /** Nur mit Kaufpreis: Ein geschätzter Preis ohne Betrag wäre keine Aussage. */
  geschaetzt?: boolean;
  waehrung?: string | null;
  erfasstAm?: string | null;
}

export async function recordAcquisition(e: Erfassung, dbh: DbSchnittstelle = db) {
  const pp = e.kaufpreis !== null && e.kaufpreis !== undefined && !Number.isNaN(e.kaufpreis) ? e.kaufpreis : null;
  const cond = e.zustand === 'N' || e.zustand === 'U' ? e.zustand : 'N';
  await recordAcquisitionForDay(
    'set',
    e.konto,
    [e.setNumber],
    {
      quantity: e.menge,
      price: pp,
      condition: cond,
      geschaetzt: !!e.geschaetzt,
      currency: e.waehrung ?? null,
      createdAt: e.erfasstAm ?? null,
    },
    dbh,
  );
}

// Dieselbe Regel wie beim Schreiben, sonst prüfte die Suche eine andere Nummer.
// Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#normalizesetnumber
export function normalizeSetNumber(input: string): string {
  return normalisiereSetNummer(input);
}

export interface VorhandenesSet {
  set_number: string;
  owner_user_id: number;
  /** Sonst gehört es einem anderen Konto im Haushalt. */
  is_self: boolean;
}

/** Im BLICKFELD, nicht nur im eigenen Konto: Webapp und App sollen dieselbe
 * Eingabe gleich behandeln. Ohne Fang: null hiesse sonst „nicht da“.
 * Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#findsetinscope */
export async function findSetInScope(viewerId: number, setNumber: string): Promise<VorhandenesSet | null> {
  const sn = normalizeSetNumber(setNumber);
  const row = await repo.setImBlickfeld(await scopeIds(viewerId), sn, viewerId);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}

/** Getippt wird eine Nummer, kein Satz: Die nachsichtige Normalisierung (für CSV) machte aus Text ein Set. */
const GETIPPTE_NUMMER = /^[A-Za-z0-9]{1,20}(-\d{1,3})?$/;

export interface NeuesSet {
  anfragender: number;
  /** Wunsch der Anfrage; schreibziel() prüft die Richtung im Haushalt. */
  besitzerWunsch?: unknown;
  setNumber: string;
  menge?: number;
  kaufpreis?: number | null;
  zustand?: string | null;
  lagerort?: string | null;
  erfasstAm?: string | null;
  waehrung?: string | null;
  /** Getippte Eingabe: nur eine Nummer, kein Satz. */
  streng?: boolean;
  /** Bis der Auftrag beginnt; der Strom ergänzt selbst und braucht ihn nur als Rückfall. */
  ergaenzenNachSekunden?: number;
}

export type SetErfasst =
  | ({ action: 'exists' } & VorhandenesSet)
  | {
      action: 'added';
      set_number: string;
      name: string;
      katalog_offen: boolean;
      ergaenzung: 'ausstehend';
      besitzer: number;
    };

/** Anlegen ohne Netz: „schon im Blickfeld?“ und Anlegen unter einer Sperre je
 * Setnummer, sonst legten zwei gleichzeitige Anfragen (auch zweier Konten im
 * Haushalt) das Set zweimal an. Katalog, Bild und Marktpreis holt der Auftrag. */
export async function setErfassen(e: NeuesSet): Promise<SetErfasst> {
  const roh = String(e.setNumber ?? '').trim();
  if (!roh) fachfehler('ungueltig', 'set_number_erforderlich');
  if (e.streng && !GETIPPTE_NUMMER.test(roh)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const sn = normalizeSetNumber(roh);
  if (!moeglicheSetNummer(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const besitzer = await schreibziel(e.anfragender, e.besitzerWunsch);
  const zustand = await zustandFuerPreis(e.zustand ?? null, null, besitzer);
  const ort = await ortFuerNeuerfassung(besitzer, e.lagerort ?? null);
  const kaufpreis = e.kaufpreis ?? null;

  return db.transaction(async tx => {
    await repo.sperreSetErfassen(tx, sn, besitzer);
    const vorhanden = await findSetInScope(e.anfragender, sn);
    if (vorhanden) return { action: 'exists' as const, ...vorhanden };
    const katalog = await repo.merkeKatalogPlatzhalter(tx, sn);
    await repo.legeSetZeileAn(tx, besitzer, sn);
    await recordAcquisition(
      {
        konto: besitzer,
        setNumber: sn,
        menge: e.menge ?? 1,
        kaufpreis,
        zustand,
        waehrung: kaufpreis === null ? null : (e.waehrung ?? null),
        erfasstAm: e.erfasstAm ?? null,
      },
      tx,
    );
    if (ort) await setzeLagerort('set', [besitzer], [sn], ort);
    // In derselben Transaktion: Ein angelegtes Set ohne Auftrag bliebe für immer ohne Katalog.
    await stelleAuftragEin(
      'nacharbeit',
      { set_number: sn, user_id: besitzer, art: 'ergaenzen' },
      {
        userId: besitzer,
        schluessel: `nacharbeit:${besitzer}:${sn}`,
        maxVersuche: 5,
        nachSekunden: e.ergaenzenNachSekunden ?? 0,
      },
    );
    const offen = !katalog || katalog.platzhalter;
    return {
      action: 'added' as const,
      set_number: sn,
      name: katalog?.name ?? `Set ${sn}`,
      katalog_offen: offen,
      ergaenzung: 'ausstehend' as const,
      besitzer,
    };
  });
}

export type Fortschritt = (n: { step: string; set: string }) => void;

/** Rebrickable, dann Brickset für Lücken, dann das Bild. `gestoert`: Rebrickable
 * hat nicht geantwortet (anders als „kennt die Nummer nicht“). */
async function katalogHolen(sn: string, mitBrickset: boolean, sendProgress: Fortschritt | null) {
  let name: string | null = null,
    year: number | null = null,
    theme: string | null = null,
    pieces: number | null = null,
    minifigs: number | null = null,
    imageUrl: string | null = null;
  const rbErgebnis = await versuche('set-service:getSetInfo', getSetInfo(sn));
  const rb = wertOder(rbErgebnis, null);
  if (rb) {
    name = rb.name;
    year = rb.year;
    theme = rb.theme;
    pieces = rb.pieces;
    imageUrl = rb.image_url;
  }
  if (mitBrickset) {
    const bs = wertOder(await versuche('set-anlegen:brickset-info', brickset.getSetInfo(sn)), null);
    if (bs) {
      name ??= bs.name;
      year ??= bs.year;
      theme ??= bs.theme;
      pieces ??= bs.pieces;
      minifigs ??= bs.minifigs;
    }
  }
  imageUrl ??= rebrickableSetBild(sn);
  if (sendProgress) sendProgress({ step: 'image', set: sn });
  const frist = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Image timeout')), 15000).unref());
  const bild = await versuche('set-anlegen:bild-laden', Promise.race([downloadSetImage(imageUrl, sn), frist]));
  const lokal = wertOder(bild, null);
  if (lokal) void versuche('set-anlegen:vorschau', generateThumb(lokal));
  // Kein Fang: Der Katalog ist die einzige Stelle mit Name, Jahr und Bild.
  // Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#addsetintern-3
  await repo.merkeSetKatalog(sn, name, year, theme || null, pieces, minifigs, imageUrl, lokal);
  if (minifigs) await repo.setzeFigurenzahl(minifigs, sn);
  return { name, gestoert: !rbErgebnis.ok, bild: !!lokal };
}

/** Was setErfassen() offen liess; idempotent, damit Strom und Auftrag sich nicht
 * stören. Wirft, solange Rebrickable gestört ist: Der Auftrag versucht es später. */
export async function setErgaenzen(
  sn: string,
  konto: number,
  sendProgress: Fortschritt | null = null,
): Promise<{ name: string | null }> {
  const stand = await repo.katalogStand(sn);
  let name = stand && !stand.platzhalter ? stand.name : null;
  if (!stand || stand.platzhalter || !stand.image_local) {
    const k = await katalogHolen(sn, true, sendProgress);
    if (k.gestoert && !k.name) throw new Error(`Katalog für ${sn} nicht erreichbar`);
    name = k.name ?? name;
  }
  for (const z of await repo.erfassungenOhnePreisDesSets(konto, sn)) {
    const preis = await getCurrentMarketPrice(sn, konto, z.condition || null);
    if (preis) await setzeGeschaetztenPreis('set', z.id, preis);
  }
  return { name };
}

/** `massenimport`: kein Brickset-Abruf und keine Nacharbeit je Set — die
 * Importschleife stellt sie selbst ein und schont so Pool und Tageskontingent. */
export interface SetHinzufuegen {
  setNumber: string;
  menge: number;
  konto: number;
  kaufpreis?: number | null;
  zustand?: string | null;
  lagerort?: string | null;
  erfasstAm?: string | null;
  waehrung?: string | null;
  massenimport?: boolean;
  fortschritt?: Fortschritt | null;
}

/** Steht das Set schon im eigenen Konto, kommt eine Erfassung dazu (CSV, Merkliste).
 * Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#addset */
export async function addSet(s: SetHinzufuegen) {
  // Ohne Ort gilt der Vorgabeort des Kontos (CSV- und Wanted-Import haben keinen).
  const ort = await ortFuerNeuerfassung(s.konto, s.lagerort ?? null);
  const ergebnis = await addSetIntern(s);
  if (ort && ergebnis?.set_number) await setzeLagerort('set', [s.konto], [ergebnis.set_number], ort);
  return ergebnis;
}

// Das Datum geht in DIESELBE Erfassung — ein nachträgliches UPDATE datierte einen fremden Kauf desselben Tages um.
export async function addSetWithDate(
  setNumber: string,
  menge: number,
  konto: number,
  kaufpreis: number | null,
  zustand: string | null,
  erfasstAm: string | null,
) {
  return addSet({ setNumber, menge, konto, kaufpreis, zustand, erfasstAm, massenimport: true });
}

/** Nie Voraussetzung für die Antwort: Scheitert das Einstellen, ist das Set
 * trotzdem erfasst, und der Fehler steht im Protokoll. */
export async function nacharbeitEinstellen(setNumber: string, userId: number, art: 'zweit' | 'neu' | 'csv') {
  await versuche(
    `set-anlegen:nacharbeit ${setNumber}`,
    stelleAuftragEin(
      'nacharbeit',
      { set_number: setNumber, user_id: userId, art },
      { userId, schluessel: `nacharbeit:${userId}:${setNumber}`, maxVersuche: 3 },
    ),
  );
}

async function addSetIntern(s: SetHinzufuegen) {
  const { konto: userId, menge, fortschritt } = s;
  const massenimport = s.massenimport === true;
  const normalized = normalizeSetNumber(s.setNumber);
  if (!moeglicheSetNummer(normalized)) fachfehler('ungueltig', 'setnummer_ungueltig');
  fortschritt?.({ step: 'meta', set: normalized });
  // Einmal für beide Zweige, damit Neuanlage und Aufstocken nicht verschieden rechnen.
  const zustand = await zustandFuerPreis(s.zustand ?? null, null, userId);
  const kaufpreis = s.kaufpreis ?? null;
  // Ohne Angabe gilt der Marktpreis des gewählten Zustands, geholt VOR der Sperre:
  // Ein Netzaufruf in der Sperre blockierte jeden anderen Schreiber.
  // Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#addsetintern-readdprice
  const geschaetzt = kaufpreis === null || Number.isNaN(kaufpreis);
  const marktpreis = async () =>
    geschaetzt
      ? wertOder(
          await versuche('set-service:getCurrentMarketPrice', getCurrentMarketPrice(normalized, userId, zustand)),
          null,
        )
      : kaufpreis;

  if (await repo.setZeileDesKontos(userId, normalized)) {
    const preis = await marktpreis();
    // Gesperrt, weil recordAcquisitionForDay() erst liest und dann schreibt.
    // Ausführlich: docs/begruendungen/src/sets/erfassen.ts.md#addsetintern
    await withInventoryLock(userId, normalized, async tx => {
      await recordAcquisition(
        {
          konto: userId,
          setNumber: normalized,
          menge,
          kaufpreis: preis,
          zustand,
          geschaetzt,
          waehrung: geschaetzt ? null : (s.waehrung ?? null),
          erfasstAm: s.erfasstAm ?? null,
        },
        tx,
      );
    });
    if (!massenimport) await nacharbeitEinstellen(normalized, userId, 'zweit');
    return { action: 'updated', set_number: normalized };
  }

  const { name } = await katalogHolen(normalized, !massenimport, fortschritt ?? null);
  const preis = await marktpreis();
  // Gesperrt: Zwei gleichzeitige Erst-Erfassungen überschrieben sich sonst.
  await withInventoryLock(userId, normalized, async tx => {
    await repo.legeSetZeileAn(tx, userId, normalized);
    // Nur ein bezahlter Betrag trägt die gewählte Währung; ein Marktpreis steht in der des Kontos.
    await recordAcquisition(
      {
        konto: userId,
        setNumber: normalized,
        menge,
        kaufpreis: preis,
        zustand,
        geschaetzt,
        waehrung: geschaetzt ? null : (s.waehrung ?? null),
        erfasstAm: s.erfasstAm ?? null,
      },
      tx,
    );
  });
  fortschritt?.({ step: 'done_meta', set: normalized });
  if (!massenimport) await nacharbeitEinstellen(normalized, userId, 'neu');
  // katalog_offen: Keine Quelle hat geantwortet; die Oberfläche soll das sagen statt eines schlichten „hinzugefügt“.
  return { action: 'added', set_number: normalized, name: name ?? `Set ${normalized}`, katalog_offen: !name };
}
