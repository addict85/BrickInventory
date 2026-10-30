import * as db from '../db/database';
import type { DbSchnittstelle } from '../db/database';
import { meldeUndWeiter, fehlertext, logAndContinue, meldeUndLiefere } from './httpError';
import { scopeIds, writableIds } from './household';
import { recordAcquisitionForDay, erfassungsTagSql } from './acquisitions';
import { withInventoryLock } from './txLock';
import { downloadSetImage } from './setImages';
import { getCurrentMarketPrice } from './marketPrice';
import { zustandFuerPreis, getSetting } from './settings';
import { deleteSetRows } from '../utils/handlers/sets';
import { legeInPapierkorb } from './papierkorb';
import { toCsv } from './csvExport';
import { getSetInfo } from '../clients/rebrickable';
import * as brickset from '../clients/brickset';
import { getItemImageUrl } from '../clients/bricklink';
import { generateThumb } from './thumbs';
import { stelleAuftragEin } from './auftraege';
import { normalisiereSetNummer, moeglicheSetNummer } from './setNummer';
import { fehlerWerfen } from './fehlerTexte';
import { setzeLagerort, ortFuerNeuerfassung } from './lagerort';
import { mengeSummeSql } from './bestandsmenge';
import { bestandsMenge } from './validate';
import { resolveSetCondition } from './financeCalc';

/**
 * Sets anlegen, ändern und ausgeben — der Kern hinter den Set-Routen.
 * Ausführlich: docs/begruendungen/utils/setService.ts.md#abschnitt
 */

// recomputeSetCondition() stand hier: Sie leitete den Zustand aus den
// Erfassungen ab und spiegelte ihn nach sets.condition. Mit Migration 0032 ist
// die Spalte weg — damit entfällt nicht nur die Spiegelung, sondern auch der
// Grund, sie nach jeder Mengenänderung aufzufrischen. Wer den Zustand braucht,
// leitet ihn beim Lesen ab (utils/finance/zustand.ts, effectiveCondition).

// `unknown`, weil der Rumpf mit String(input) genau das abfaengt — hier
// kommen Formularfelder und CSV-Zellen an, nicht garantierte Zeichenketten.
function sanitizeSetNumber(input: unknown) {
  return normalisiereSetNummer(input);
}

/**
 * Zustand und Kaufpreis für eine NEU entstehende Erfassung ermitteln.
 * Ausführlich: docs/begruendungen/utils/setService.ts.md#pricefornewacquisition
 */
async function priceForNewAcquisition(userId: number, setNumber: string, dbh: DbSchnittstelle = db) {
  // Der Zustand kommt wie im Preis-Job aus den Erfassungen
  // (resolveSetCondition), und zwar über das Blickfeld: Mit einer nackten ID
  // fände der Hauptaccount das Set des Unterkontos nicht.
  // Ausführlich: docs/begruendungen/utils/setService.ts.md#pricefornewacquisition-blickfeld
  const blickfeld = await scopeIds(userId).catch(() => [userId]);
  const cond = await resolveSetCondition(blickfeld, setNumber, dbh);
  // Die Währung DES KONTOS: Der Preis wird in ihr gesucht und mit ihr
  // gespeichert. Hier stand ein globaler Schlüssel, den es nie gibt — also
  // immer EUR, und ein EUR-Betrag landete als CHF-Kaufpreis.
  const currency = String(await getSetting(userId, 'currency', 'EUR'));
  const cached = await dbh.get(
    // Fallback zwischen den Zuständen, aber mit der richtigen Priorität:
    // Der angefragte Zustand gewinnt IMMER, wenn er einen Preis hat. Der
    // andere kommt nur zum Zug, wenn dort keiner steht (avg_price > 0
    // filtert leere Einträge vorher raus). Genau umgekehrt war es der
    // gemeldete Fehler: „hat einen Preis" schlug „passender Zustand".
    `SELECT avg_price FROM price_cache
     WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND avg_price > 0
     ORDER BY (condition = $3) DESC LIMIT 1`,
    [setNumber, currency, cond]
  ).catch(meldeUndLiefere('set-service:cached', null));
  let pp = parseFloat(cached?.avg_price || 0) || null;
  if (!pp) pp = await getCurrentMarketPrice(setNumber, userId, cond).catch(meldeUndLiefere('set-service:getCurrentMarketPrice', null));
  if (!pp) {
    // Beim CSV-Import ist das Set oft noch nicht im Preis-Cache, und der
    // BrickLink-Abruf darüber scheitert bei vielen Sets am Tageskontingent.
    // Die Erfassung entstand dann OHNE Kaufpreis — und der Marktpreis
    // erschien später trotzdem, sobald der Preis-Job den Cache füllte. Das
    // erklärt die gemeldete Abweichung.
    const hist = await dbh.get(
      `SELECT avg_price FROM price_history
        WHERE set_number=$1 AND currency_code=$2 AND condition IN ('N','U') AND avg_price > 0
        ORDER BY (condition = $3) DESC, recorded_at DESC LIMIT 1`,
      [setNumber, currency, cond]
    ).catch(meldeUndLiefere('set-service:hist', null));
    pp = parseFloat(hist?.avg_price || 0) || null;
  }
  return { price: pp, condition: cond, geschaetzt: pp != null, currency };
}

