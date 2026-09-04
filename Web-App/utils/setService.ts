import * as db from '../db/database';
import { logAndContinue, meldeUndWeiter, fehlertext } from './httpError';
import { scopeIds, writableIds } from './household';
import { recordAcquisitionForDay } from './acquisitions';
import { withInventoryLock } from './txLock';
import { downloadSetImage } from './setImages';
import { getCurrentMarketPrice } from './marketPrice';
import { downloadSetInstructions } from './instructions';
import { zustandFuerPreis } from './settings';
import { deleteSetRows } from '../utils/handlers/sets';
import { toCsv } from './csvExport';
import { getSetInfo } from '../clients/rebrickable';
import * as brickset from '../clients/brickset';
import { getItemImageUrl } from '../clients/bricklink';
import { generateThumb } from '../routes/thumbs';
import * as nachErfassung from '../jobs/nachErfassung';

/**
 * Sets anlegen, ändern und ausgeben — der Kern hinter den Set-Routen.
 *
 * ── Warum das zuletzt kam (Nachtrag 131) ────────────────────────────────────
 *
 * `addSet` und `updateSet` blieben durch die Nachträge 125 bis 127 als einzige
 * in routes/sets.ts liegen, und der Grund war kein Zufall: Sie rufen
 * `importPartsForSet()` und `importMinifigsForSet()`, und die standen in
 * routes/parts.ts bzw. routes/minifigs.ts. Ein Modul unter utils/ hätte also
 * ROUTER importieren müssen — die falsche Richtung; utils/ ist die Schicht, auf
 * der Routen aufsetzen, nicht umgekehrt.
 *
 * Deshalb ging diesem Umzug ein zweiter voraus: die reine Katalogarbeit nach
 * utils/partsImport.ts und utils/minifigsImport.ts, und routes/bricklink.ts
 * (null Routen, nie montiert) nach clients/. Erst danach war dieser Schnitt
 * ohne Kreis möglich.
 *
 * Was hier steht, ist Ablaufsteuerung: Was passiert, wenn ein Set dazukommt
 * (Bild holen, Teile und Minifiguren übernehmen, Anleitung einreihen, Preis
 * anstossen) und was, wenn es sich ändert. Was NICHT hier steht, sind die
 * HTTP-Routen — die bleiben in routes/sets.ts und rufen von hier.
 */

// Setzt sets.condition konsistent aus den Erfassungen neu: "Gebraucht" sobald
// eine Erfassung U ist, sonst "Neu". Ohne Erfassungen bleibt der Wert
// unverändert. Wird nach jeder Mengen-/Erfassungsänderung aufgerufen, damit
// der denormalisierte Wert nicht veraltet (z. B. nach LIFO-Reduktion).
async function recomputeSetCondition(userId: number, setNumber: string, dbh: any = db) {
  const row = await dbh.get(
    "SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE condition='U') AS used FROM set_acquisitions WHERE user_id=$1 AND set_number=$2",
    [userId, setNumber]
  ).catch(() => null);
  if (!row || (parseInt(row.n) || 0) === 0) return;
  const cond = (parseInt(row.used) || 0) > 0 ? 'U' : 'N';
  // Ohne .catch(() => {}): Scheitert die Spiegelung, zeigt die Galerie-Kachel
  // dauerhaft den falschen Zustand — und der Aufrufer erführe nie davon.
  // Innerhalb einer Transaktion (dbh = tx) wäre es zusätzlich fatal: Postgres
  // bricht beim ersten Fehler ab, alle folgenden Statements laufen ins Leere.
  await dbh.run('UPDATE sets SET condition=$1 WHERE user_id=$2 AND set_number=$3', [cond, userId, setNumber]);
}

// `unknown`, weil der Rumpf mit String(input) genau das abfaengt — hier
// kommen Formularfelder und CSV-Zellen an, nicht garantierte Zeichenketten.
function sanitizeSetNumber(input: unknown) {
  // Bewusst OHNE den vorDem()-Helfer: Diese Funktion steht in zwei Fassungen
  // nebeneinander (ein Import baute einen Kreis, siehe oben), und
  // set-add-exists-db.test.js fuehrt ihren Rumpf ISOLIERT aus, um beide zu
  // vergleichen. Ein externer Aufruf darin waere dort nicht aufloesbar — der
  // Test hat das gemeldet, als ich es zuerst anders gemacht habe.
  let s = ((String(input).trim().split(';')[0] ?? '').trim().split(' ')[0] ?? '')
    .trim().replace(/[^a-zA-Z0-9-]/g, '');
  if (!/-\d+$/.test(s)) s = s + '-1';
  return s;
}

