/**
 * Fachdienst Erfassungen: Ändern, Verschieben und Löschen eines Kaufpreises
 * für Sets, manuelle Teile und manuelle Figuren. Eine Regel für drei Arten,
 * damit Webapp und App nicht auseinanderlaufen.
 */
import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { writableIds, acquisitionMoveSource, resolveWriteTarget } from '../../src/haushalt/haushalt';
import { findSameDayAcquisition, erfassungsTagSql } from '../acquisitions';
import { meldeUndLiefere } from '../../src/infra/httpError';
import { withInventoryLock, bestandsSchluessel } from '../../db/txLock';
import { moveSetBetweenAccounts, moveManualAcquisition } from '../setMove';
import { getCurrentMarketPrice, getCurrentPartMarketPrice, getCurrentFigMarketPrice } from '../marketPrice';
import { deleteSetRows, withSetAggregate } from '../handlers/sets';
import { loescheManuellesTeil, loescheManuelleFigur } from '../handlers/shared';
import { fehlerWerfen } from '../../src/infra/fehlerTexte';
import type { FehlerCode } from '../../src/infra/fehlerTexte';
import { blAbrufNummer } from '../blZuordnung';
import { mengeDesSets, mengeDerPosition } from '../bestandsmenge';
import { bestandsMenge } from '../../src/infra/validate';

export type ErfassungsArt = 'set' | 'part' | 'fig';
type Schluessel = Array<string | number>;

interface Art {
  table: string;
  priceCol: 'purchase_price' | 'unit_price';
  /** $1 = id, $2 = Schreib-Blickfeld, bei Sets $3 = Setnummer. */
  existsSql: string;
  existsWithKeys: boolean;
  notFound: FehlerCode;
  /** Marktpreis, wenn der Preis geleert wird — im Zustand dieser Zeile. */
  resolvePrice: (uid: number, keys: Schluessel, cond: string | null) => Promise<number | null>;
  /** Aufräumen, wenn nach dem Löschen keine Erfassung mehr übrig ist. */
  cleanupWhenEmpty: (tx: DbSchnittstelle, ownerId: number, keys: Schluessel) => Promise<unknown>;
}

const ARTEN: Record<ErfassungsArt, Art> = {
  set: {
    table: 'set_acquisitions', priceCol: 'purchase_price',
    existsSql: `SELECT id, user_id, condition, purchase_price AS preis, price_estimated, currency, (${erfassungsTagSql()})::text AS tag FROM set_acquisitions WHERE id=$1 AND user_id = ANY($2) AND set_number=$3`,
    existsWithKeys: true, notFound: 'erfassung_nicht_gefunden',
    resolvePrice: (uid, [sn], cond) => getCurrentMarketPrice(String(sn), uid, cond || null),
    // Dieselben Zeilen wie beim ausdrücklichen Löschen: Teile und Figuren des
    // Sets stünden sonst ohne Set in Teileliste und Finanzsummen.
    cleanupWhenEmpty: (tx, ownerId, [sn]) => deleteSetRows(tx, [ownerId], String(sn)),
  },
  part: {
    table: 'part_acquisitions', priceCol: 'unit_price',
    existsSql: `SELECT id, user_id, condition, unit_price AS preis, price_estimated, currency, (${erfassungsTagSql()})::text AS tag FROM part_acquisitions WHERE id=$1 AND user_id = ANY($2)`,
    existsWithKeys: false, notFound: 'nicht_gefunden',
    resolvePrice: (uid, [pn, cid], cond) => getCurrentPartMarketPrice(String(pn), Number(cid), uid, cond),
    // Nur die manuelle Position; Set-Teile gehen mit ihrem Set.
    cleanupWhenEmpty: (tx, ownerId, [pn, cid]) => loescheManuellesTeil(tx, ownerId, String(pn), Number(cid)),
  },
  fig: {
    table: 'minifig_acquisitions', priceCol: 'unit_price',
    existsSql: `SELECT id, user_id, condition, unit_price AS preis, price_estimated, currency, (${erfassungsTagSql()})::text AS tag FROM minifig_acquisitions WHERE id=$1 AND user_id = ANY($2)`,
    existsWithKeys: false, notFound: 'nicht_gefunden',
    resolvePrice: async (uid, [fn], cond) =>
      getCurrentFigMarketPrice(String(fn), uid, await blAbrufNummer('fig', String(fn)), cond),
    cleanupWhenEmpty: (tx, ownerId, [fn]) => loescheManuelleFigur(tx, ownerId, String(fn)),
  },
};

interface Zeile { id: number; user_id: number; condition: string | null; preis: number | null; price_estimated: boolean; currency: string; tag: string }

