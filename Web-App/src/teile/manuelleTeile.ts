/** Hier und nicht in einer Route, weil Sitzungsroute und v1-Fabrik beide darauf
 * zugreifen — eine Route soll keine andere importieren. */
import type { Sicht } from '../haushalt';
import { oeffentlicherFehler } from '../infra/fehler';
import { Abstriche, versuche } from '../infra/ergebnis';
import { csvGemeinsameFelder, csvZeilenAusAnfrage } from '../infra/csvExport';
import { mengenwunsch } from '../bestand';
import { lookupPart, farbliste, KEINE_FARBE } from '../katalog';
import * as V0 from '../infra/validate';
import { geldEingabe } from '../infra/geld';
import { fachfehler } from '../infra/fehlerTexte';
import type { TeileKontext } from './kontext';

export const getPartColorList = farbliste;

// Eine Rechnung für Anlegen, Bearbeiten und CSV-Import; ohne Angabe bleibt Preis/Stk leer.
export async function resolveManualPartPurchase(
  k: TeileKontext,
  uid: number,
  {
    partNumber,
    colorId,
    unitPrice = null,
    condition = null,
  }: { partNumber: string; colorId: number; unitPrice?: unknown; condition?: string | null },
) {
  // Die Regel steht in src/finanzen/preisRegel.ts; hier bleibt nur, was ein
  // TEIL anders macht als eine Figur: der Schlüssel der Abfrage.
  const r = await k.finanzen.manuellerKaufpreis(uid, { unitPrice, condition }, zustand =>
    k.finanzen.marktpreisMitHerkunft(partNumber, colorId, uid, zustand),
  );
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    // null, wenn es nichts zu kennzeichnen gibt.
    preisAusZustand: r.preisAusZustand,
    geschaetzt: r.geschaetzt,
  };
}

/** Eine Umsetzung für Webapp und App, damit Kaufpreis und Lagerort überall
 * gleich behandelt werden. */
export async function addManualPart(k: TeileKontext, uid: number, rawBody: Record<string, unknown>) {
  // Ohne mitgegebenen Ort gilt der Vorgabeort des Kontos (src/bestand/lagerort.ts).
  const ort = await k.bestand.lagerortDienst.ortFuerNeuerfassung(uid, rawBody?.storage);
  // DIESELBE Umwandlung wie im Rumpf, auf derselben Eingabe — sie kann nicht
  // auseinanderlaufen.
  const farbe = V0.colorId(rawBody?.color_id);
  const ergebnis = await addManualPartIntern(k, uid, rawBody);
  if (ort && ergebnis?.part_number) {
    await k.bestand.lagerortDienst.setzeLagerort('part', [uid], [ergebnis.part_number, String(farbe)], ort);
  }
  return ergebnis;
}

async function addManualPartIntern(k: TeileKontext, uid: number, rawBody: Record<string, unknown>) {
  // Alle Felder geprüft: Sie werden später gerendert, ungeprüft waren sie die
  // Server-Hälfte einer Stored-XSS-Kette. image_url ist zwingend https.
  const V = V0;
  const part_number = V.requireItemNumber(rawBody?.part_number, 'part_number');
  const color_id = V.colorId(rawBody?.color_id);
  const color_name = V.optionalText(rawBody?.color_name, 100);
  const color_hex = V.optionalHex(rawBody?.color_hex);
  const quantity = V.acquisitionQuantity(rawBody?.quantity, 1);
  const condition = V.optionalCondition(rawBody?.condition);
  // Negative Beträge wanderten sonst in die Summen des Finanzreiters.
  const unit_price = geldEingabe(rawBody?.unit_price, 'Stückpreis');
  // Erlaubt mehrere Erfassungen desselben Teils zu verschiedenen Zeitpunkten.
  const acquiredAt = String(rawBody?.acquired_at || '').trim() || null;

  // In dieser Reihenfolge geprüft: Bei mehreren Fehlern meldet sich der erste.
  const name = V.optionalText(rawBody?.part_name, 200);
  const bild = V.optionalImageUrl(rawBody?.image_url);
  const eingabe = { name, kategorie: V.optionalText(rawBody?.category_name, 100), bild };
  const { part_name, gefunden } = await teilBeschreibung(k, uid, part_number, color_id, eingabe);

  // Nur die Existenz zählt: Die Menge addiert sich über eine zweite Erfassung.
  if (await manuellesTeil(k, uid, part_number, color_id)) {
    await weitereErfassung(k, uid, part_number, color_id, { condition, unit_price, quantity, acquiredAt });
    return { action: 'updated', part_number };
  }

  // Eine Rechnung an einer Stelle, dieselbe wie im CSV-Import.
  const { erfassungsPreis, effectiveCondition, preisAusZustand, geschaetzt } = await resolveManualPartPurchase(k, uid, {
    partNumber: part_number,
    colorId: color_id,
    unitPrice: unit_price,
    condition,
  });
  // Ohne Farbcode bliebe der Farbpunkt in der Oberfläche grau.
  const rbFarbcode = await k.manuelleTeile.rbFarbcode(color_id);

  // Beschreibung gilt für ALLE Konten (Katalog), der Bestand für eines.
  await k.katalog.merkeTeil(part_number, gefunden?.part_name, gefunden?.category_name);
  await k.katalog.merkeTeil(part_number, eingabe.name, eingabe.kategorie, k.db, uid);
  await k.katalog.merkeTeilFarbe(part_number, color_id, null, rbFarbcode, gefunden?.image_url);
  await k.katalog.merkeTeilFarbe(part_number, color_id, color_name, color_hex, eingabe.bild, null, k.db, uid);

  // Preis, Zustand und Menge stehen in der Erfassung, nicht an der Zeile.
  await k.manuelleTeile.legeTeilManuellAn(uid, part_number, color_id);
  await k.bestand.recordAcquisitionForDay('part', uid, [part_number, color_id], {
    quantity,
    price: erfassungsPreis,
    geschaetzt,
    condition: effectiveCondition,
    createdAt: acquiredAt,
  });

  // `price_from_condition`: Der übernommene Marktpreis stammt aus dem ANDEREN
  // Zustand — übernehmen, aber kennzeichnen.
  return { action: 'added', part_number, part_name, price_from_condition: preisAusZustand };
}