// ── Kaufpreis-Historie ────────────────────────────────────────────────────────
// Jede Erfassung (auch Re-Add desselben Sets) erzeugt eine Zeile in
// set_acquisitions. Das ist seit Migration 0032 der einzige Ort für Kaufpreis
// und Zustand — die Spiegelung nach sets.purchase_price/condition ist weg.
async function recordAcquisition(userId: number, setNumber: string, quantity: number, purchasePrice: number | null, condition: string | null = null, dbh: DbSchnittstelle = db, geschaetzt = false,
                                 currency: string | null = null, createdAt: string | null = null) {
  // Der Zustand wurde von allen Aufrufern schon immer als 5. Argument
  // übergeben, aber bisher hier ignoriert (Signatur hatte nur 4 Parameter) —
  // neue Erfassungen bekamen dadurch nie den Set-Zustand, sondern den
  // Spalten-Default. Jetzt wird er mitgeschrieben.
  const pp   = (purchasePrice !== null && purchasePrice !== undefined && !isNaN(purchasePrice)) ? purchasePrice : null;
  const cond = ['N','U'].includes(condition as string) ? condition : null;
  // Kein Rückfall ohne condition mehr.
  // Ausführlich: docs/begruendungen/utils/setService.ts.md#recordacquisition
  await recordAcquisitionForDay('set', userId, [setNumber],
    { quantity, price: pp, condition: cond || 'N', geschaetzt, currency, createdAt }, dbh);
}

/**
 * @param pricePlan vorab ermittelter Preis/Zustand (siehe
 *        priceForNewAcquisition). Ohne Angabe wird er hier geholt — dann darf
 *        dbh KEINE Transaktion sein, weil ein Netzaufruf darin steckt.
 */
