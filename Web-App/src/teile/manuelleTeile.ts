/**
 * Manuell erfasste Teile: Anlegen, Ändern, Farbliste und Erfassungen. Hier und
 * nicht in routes/parts.ts, weil die Sitzungsroute und die v1-Fabrik beide
 * darauf zugreifen — eine Route soll keine andere importieren.
 */
import { meldeUndLiefere, fehlertext } from '../infra/httpError';
import { csvGemeinsameFelder, csvZeilenAusAnfrage } from '../infra/csvExport';
import * as db from '../../db/database';
import { recordAcquisitionForDay } from '../bestand/acquisitions';
import { mengenwunsch, passeManuelleMengeAn } from '../bestand/manuelleMenge';
import * as repo from './repository/manuelleTeile';
import { kaufpreisAusEingabe, manuellerKaufpreis } from '../finanzen/preisRegel';
import { zustandFuerPreis } from '../konto/settings';
import { resolvePartCondition, marktpreisMitHerkunft, getCurrentPartMarketPrice } from '../finanzen/marketPrice';
import { lookupPart } from '../../clients/rebrickable';
import { farbliste, KEINE_FARBE } from '../katalog/farben';
import { setzeLagerort, ortFuerNeuerfassung } from '../bestand/lagerort';
import { merkeTeil, merkeTeilFarbe, katalogTeil } from '../katalog/katalogPflege';
import * as V0 from '../infra/validate';

/** Farbauswahl beim Erfassen; Quelle und Notliste stehen in src/katalog/farben.ts. */
export const getPartColorList = farbliste;

/**
 * Preis/Stk, Kaufpreis und Zustand fuer ein manuell erfasstes Teil.
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#resolvemanualpartpurchase
 */
export async function resolveManualPartPurchase(uid: number, { partNumber, colorId, unitPrice = null, condition = null }:
  { partNumber: string; colorId: number; unitPrice?: any; condition?: string | null }) {
  // Die Regel steht in src/finanzen/preisRegel.ts — dort auch, warum ohne Marktpreis
  // eine 0 in der Stammzeile steht und NULL in der Erfassung. Hier bleibt nur,
  // was ein TEIL anders macht als eine Figur: der Schluessel der Abfrage.
  const r = await manuellerKaufpreis(uid, { unitPrice, condition },
    (zustand) => marktpreisMitHerkunft(partNumber, colorId, uid, zustand));
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    // Aus welchem Zustand der uebernommene Marktpreis stammt —
    // null, wenn es nichts zu kennzeichnen gibt.
    preisAusZustand: r.preisAusZustand,
    geschaetzt: r.geschaetzt,
  };
}

// Shared logic to add/update a single manual part. Used by both the
// session-based web route (POST /api/parts) and the token-based API
// (POST /api/v1/parts), so the behaviour (incl. Kaufpreis handling) is
// implemented exactly once.
// Ausführlich: docs/begruendungen/routes/parts.ts.md#abschnitt-2
/**
 * Ein Teil von Hand erfassen — mit Lagerort, wenn einer mitkommt.
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpart
 */
export async function addManualPart(uid: number, rawBody: Record<string, unknown>) {
    // ortFuerNeuerfassung statt normalisiereLagerort: Kommt kein Ort mit, gilt
  // Marcos Stern (die Begruendung samt Messung steht dort in src/bestand/lagerort.ts).
  const ort = await ortFuerNeuerfassung(uid, rawBody?.storage);
  // DIESELBE Umwandlung wie im Rumpf, auf derselben Eingabe — sie kann also
  // nicht auseinanderlaufen. Der Rumpf gibt sie nicht zurueck, weil die
  // Antwort der Route sonst eine Form mehr haette, die niemand liest.
  const farbe = V0.colorId(rawBody?.color_id);
  const ergebnis = await addManualPartIntern(uid, rawBody);
  if (ort && ergebnis?.part_number) {
    await setzeLagerort('part', [uid], [ergebnis.part_number, String(farbe)], ort);
  }
  return ergebnis;
}

