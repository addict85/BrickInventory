/**
 * Fachdienst Erfassungen: Ändern, Verschieben und Löschen eines Kaufpreises
 * für Sets, manuelle Teile und manuelle Figuren. Eine Regel für drei Arten,
 * damit Webapp und App nicht auseinanderlaufen.
 */
import * as repo from './repository/kaufErfassungen';
import type { DbSchnittstelle } from '../../db/database';
import { writableIds, acquisitionMoveSource, resolveWriteTarget } from '../haushalt/haushalt';
import { findSameDayAcquisition } from './acquisitions';
import { meldeUndLiefere } from '../infra/httpError';
import { withInventoryLock, bestandsSchluessel } from '../../db/txLock';
import { moveSetBetweenAccounts, moveManualAcquisition } from '../sets/setMove';
import { getCurrentMarketPrice, getCurrentPartMarketPrice, getCurrentFigMarketPrice } from '../finanzen/marketPrice';
import { deleteSetRows, withSetAggregate } from '../sets/abfragen';
import { loescheManuellesTeil, loescheManuelleFigur } from './gemeinsam';
import { fehlerWerfen } from '../infra/fehlerTexte';
import type { FehlerCode } from '../infra/fehlerTexte';
import { blAbrufNummer } from '../katalog/blZuordnung';
import { mengeDesSets, mengeDerPosition } from '../../db/bestandsmenge';
import { bestandsMenge } from '../infra/validate';

export type ErfassungsArt = 'set' | 'part' | 'fig';
type Schluessel = Array<string | number>;

interface Art {
  notFound: FehlerCode;
  /** Marktpreis, wenn der Preis geleert wird — im Zustand dieser Zeile. */
  resolvePrice: (uid: number, keys: Schluessel, cond: string | null) => Promise<number | null>;
  /** Aufräumen, wenn nach dem Löschen keine Erfassung mehr übrig ist. */
  cleanupWhenEmpty: (tx: DbSchnittstelle, ownerId: number, keys: Schluessel) => Promise<unknown>;
}

const ARTEN: Record<ErfassungsArt, Art> = {
  set: {
    notFound: 'erfassung_nicht_gefunden',
    resolvePrice: (uid, [sn], cond) => getCurrentMarketPrice(String(sn), uid, cond || null),
    // Dieselben Zeilen wie beim ausdrücklichen Löschen: Teile und Figuren des
    // Sets stünden sonst ohne Set in Teileliste und Finanzsummen.
    cleanupWhenEmpty: (tx, ownerId, [sn]) => deleteSetRows(tx, [ownerId], String(sn)),
  },
  part: {
    notFound: 'nicht_gefunden',
    resolvePrice: (uid, [pn, cid], cond) => getCurrentPartMarketPrice(String(pn), Number(cid), uid, cond),
    // Nur die manuelle Position; Set-Teile gehen mit ihrem Set.
    cleanupWhenEmpty: (tx, ownerId, [pn, cid]) => loescheManuellesTeil(tx, ownerId, String(pn), Number(cid)),
  },
  fig: {
    notFound: 'nicht_gefunden',
    resolvePrice: async (uid, [fn], cond) =>
      getCurrentFigMarketPrice(String(fn), uid, await blAbrufNummer('fig', String(fn)), cond),
    cleanupWhenEmpty: (tx, ownerId, [fn]) => loescheManuelleFigur(tx, ownerId, String(fn)),
  },
};

interface Zeile { id: number; user_id: number; condition: string | null; preis: number | null; price_estimated: boolean; currency: string; tag: string }

/** Besitzer einer Erfassung für den Sperrschlüssel; die Rechte prüft danach die Abfrage im Schreib-Blickfeld. */
async function besitzerDerZeile(art: ErfassungsArt, id: number, fallback: number): Promise<number> {
  return await repo.kontoDerErfassung(art, id) ?? fallback;
}

/** Stückzahl der Bestandszeile aus den Erfassungen: Zahl, 0 („leer“) oder null („keine Zeile“). */
function mengeDesBestands(tx: DbSchnittstelle, art: ErfassungsArt, ownerId: number, keys: Schluessel) {
  return art === 'set'
    ? mengeDesSets(ownerId, String(keys[0]), tx).catch(meldeUndLiefere('erfassungen:mengeDesSets', null))
    : mengeDerPosition(art, ownerId, keys, tx).catch(meldeUndLiefere('erfassungen:mengeDerPosition', null));
}

/** Sucht die Zeile im Schreib-Blickfeld: Ein Unterkonto darf nicht rückwärts schreiben. */
async function zeileImSchreibfeld(tx: DbSchnittstelle, art: ErfassungsArt, uid: number, id: number, keys: Schluessel): Promise<Zeile> {
  const a = ARTEN[art];
  const z = await repo.erfassungImSchreibfeld(tx, art, id, await writableIds(uid), keys);
  if (!z) fehlerWerfen(a.notFound, 404);
  return z;
}

/** Bei Sets kommt das Zustands-Aggregat in die Antwort, sonst bleibt sie, wie sie ist. */
async function antwort(art: ErfassungsArt, uid: number, keys: Schluessel, payload: Record<string, unknown>) {
  return art === 'set' ? withSetAggregate(uid, String(keys[0]), payload) : payload;
}

export interface Aenderung { quantity?: unknown; condition?: unknown; date?: unknown; owner_user_id?: unknown; [preis: string]: unknown }

