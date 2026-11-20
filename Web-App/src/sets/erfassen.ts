/** Sets erfassen: Web, App, CSV, Wanted-XML und Merkliste unter denselben Regeln. Was das
 * Netz braucht (Katalog, Bild, Marktpreis), hält die Anfrage nicht auf, es läuft als Auftrag. */
import { rebrickableSetImage } from '../images';
import { normalisiereSetNummer, possibleSetNumber } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/sets';
import { versuche, valueOr } from '../infra/ergebnis';
import type { SetsContext } from './kontext';

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
  recordedAt?: string | null;
}

/** In einer Transaktion mit deren Kontext (`t`) rufen. */
export async function bookEntry(sk: SetsContext, e: Erfassung) {
  const pp = e.kaufpreis !== null && e.kaufpreis !== undefined && !Number.isNaN(e.kaufpreis) ? e.kaufpreis : null;
  const cond = e.zustand === 'N' || e.zustand === 'U' ? e.zustand : 'N';
  await sk.bestand.bookDailyEntry('set', e.konto, [e.setNumber], {
    quantity: e.menge,
    price: pp,
    condition: cond,
    geschaetzt: !!e.geschaetzt,
    currency: e.waehrung ?? null,
    createdAt: e.recordedAt ?? null,
  });
}

export interface ExistingSet {
  set_number: string;
  owner_user_id: number;
  /** Sonst gehört es einem anderen Konto im Haushalt. */
  is_self: boolean;
}

/** Im BLICKFELD, nicht nur im eigenen Konto: Webapp und App sollen dieselbe
 * Eingabe gleich behandeln. Ohne Fang: null hiesse sonst „nicht da“. */
export async function findSetInScope(
  sk: SetsContext,
  viewerId: number,
  setNumber: string,
): Promise<ExistingSet | null> {
  const sn = normalisiereSetNummer(setNumber);
  const row = await repo.setInScope(sk.db, await sk.household.scopeIds(viewerId), sn, viewerId);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}

/** Für „gibt es das schon?“: ohne Treffer die Nummer so, wie sie angelegt würde. */
export async function setPresent(sk: SetsContext, viewerId: number, setNumber: string) {
  const treffer = await findSetInScope(sk, viewerId, setNumber);
  return { exists: !!treffer, ...(treffer ?? { set_number: normalisiereSetNummer(setNumber) }) };
}

/** ergaenzen (= neu): angelegt; zweit: ein vorhandenes Set aufgestockt; csv: aus dem CSV-Import. */
export type ReworkKind = 'zweit' | 'neu' | 'csv' | 'ergaenzen';

/** Getippt wird eine Nummer, kein Satz: Die nachsichtige Normalisierung (für CSV) machte aus Text ein Set. */
const TYPED_NUMBER = /^[A-Za-z0-9]{1,20}(-\d{1,3})?$/;

export interface NewSet {
  requester: number;
  /** Wunsch der Anfrage; schreibziel() prüft die Richtung im Haushalt. */
  ownerWish?: unknown;
  setNumber: string;
  menge?: number;
  kaufpreis?: number | null;
  zustand?: string | null;
  lagerort?: string | null;
  recordedAt?: string | null;
  waehrung?: string | null;
  /** Getippte Eingabe: nur eine Nummer, kein Satz. */
  streng?: boolean;
  /** Bis der Auftrag beginnt; der Strom ergänzt selbst und braucht ihn nur als Rückfall. */
  supplementAfterSeconds?: number;
  /** Ein Import bucht die Datei eines Kontos und stockt auf; getippt heisst „im Blickfeld“ exists. */
  ifPresent?: 'melden' | 'aufstocken';
  /** Der CSV-Import fragt Brickset erst in der Nacharbeit ('csv'). */
  nacharbeit?: ReworkKind;
}

export type SetRecorded =
  | ({ action: 'exists' } & ExistingSet)
  | { action: 'updated'; set_number: string; besitzer: number }
  | {
      action: 'added';
      set_number: string;
      name: string;
      katalog_offen: boolean;
      ergaenzung: 'ausstehend';
      besitzer: number;
    };

/** Der eine Weg zum Erfassen, ohne Netz und unter der Sperre je Setnummer: Sonst legten zwei
 * Anfragen (auch zweier Konten im Haushalt) das Set zweimal an. Den Katalog holt der Auftrag. */
