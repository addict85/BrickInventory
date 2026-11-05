import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { meldeUndWeiter, fehlertext, logAndContinue, meldeUndLiefere } from '../infra/fehler';
import { scopeIds, writableIds } from '../haushalt/haushalt';
import { recordAcquisitionForDay } from '../bestand/acquisitions';
import { withInventoryLock } from '../../db/txLock';
import { downloadSetImage } from '../katalog/bilder/setImages';
import { getCurrentMarketPrice } from '../finanzen/marketPrice';
import { zustandFuerPreis, getSetting } from '../einstellungen/settings';
import { deleteSetRows } from './abfragen';
import { legeInPapierkorb } from '../bestand/papierkorb';
import { toCsv } from '../infra/csvExport';
import { getSetInfo } from '../katalog/rebrickableKatalog';
import { brickset, getItemImageUrl } from '../katalog/quellen';
import { generateThumb } from '../katalog/bilder/thumbs';
import { stelleAuftragEin } from '../auftraege/dienst';
import { normalisiereSetNummer, moeglicheSetNummer } from '../infra/setNummer';
import { fehlerWerfen, Meldung } from '../infra/fehlerTexte';
import { setzeLagerort, ortFuerNeuerfassung } from '../bestand/lagerort';
import { bestandsMenge } from '../infra/validate';
import { resolveSetCondition } from '../finanzen/financeCalc';
import * as repo from './repository/sets';

/** Sets anlegen, ändern und ausgeben — eine Umsetzung für Web und App, damit
 * beide dieselben Regeln für Menge, Kaufpreis und Blickfeld erfüllen. */

// `unknown`: Hier kommen Formularfelder und CSV-Zellen an, nicht garantierte
// Zeichenketten.
export function sanitizeSetNumber(input: unknown) {
  return normalisiereSetNummer(input);
}

/** Reihenfolge Preis-Cache → BrickLink → Historie; bleibt alles leer, trägt
 * jobs/purchasePriceBackfill.ts nach.
 * Ausführlich: docs/begruendungen/src/sets/setService.ts.md#pricefornewacquisition */
async function priceForNewAcquisition(userId: number, setNumber: string, dbh: DbSchnittstelle = db) {
  // Über das Blickfeld: Mit einer nackten ID fände der Hauptaccount das Set des
  // Unterkontos nicht.
  const blickfeld = await scopeIds(userId).catch(() => [userId]);
  const cond = await resolveSetCondition(blickfeld, setNumber, dbh);
  // Die Währung DES KONTOS: Der Preis wird in ihr gesucht und gespeichert.
  const currency = String(await getSetting(userId, 'currency', 'EUR'));
  const cached = await repo.marktpreisAusCache(dbh, setNumber, currency, cond).catch(meldeUndLiefere('set-service:cached', null));
  let pp = Number(cached?.avg_price ?? 0) || null;
  if (!pp) pp = await getCurrentMarketPrice(setNumber, userId, cond).catch(meldeUndLiefere('set-service:getCurrentMarketPrice', null));
  if (!pp) {
    // Der Verlauf füllt die Lücke, wenn Cache und BrickLink-Kontingent beim
    // CSV-Import leer ausgehen; sonst entstünde die Erfassung ohne Kaufpreis.
    const hist = await repo.marktpreisAusVerlauf(dbh, setNumber, currency, cond).catch(meldeUndLiefere('set-service:hist', null));
    pp = Number(hist?.avg_price ?? 0) || null;
  }
  return { price: pp, condition: cond, geschaetzt: pp != null, currency };
}

// Jede Erfassung ist eine Zeile in set_acquisitions — der einzige Ort für
// Kaufpreis und Zustand.
export async function recordAcquisition(userId: number, setNumber: string, quantity: number, purchasePrice: number | null, condition: string | null = null, dbh: DbSchnittstelle = db, geschaetzt = false,
                                 currency: string | null = null, createdAt: string | null = null) {
  const pp   = (purchasePrice !== null && purchasePrice !== undefined && !isNaN(purchasePrice)) ? purchasePrice : null;
  const cond = ['N','U'].includes(condition as string) ? condition : null;
  await recordAcquisitionForDay('set', userId, [setNumber],
    { quantity, price: pp, condition: cond || 'N', geschaetzt, currency, createdAt }, dbh);
}