async function adjustAcquisitionsToQuantity(userId: number, setNumber: string, newTotalQty: number, dbh: DbSchnittstelle = db,
                                            pricePlan: { price: number | null; condition: string; geschaetzt?: boolean; currency?: string } | null = null) {
  const rows: { id: number; quantity: number; created_at: Date }[] = await dbh.all(
    'SELECT id, quantity, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at DESC, id DESC',
    [userId, setNumber]).catch(meldeUndLiefere('set-service:rows', []));
  const current = rows.reduce((sum: number, r: { quantity?: number | null }) => sum + (r.quantity || 0), 0);
  let delta = newTotalQty - current;
  if (delta === 0) return;
  if (delta > 0) {
    if (rows.length) {
      {
        // Aufstocken oder neue Tageszeile — beides entscheidet
        // recordAcquisitionForDay() (über recordAcquisition unten).
        // Ausführlich: docs/begruendungen/utils/setService.ts.md#adjustacquisitionstoquantity-plan
        const plan = pricePlan ?? await priceForNewAcquisition(userId, setNumber, dbh);
        await recordAcquisition(userId, setNumber, delta, plan.price, plan.condition, dbh, !!plan.geschaetzt, plan.currency ?? null);
      }
    } else {
      // ERSTE Erfassung dieses Kontos für das Set.
      // Ausführlich: docs/begruendungen/utils/setService.ts.md#adjustacquisitionstoquantity-plan-2
      const plan = pricePlan ?? await priceForNewAcquisition(userId, setNumber, dbh);
      await recordAcquisition(userId, setNumber, newTotalQty,
        plan.price, plan.condition || 'N', dbh, !!plan.geschaetzt, plan.currency ?? null);
    }
    return;
  }
  // Reduktion: LIFO
  for (const r of rows) {
    if (delta === 0) break;
    const take = Math.min(r.quantity, -delta);
    if (take >= r.quantity) await dbh.run('DELETE FROM set_acquisitions WHERE id=$1', [r.id]);
    else await dbh.run('UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2', [take, r.id]);
    delta += take;
  }
  // Hier stand recomputeSetCondition(): Nach einer LIFO-Reduktion kann die
  // letzte „Gebraucht"-Erfassung weggefallen sein, und der gespiegelte Wert in
  // sets.condition wäre veraltet. Die Spalte gibt es seit Migration 0032 nicht
  // mehr — die verbleibenden Erfassungen SIND der Zustand.
}

/**
 * Wie ein Aufruf erfasst. `massenimport` (CSV-Import): kein Brickset-Abruf und
 * keine Nacharbeit je Set — die Importschleife stellt sie selbst ein und schont
 * so Pool und Tageskontingent. Das gilt nur für diesen Aufruf, nie für andere.
 */
export interface ErfassenOptionen { massenimport?: boolean }

// CSV-Import: Das Datum geht in DIESELBE Erfassung, die angelegt wird — kein
// nachträgliches UPDATE, das einen fremden Kauf desselben Tages umdatiert.
async function addSetWithDate(setNumber: string, quantity: number, userId: number, purchasePrice: number | null,
                              condition: string | null, acquiredAt: string | null) {
  return addSet(setNumber, quantity, userId, null, purchasePrice, condition, null, acquiredAt, { massenimport: true });
}

/**
 * Ein Set erfassen — mit Lagerort, wenn einer mitkommt.
 * Ausführlich: docs/begruendungen/utils/setService.ts.md#addset
 */
async function addSet(setNumber: string, quantity: number, userId: number,
                      sendProgress: ((n: { step: string; set: string }) => void) | null,
                      purchasePrice: number | null, condition: string | null = null,
                      storage: string | null = null, erfasstAm: string | null = null,
                      optionen: ErfassenOptionen = {}) {
  // Ohne mitgegebenen Ort gilt der Vorgabeort des Kontos (CSV- und
  // Wanted-Import haben kein Lagerortfeld).
  const ort = await ortFuerNeuerfassung(userId, storage);
  const ergebnis = await addSetIntern(setNumber, quantity, userId, sendProgress, purchasePrice, condition, erfasstAm, optionen);
  if (ort && ergebnis?.set_number) {
    await setzeLagerort('set', [userId], [ergebnis.set_number], ort);
  }
  return ergebnis;
}

/**
 * Die Nacharbeit eines Sets als Auftrag; ein gleicher offener Auftrag genügt.
 * Sie ist nie Voraussetzung für die Antwort: Scheitert das Einstellen, ist das
 * Set trotzdem erfasst, und der Fehler steht im Protokoll.
 */
export async function nacharbeitEinstellen(setNumber: string, userId: number, art: 'zweit' | 'neu' | 'csv') {
  await stelleAuftragEin('nacharbeit', { set_number: setNumber, user_id: userId, art },
    { userId, schluessel: `nacharbeit:${userId}:${setNumber}`, maxVersuche: 3 })
    .catch(logAndContinue(`set-anlegen:nacharbeit ${setNumber}`));
}