/** Besitzer einer Erfassung für den Sperrschlüssel; die Rechte prüft danach die Abfrage im Schreib-Blickfeld. */
async function besitzerDerZeile(table: string, id: number, fallback: number): Promise<number> {
  const r = await db.get<{ user_id: number }>(`SELECT user_id FROM ${table} WHERE id = $1`, [id]);
  return r ? Number(r.user_id) : fallback;
}

/** Stückzahl der Bestandszeile aus den Erfassungen: Zahl, 0 („leer“) oder null („keine Zeile“). */
function mengeDesBestands(tx: DbSchnittstelle, art: ErfassungsArt, ownerId: number, keys: Schluessel) {
  return art === 'set'
    ? mengeDesSets(ownerId, String(keys[0]), tx).catch(meldeUndLiefere('erfassungen:mengeDesSets', null))
    : mengeDerPosition(art, ownerId, keys, tx).catch(meldeUndLiefere('erfassungen:mengeDerPosition', null));
}

/** Sucht die Zeile im Schreib-Blickfeld: Ein Unterkonto darf nicht rückwärts schreiben. */
async function zeileImSchreibfeld(tx: DbSchnittstelle, a: Art, uid: number, id: number, keys: Schluessel): Promise<Zeile> {
  const wids = await writableIds(uid);
  const z = await tx.get<Zeile>(a.existsSql, a.existsWithKeys ? [id, wids, ...keys] : [id, wids]);
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
  const rawPrice = body[a.priceCol];

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
      const condRow = condition ? null : await db.get<{ condition: string }>(`SELECT condition FROM ${a.table} WHERE id=$1`, [id])
        .catch(meldeUndLiefere('erfassungen:zustand', undefined));
      p = await a.resolvePrice(uid, keys, String(condition || condRow?.condition || '') || null)
        .catch(meldeUndLiefere('erfassungen:resolvePrice', null));
    }
    priceVal = (p !== null && !isNaN(p)) ? p : null;
  }

  const besitzer = await besitzerDerZeile(a.table, id, uid);
  await withInventoryLock(besitzer, bestandsSchluessel(art, keys), async (tx) => {
    const acq = await zeileImSchreibfeld(tx, a, uid, id, keys);
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
      await tx.run(`UPDATE ${a.table} SET quantity=$1 WHERE id=$2`, [bestandsMenge(quantity, 1), id]);
      const q = await mengeDesBestands(tx, art, ownerId, keys);
      if ((q ?? 0) <= 0) await a.cleanupWhenEmpty(tx, ownerId, keys);
    }
    if (rawPrice !== undefined)
      await tx.run(`UPDATE ${a.table} SET ${a.priceCol}=$1, price_estimated=$2 WHERE id=$3`, [priceVal, zielGeschaetzt, id]);
    if (hatZustand)
      await tx.run(`UPDATE ${a.table} SET condition=$1 WHERE id=$2`, [zielZustand, id]);
    if (neuesDatum)
      await tx.run(`UPDATE ${a.table} SET created_at=$1::date + interval '12 hours', tag=$1::date WHERE id=$2`, [neuesDatum, id]);
  });
  return antwort(art, uid, keys, { success: true });
}

/** Eine Erfassung löschen; ist danach nichts mehr da, geht die Bestandszeile mit. */
export async function erfassungLoeschen(art: ErfassungsArt, uid: number, id: number, keys: Schluessel) {
  const a = ARTEN[art];
  const besitzer = await besitzerDerZeile(a.table, id, uid);
  const menge = await withInventoryLock(besitzer, bestandsSchluessel(art, keys), async (tx) => {
    const acq = await zeileImSchreibfeld(tx, a, uid, id, keys);
    const ownerId = Number(acq.user_id);
    await tx.run(`DELETE FROM ${a.table} WHERE id=$1 AND user_id=$2`, [id, ownerId]);
    const q = await mengeDesBestands(tx, art, ownerId, keys);
    if ((q ?? 0) <= 0) await a.cleanupWhenEmpty(tx, ownerId, keys);
    return q;
  });
  return antwort(art, uid, keys, { success: true, new_quantity: menge ?? 0 });
}

/** Die Kaufpreise eines Sets im Blickfeld, je Zeile mit Besitzer. */
export function setErfassungen(blickfeld: number[], setNumber: string) {
  return db.all(
    `SELECT id, quantity, purchase_price, COALESCE(condition, 'N') AS condition, price_estimated, currency,
            created_at, user_id AS owner_user_id FROM set_acquisitions
      WHERE user_id = ANY($1) AND set_number=$2 ORDER BY created_at ASC, id ASC`, [blickfeld, setNumber]);
}