/** Eingetipptes und Nachgeschlagenes getrennt: Nur was Rebrickable liefert, geht als
 * geprüft in den gemeinsamen Katalog. Ohne Namen erst der eigene Katalog, dann Rebrickable. */
async function teilBeschreibung(
  k: TeileKontext,
  uid: number,
  part_number: string,
  color_id: number,
  eingabe: { name: string | null; kategorie: string | null; bild: string | null },
) {
  let part_name = eingabe.name;
  let image_url = eingabe.bild;
  let gefunden: Awaited<ReturnType<typeof lookupPart>> | null = null;
  if (part_name) return { part_name, gefunden };

  const hasColor = color_id !== KEINE_FARBE;
  const lokal = await k.katalog.katalogTeil(part_number, hasColor ? color_id : null, uid);
  if (lokal) {
    part_name = lokal.name;
    image_url = image_url || lokal.bild;
  }

  // `hatBild` statt `image_url`: Ein lokaler Pfad fiele bei der URL-Prüfung
  // durch, beweist aber, dass der Abruf nichts mehr zu holen hat.
  if (!part_name || !(image_url || lokal?.hatBild)) {
    // Ohne Rebrickable wird das Teil mit dem erfasst, was der Katalog schon weiss.
    const abruf = await versuche('teile:lookupPart', lookupPart(part_number, hasColor ? color_id : null));
    gefunden = abruf.ok ? abruf.wert : null;
    // `||`: Was der Katalog schon wusste, bleibt stehen.
    if (gefunden) part_name = part_name || gefunden.part_name;
  }
  return { part_name, gefunden };
}

/** Ein schon erfasstes Teil: nur eine weitere Erfassung, ohne Zustand den des Bestands. */
async function weitereErfassung(
  k: TeileKontext,
  uid: number,
  part_number: string,
  color_id: number,
  e: { condition: string | null; unit_price: number | null; quantity: number; acquiredAt: string | null },
) {
  const reCond =
    e.condition && ['N', 'U'].includes(e.condition)
      ? e.condition
      : await k.finanzen.resolvePartCondition(uid, part_number, color_id);
  const reEntered = e.unit_price;
  const rePrice =
    reEntered !== null ? reEntered : await k.finanzen.getCurrentPartMarketPrice(part_number, color_id, uid, reCond);

  // Pro Tag und Zustand EINE Erfassung (src/bestand/acquisitions.ts).
  await k.bestand.recordAcquisitionForDay('part', uid, [part_number, color_id], {
    quantity: e.quantity,
    price: (rePrice ?? 0) > 0 ? rePrice : null,
    condition: reCond,
    createdAt: e.acquiredAt,
    geschaetzt: reEntered === null,
  });
}

/** Für Webapp und App derselbe Weg.
 * @returns die Menge danach, wenn sie Teil der Anfrage war */