async function addSetIntern(setNumber: string, quantity: number, userId: number,
                      sendProgress: ((n: { step: string; set: string }) => void) | null,
                      purchasePrice: number | null, condition: string | null = null,
                      erfasstAm: string | null = null, optionen: ErfassenOptionen = {}) {
  const massenimport = optionen.massenimport === true;
  const normalized = sanitizeSetNumber(setNumber);
  if (!moeglicheSetNummer(normalized)) fehlerWerfen('setnummer_ungueltig', 400);
  if (sendProgress) sendProgress({ step:'meta', set:normalized });

  // Zustand EINMAL bestimmen, fuer BEIDE Zweige.
  // Ausführlich: docs/begruendungen/utils/setService.ts.md#addsetintern-zustand
  const zustand = await zustandFuerPreis(condition, null, userId);

  const existing = await db.get('SELECT id FROM sets WHERE user_id = $1 AND set_number = $2', [userId, normalized]);
  if (existing) {
    // Kaufpreis dieser Erfassung festhalten (ging früher verloren!) —
    // ohne Angabe aktuellen Marktpreis übernehmen, wie bei Neu-Erfassung.
    // Auch hier den gewählten Zustand mitgeben, sonst kommt der Neupreis.
    // Ausführlich: docs/begruendungen/utils/setService.ts.md#addsetintern-readdprice
    let reAddPrice: number | null = purchasePrice;
    const reAddGeschaetzt = reAddPrice === null || isNaN(reAddPrice);
    if (reAddGeschaetzt) {
      reAddPrice = await getCurrentMarketPrice(normalized, userId, zustand).catch(meldeUndLiefere('set-service:getCurrentMarketPrice', null));
    }

    //  Menge und Erfassung GESPERRT schreiben
    // Ausführlich: docs/begruendungen/utils/setService.ts.md#addsetintern
    await withInventoryLock(userId, normalized, async (tx) => {
      // Erst die Erfassung, dann die Menge daraus
      // Jetzt schreibt nur noch die Erfassung. Die Menge ist seit Migration
      // 0036 keine Spalte mehr — sie wird beim LESEN aus den Erfassungen
      // gerechnet (utils/bestandsmenge.ts).
      // Ausführlich: docs/begruendungen/utils/setService.ts.md#addsetintern-2
      await recordAcquisition(userId, normalized, quantity, reAddPrice, zustand, tx, reAddGeschaetzt, null, erfasstAm);
    });
    if (!massenimport) await nacharbeitEinstellen(normalized, userId, 'zweit');
    return { action:'updated', set_number:normalized };
  }

  // Ausgeschrieben, weil `let x = null` den Typ `null` ergibt und jede spätere
  // Zuweisung dann als Fehler gemeldet wird.
  let name: string | null = null, year: number | null = null, theme: string | null = null,
      pieces: number | null = null, minifigs: number | null = null, imageUrl: string | null = null;
  // Fetch from Rebrickable (primary) — never blocks import
  const rb = await getSetInfo(normalized).catch(meldeUndLiefere('set-service:getSetInfo', null));
  if (rb) { name=rb.name; year=rb.year; theme=rb.theme; pieces=rb.pieces; imageUrl=rb.image_url; }

  // Brickset ergänzt, blockiert aber nie; beim Massenimport holt es die Nacharbeit.
  let bsInfo: Awaited<ReturnType<typeof brickset.getSetInfo>> = null;
  if (!massenimport) {
    try {
      bsInfo = await brickset.getSetInfo(normalized);
    } catch (e) { meldeUndWeiter('set-anlegen:brickset-info', e); }
    if (bsInfo) {
      if (!name) name=bsInfo.name; if (!year) year=bsInfo.year;
      if (!theme) theme=bsInfo.theme; if (!pieces) pieces=bsInfo.pieces;
      if (!minifigs) minifigs=bsInfo.minifigs; if (!imageUrl) imageUrl=bsInfo.image_url;
    }
  }
  if (!imageUrl) imageUrl = getItemImageUrl(normalized);

  if (sendProgress) sendProgress({ step:'image', set:normalized });
  let localImage: string | null = null;
  try {
    const imgTimeout = new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error('Image timeout')),15000).unref());
    localImage = await Promise.race([downloadSetImage(imageUrl, normalized), imgTimeout]);
  } catch (e) { meldeUndWeiter('set-anlegen:bild-laden', e); }
  // Die Vorschau entsteht nebenher; image_local schreibt der Katalog-Upsert unten.
  if (localImage) generateThumb(localImage).catch(logAndContinue('set-anlegen:vorschau'));
  // Der Katalog ist die einzige Stelle mit Name, Jahr und Bild — darum kein
  // Fang: Scheitert das, bricht das Erfassen mit der Meldung von Postgres ab.
  // Ohne Antwort der Quellen bleibt stehen, was der Katalog schon weiss.
  // Ausführlich: docs/begruendungen/utils/setService.ts.md#addsetintern-3
  await db.run(`INSERT INTO set_catalog (set_number,name,year,theme,pieces,minifigs,image_url,image_local)
                VALUES ($1, COALESCE($2, 'Set ' || $1), $3,$4,$5,$6,$7,$8)
                ON CONFLICT (set_number) DO UPDATE SET
                  name = COALESCE($2, set_catalog.name), year = COALESCE($3, set_catalog.year),
                  theme = COALESCE($4, set_catalog.theme), pieces = COALESCE($5, set_catalog.pieces),
                  minifigs = COALESCE($6, set_catalog.minifigs),
                  image_url = COALESCE($7, set_catalog.image_url),
                  image_local = COALESCE($8, set_catalog.image_local), updated_at = NOW()`,
    [normalized, name, year, theme||null, pieces, minifigs, imageUrl, localImage]);

  // Zustand: siehe oben, einmal fuer beide Zweige bestimmt.
  const effectiveCondition = zustand;

  // Ohne Kaufpreis gilt der Marktpreis des GEWÄHLTEN Zustands; ohne ihn fiele
  // getCurrentMarketPrice auf „Neu“ zurück, und ein gebrauchtes Set bekäme den
  // Neupreis.
  let effectivePurchasePrice: number | null = purchasePrice;
  const preisGeschaetzt = effectivePurchasePrice === null || isNaN(effectivePurchasePrice);
  if (preisGeschaetzt) {
    effectivePurchasePrice = await getCurrentMarketPrice(normalized, userId, effectiveCondition);
  }
  // Wie oben gesperrt: Zwei gleichzeitige Erst-Erfassungen desselben Sets
  // laufen sonst beide durch den ON-CONFLICT-Zweig, während ihre Erfassungen
  // sich gegenseitig überschreiben.
  await withInventoryLock(userId, normalized, async (tx) => {
    // Die Bestandszeile traegt nur noch, WER WIE VIELE haelt.
    // Ausführlich: docs/begruendungen/utils/setService.ts.md#addsetintern-4
    await tx.run('INSERT INTO sets (user_id,set_number) VALUES ($1,$2) ON CONFLICT (user_id,set_number) DO NOTHING',
      [userId, normalized]);
    await recordAcquisition(userId, normalized, quantity, effectivePurchasePrice, effectiveCondition, tx, preisGeschaetzt, null, erfasstAm);
  });

  // In den Katalog, nicht an die Bestandszeile (Migration 0033). Und ohne
  // user_id: Die Teilezahl eines Sets ist in jedem Konto dieselbe.
  if (minifigs) await db.run('UPDATE set_catalog SET minifigs = $1 WHERE set_number = $2', [minifigs, normalized]);

  if (sendProgress) sendProgress({ step:'done_meta', set:normalized });
  // Anleitung, Teile, Figuren und Bilder holt der Auftrag (jobs/nachErfassung.ts).
  if (!massenimport) await nacharbeitEinstellen(normalized, userId, 'neu');
  // katalog_offen: Weder Rebrickable noch Brickset haben geantwortet. Das Set
  // ist gespeichert, Name und Bild zieht die Nacharbeit nach — die Oberfläche
  // soll das sagen statt eines schlichten „hinzugefügt“.
  return { action:'added', set_number:normalized, name: name ?? `Set ${normalized}`, katalog_offen: !name };
}