async function addManualPartIntern(uid: number, rawBody: any) {
  // Eingangsvalidierung (src/infra/validate.ts): vorher wurden part_number,
  // part_name, color_name, category_name und image_url völlig ungeprüft
  // gespeichert und später per innerHTML gerendert — das war die Server-Hälfte
  // der Stored-XSS-Kette. image_url ist jetzt zwingend https.
  const V = V0;
  const part_number = V.requireItemNumber(rawBody?.part_number, 'part_number');
  const color_id    = V.colorId(rawBody?.color_id);
  const color_name  = V.optionalText(rawBody?.color_name, 100);
  const color_hex   = V.optionalHex(rawBody?.color_hex);
  const quantity    = V.acquisitionQuantity(rawBody?.quantity, 1);
  const condition   = V.optionalCondition(rawBody?.condition);
  // Negative Beträge gingen bis hardened-137 durch und wanderten unverändert
  // in die Summen des Finanzreiters.
  const unit_price  = V.optionalPrice(rawBody?.unit_price, 'Stückpreis');
  // Erfassungsdatum: erlaubt mehrere Erfassungen desselben Teils zu
  // verschiedenen Zeitpunkten — wie im CSV-Import, der das längst kann.
  const acquiredAt  = (rawBody?.acquired_at || '').trim() || null;

  let part_name = V.optionalText(rawBody?.part_name, 200);
  let image_url = V.optionalImageUrl(rawBody?.image_url);
  let category_name = V.optionalText(rawBody?.category_name, 100);
  // Eingetipptes und Nachgeschlagenes getrennt halten: Nur was Rebrickable
  // liefert, geht als geprüft in den gemeinsamen Katalog (katalogPflege.ts).
  const eingabe = { name: part_name, kategorie: category_name, bild: image_url };
  let gefunden: Awaited<ReturnType<typeof lookupPart>> | null = null;

  if (!part_name) {
    // Ohne gewählte Farbe sucht der Abruf das allgemeine Teilebild.
    const hasColor = color_id !== KEINE_FARBE;

    // Erst der EIGENE Katalog, dann der fremde Dienst
    // Der Import ist dabei nur der Auffaellige. Die Luecke war in DIESER
    // Funktion, und sie gilt fuer jeden Weg, der ohne Namen hereinkommt —
    // auch POST /api/v1/parts. Deshalb steht die Staffelung hier und nicht …
    // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-lokal
    const lokal = await katalogTeil(part_number, hasColor ? color_id : null, uid);
    if (lokal) {
      part_name     = part_name     || lokal.name;
      category_name = category_name || lokal.kategorie;
      image_url     = image_url     || lokal.bild;
    }

    // Nur fragen, wenn danach noch etwas fehlt. `hatBild` statt `image_url`:
    // Ein bereits heruntergeladenes Bild (`image_local`) darf nicht hierher
    // durchreisen — es ist ein Pfad und faellt bei V.optionalImageUrl durch —,
    // es beweist aber, dass der Abruf nichts mehr zu holen hat.
    if (!part_name || !(image_url || lokal?.hatBild)) {
      const info = await lookupPart(part_number, hasColor ? color_id : null);
      gefunden = info;
      // `||`, nicht Zuweisung: Was der Katalog schon wusste, bleibt stehen.
      // Gefragt wird oft nur noch, weil EIN Stueck fehlte.
      if (info) {
        part_name     = part_name     || info.part_name;
        image_url     = image_url     || info.image_url;
        category_name = category_name || info.category_name;
      }
    }
  }

  // Gibt es die Position schon? Nur die EXISTENZ wird gebraucht — die
  // Stückzahl stand hier als zweite Spalte und ist mit Migration 0038 weg.
  // Gelesen wurde sie ohnehin nicht mehr: Die Menge addiert sich dadurch,
  // dass eine zweite Erfassung entsteht.
  const existing = await manuellesTeil(uid, part_number, color_id);

  if (existing) {
    // Menge addieren UND eine Erfassung anlegen.
    // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-recond
    const reCond = condition && ['N','U'].includes(condition) ? condition
      : await resolvePartCondition(uid, part_number, color_id).catch(() => 'N');
    const reEntered = (unit_price !== undefined && unit_price !== null && String(unit_price) !== '')
      ? parseFloat(String(unit_price)) : null;
    const rePrice = (reEntered !== null && !isNaN(reEntered))
      ? reEntered
      : await getCurrentPartMarketPrice(part_number, color_id, uid, reCond);

    // Pro Tag und Zustand EINE Erfassung — wird am selben Tag erneut erfasst,
    // wächst die bestehende Zeile, statt dass eine zweite entsteht
    // (src/bestand/acquisitions.ts).
    await recordAcquisitionForDay('part', uid, [part_number, color_id], {
      quantity, price: ((rePrice ?? 0) > 0 ? rePrice : null), condition: reCond, createdAt: acquiredAt,
      geschaetzt: reEntered === null || isNaN(reEntered),
    });
    // Kein Nachrechnen mehr: Die Stückzahl steht seit Migration 0038
    // nicht an der Zeile. Hier stand mengeNeuRechnen(), das sie aus den
    // Erfassungen ableitete und SCHRIEB — jetzt rechnet sie das Lesen
    // (db/bestandsmenge.ts, teilmengeJoin/teilmengeAus).

    return { action: 'updated', part_number };
  }

  // Preis/Stk, Kaufpreis und Zustand: eine Rechnung, eine Stelle
  // (resolveManualPartPurchase oben) — dieselbe, die der CSV-Import benutzt.
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern
  const { erfassungsPreis, effectiveCondition, preisAusZustand, geschaetzt } =
    await resolveManualPartPurchase(uid, { partNumber: part_number, colorId: color_id, unitPrice: unit_price, condition });
  // Farbcode möglichst füllen: vom Client übergeben, sonst aus rb_colors ableiten
  // (sonst bleibt der Farbpunkt in der Oberfläche grau).
  const rbFarbcode = await repo.rbFarbcode(color_id).catch(meldeUndLiefere('manuelle-teile:farbcode', null));

  // Beschreibung in den Katalog, Bestand in parts
  // Seit Migration 0034 trennt sich beides: Name, Farbbezeichnung, Farbcode,
  // Kategorie und Bild gelten fuer ALLE Konten, der Bestand gilt fuer eines.
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-2
  await merkeTeil(part_number, gefunden?.part_name, gefunden?.category_name);
  await merkeTeil(part_number, eingabe.name, eingabe.kategorie, db, uid);
  await merkeTeilFarbe(part_number, color_id, null, rbFarbcode, gefunden?.image_url);
  await merkeTeilFarbe(part_number, color_id, color_name, color_hex, eingabe.bild, null, db, uid);

  // Preis, Zustand und Menge stehen in der Erfassung, nicht an der Zeile;
  // gibt es die Zeile schon, ist die zweite Erfassung ein Zugang.
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#addmanualpartintern-3
  await repo.legeTeilManuellAn(uid, part_number, color_id);
  await recordAcquisitionForDay('part', uid, [part_number, color_id], {
    quantity, price: erfassungsPreis, geschaetzt,
    condition: effectiveCondition, createdAt: acquiredAt,
  });

  // `price_from_condition` sagt der Oberflaeche, dass der uebernommene
  // Marktpreis aus dem ANDEREN Zustand stammt (Marcos
  // Entscheidung „uebernehmen, aber kennzeichnen"). Null, wenn es nichts zu
  // sagen gibt — dann zeigt keine der beiden Oberflaechen einen Hinweis.
  return { action: 'added', part_number, part_name, price_from_condition: preisAusZustand };
}