/** @param pricePlan vorab ermittelt; ohne Angabe wird er hier geholt — dann
 *        darf dbh KEINE Transaktion sein, weil ein Netzaufruf darin steckt. */
async function adjustAcquisitionsToQuantity(userId: number, setNumber: string, newTotalQty: number, dbh: DbSchnittstelle = db,
                                            pricePlan: { price: number | null; condition: string; geschaetzt?: boolean; currency?: string } | null = null) {
  const rows: { id: number; quantity: number; created_at: Date }[] = await repo.setErfassungenNeuesteZuerst(dbh, userId, setNumber).catch(meldeUndLiefere('set-service:rows', []));
  const current = rows.reduce((sum: number, r: { quantity?: number | null }) => sum + (r.quantity || 0), 0);
  let delta = newTotalQty - current;
  if (delta === 0) return;
  if (delta > 0) {
    if (rows.length) {
      {
        // Aufstocken oder neue Tageszeile entscheidet recordAcquisitionForDay(), damit
        // die Regel nur einmal existiert.
        const plan = pricePlan ?? await priceForNewAcquisition(userId, setNumber, dbh);
        await recordAcquisition(userId, setNumber, delta, plan.price, plan.condition, dbh, !!plan.geschaetzt, plan.currency ?? null);
      }
    } else {
      const plan = pricePlan ?? await priceForNewAcquisition(userId, setNumber, dbh);
      await recordAcquisition(userId, setNumber, newTotalQty,
        plan.price, plan.condition || 'N', dbh, !!plan.geschaetzt, plan.currency ?? null);
    }
    return;
  }
  for (const r of rows) {
    if (delta === 0) break;
    const take = Math.min(r.quantity, -delta);
    if (take >= r.quantity) await repo.loescheSetErfassungNachId(dbh, r.id);
    else await repo.kuerzeSetErfassung(dbh, take, r.id);
    delta += take;
  }
}

/** `massenimport`: kein Brickset-Abruf und keine Nacharbeit je Set — die
 * Importschleife stellt sie selbst ein und schont so Pool und Tageskontingent. */
export interface ErfassenOptionen { massenimport?: boolean }

// Das Datum geht in DIESELBE Erfassung — ein nachträgliches UPDATE datierte
// einen fremden Kauf desselben Tages um.
export async function addSetWithDate(setNumber: string, quantity: number, userId: number, purchasePrice: number | null,
                              condition: string | null, acquiredAt: string | null) {
  return addSet(setNumber, quantity, userId, null, purchasePrice, condition, null, acquiredAt, { massenimport: true });
}

/** Der Lagerort kommt hier mit, damit jeder Weg (auch die Galerie) ihn wählen kann.
 * Ausführlich: docs/begruendungen/src/sets/setService.ts.md#addset */
export async function addSet(setNumber: string, quantity: number, userId: number,
                      sendProgress: ((n: { step: string; set: string }) => void) | null,
                      purchasePrice: number | null, condition: string | null = null,
                      storage: string | null = null, erfasstAm: string | null = null,
                      optionen: ErfassenOptionen = {}) {
  // Ohne Ort gilt der Vorgabeort des Kontos (CSV- und Wanted-Import haben keinen).
  const ort = await ortFuerNeuerfassung(userId, storage);
  const ergebnis = await addSetIntern(setNumber, quantity, userId, sendProgress, purchasePrice, condition, erfasstAm, optionen);
  if (ort && ergebnis?.set_number) {
    await setzeLagerort('set', [userId], [ergebnis.set_number], ort);
  }
  return ergebnis;
}