export async function setErfassen(sk: SetsContext, e: NewSet): Promise<SetRecorded> {
  const roh = String(e.setNumber ?? '').trim();
  if (!roh) fachfehler('ungueltig', 'set_number_erforderlich');
  if (e.streng && !TYPED_NUMBER.test(roh)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const sn = normalisiereSetNummer(roh);
  if (!possibleSetNumber(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const besitzer = await sk.household.schreibziel(e.requester, e.ownerWish);
  const zustand = await sk.einstellungen.conditionForPrice(e.zustand ?? null, null, besitzer);
  const ort = await sk.bestand.locationService.locationForNewEntry(besitzer, e.lagerort ?? null);
  const kaufpreis = e.kaufpreis ?? null;
  const erfassung = {
    konto: besitzer,
    setNumber: sn,
    menge: e.menge ?? 1,
    kaufpreis,
    zustand,
    waehrung: kaufpreis === null ? null : (e.waehrung ?? null),
    recordedAt: e.recordedAt ?? null,
  };

  return sk.transaktion(async t => {
    await repo.addLockSet(t.db, sn, besitzer);
    const nacharbeit = (art: ReworkKind) =>
      // In derselben Transaktion: Ein angelegtes Set ohne Auftrag bliebe für immer ohne Katalog.
      t.auftraege.placeOwnJobOne(
        'nacharbeit',
        { set_number: sn, user_id: besitzer, art: e.nacharbeit ?? art },
        {
          userId: besitzer,
          schluessel: `nacharbeit:${besitzer}:${sn}`,
          maxAttempts: 5,
          afterSeconds: e.supplementAfterSeconds ?? 0,
        },
      );
    if (e.ifPresent === 'aufstocken' && (await repo.setRowOfAccount(t.db, besitzer, sn))) {
      await bookEntry(t, erfassung);
      // Nur ein genannter Ort: Die Vorgabe des Kontos verschöbe sonst ein einsortiertes Set.
      if (ort && e.lagerort) await t.bestand.locationService.setLocation('set', [besitzer], [sn], ort);
      await nacharbeit('zweit');
      return { action: 'updated' as const, set_number: sn, besitzer };
    }
    if (e.ifPresent !== 'aufstocken') {
      const vorhanden = await findSetInScope(t, e.requester, sn);
      if (vorhanden) return { action: 'exists' as const, ...vorhanden };
    }
    const katalog = await t.katalog.rememberCatalogPlaceholder(sn);
    await t.bestand.putSetAn(besitzer, sn);
    await bookEntry(t, erfassung);
    if (ort) await t.bestand.locationService.setLocation('set', [besitzer], [sn], ort);
    await nacharbeit('ergaenzen');
    return {
      action: 'added' as const,
      set_number: sn,
      name: katalog?.name ?? `Set ${sn}`,
      katalog_offen: !katalog || katalog.platzhalter,
      ergaenzung: 'ausstehend' as const,
      besitzer,
    };
  });
}

export type Fortschritt = (n: { step: string; set: string }) => void;

/** Rebrickable, dann Brickset für Lücken, dann das Bild. `disrupted`: Rebrickable
 * hat nicht geantwortet (anders als „kennt die Nummer nicht“). */
async function fetchCatalog(sk: SetsContext, sn: string, withBrickset: boolean, sendProgress: Fortschritt | null) {
  let name: string | null = null,
    year: number | null = null,
    theme: string | null = null,
    pieces: number | null = null,
    minifigs: number | null = null,
    imageUrl: string | null = null,
    themeId: number | null = null;
  const rbResult = await versuche('set-service:setAngaben', sk.katalog.setInfo(sn));
  const rb = valueOr(rbResult, null);
  if (rb) {
    name = rb.name;
    year = rb.year;
    theme = rb.theme;
    pieces = rb.pieces;
    imageUrl = rb.image_url;
    themeId = ('theme_id' in rb ? rb.theme_id : null) ?? null;
  }
  if (withBrickset) {
    const bs = valueOr(
      await versuche('set-anlegen:brickset-info', sk.externalSources.quellen.brickset.setAngaben(sn)),
      null,
    );
    if (bs) {
      name ??= bs.name;
      year ??= bs.year;
      theme ??= bs.theme;
      pieces ??= bs.pieces;
      minifigs ??= bs.minifigs;
    }
  }
  imageUrl ??= rebrickableSetImage(sn);
  if (sendProgress) sendProgress({ step: 'image', set: sn });
  const frist = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Image timeout')), 15000).unref());
  const bild = await versuche('set-anlegen:bild-laden', Promise.race([sk.images.setBildLaden(imageUrl, sn), frist]));
  const lokal = valueOr(bild, null);
  if (lokal) void versuche('set-anlegen:vorschau', sk.images.createPreview(lokal));
  // Kein Fang: Der Katalog ist die einzige Stelle mit Name, Jahr und Bild.
  await sk.katalog.rememberSetCatalog(sn, name, year, theme || null, pieces, minifigs, imageUrl, lokal, themeId);
  return { name, disrupted: !rbResult.ok, bild: !!lokal };
}

/** Was setErfassen(sk) offen liess; idempotent, damit Strom und Auftrag sich nicht
 * stören. Wirft, solange Rebrickable gestört ist: Der Auftrag versucht es später. */
export async function setSupplement(
  sk: SetsContext,
  sn: string,
  konto: number,
  sendProgress: Fortschritt | null = null,
  withBrickset = true,
): Promise<{ name: string | null }> {
  const stand = await sk.katalog.catalogStatus(sn);
  let name = stand && !stand.platzhalter ? stand.name : null;
  if (!stand || stand.platzhalter || !stand.image_local) {
    const k = await fetchCatalog(sk, sn, withBrickset, sendProgress);
    if (k.disrupted && !k.name) throw new Error(`Katalog für ${sn} nicht erreichbar`);
    name = k.name ?? name;
  }
  for (const z of await repo.entriesWithoutPriceOfSets(sk.db, konto, sn)) {
    const preis = await sk.finances.aktuellerMarktpreis(sn, konto, z.condition || null);
    if (preis) await sk.bestand.setEstimatedPrice('set', z.id, preis);
  }
  return { name };
}