/**
 * Eine Erfassung ändern: Menge, Preis (leer heisst Marktpreis, dann
 * geschätzt), Zustand, Datum — oder den Besitzer im Haushalt.
 */
export async function erfassungAendern(art: ErfassungsArt, uid: number, id: number, keys: Schluessel, body: Aenderung) {
  const a = ARTEN[art];
  const { quantity, condition, date } = body;
  const rawPrice = body[repo.preisSpalte(art)];

  const ownerReq = body.owner_user_id;
  if (ownerReq !== undefined && ownerReq !== null && ownerReq !== '') {
    const from = await acquisitionMoveSource(uid, art, id);
    const to = await resolveWriteTarget(uid, ownerReq);
    if (to === null) fehlerWerfen('kein_schreibrecht', 403);
    if (from === to) return { success: true, unchanged: true };
    const moved = await withInventoryLock(from, bestandsSchluessel(art, keys), (tx) =>
      art === 'set' ? moveSetBetweenAccounts(tx, String(keys[0]), from, to, [id]) : moveManualAcquisition(tx, art, keys, id, from, to));
    return { success: true, from_user_id: from, to_user_id: to, ...moved };
  }

  // Der Marktpreis-Rückfall fragt fremde Dienste — vor der Transaktion, sonst
  // hielte ein Netzaufruf Sperre und Verbindung offen.
  let priceVal: number | null = null;
  let preisGeschaetzt = false;
  if (rawPrice !== undefined) {
    let p = (rawPrice === null || rawPrice === '') ? null : parseFloat(String(rawPrice));
    if (p === null || isNaN(p)) {
      preisGeschaetzt = true;
      const bisher = condition ? null : await repo.zustandDerErfassung(art, id)
        .catch(meldeUndLiefere('erfassungen:zustand', null));
      p = await a.resolvePrice(uid, keys, String(condition || bisher || '') || null)
        .catch(meldeUndLiefere('erfassungen:resolvePrice', null));
    }
    priceVal = (p !== null && !isNaN(p)) ? p : null;
  }

  const besitzer = await besitzerDerZeile(art, id, uid);
  await withInventoryLock(besitzer, bestandsSchluessel(art, keys), async (tx) => {
    const acq = await zeileImSchreibfeld(tx, art, uid, id, keys);
    // Ab hier zählt der Besitzer der Zeile, nicht der Betrachter.
    const ownerId = Number(acq.user_id);
    let neuesDatum: string | null = null;
    if (date !== undefined && date !== null && date !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fehlerWerfen('datum_ungueltig', 400);
      neuesDatum = String(date);
    }
    const hatZustand = condition !== undefined && condition !== null;
    const zielZustand = hatZustand ? (['N', 'U'].includes(String(condition)) ? String(condition) : 'N') : (acq.condition || 'N');
    const zielGeschaetzt = rawPrice !== undefined ? (preisGeschaetzt && priceVal != null) : !!acq.price_estimated;
    // Eine Zeile je Tag, Zustand, Preis, Herkunft und Währung — geprüft gegen
    // die Werte nach dieser Änderung.
    if (neuesDatum || rawPrice !== undefined || hatZustand) {
      const clash = await findSameDayAcquisition(art, ownerId, keys, neuesDatum || acq.tag, id, zielZustand, tx,
        { preis: rawPrice !== undefined ? priceVal : acq.preis, geschaetzt: zielGeschaetzt, waehrung: acq.currency });
      if (clash) fehlerWerfen('datum_belegt', 409);
    }
    if (quantity !== undefined && quantity !== null) {
      await repo.setzeErfassungsMenge(tx, art, id, bestandsMenge(quantity, 1));
      const q = await mengeDesBestands(tx, art, ownerId, keys);
      if ((q ?? 0) <= 0) await a.cleanupWhenEmpty(tx, ownerId, keys);
    }
    if (rawPrice !== undefined)
      await repo.setzeErfassungsPreis(tx, art, id, priceVal, zielGeschaetzt);
    if (hatZustand)
      await repo.setzeErfassungsZustand(tx, art, id, zielZustand);
    if (neuesDatum)
      await repo.setzeErfassungsDatum(tx, art, id, neuesDatum);
  });
  return antwort(art, uid, keys, { success: true });
}

/** Eine Erfassung löschen; ist danach nichts mehr da, geht die Bestandszeile mit. */
export async function erfassungLoeschen(art: ErfassungsArt, uid: number, id: number, keys: Schluessel) {
  const a = ARTEN[art];
  const besitzer = await besitzerDerZeile(art, id, uid);
  const menge = await withInventoryLock(besitzer, bestandsSchluessel(art, keys), async (tx) => {
    const acq = await zeileImSchreibfeld(tx, art, uid, id, keys);
    const ownerId = Number(acq.user_id);
    await repo.loescheErfassung(tx, art, id, ownerId);
    const q = await mengeDesBestands(tx, art, ownerId, keys);
    if ((q ?? 0) <= 0) await a.cleanupWhenEmpty(tx, ownerId, keys);
    return q;
  });
  return antwort(art, uid, keys, { success: true, new_quantity: menge ?? 0 });
}

/** Die Kaufpreise eines Sets im Blickfeld, je Zeile mit Besitzer. */
export function setErfassungen(blickfeld: number[], setNumber: string) {
  return repo.setErfassungenImBlickfeld(blickfeld, setNumber);
}