/**
 * Menge und Kaufpreis eines Sets ändern — eine Umsetzung für Web und App.
 * `uid` ist eine einzelne ID; das Blickfeld entsteht im Rumpf.
 * @returns die Gesamtmenge des Blickfelds NACH der Änderung: Eine bei 0
 *   gedeckelte Verringerung (fremde Exemplare) ergibt eine andere Zahl als die
 *   gesendete, und die Oberfläche richtet ihre Annahme daran.
 */

/**
 * Einen Wert in die LETZTE Erfassung schreiben — die, die der Detail-Dialog
 * definitionsgemaess bearbeitet.
 * Ausführlich: docs/begruendungen/utils/setService.ts.md#schreibeinletzteerfassung
 * @param feld  fester Spaltenname, KEINE Eingabe von aussen
 */
async function schreibeInLetzteErfassung(
  feld: 'purchase_price' | 'condition', wert: any, ownerId: number, sn: string,
) {
  await db.run(`UPDATE set_acquisitions SET ${feld} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [wert, ownerId, sn]);
}

async function updateSet(uid: number, sn: string, body: any) {
  // SCHREIB-Blickfeld statt eigener ID (Marcos Bericht: „Wenn die
  // Anzahl eines Sets erhöht wird, das einem Unterkonto gehört, funktioniert
  // die ganze Logik mit dem Kaufpreis nicht und die Anzahl wird nicht
  // gespeichert").
  // Ausführlich: docs/begruendungen/utils/setService.ts.md#updateset-wids
  const _wids = await writableIds(uid);
  // Die EIGENE Zeile gewinnt, wenn mehrere Konten das Set halten — sonst
  // entschiede die Tabellenreihenfolge, wessen Menge und Preis gilt.
  const existing = await db.get(
    `SELECT id, user_id FROM sets WHERE user_id = ANY($1) AND set_number=$2
      ORDER BY (user_id = $3) DESC, id ASC LIMIT 1`, [_wids, sn, uid]);
  if (!existing) { const e = Object.assign(new Error('Set nicht gefunden'), { status: 404 }); throw e; }
  // Ab hier zählt der BESITZER der Zeile — sonst legt die Mengenanpassung
  // Erfassungen im falschen Konto an.
  const ownerId = parseInt(String(existing.user_id));

  const hatDelta = body.quantity_delta !== undefined && body.quantity_delta !== null;
  const hasQuantity = hatDelta || (body.quantity !== undefined && body.quantity !== null);
  let papierkorb: number | null = null;

  if (hasQuantity) {
    // quantity_delta ändert relativ: Zwei Geräte, die gleichzeitig „+1"
    // tippen, ergeben +2. Eine absolute Menge (quantity) aus einem veralteten
    // Stand überschriebe den anderen Zugang.
    const delta = hatDelta ? Number(body.quantity_delta) : null;
    if (delta !== null && (!Number.isInteger(delta) || Math.abs(delta) > 9999)) fehlerWerfen('wert_ungueltig', 400);
    const gewuenschtGesamt = delta === null ? bestandsMenge(body.quantity) : null;
    const leseFeld = await scopeIds(uid);
    //  Angezeigt wird der HAUSHALT, geändert wird das EIGENE Konto
    // Ausführlich: docs/begruendungen/utils/setService.ts.md#updateset-gewuenschtgesamt
    const eigenesZiel = async (dbh: Pick<typeof db, 'get'>) => {
      const gesamtVorher = (await dbh.get(mengeSummeSql('blickfeld'), [leseFeld, sn]))?.q ?? 0;
      const eigenVorher = (await dbh.get(mengeSummeSql('eines'), [uid, sn]))?.q ?? 0;
      // Nach unten bei 0 gedeckelt: Die Exemplare eines anderen Kontos sind
      // nicht meine, ich kann sie nicht wegnehmen.
      const aenderung = delta ?? (Number(gewuenschtGesamt) - gesamtVorher);
      return { eigenVorher, eigenZiel: Math.max(0, eigenVorher + aenderung) };
    };
    // Der Marktpreis wird VOR der Sperre geholt (Netzaufruf). Ob er gebraucht
    // wird, sagt ein Blick vorab; massgeblich ist die Rechnung in der Sperre.
    const vorab = await eigenesZiel(db);
    const plan = vorab.eigenZiel > vorab.eigenVorher
      ? await priceForNewAcquisition(uid, sn).catch(() => ({ price: null, condition: 'N' }))
      : { price: null, condition: 'N' };
    await withInventoryLock(uid, sn, async (tx) => {
      const { eigenVorher, eigenZiel } = await eigenesZiel(tx);
      if (eigenZiel === eigenVorher) return;
      // Eigene Zeile anlegen, falls das Set bisher nur einem anderen Konto
      // gehörte — sonst liefe die Mengenanpassung ins Leere.
      // Ausführlich: docs/begruendungen/utils/setService.ts.md#updateset
      if (eigenVorher === 0 && eigenZiel > 0)
        await tx.run(
          `INSERT INTO sets (user_id, set_number)
           SELECT $1, set_number
             FROM sets WHERE user_id = ANY($2) AND set_number = $3
            ORDER BY id ASC LIMIT 1
           ON CONFLICT DO NOTHING`, [uid, leseFeld, sn]);
      // Menge 0 ist ein Löschen und geht deshalb durch den Papierkorb wie
      // der Löschknopf — ein Tippfehler im Mengenfeld soll sich
      // zurückholen lassen.
      if (eigenZiel === 0) {
        papierkorb = await legeInPapierkorb(tx, 'set', uid, sn);
        await deleteSetRows(tx, [uid], sn);
      } else {
        // Die Erfassungen SIND die Menge (utils/bestandsmenge.ts).
        await adjustAcquisitionsToQuantity(uid, sn, eigenZiel, tx, plan);
      }
    });
  }
  // Mit einer Mengenänderung schickt die App den ALTEN Kaufpreis und
  // condition:null als Echo mit. Angewandt überschrieben sie den Marktpreis
  // der neuen Erfassung; Preis und Zustand gelten deshalb nur ohne Menge.
  if (body.purchase_price !== undefined && !hasQuantity) {
    // Leerer Wert (null/'') => aktuellen Marktpreis als Kaufpreis übernehmen
    // (gleiche Logik wie beim Erfassen eines neuen Sets); ein Zahlenwert überschreibt ihn direkt.
    const raw = body.purchase_price;
    let pp = (raw === null || raw === '') ? null : parseFloat(raw);
    if (pp === null || isNaN(pp)) {
      // Zustand der LETZTEN Erfassung heranziehen — genau die wird unten
      // aktualisiert. Ohne ihn kam der Preis für den Standardzustand des
      // Nutzers, also meist „Neu", auch bei einem gebrauchten Set.
      const lastCond = await db.get(
        `SELECT condition FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2
          ORDER BY created_at DESC, id DESC LIMIT 1`, [ownerId, sn]).catch(meldeUndLiefere('set-service:lastCond', null));
      pp = await getCurrentMarketPrice(sn, ownerId, lastCond?.condition || null);
    }
    const val = (pp !== null && !isNaN(pp)) ? pp : null;
    // Der Detail-Dialog editiert definitionsgemäss die LETZTE Erfassung.
    await schreibeInLetzteErfassung('purchase_price', val, ownerId, sn);
  }
  // condition === null bedeutet "nicht gesetzt" (nicht auf 'N' zwingen), und
  // während einer Mengenänderung ist ein mitgeschicktes condition ein Echo.
  if (body.condition !== undefined && body.condition !== null && !hasQuantity) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    try {
      // ownerId, nicht uid: Hier stand der Aufrufer, und damit traf das
      // UPDATE bei einem Set des Unterkontos keine Zeile.
      await schreibeInLetzteErfassung('condition', cond, ownerId, sn);
    } catch (e) {
      console.error('[updateSet] condition update skipped (migration pending?):', fehlertext(e));
    }
  }
  // Die Gesamtmenge des Blickfelds NACH der Änderung — siehe Kopfkommentar.
  const nachher = await db.get(
    // Aus den Erfassungen (Migration 0036) — siehe die Begruendung bei
    // setQuantity weiter oben.
    mengeSummeSql('blickfeld'),
    [await scopeIds(uid), sn]).catch(meldeUndLiefere('set-service:scopeIds', null));
  return { quantity: nachher?.q ?? 0, ...(papierkorb ? { papierkorb } : {}) };
}

// Shared logic to build the Sets CSV export content. Used by both the
// standalone CSV download and the combined ZIP export in settings.js.
// Eine Zeile pro Erfassung, damit Kaufpreis, Zustand und Datum je Kauf erhalten
// bleiben und beim Re-Import 1:1 wiederhergestellt werden. Sets ohne Erfassungen …
// Ausführlich: docs/begruendungen/utils/setService.ts.md#sets-csv-sql
const SETS_CSV_SQL = `
  SELECT s.set_number,
         -- Hier stand CASE WHEN a.id IS NULL THEN s.quantity ELSE a.quantity.
         -- (Keine Gegenstriche: Der Kommentar steht in einem Template-Literal.)
         -- Der Rueckfall auf die Set-Zeile ist weg: Migration 0036 hat die
         -- Spalte geloescht, und Migration 0032 garantiert fuer jede Set-Zeile
         -- eine Erfassung. Der LEFT JOIN bleibt, damit ein Export an einer
         -- unerwarteten Lage nicht ganz ausfaellt.
         -- COALESCE(..., 0) und nicht NULL: Eine Set-Zeile ohne Erfassung
         -- bedeutet null Exemplare — dieselbe Lesart wie in
         -- utils/bestandsmenge.ts (mengeAus mit 0). Ein leeres Feld im Export
         -- hiesse „keine Angabe", und das ist eine andere Aussage.
         COALESCE(a.quantity, 0) AS quantity,
         a.purchase_price AS purchase_price,
         COALESCE(a.condition, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(${erfassungsTagSql('a')}, 'YYYY-MM-DD') END AS acquired_at
    FROM sets s
    LEFT JOIN set_acquisitions a
           ON a.user_id = s.user_id AND a.set_number = s.set_number
   WHERE s.user_id = $1
   ORDER BY s.set_number ASC, a.created_at ASC, a.id ASC`;

async function buildSetsCsv(uid: number) {
  // Der Rückfallweg bewahrt, was das frühere `.catch(() => [])` je Set leistete:
  // Fehlt set_acquisitions (Migration noch nicht gelaufen), kam dort weiterhin
  // die Set-Zeile heraus. Ein JOIN würde stattdessen die GANZE Abfrage
  // abbrechen — der Export lieferte gar nichts mehr.
  // Ausführlich: docs/begruendungen/utils/setService.ts.md#buildsetscsv-rows
  const rows = await db.all(SETS_CSV_SQL, [uid]);

  return toCsv(['set_number', 'quantity', 'purchase_price', 'condition', 'acquired_at'],
    rows.map((r: any) => ({ ...r, purchase_price: r.purchase_price ?? '' })));
}

export { addSet, updateSet, buildSetsCsv, recordAcquisition, sanitizeSetNumber, addSetWithDate };
