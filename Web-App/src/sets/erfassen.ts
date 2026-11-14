/** Sets erfassen: Web, App, CSV, Wanted-XML und Merkliste unter denselben Regeln. Was das
 * Netz braucht (Katalog, Bild, Marktpreis), hält die Anfrage nicht auf, es läuft als Auftrag. */
import { katalogStand, merkeKatalogPlatzhalter, merkeSetKatalog } from '../katalog';
import { rebrickableSetBild } from '../bilder';
import { normalisiereSetNummer, moeglicheSetNummer } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/sets';
import { versuche, wertOder } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

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

/** In einer Transaktion mit deren Kontext (`t`) rufen. */
export async function erfassungBuchen(sk: SetsKontext, e: Erfassung) {
  const pp = e.kaufpreis !== null && e.kaufpreis !== undefined && !Number.isNaN(e.kaufpreis) ? e.kaufpreis : null;
  const cond = e.zustand === 'N' || e.zustand === 'U' ? e.zustand : 'N';
  await sk.bestand.recordAcquisitionForDay('set', e.konto, [e.setNumber], {
    quantity: e.menge,
    price: pp,
    condition: cond,
    geschaetzt: !!e.geschaetzt,
    currency: e.waehrung ?? null,
    createdAt: e.erfasstAm ?? null,
  });
}

export interface VorhandenesSet {
  set_number: string;
  owner_user_id: number;
  /** Sonst gehört es einem anderen Konto im Haushalt. */
  is_self: boolean;
}

/** Im BLICKFELD, nicht nur im eigenen Konto: Webapp und App sollen dieselbe
 * Eingabe gleich behandeln. Ohne Fang: null hiesse sonst „nicht da“. */
export async function findSetInScope(
  sk: SetsKontext,
  viewerId: number,
  setNumber: string,
): Promise<VorhandenesSet | null> {
  const sn = normalisiereSetNummer(setNumber);
  const row = await repo.setImBlickfeld(sk.db, await sk.haushalt.blickfeldIds(viewerId), sn, viewerId);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}

/** ergaenzen (= neu): angelegt; zweit: ein vorhandenes Set aufgestockt; csv: aus dem CSV-Import. */
export type NacharbeitArt = 'zweit' | 'neu' | 'csv' | 'ergaenzen';

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
  /** Ein Import bucht die Datei eines Kontos und stockt auf; getippt heisst „im Blickfeld“ exists. */
  wennVorhanden?: 'melden' | 'aufstocken';
  /** Der CSV-Import fragt Brickset erst in der Nacharbeit ('csv'). */
  nacharbeit?: NacharbeitArt;
}