/**
 * Zustand und Kaufpreis für eine NEU entstehende Erfassung ermitteln.
 *
 * Reihenfolge: Preis-Cache im passenden Zustand → BrickLink → Historie.
 * Bleibt alles leer, trägt jobs/purchasePriceBackfill.ts es nach, sobald ein
 * Preis vorliegt.
 *
 * ── Warum das eine eigene Funktion ist ──────────────────────────────────────
 * Der mittlere Schritt (getCurrentMarketPrice) ist ein NETZAUFRUF. Er darf
 * nicht innerhalb einer Transaktion laufen — das hielte Sperre und
 * Datenbankverbindung sekundenlang, im Zweifel bis zum Zeitlimit von
 * BrickLink. Deshalb wird der Preis VOR dem Advisory-Lock ermittelt und der
 * Schreibphase als fertiger Wert übergeben; dasselbe Muster wie in
 * routes/api_v1/acquisitions.ts.
 *
 * Dass der Preis dabei ein paar Millisekunden alt ist, spielt keine Rolle —
 * es ist ein Marktpreis, kein Bestandswert.
 */
async function priceForNewAcquisition(userId: number, setNumber: string, dbh: any = db) {
  // ── Welcher Zustand? DIESELBE Regel wie ueberall sonst ───────────────────
  //
  // Hier stand `SELECT condition FROM sets` — also nur der GESPEICHERTE Wert.
  // Weicht er von den Erfassungen ab (genau der Fall, fuer den
  // effectiveCondition() gebaut wurde), bekam das neue Exemplar den falschen
  // Marktpreis. NACHGEMESSEN an einem Set mit sets.condition='N' und einer
  // Erfassung 'U', Marktpreis U=20 / N=100:
  //
  //     vorhandene Erfassung        U, Kaufpreis 10
  //     neue Erfassung durch "+1"   N, Kaufpreis 100   <- Neupreis fuer ein
  //                                                       gebrauchtes Set
  //
  // jobs/priceJob.ts (conditionsNeededFor) fragte an derselben Stelle schon
  // immer zuerst die Erfassungen. Jetzt beide ueber resolveSetCondition().
  //
  // Lazy require: utils/financeCalc auf Modulebene ergaebe einen Zyklus —
  // dasselbe Muster wie in utils/rateLimiter.ts.
  const { resolveSetCondition } = require('./financeCalc');
  const cond = await resolveSetCondition(userId, setNumber, dbh);
  const currRow = await dbh.get("SELECT value FROM global_settings WHERE key='currency'").catch(()=>null);
  const currency = currRow?.value || 'EUR';
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
  ).catch(()=>null);
  let pp = parseFloat(cached?.avg_price || 0) || null;
  if (!pp) pp = await getCurrentMarketPrice(setNumber, userId, cond).catch(()=>null);
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
    ).catch(() => null);
    pp = parseFloat(hist?.avg_price || 0) || null;
  }
  return { price: pp, condition: cond };
}

// ── Kaufpreis-Historie ────────────────────────────────────────────────────────
// Jede Erfassung (auch Re-Add desselben Sets) erzeugt eine Zeile in
// set_acquisitions. sets.purchase_price spiegelt den Preis der letzten Erfassung.
async function recordAcquisition(userId: number, setNumber: string, quantity: number, purchasePrice: number | null, condition: string | null = null, dbh: any = db) {
  // Der Zustand wurde von allen Aufrufern schon immer als 5. Argument
  // übergeben, aber bisher hier ignoriert (Signatur hatte nur 4 Parameter) —
  // neue Erfassungen bekamen dadurch nie den Set-Zustand, sondern den
  // Spalten-Default. Jetzt wird er mitgeschrieben.
  const pp   = (purchasePrice !== null && purchasePrice !== undefined && !isNaN(purchasePrice)) ? purchasePrice : null;
  const cond = ['N','U'].includes(condition as string) ? condition : null;
  // Kein Rückfall ohne condition mehr.
  //
  // Hier stand ein try/catch, das bei JEDEM Fehler ein zweites INSERT ohne die
  // condition-Spalte versuchte — gedacht für Installationen von vor der
  // Migration. initSchema() legt die Spalte inzwischen garantiert an
  // (db/database.ts, "Migration: set_acquisitions.condition"), der Zweig war
  // also toter Code.
  //
  // Er war ausserdem schädlich: Das catch fing nicht nur "Spalte fehlt", sondern
  // jeden Fehler ab — und seit die Aufrufer in einer Transaktion laufen
  // (utils/txLock.ts) hätte ein zweites Statement nach einem Fehler die bereits
  // abgebrochene Transaktion weiterbenutzt und den echten Grund verschluckt.
  // Pro Tag und Zustand EINE Erfassung (utils/acquisitions.ts).
  //
  // Vorher schrieb dieser Pfad bedingungslos eine neue Zeile — und stellte
  // damit genau den Zustand her, den der Datums-Endpunkt weiter unten ablehnt
  // („An diesem Datum existiert bereits ein Eintrag."). Zweimal dasselbe Set
  // am selben Tag ergab zwei Zeilen, die sich in nichts unterschieden.
  await recordAcquisitionForDay('set', userId, [setNumber],
    { quantity, price: pp, condition: cond || 'N' }, dbh);
}