export async function updateManualPart(
  k: TeileKontext,
  uid: number,
  partNumber: string,
  colorId: number,
  body: Record<string, unknown>,
): Promise<{ quantity?: number; degradiert?: string[] }> {
  const existing = await k.manuelleTeile.teilZeileMitZustand(uid, partNumber, colorId);
  if (!existing) fachfehler('nicht_gefunden', 'teil_nicht_manuell');

  const raus: { quantity?: number } = {};
  // Kam der Marktpreis für die neue Erfassung nicht, sagt es `degradiert`.
  const ab = new Abstriche();
  const wunsch = mengenwunsch(body);
  if (wunsch) {
    const cond = await k.einstellungen.zustandFuerPreis(undefined, existing.condition, uid);
    raus.quantity = await k.bestand.passeManuelleMengeAn(
      'part',
      uid,
      [partNumber, colorId],
      wunsch,
      cond,
      () => k.finanzen.getCurrentPartMarketPrice(partNumber, colorId, uid, cond),
      ab,
    );
  }
  if (body.unit_price !== undefined) {
    // Die Regel steht in src/finanzen/preisRegel.ts; hier nur Abfrage und Tabelle.
    const { unitPrice } = await k.finanzen.kaufpreisAusEingabe(
      body.unit_price,
      body.condition,
      existing.condition,
      uid,
      zustand => k.finanzen.getCurrentPartMarketPrice(partNumber, colorId, uid, zustand),
    );
    // In die NEUESTE Erfassung: Dort heisst NULL „kein Preis bekannt", die 0 der
    // Anzeige bildet die Leseabfrage.
    await k.manuelleTeile.setzeTeilpreisNeueste(uid, partNumber, colorId, unitPrice);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = V0.zustand(body.condition);
    await k.manuelleTeile.setzeTeilzustandNeueste(uid, partNumber, colorId, cond);
  }
  return { ...raus, ...ab.angabe() };
}

export async function getPartAcquisitions(
  k: TeileKontext,
  uidWahl: Sicht | number[],
  partNumber: string,
  colorId: string | number,
) {
  const uid = await k.haushalt.blickfeldAus(uidWahl);
  // Das BLICKFELD: Je Zeile kommt der Eigentümer mit, sonst wüsste die Auswahl
  // im Dialog nicht, worauf sie steht.
  return k.manuelleTeile.teilErfassungen(uid, partNumber, V0.colorId(colorId));
}

export function manuellesTeil(
  k: TeileKontext,
  uid: number,
  partNumber: string,
  colorId: number,
): Promise<{ id: number } | undefined> {
  return k.manuelleTeile.teilZeileManuell(uid, partNumber, colorId);
}

/** Dieselbe Preisregel wie beim Anlegen von Hand; eine fehlerhafte Zeile
 * bricht den Rest nicht ab. */
export async function importiereTeileCsv(k: TeileKontext, uid: number, text: string) {
  const { records, bereinigt, uebersprungen } = csvZeilenAusAnfrage(text);
  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ part_number: string; action: string; error?: string }> = [];

  for (const row of bereinigt) {
    const partNumber = String(row.part_number || row.Teilenummer || row.part_num || Object.values(row)[0] || '').trim();
    if (!partNumber) continue;
    const colorId = V0.colorId(row.color_id ?? row['Farb-ID']);
    const colorName = row.color_name || row.Farbe || null;
    const { menge: qty, preis: unitPrice, erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);

    try {
      let partName = row.part_name || row.Name || null;
      const eingetippt = !!partName;
      let imageUrl: string | null = null,
        categoryName: string | null = null;
      if (!partName) {
        const abruf = await versuche(
          'teile:import-lookupPart',
          lookupPart(partNumber, colorId === KEINE_FARBE ? null : colorId),
        );
        const info = abruf.ok ? abruf.wert : null;
        if (info) {
          partName = info.part_name;
          imageUrl = info.image_url;
          categoryName = info.category_name;
        }
      }
      const { erfassungsPreis, effectiveCondition, geschaetzt } = await resolveManualPartPurchase(k, uid, {
        partNumber,
        colorId,
        unitPrice,
        condition: rawCondition,
      });
      const erfassung = {
        quantity: qty,
        price: erfassungsPreis,
        geschaetzt,
        condition: effectiveCondition || 'N',
        createdAt: acquiredAt || new Date().toISOString().slice(0, 10),
      };

      if (await manuellesTeil(k, uid, partNumber, colorId)) {
        await k.bestand.recordAcquisitionForDay('part', uid, [partNumber, colorId], erfassung);
        updated++;
        results.push({ part_number: partNumber, action: 'updated' });
        continue;
      }
      // Katalog vor Bestand: lieber eine Beschreibung ohne Bestand als umgekehrt.
      const colorHex = await k.manuelleTeile.rbFarbcode(colorId);
      if (eingetippt) await k.katalog.merkeTeil(partNumber, partName, null, k.db, uid);
      else await k.katalog.merkeTeil(partNumber, partName, categoryName);
      await k.katalog.merkeTeilFarbe(partNumber, colorId, null, colorHex, imageUrl);
      await k.katalog.merkeTeilFarbe(partNumber, colorId, colorName, null, null, null, k.db, uid);
      await k.manuelleTeile.legeTeilManuellAn(uid, partNumber, colorId);
      await k.bestand.recordAcquisitionForDay('part', uid, [partNumber, colorId], erfassung);
      added++;
      results.push({ part_number: partNumber, action: 'added' });
    } catch (e) {
      errors++;
      results.push({
        part_number: partNumber,
        action: 'error',
        error: oeffentlicherFehler(e, 'teile-csv:zeile').error,
      });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