export type SetErfasst =
  | ({ action: 'exists' } & VorhandenesSet)
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
export async function setErfassen(sk: SetsKontext, e: NeuesSet): Promise<SetErfasst> {
  const roh = String(e.setNumber ?? '').trim();
  if (!roh) fachfehler('ungueltig', 'set_number_erforderlich');
  if (e.streng && !GETIPPTE_NUMMER.test(roh)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const sn = normalisiereSetNummer(roh);
  if (!moeglicheSetNummer(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  const besitzer = await sk.haushalt.schreibziel(e.anfragender, e.besitzerWunsch);
  const zustand = await sk.einstellungen.zustandFuerPreis(e.zustand ?? null, null, besitzer);
  const ort = await sk.bestand.lagerortDienst.ortFuerNeuerfassung(besitzer, e.lagerort ?? null);
  const kaufpreis = e.kaufpreis ?? null;
  const erfassung = {
    konto: besitzer,
    setNumber: sn,
    menge: e.menge ?? 1,
    kaufpreis,
    zustand,
    waehrung: kaufpreis === null ? null : (e.waehrung ?? null),
    erfasstAm: e.erfasstAm ?? null,
  };

  return sk.transaktion(async t => {
    await repo.sperreSetErfassen(t.db, sn, besitzer);
    const nacharbeit = (art: NacharbeitArt) =>
      // In derselben Transaktion: Ein angelegtes Set ohne Auftrag bliebe für immer ohne Katalog.
      t.auftraege.stelleEigenenAuftragEin(
        'nacharbeit',
        { set_number: sn, user_id: besitzer, art: e.nacharbeit ?? art },
        {
          userId: besitzer,
          schluessel: `nacharbeit:${besitzer}:${sn}`,
          maxVersuche: 5,
          nachSekunden: e.ergaenzenNachSekunden ?? 0,
        },
      );
    if (e.wennVorhanden === 'aufstocken' && (await repo.setZeileDesKontos(t.db, besitzer, sn))) {
      await erfassungBuchen(t, erfassung);
      // Nur ein genannter Ort: Die Vorgabe des Kontos verschöbe sonst ein einsortiertes Set.
      if (ort && e.lagerort) await t.bestand.lagerortDienst.setzeLagerort('set', [besitzer], [sn], ort);
      await nacharbeit('zweit');
      return { action: 'updated' as const, set_number: sn, besitzer };
    }
    if (e.wennVorhanden !== 'aufstocken') {
      const vorhanden = await findSetInScope(t, e.anfragender, sn);
      if (vorhanden) return { action: 'exists' as const, ...vorhanden };
    }
    const katalog = await merkeKatalogPlatzhalter(t.db, sn);
    await repo.legeSetZeileAn(t.db, besitzer, sn);
    await erfassungBuchen(t, erfassung);
    if (ort) await t.bestand.lagerortDienst.setzeLagerort('set', [besitzer], [sn], ort);
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

/** Rebrickable, dann Brickset für Lücken, dann das Bild. `gestoert`: Rebrickable
 * hat nicht geantwortet (anders als „kennt die Nummer nicht“). */
async function katalogHolen(sk: SetsKontext, sn: string, mitBrickset: boolean, sendProgress: Fortschritt | null) {
  let name: string | null = null,
    year: number | null = null,
    theme: string | null = null,
    pieces: number | null = null,
    minifigs: number | null = null,
    imageUrl: string | null = null,
    themeId: number | null = null;
  const rbErgebnis = await versuche('set-service:getSetInfo', sk.katalog.getSetInfo(sn));
  const rb = wertOder(rbErgebnis, null);
  if (rb) {
    name = rb.name;
    year = rb.year;
    theme = rb.theme;
    pieces = rb.pieces;
    imageUrl = rb.image_url;
    themeId = ('theme_id' in rb ? rb.theme_id : null) ?? null;
  }
  if (mitBrickset) {
    const bs = wertOder(await versuche('set-anlegen:brickset-info', sk.katalog.quellen.brickset.getSetInfo(sn)), null);
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
  const bild = await versuche(
    'set-anlegen:bild-laden',
    Promise.race([sk.katalog.bilder.setBildLaden(imageUrl, sn), frist]),
  );
  const lokal = wertOder(bild, null);
  if (lokal) void versuche('set-anlegen:vorschau', sk.katalog.bilder.vorschauErzeugen(lokal));
  // Kein Fang: Der Katalog ist die einzige Stelle mit Name, Jahr und Bild.
  await merkeSetKatalog(sk.db, sn, name, year, theme || null, pieces, minifigs, imageUrl, lokal, themeId);
  return { name, gestoert: !rbErgebnis.ok, bild: !!lokal };
}

/** Was setErfassen(sk) offen liess; idempotent, damit Strom und Auftrag sich nicht
 * stören. Wirft, solange Rebrickable gestört ist: Der Auftrag versucht es später. */
export async function setErgaenzen(
  sk: SetsKontext,
  sn: string,
  konto: number,
  sendProgress: Fortschritt | null = null,
  mitBrickset = true,
): Promise<{ name: string | null }> {
  const stand = await katalogStand(sk.db, sn);
  let name = stand && !stand.platzhalter ? stand.name : null;
  if (!stand || stand.platzhalter || !stand.image_local) {
    const k = await katalogHolen(sk, sn, mitBrickset, sendProgress);
    if (k.gestoert && !k.name) throw new Error(`Katalog für ${sn} nicht erreichbar`);
    name = k.name ?? name;
  }
  for (const z of await repo.erfassungenOhnePreisDesSets(sk.db, konto, sn)) {
    const preis = await sk.finanzen.getCurrentMarketPrice(sn, konto, z.condition || null);
    if (preis) await sk.bestand.setzeGeschaetztenPreis('set', z.id, preis);
  }
  return { name };
}