/**
 * @param pricePlan vorab ermittelter Preis/Zustand (siehe
 *        priceForNewAcquisition). Ohne Angabe wird er hier geholt — dann darf
 *        dbh KEINE Transaktion sein, weil ein Netzaufruf darin steckt.
 */
async function adjustAcquisitionsToQuantity(userId: number, setNumber: string, newTotalQty: number, dbh: any = db,
                                            pricePlan: { price: number | null; condition: string } | null = null) {
  const rows = await dbh.all(
    'SELECT id, quantity, created_at FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY created_at DESC, id DESC',
    [userId, setNumber]).catch(() => []);
  const current = rows.reduce((sum: number, r: { quantity?: number | null }) => sum + (r.quantity || 0), 0);
  let delta = newTotalQty - current;
  if (delta === 0) return;
  if (delta > 0) {
    if (rows.length) {
      {
        // Aufstocken oder neue Tageszeile — beides entscheidet
        // recordAcquisitionForDay() (über recordAcquisition unten).
        //
        // Hier stand zuletzt eine eigene Tagesprüfung: Ist die NEUESTE
        // Erfassung von heute, Menge erhöhen, sonst neu anlegen. Zwei Dinge
        // waren daran falsch. Erstens war es die vierte Kopie derselben Regel.
        // Zweitens erhöhte der Zweig nur die Menge und liess den Kaufpreis
        // stehen — ein heute dazugekauftes Exemplar zum aktuellen Marktpreis
        // verschwand damit im alten Stückpreis. Der Helfer mittelt
        // mengengewichtet, wie überall sonst.
        //
        // Der Marktpreis wird deshalb IMMER ermittelt, nicht nur im
        // Neuanlage-Fall.
        const plan = pricePlan ?? await priceForNewAcquisition(userId, setNumber, dbh);
        await recordAcquisition(userId, setNumber, delta, plan.price, plan.condition, dbh);
      }
    } else {
      // ERSTE Erfassung dieses Kontos für das Set.
      //
      // Der Preis der sets-Zeile gilt als Vorgabe — das ist der Altfall, in dem
      // eine Zeile mit Kaufpreis, aber ohne Erfassungen existiert. Steht dort
      // keiner, MUSS der Marktpreis einspringen, sonst entsteht eine Erfassung
      // ohne Preis.
      //
      // Genau das passierte, seit die Mengenänderung auf das eigene Konto
      // schreibt (Nachtrag 85): Hält bisher nur ein anderes Konto das Set, wird
      // für das eigene eine frische Zeile ohne Kaufpreis angelegt — der Zweig
      // hier las sie und übergab null, obwohl der Aufrufer den Marktpreis
      // längst ermittelt hatte. Der Plan wurde schlicht ignoriert.
      const set = await dbh.get('SELECT purchase_price, condition FROM sets WHERE user_id=$1 AND set_number=$2', [userId, setNumber]);
      const plan = pricePlan ?? await priceForNewAcquisition(userId, setNumber, dbh);
      await recordAcquisition(userId, setNumber, newTotalQty,
        set?.purchase_price ?? plan.price, set?.condition || plan.condition || 'N', dbh);
    }
    await recomputeSetCondition(userId, setNumber, dbh);
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
  // Nach LIFO-Reduktion kann die letzte "Gebraucht"-Erfassung weggefallen sein
  // → Zustand aus den verbleibenden Erfassungen neu ableiten.
  await recomputeSetCondition(userId, setNumber, dbh);
}

// CSV import helper: add set with specific acquisition date (avoids duplicate acquisitions)
async function addSetWithDate(setNumber: string, quantity: number, userId: number, purchasePrice: number | null,
                              condition: string | null, acquiredAt: string | null) {
  // Always use addSet for the set metadata; then fix the acquisition date if provided
  const result = await addSet(setNumber, quantity, userId, null, purchasePrice, condition);
  if (acquiredAt && result) {
    // Update the most recently created acquisition to use the CSV date
    await db.run(
      `UPDATE set_acquisitions SET created_at=$1
       WHERE id=(SELECT id FROM set_acquisitions WHERE user_id=$2 AND set_number=$3
                 ORDER BY id DESC LIMIT 1)`,
      [acquiredAt, userId, result.set_number || setNumber]
    ).catch(logAndContinue(`sets:csv-datum ${setNumber}`));
  }
  return result;
}

/** `sendProgress` meldet Zwischenschritte an den SSE-Strom; null beim CSV-Import. */
async function addSet(setNumber: string, quantity: number, userId: number,
                      sendProgress: ((n: { step: string; set: string }) => void) | null,
                      purchasePrice: number | null, condition: string | null = null) {
  const normalized = sanitizeSetNumber(setNumber);
  if (sendProgress) sendProgress({ step:'meta', set:normalized });

  // Zustand EINMAL bestimmen, fuer BEIDE Zweige.
  //
  // Er stand vorher zweimal da, und die beiden Fassungen waren nicht gleich:
  // Der Neuanlage-Zweig rechnete `condition || userDefaultCondition(...)`, der
  // Aufstock-Zweig gab dem Preis `condition || null` (worauf getCurrentMarketPrice
  // intern denselben Standard einsetzte) und der ERFASSUNG hart `condition || 'N'`.
  //
  // Steht der Standard des Nutzers auf „Gebraucht", bekam eine Erfassung ohne
  // Zustandsangabe damit den Gebraucht-Preis, wurde aber als NEU verbucht. In
  // der Finanzansicht zaehlt sie danach in der falschen Gruppe.
  //
  // Es ist dieselbe Verwechslung wie in Nachtrag 68, nur andersherum: Damals
  // war der Preis falsch, hier der Vermerk. Die Staffelung steht seit dem
  // Zusammenlegen in utils/settings.ts.
  const zustand = await zustandFuerPreis(condition, null, userId);

  const existing = await db.get('SELECT id FROM sets WHERE user_id = $1 AND set_number = $2', [userId, normalized]);
  if (existing) {
    // Kaufpreis dieser Erfassung festhalten (ging früher verloren!) —
    // ohne Angabe aktuellen Marktpreis übernehmen, wie bei Neu-Erfassung.
    // Auch hier den gewählten Zustand mitgeben, sonst kommt der Neupreis.
    //
    // Der Marktpreis wird VOR der Sperre geholt: Das ist ein Netzaufruf, und
    // eine Sperre über einen Netzaufruf zu halten blockiert jeden anderen
    // Schreibvorgang auf diesem Set für die Dauer der Antwort.
    // purchasePrice ist number|null. NACHGEMESSEN: Es gibt genau drei
    // Importeure (routes/sets.ts, routes/api_v1/sets.ts, addSetWithDate), und
    // alle drei normalisieren vorher — V.optionalPrice() bzw. routes/sets.ts
    // Zeile 549 beim CSV-Import. Die frueheren Pruefungen auf '' und das
    // parseFloat verteidigten gegen eine Form, die hier nicht ankommt; der Typ
    // hat das sichtbar gemacht ("number und string haben keine Ueberschneidung").
    let reAddPrice: number | null = purchasePrice;
    if (reAddPrice === null || isNaN(reAddPrice)) {
      reAddPrice = await getCurrentMarketPrice(normalized, userId, zustand).catch(() => null);
    }

    // ── Menge und Erfassung GESPERRT schreiben ────────────────────────────
    //
    // Vorher standen die drei Schreibvorgänge ungesperrt nebeneinander, und
    // recordAcquisitionForDay() liest erst und schreibt dann. Zehn parallele
    // Erfassungen desselben Sets ergaben am laufenden Server: sets.quantity =
    // 10, aber drei Erfassungszeilen mit Summe 7 — drei verlorene Exemplare
    // und drei Tageszeilen, wo genau eine erlaubt ist. Alle anderen
    // Schreibwege (Mengenänderung, Verschieben, Eigentümerwechsel) hielten
    // diese Sperre längst; ausgerechnet das Erfassen nicht.
    await withInventoryLock(userId, normalized, async (tx) => {
      await tx.run('UPDATE sets SET quantity = quantity + $1 WHERE user_id = $2 AND set_number = $3', [quantity, userId, normalized]);
      await recordAcquisition(userId, normalized, quantity, reAddPrice, zustand, tx);
      // sets.purchase_price = Preis der letzten Erfassung (editierbar im Detail)
      if (reAddPrice !== null && !isNaN(reAddPrice)) {
        await tx.run('UPDATE sets SET purchase_price=$1 WHERE user_id=$2 AND set_number=$3',
          [reAddPrice, userId, normalized]);
      }
    });
    // During bulk CSV import, skip immediate background jobs to avoid DB pool exhaustion.
    // The import loop triggers enrichment after all sets are imported.
    //
    // Der Rumpf steht seit dem Herausziehen in jobs/nachErfassung.ts — als
    // anonymer Block im setTimeout war er in Tests nicht abfangbar und lief
    // dort echt, gegen einen meist schon geschlossenen Pool.
    if (!global._csvImportRunning) nachErfassung.zieheNach(normalized, userId);
    return { action:'updated', set_number:normalized };
  }

  // Ausgeschrieben, weil `let x = null` den Typ `null` ergibt und jede spätere
  // Zuweisung dann als Fehler gemeldet wird.
  let name: string | null = null, year: number | null = null, theme: string | null = null,
      pieces: number | null = null, minifigs: number | null = null, imageUrl: string | null = null;
  // Fetch from Rebrickable (primary) — never blocks import
  const rb = await getSetInfo(normalized).catch(() => null);
  if (rb) { name=rb.name; year=rb.year; theme=rb.theme; pieces=rb.pieces; imageUrl=rb.image_url; }

  // Fetch from Brickset (secondary) — enrich but never block import
  // Skip during CSV bulk import to preserve quota and reduce DB pool pressure
  let bsInfo: any = null;
  if (!global._csvImportRunning) {
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
  if (!name) name = `Set ${normalized}`;

  if (sendProgress) sendProgress({ step:'image', set:normalized });
  let localImage: any = null;
  try {
    const imgTimeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('Image timeout')),15000));
    localImage = await Promise.race([downloadSetImage(imageUrl, normalized), imgTimeout]);
  } catch (e) { meldeUndWeiter('set-anlegen:bild-laden', e); }
  // Generate thumbnail in background
  if(localImage){
    setImmediate(()=>generateThumb(localImage).catch(()=>{}));
    // Sync image_local to shared set_catalog
    db.run('UPDATE set_catalog SET image_local=$1 WHERE set_number=$2', [localImage, normalized]).catch(()=>{});
  }
  // Upsert into shared set_catalog
  await db.run('INSERT INTO set_catalog (set_number,name,year,theme,pieces,minifigs,image_url,image_local) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (set_number) DO UPDATE SET name=EXCLUDED.name,year=EXCLUDED.year,theme=EXCLUDED.theme,pieces=EXCLUDED.pieces,minifigs=EXCLUDED.minifigs,image_url=COALESCE(EXCLUDED.image_url,set_catalog.image_url),image_local=COALESCE(EXCLUDED.image_local,set_catalog.image_local),updated_at=NOW()',
    [normalized, name, year, theme||null, pieces, minifigs, imageUrl, localImage]).catch(()=>{});

  // Zustand: siehe oben, einmal fuer beide Zweige bestimmt.
  const effectiveCondition = zustand;

  // Kaufpreis: falls nicht angegeben, aktuellen Marktpreis (BrickLink) als
  // Kaufpreis hinterlegen — und zwar für den GEWÄHLTEN Zustand.
  //
  // Ohne den dritten Parameter fiel getCurrentMarketPrice auf den
  // Standardzustand des Nutzers zurück, also in aller Regel „Neu". Ein als
  // gebraucht erfasstes Set bekam dadurch den Neupreis als Kaufpreis
  // eingetragen — im gemeldeten Fall 55 statt 33 CHF.
  // wie oben: purchasePrice kommt normalisiert als number|null herein
  let effectivePurchasePrice: number | null = purchasePrice;
  if (effectivePurchasePrice === null || isNaN(effectivePurchasePrice)) {
    effectivePurchasePrice = await getCurrentMarketPrice(normalized, userId, effectiveCondition);
  }
  // Wie oben gesperrt: Zwei gleichzeitige Erst-Erfassungen desselben Sets
  // laufen sonst beide durch den ON-CONFLICT-Zweig, während ihre Erfassungen
  // sich gegenseitig überschreiben.
  await withInventoryLock(userId, normalized, async (tx) => {
    await tx.run('INSERT INTO sets (user_id,set_number,name,year,theme,pieces,minifigs,quantity,image_url,image_local,purchase_price,condition) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (user_id,set_number) DO UPDATE SET quantity=sets.quantity+EXCLUDED.quantity,name=COALESCE(EXCLUDED.name,sets.name),updated_at=NOW()',
      [userId, normalized, name, year, theme||null, pieces, minifigs, quantity, imageUrl, localImage, effectivePurchasePrice, effectiveCondition]);
    await recordAcquisition(userId, normalized, quantity, effectivePurchasePrice, effectiveCondition, tx);
  });

  if (minifigs) await db.run('UPDATE sets SET minifigs = $1 WHERE user_id = $2 AND set_number = $3', [minifigs, userId, normalized]);

  // Kein 'instructions'-Schritt mehr an die Oberfläche: Der Download läuft
  // eine Zeile tiefer in einem setImmediate() und damit NACH der Antwort. Der
  // Dialog zeigte dadurch einen Punkt, der auf „aktiv" sprang und nie fertig
  // wurde. Der Hinweis auf die Hintergrundarbeit steht jetzt fest im Dialog.
  // Skip instructions during CSV bulk import — instructionQueue handles it after
  if (!global._csvImportRunning) {
    setImmediate(() => downloadSetInstructions(normalized).catch(()=>{}));
  }

  if (sendProgress) sendProgress({ step:'done_meta', set:normalized });
  // All heavy work in background — don't block the response
  // Rumpf in jobs/nachErfassung.ts — dort steht er neben dem Nachzug des
  // Zweiterfassungs-Zweigs, und der Unterschied zwischen beiden ist damit an
  // einer Stelle zu sehen statt vierzig Zeilen auseinander.
  if (!global._csvImportRunning) nachErfassung.zieheNachNeuanlage(normalized, userId);
  return { action:'added', set_number:normalized, name };
}