/**
 * Menge (absolut oder als Schritt), Preis/Stk und Zustand eines manuellen
 * Teils ändern — für Webapp und App derselbe Weg.
 * @returns die Menge danach, wenn sie Teil der Anfrage war
 */
export async function updateManualPart(uid: number, partNumber: string, colorId: number, body: any): Promise<{ quantity?: number }> {
  const existing = await repo.teilZeileMitZustand(uid, partNumber, colorId);
  if (!existing) { const e = Object.assign(new Error('Teil nicht gefunden oder nicht manuell hinzugefügt'), { status: 404 }); throw e; }

  const raus: { quantity?: number } = {};
  const wunsch = mengenwunsch(body);
  if (wunsch) {
    const cond = await zustandFuerPreis(undefined, existing.condition, uid);
    raus.quantity = await passeManuelleMengeAn('part', uid, [partNumber, colorId], wunsch, cond,
      () => getCurrentPartMarketPrice(partNumber, colorId, uid, cond));
  }
  if (body.unit_price !== undefined) {
    // Die Regel („leer heisst Marktpreis", Zustand gestaffelt) steht in
    // src/finanzen/preisRegel.ts — sie galt vorher zeichengleich hier und in
    // routes/minifigs.ts. Hier bleibt nur, was sich unterscheidet: welche
    // Marktpreis-Abfrage und welche Tabelle.
    const { unitPrice } = await kaufpreisAusEingabe(
      body.unit_price, body.condition, existing.condition, uid,
      (zustand) => getCurrentPartMarketPrice(partNumber, colorId, uid, zustand),
    );
    // In die NEUESTE Erfassung, nicht an die Bestandszeile
    // purchasePrice wird gar nicht mehr ausgepackt: Er war der ANZEIGEWERT
    // (nie NULL, 0 heisst „nichts bekannt"), und den bildet jetzt die
    // Leseabfrage mit COALESCE(..., 0). In der Erfassung bedeutet 0 „fuer …
    // Ausführlich: docs/begruendungen/routes/parts.ts.md#updatemanualpart-3
    await repo.setzeTeilpreisNeueste(uid, partNumber, colorId, unitPrice);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = ['N','U'].includes(body.condition) ? body.condition : 'N';
    await repo.setzeTeilzustandNeueste(uid, partNumber, colorId, cond);
  }
  return raus;
}