/** Nie Voraussetzung für die Antwort: Scheitert das Einstellen, ist das Set
 * trotzdem erfasst, und der Fehler steht im Protokoll. */
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

  // Einmal für beide Zweige, damit Neuanlage und Aufstocken nicht verschieden rechnen.
  const zustand = await zustandFuerPreis(condition, null, userId);

  const existing = await repo.setZeileDesKontos(userId, normalized);
  if (existing) {
    // Ohne Angabe gilt der Marktpreis des gewählten Zustands, geholt VOR der Sperre:
    // Ein Netzaufruf in der Sperre blockierte jeden anderen Schreiber.
    // Ausführlich: docs/begruendungen/src/sets/setService.ts.md#addsetintern-readdprice
    let reAddPrice: number | null = purchasePrice;
    const reAddGeschaetzt = reAddPrice === null || isNaN(reAddPrice);
    if (reAddGeschaetzt) {
      reAddPrice = await getCurrentMarketPrice(normalized, userId, zustand).catch(meldeUndLiefere('set-service:getCurrentMarketPrice', null));
    }

    // Gesperrt, weil recordAcquisitionForDay() erst liest und dann schreibt;
    // parallele Erfassungen verloren sonst Mengen.
    // Ausführlich: docs/begruendungen/src/sets/setService.ts.md#addsetintern
    await withInventoryLock(userId, normalized, async (tx) => {
      // Nur die Erfassung wird geschrieben; die Menge wird beim Lesen daraus
      // gerechnet (db/bestandsmenge.ts).
      await recordAcquisition(userId, normalized, quantity, reAddPrice, zustand, tx, reAddGeschaetzt, null, erfasstAm);
    });
    if (!massenimport) await nacharbeitEinstellen(normalized, userId, 'zweit');
    return { action:'updated', set_number:normalized };
  }

  let name: string | null = null, year: number | null = null, theme: string | null = null,
      pieces: number | null = null, minifigs: number | null = null, imageUrl: string | null = null;
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
  if (localImage) generateThumb(localImage).catch(logAndContinue('set-anlegen:vorschau'));
  // Kein Fang: Der Katalog ist die einzige Stelle mit Name, Jahr und Bild;
  // scheitert er, bricht das Erfassen mit der Meldung von Postgres ab.
  // Ausführlich: docs/begruendungen/src/sets/setService.ts.md#addsetintern-3
  await repo.merkeSetKatalog(normalized, name, year, theme||null, pieces, minifigs, imageUrl, localImage);

  const effectiveCondition = zustand;

  // Mit dem GEWÄHLTEN Zustand, sonst fiele getCurrentMarketPrice auf „Neu" zurück.
  let effectivePurchasePrice: number | null = purchasePrice;
  const preisGeschaetzt = effectivePurchasePrice === null || isNaN(effectivePurchasePrice);
  if (preisGeschaetzt) {
    effectivePurchasePrice = await getCurrentMarketPrice(normalized, userId, effectiveCondition);
  }
  // Gesperrt: Zwei gleichzeitige Erst-Erfassungen überschrieben sich sonst.
  await withInventoryLock(userId, normalized, async (tx) => {
    // Die Bestandszeile trägt nur, WER WIE VIELE hält; alles andere steht in
    // Erfassung und Katalog.
    await repo.legeSetZeileAn(tx, userId, normalized);
    await recordAcquisition(userId, normalized, quantity, effectivePurchasePrice, effectiveCondition, tx, preisGeschaetzt, null, erfasstAm);
  });

  if (minifigs) await repo.setzeFigurenzahl(minifigs, normalized);

  if (sendProgress) sendProgress({ step:'done_meta', set:normalized });
  if (!massenimport) await nacharbeitEinstellen(normalized, userId, 'neu');
  // katalog_offen: Keine Quelle hat geantwortet; die Oberfläche soll das sagen
  // statt eines schlichten „hinzugefügt".
  return { action:'added', set_number:normalized, name: name ?? `Set ${normalized}`, katalog_offen: !name };
}

/** Die LETZTE Erfassung, weil der Detail-Dialog genau sie bearbeitet.
 * @param feld  fester Spaltenname, KEINE Eingabe von aussen */
async function schreibeInLetzteErfassung(
  feld: 'purchase_price' | 'condition', wert: any, ownerId: number, sn: string,
) {
  await repo.schreibeInNeuesteSetErfassung(wert, ownerId, sn, feld);
}