// Shared logic to update a set's quantity and/or Kaufpreis. Used by both the
// session-based web route (PUT /api/sets/:setNumber) and the token-based API
// (PUT /api/v1/sets/:setNumber), so the behaviour is implemented exactly once.
/**
 * @returns {{quantity:number}} die Gesamtmenge des Blickfelds NACH der Änderung
 *   — die Oberfläche soll ihre eigene Annahme daran richten können. Wird eine
 *   Verringerung bei 0 gedeckelt (fremde Exemplare lassen sich nicht
 *   wegnehmen), steht hier eine andere Zahl als die gesendete.
 */
// `uid` ist eine EINZELNE ID, kein Blickfeld: Zeile darunter vergleicht
// `user_id = $3` damit, und scopeIds(uid) verlangt eine Zahl. Das Blickfeld
// wird im Rumpf daraus berechnet (_wids, leseFeld).
/**
 * Einen Wert auf die sets-Zeile UND die letzte Erfassung schreiben.
 *
 * ── Warum das eine Funktion ist ─────────────────────────────────────────────
 * Kaufpreis und Zustand machen in updateSet dieselbe Bewegung: erst die
 * sets-Zeile, dann die Erfassung, die der Detail-Dialog definitionsgemaess
 * bearbeitet (die neueste). Es waren zwei Abschriften — und die zweite hatte
 * ein anderes Konto eingesetzt.
 *
 * NACHGEMESSEN, Set und Erfassung gehoeren dem UNTERKONTO, geaendert wird
 * vom Hauptkonto:
 *
 *     vorher                       sets: N/10   erfassung: N/10
 *     nach Preis 99 (Hauptkonto)   sets: N/99   erfassung: N/99
 *     nach Zustand U (Hauptkonto)  sets: N/99   erfassung: N/99
 *
 * Der Preis kam an, der Zustand verschwand still: Der Zustands-Zweig schrieb
 * `WHERE user_id = <Aufrufer>`, und das trifft keine Zeile. Kein Fehler, kein
 * Hinweis — updateSet meldete Erfolg.
 *
 * Das bleibt nicht bei der Plakette: effectiveCondition() entscheidet, zu
 * welchem Zustand der Marktpreis geholt wird. Ein Set, das der Haushalt als
 * gebraucht fuehrt, wurde weiter als neu bewertet.
 *
 * `ownerId`, nicht der Aufrufer — die Regel steht in updateSet ausdrueckllich
 * ueber dieser Stelle („ab hier zaehlt der BESITZER der Zeile"). Der
 * Mengen-Zweig weicht bewusst davon ab (Marcos Vorgabe: angezeigt wird der
 * Haushalt, geaendert wird das eigene Konto) — deshalb geht der nicht hier
 * durch.
 *
 * @param feld  fester Spaltenname, KEINE Eingabe von aussen
 */