/**
 * Erfassungen eines Teils — fuer den Kaufpreis-Dialog.
 * Ausführlich: docs/begruendungen/routes/parts.ts.md#getpartacquisitions
 */
export async function getPartAcquisitions(uid: number[], partNumber: string, colorId: string | number) {
  // uid ist hier das BLICKFELD (Liste): Im Haushalt können die Kaufpreise
  // eines Teils mehreren Konten gehören, und je Zeile kommt der Eigentümer
  // mit — sonst wüsste die Auswahl im Dialog nicht, worauf sie steht.
  //  Kein Rueckfall auf die Stammzeile mehr
  // Ausführlich: docs/begruendungen/routes/parts.ts.md#getpartacquisitions-2
  return repo.teilErfassungen(uid, partNumber, V0.colorId(colorId));
}

/** Die manuelle Bestandszeile eines Teils, falls es sie gibt. */
export function manuellesTeil(uid: number, partNumber: string, colorId: number): Promise<{ id: number } | undefined> {
  return repo.teilZeileManuell(uid, partNumber, colorId);
}

/**
 * CSV-Import manueller Teile (Spalten part_number, color_id, color_name,
 * quantity, unit_price, condition, acquired_at). Dieselbe Preisregel wie beim
 * Anlegen von Hand; eine fehlerhafte Zeile bricht den Rest nicht ab.
 */
export async function importiereTeileCsv(uid: number, text: string) {
  const { records, bereinigt, uebersprungen } = csvZeilenAusAnfrage(text);
  let added = 0, updated = 0, errors = 0;
  const results: Array<{ part_number: string; action: string; error?: string }> = [];

  for (const row of bereinigt) {
    const partNumber = String(row.part_number || row['Teilenummer'] || row['part_num'] || Object.values(row)[0] || '').trim();
    if (!partNumber) continue;
    const colorId   = V0.colorId(row.color_id ?? row['Farb-ID']);
    const colorName = row.color_name || row['Farbe'] || null;
    const { menge: qty, preis: unitPrice, erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);

    try {
      let partName = row.part_name || row['Name'] || null;
      const eingetippt = !!partName;
      let imageUrl: string | null = null, categoryName: string | null = null;
      if (!partName) {
        const info = await lookupPart(partNumber, colorId === KEINE_FARBE ? null : colorId);
        if (info) { partName = info.part_name; imageUrl = info.image_url; categoryName = info.category_name; }
      }
      const { erfassungsPreis, effectiveCondition, geschaetzt } =
        await resolveManualPartPurchase(uid, { partNumber, colorId, unitPrice, condition: rawCondition });
      const erfassung = { quantity: qty, price: erfassungsPreis, geschaetzt,
                          condition: effectiveCondition || 'N', createdAt: acquiredAt || new Date().toISOString().slice(0, 10) };

      if (await manuellesTeil(uid, partNumber, colorId)) {
        await recordAcquisitionForDay('part', uid, [partNumber, colorId], erfassung);
        updated++;
        results.push({ part_number: partNumber, action: 'updated' });
        continue;
      }
      // Katalog vor Bestand: lieber eine Beschreibung ohne Bestand als umgekehrt.
      // Name und Farbbezeichnung aus der Datei sind Eingaben dieses Kontos.
      const colorHex = await repo.rbFarbcode(colorId).catch(meldeUndLiefere('teile-csv:farbcode', null));
      if (eingetippt) await merkeTeil(partNumber, partName, null, db, uid);
      else await merkeTeil(partNumber, partName, categoryName);
      await merkeTeilFarbe(partNumber, colorId, null, colorHex, imageUrl);
      await merkeTeilFarbe(partNumber, colorId, colorName, null, null, null, db, uid);
      await repo.legeTeilManuellAn(uid, partNumber, colorId);
      await recordAcquisitionForDay('part', uid, [partNumber, colorId], erfassung);
      added++;
      results.push({ part_number: partNumber, action: 'added' });
    } catch (e) {
      errors++;
      results.push({ part_number: partNumber, action: 'error', error: fehlertext(e) });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}