export async function updateSet(uid: number, sn: string, body: any) {
  // SCHREIB-Blickfeld statt eigener ID, sonst fände ein Set des Unterkontos
  // keine Zeile.
  const _wids = await writableIds(uid);
  // Die EIGENE Zeile gewinnt, sonst entschiede die Tabellenreihenfolge.
  const existing = await repo.setZeileImSchreibfeld(_wids, sn, uid);
  if (!existing) throw new Meldung('Set nicht gefunden', 404);
  // Ab hier zählt der BESITZER, sonst entstünden Erfassungen im falschen Konto.
  const ownerId = parseInt(String(existing.user_id));

  const hatDelta = body.quantity_delta !== undefined && body.quantity_delta !== null;
  const hasQuantity = hatDelta || (body.quantity !== undefined && body.quantity !== null);
  let papierkorb: number | null = null;

  if (hasQuantity) {
    // Relativ, damit zwei gleichzeitige „+1" zwei ergeben statt sich zu überschreiben.
    const delta = hatDelta ? Number(body.quantity_delta) : null;
    if (delta !== null && (!Number.isInteger(delta) || Math.abs(delta) > 9999)) fehlerWerfen('wert_ungueltig', 400);
    const gewuenschtGesamt = delta === null ? bestandsMenge(body.quantity) : null;
    const leseFeld = await scopeIds(uid);
    // Angezeigt wird der Haushalt, geändert nur das eigene Konto.
    // Ausführlich: docs/begruendungen/src/sets/setService.ts.md#updateset-gewuenschtgesamt
    const eigenesZiel = async (dbh: Pick<typeof db, 'get'>) => {
      const gesamtVorher = await repo.setMenge(dbh, 'blickfeld', leseFeld, sn);
      const eigenVorher = await repo.setMenge(dbh, 'eines', uid, sn);
      // Bei 0 gedeckelt: Exemplare eines anderen Kontos kann ich nicht wegnehmen.
      const aenderung = delta ?? (Number(gewuenschtGesamt) - gesamtVorher);
      return { eigenVorher, eigenZiel: Math.max(0, eigenVorher + aenderung) };
    };
    // Der Marktpreis wird VOR der Sperre geholt (Netzaufruf); massgeblich ist die
    // Rechnung in der Sperre.
    const vorab = await eigenesZiel(db);
    const plan = vorab.eigenZiel > vorab.eigenVorher
      ? await priceForNewAcquisition(uid, sn).catch(() => ({ price: null, condition: 'N' }))
      : { price: null, condition: 'N' };
    await withInventoryLock(uid, sn, async (tx) => {
      const { eigenVorher, eigenZiel } = await eigenesZiel(tx);
      if (eigenZiel === eigenVorher) return;
      // Gehörte das Set bisher nur einem anderen Konto, liefe die Anpassung sonst ins Leere.
      if (eigenVorher === 0 && eigenZiel > 0)
        await repo.uebernimmSetZeile(tx, uid, leseFeld, sn);
      // Menge 0 geht durch den Papierkorb, damit ein Tippfehler sich zurückholen lässt.
      if (eigenZiel === 0) {
        papierkorb = await legeInPapierkorb(tx, 'set', uid, sn);
        await deleteSetRows(tx, [uid], sn);
      } else {
        await adjustAcquisitionsToQuantity(uid, sn, eigenZiel, tx, plan);
      }
    });
  }
  // Mit einer Mengenänderung schickt die App alten Preis und Zustand als Echo;
  // angewandt überschrieben sie den Marktpreis der neuen Erfassung.
  if (body.purchase_price !== undefined && !hasQuantity) {
    const raw = body.purchase_price;
    let pp = (raw === null || raw === '') ? null : parseFloat(raw);
    if (pp === null || isNaN(pp)) {
      // Zustand der LETZTEN Erfassung, sonst käme der Preis für „Neu".
      const lastCond = await repo.zustandNeuesteSetErfassung(ownerId, sn).catch(meldeUndLiefere('set-service:lastCond', null));
      pp = await getCurrentMarketPrice(sn, ownerId, lastCond?.condition || null);
    }
    const val = (pp !== null && !isNaN(pp)) ? pp : null;
    await schreibeInLetzteErfassung('purchase_price', val, ownerId, sn);
  }
  // null heisst „nicht gesetzt", nicht 'N'.
  if (body.condition !== undefined && body.condition !== null && !hasQuantity) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    try {
      // ownerId: Mit dem Aufrufer träfe das UPDATE beim Unterkonto keine Zeile.
      await schreibeInLetzteErfassung('condition', cond, ownerId, sn);
    } catch (e) {
      console.error('[updateSet] condition update skipped (migration pending?):', fehlertext(e));
    }
  }
  const nachher = await repo.setMenge(db, 'blickfeld', await scopeIds(uid), sn).catch(meldeUndLiefere('set-service:scopeIds', null));
  return { quantity: nachher ?? 0, ...(papierkorb ? { papierkorb } : {}) };
}


export async function buildSetsCsv(uid: number) {
  const rows = await repo.setsFuerCsv(uid);

  return toCsv(['set_number', 'quantity', 'purchase_price', 'condition', 'acquired_at'],
    rows.map((r: any) => ({ ...r, purchase_price: r.purchase_price ?? '' })));
}