async function spiegleAufSetUndLetzteErfassung(
  feld: 'purchase_price' | 'condition', wert: any, ownerId: number, sn: string,
) {
  await db.run(`UPDATE sets SET ${feld} = $1 WHERE user_id = $2 AND set_number = $3`,
    [wert, ownerId, sn]);
  await db.run(`UPDATE set_acquisitions SET ${feld} = $1
                 WHERE id = (SELECT id FROM set_acquisitions
                              WHERE user_id=$2 AND set_number=$3
                              ORDER BY created_at DESC, id DESC LIMIT 1)`,
    [wert, ownerId, sn]);
}

async function updateSet(uid: number, sn: string, body: any) {
  // SCHREIB-Blickfeld statt eigener ID (Nachtrag 52, Marcos Bericht: „Wenn die
  // Anzahl eines Sets erhöht wird, das einem Unterkonto gehört, funktioniert
  // die ganze Logik mit dem Kaufpreis nicht und die Anzahl wird nicht
  // gespeichert").
  //
  // Die Suche lief gegen `user_id = eigene ID` und lieferte für jedes Set des
  // Unterkontos 404 — auf BEIDEN Wegen, auch in der Webapp. Dieselbe Klasse
  // wie die Erfassungsroute aus Nachtrag 45; dort war es der Kaufpreis, hier
  // die Menge. Und weil die Mengenänderung über adjustAcquisitionsToQuantity()
  // auch Erfassungen anlegt und Preise setzt, blieb gleich die ganze Kette
  // wirkungslos.
  //
  // writableIds() ist bewusst enger als scopeIds(): Ein Unterkonto darf nicht
  // rückwärts in das Hauptkonto schreiben.
  const _wids = await writableIds(uid);
  // Die EIGENE Zeile gewinnt, wenn mehrere Konten das Set halten.
  //
  // Vorher nahm db.get() irgendeine — welche, entschied die Reihenfolge in der
  // Tabelle. Daran hingen zwei sichtbare Merkwürdigkeiten: Die Detailansicht
  // zeigte die Menge eines fremden Kontos (Marcos „Anzahl 0"), und eine
  // Preisänderung landete mal hier, mal dort.
  const existing = await db.get(
    `SELECT id, user_id FROM sets WHERE user_id = ANY($1) AND set_number=$2
      ORDER BY (user_id = $3) DESC, id ASC LIMIT 1`, [_wids, sn, uid]);
  if (!existing) { const e = Object.assign(new Error('Set nicht gefunden'), { status: 404 }); throw e; }
  // Ab hier zählt der BESITZER der Zeile — sonst legt die Mengenanpassung
  // Erfassungen im falschen Konto an.
  const ownerId = parseInt(String(existing.user_id));

  const hasQuantity = body.quantity !== undefined && body.quantity !== null;

  if (hasQuantity) {
    // ── Menge und Erfassungen gehören zusammen ─────────────────────────────
    //
    // Vorher standen hier zwei lose Statements: UPDATE sets … und danach
    // adjustAcquisitionsToQuantity(…).catch(() => {}). Beides ohne
    // Transaktion, ohne Sperre und mit verschlucktem Fehler. Scheiterte der
    // zweite Schritt, blieb sets.quantity erhöht, während die Erfassungen auf
    // dem alten Stand standen — der Drift, den utils/txLock.ts beschreibt,
    // nur eben stillschweigend und ohne Logzeile.
    //
    // Der Marktpreis wird VOR der Sperre geholt (Netzaufruf, siehe
    // priceForNewAcquisition); innerhalb läuft nur noch Datenbankarbeit.
    // ── Angezeigt wird der HAUSHALT, geändert wird das EIGENE Konto ────────
    //
    // Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden. Wenn
    // ich diese erhöhe, soll es für meinen Account einen neuen Kaufpreis-
    // Eintrag erstellen. Analog der bestehenden Logik."
    //
    // Die Zahl im Formular ist also die Gesamtmenge des Haushalts. Was davon
    // geschrieben wird, ist die DIFFERENZ, und die geht auf das eigene Konto —
    // nicht auf das, dessen Zeile die Abfrage zufällig zuerst fand. Vorher
    // erhöhte ein „+" auf einem Set des Unterkontos dessen Bestand, und die
    // neue Erfassung entstand in einem fremden Konto.
    //
    // „Analog der bestehenden Logik" heisst wörtlich: dieselbe Funktion.
    // adjustAcquisitionsToQuantity() legt die Erfassung an, holt den
    // Marktpreis über priceForNewAcquisition() und beachtet die Tagesregel —
    // alles unverändert, nur mit dem eigenen Konto als Ziel.
    const gewuenschtGesamt = parseInt(body.quantity) || 0;
    const leseFeld = await scopeIds(uid);
    const gesamtVorher = (await db.get(
      `SELECT COALESCE(SUM(quantity),0)::int q FROM sets WHERE user_id = ANY($1) AND set_number=$2`,
      [leseFeld, sn]))?.q ?? 0;
    const eigenVorher = (await db.get(
      `SELECT COALESCE(SUM(quantity),0)::int q FROM sets WHERE user_id = $1 AND set_number=$2`,
      [uid, sn]))?.q ?? 0;
    // Nach unten bei 0 gedeckelt: Die Exemplare eines anderen Kontos sind
    // nicht meine, ich kann sie nicht wegnehmen. Die Antwort trägt die
    // tatsächliche Gesamtmenge zurück, damit die Oberfläche nicht eine Zahl
    // stehen lässt, die es nicht gibt.
    const eigenZiel = Math.max(0, eigenVorher + (gewuenschtGesamt - gesamtVorher));

    if (eigenZiel !== eigenVorher) {
      // Eigene Zeile anlegen, falls das Set bisher nur einem anderen Konto
      // gehörte — sonst liefe die Mengenanpassung ins Leere.
      if (eigenVorher === 0 && eigenZiel > 0) {
        await db.run(
          `INSERT INTO sets (user_id, set_number, name, year, theme, pieces, minifigs,
                             image_url, image_local, quantity, condition)
           SELECT $1, set_number, name, year, theme, pieces, minifigs,
                  image_url, image_local, 0, condition
             FROM sets WHERE user_id = ANY($2) AND set_number = $3
            ORDER BY id ASC LIMIT 1
           ON CONFLICT DO NOTHING`, [uid, leseFeld, sn])
          // Scheitert dieses INSERT, trifft das UPDATE zwei Zeilen weiter NULL
          // Zeilen — die Mengenaenderung geht verloren, waehrend
          // adjustAcquisitionsToQuantity() trotzdem Erfassungen schreibt. Der
          // Kommentar oben nennt genau diese Gefahr; still verschluckt werden
          // darf sie deshalb nicht.
          .catch(logAndContinue(`sets:eigene Zeile anlegen ${sn}`));
      }
      // Der Marktpreis wird VOR der Sperre geholt (Netzaufruf); innerhalb
      // läuft nur noch Datenbankarbeit.
      const plan = await priceForNewAcquisition(uid, sn).catch(() => ({ price: null, condition: 'N' }));
      await withInventoryLock(uid, sn, async (tx) => {
        await tx.run('UPDATE sets SET quantity = $1 WHERE user_id = $2 AND set_number = $3', [eigenZiel, uid, sn]);
        await adjustAcquisitionsToQuantity(uid, sn, eigenZiel, tx, plan);
        // Bleibt nichts übrig, verschwindet die eigene Zeile ganz — dieselbe
        // Regel wie beim Löschen des letzten Kaufpreises (Nachtrag 84), sonst
        // entstünde hier wieder ein Eintrag mit Menge 0.
        if (eigenZiel === 0) {
          await deleteSetRows(tx, [uid], sn);
        }
      });
    }
  }
  // Eine Mengenänderung ist quantity-ONLY: adjustAcquisitionsToQuantity() legt
  // bereits eine neue Erfassung mit dem korrekten Marktpreis (und dem bisherigen
  // Zustand) an. Die Android-Detailansicht schickt beim +/- zusätzlich den ALTEN
  // Set-Kaufpreis und condition:null mit — beides sind Echos, keine gewollten
  // Änderungen. Würden wir sie anwenden, überschriebe der purchase_price-Zweig
  // den Marktpreis der neuen Erfassung und der condition-Zweig setzte alles auf
  // 'N' zurück. Deshalb: purchase_price/condition nur ohne gleichzeitige
  // Mengenänderung auswerten.
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
          ORDER BY created_at DESC, id DESC LIMIT 1`, [ownerId, sn]).catch(() => null);
      pp = await getCurrentMarketPrice(sn, ownerId, lastCond?.condition || null);
    }
    const val = (pp !== null && !isNaN(pp)) ? pp : null;
    // Der Detail-Dialog editiert definitionsgemäss die LETZTE Erfassung.
    await spiegleAufSetUndLetzteErfassung('purchase_price', val, ownerId, sn);
  }
  // condition === null bedeutet "nicht gesetzt" (nicht auf 'N' zwingen), und
  // während einer Mengenänderung ist ein mitgeschicktes condition ein Echo.
  if (body.condition !== undefined && body.condition !== null && !hasQuantity) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    try {
      // ownerId, nicht uid: Hier stand der Aufrufer, und damit traf das
      // UPDATE bei einem Set des Unterkontos keine Zeile.
      await spiegleAufSetUndLetzteErfassung('condition', cond, ownerId, sn);
    } catch (e) {
      console.error('[updateSet] condition update skipped (migration pending?):', fehlertext(e));
    }
  }
  // Die Gesamtmenge des Blickfelds NACH der Änderung — siehe Kopfkommentar.
  const nachher = await db.get(
    `SELECT COALESCE(SUM(quantity),0)::int q FROM sets WHERE user_id = ANY($1) AND set_number=$2`,
    [await scopeIds(uid), sn]).catch(() => null);
  return { quantity: nachher?.q ?? 0 };
}

// Shared logic to build the Sets CSV export content. Used by both the
// standalone CSV download and the combined ZIP export in settings.js.
// Eine Zeile pro Erfassung, damit Kaufpreis, Zustand und Datum je Kauf erhalten
// bleiben und beim Re-Import 1:1 wiederhergestellt werden. Sets ohne Erfassungen
// fallen auf die Set-Zeile zurück.
//
// ── Warum ein LEFT JOIN und keine Schleife ──────────────────────────────────
// Vorher lief hier eine Abfrage JE SET. Bei 700 Sets waren das 701 Hin- und
// Rückwege zur Datenbank; jeder einzelne war schnell, die Summe nicht. Der
// Export ist die Stelle, an der ein Nutzer am ehesten den GANZEN Bestand
// anfasst — also genau die, an der sich das am stärksten auswirkt.
//
// Der LEFT JOIN erzeugt dieselben Zeilen: zu jedem Set entweder eine je
// Erfassung oder, wenn es keine gibt, genau eine mit NULL-Erfassungsspalten.
//
// ── Die Falle dabei ─────────────────────────────────────────────────────────
// Die naheliegende Formulierung `COALESCE(a.purchase_price, s.purchase_price)`
// wäre FALSCH: Zu einer vorhandenen Erfassung OHNE Preis gehört ein leeres
// Feld, nicht der Preis der Set-Zeile. Entschieden wird deshalb an `a.id IS
// NULL` — also daran, OB es eine Erfassung gibt, nicht daran, ob ihre Werte
// gefüllt sind. csv-export-acquisitions-db.test.js prüft genau diesen Fall.
const SETS_CSV_SQL = `
  SELECT s.set_number,
         CASE WHEN a.id IS NULL THEN s.quantity       ELSE a.quantity       END AS quantity,
         CASE WHEN a.id IS NULL THEN s.purchase_price ELSE a.purchase_price END AS purchase_price,
         COALESCE(CASE WHEN a.id IS NULL THEN s.condition ELSE a.condition END, 'N') AS condition,
         CASE WHEN a.id IS NULL THEN ''
              ELSE TO_CHAR(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') END AS acquired_at
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
  const rows = await db.all(SETS_CSV_SQL, [uid]).catch(() => null)
    ?? await db.all(
      `SELECT set_number, quantity, purchase_price, COALESCE(condition,'N') AS condition,
              '' AS acquired_at
         FROM sets WHERE user_id=$1 ORDER BY set_number ASC`, [uid]);

  return toCsv(['set_number', 'quantity', 'purchase_price', 'condition', 'acquired_at'],
    rows.map((r: any) => ({ ...r, purchase_price: r.purchase_price ?? '' })));
}

export { addSet, updateSet, buildSetsCsv, recordAcquisition, sanitizeSetNumber, addSetWithDate };
