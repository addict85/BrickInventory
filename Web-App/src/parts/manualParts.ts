/** Here and not in a route, because the session route and the v1 factory both
 * reach for it — a route shouldn't import another route. */
import type { Sicht } from '../haushalt';
import { oeffentlicherFehler } from '../infra/fehler';
import { Abstriche, versuche } from '../infra/ergebnis';
import { csvGemeinsameFelder, csvZeilenAusAnfrage } from '../infra/csvExport';
import { mengenwunsch } from '../bestand';
import { KEINE_FARBE } from '../katalog';
import type { Quellen } from '../fremdquellen';
import * as V0 from '../infra/validate';
import { geldEingabe } from '../infra/geld';
import { fachfehler } from '../infra/fehlerTexte';
import type { PartsContext } from './context';

// One calculation for adding, editing and CSV import; without a value, price/unit stays empty.
export async function manualPartPurchase(
  k: PartsContext,
  uid: number,
  {
    partNumber,
    colorId,
    unitPrice = null,
    condition = null,
  }: { partNumber: string; colorId: number; unitPrice?: unknown; condition?: string | null },
) {
  // The rule lives in src/finanzen/preisRegel.ts; what remains here is only what
  // differs for a PART versus a minifig: the lookup key.
  const r = await k.finanzen.manuellerKaufpreis(uid, { unitPrice, condition }, zustand =>
    k.finanzen.marktpreisMitHerkunft(partNumber, colorId, uid, zustand),
  );
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    // null when there is nothing to flag.
    preisAusZustand: r.preisAusZustand,
    geschaetzt: r.geschaetzt,
  };
}

/** One path for the webapp and the app, so purchase price and storage are handled the same everywhere. */
export async function addManualPart(k: PartsContext, uid: number, rawBody: Record<string, unknown>) {
  // Without a given location, the account's default location applies (src/bestand/lagerort.ts).
  const ort = await k.bestand.lagerortDienst.ortFuerNeuerfassung(uid, rawBody?.storage);
  // The SAME conversion as in the body, on the same input — it cannot drift apart.
  const farbe = V0.colorId(rawBody?.color_id);
  const ergebnis = await addManualPartInternal(k, uid, rawBody);
  if (ort && ergebnis?.part_number) {
    await k.bestand.lagerortDienst.setzeLagerort('part', [uid], [ergebnis.part_number, String(farbe)], ort);
  }
  return ergebnis;
}

async function addManualPartInternal(k: PartsContext, uid: number, rawBody: Record<string, unknown>) {
  // Every field validated: they get rendered later, and unvalidated they were the
  // server half of a stored-XSS chain. image_url must be https.
  const V = V0;
  const part_number = V.nummerPflicht(rawBody?.part_number, 'part_number');
  const color_id = V.colorId(rawBody?.color_id);
  const color_name = V.optionalText(rawBody?.color_name, 100);
  const color_hex = V.optionalHex(rawBody?.color_hex);
  const quantity = V.acquisitionQuantity(rawBody?.quantity, 1);
  const condition = V.optionalCondition(rawBody?.condition);
  // Negative amounts used to end up in the finance tab's totals.
  const unit_price = geldEingabe(rawBody?.unit_price, 'Stückpreis');
  // Allows several acquisitions of the same part at different times.
  const acquiredAt = String(rawBody?.acquired_at || '').trim() || null;

  // Validated in this order: with several errors, the first one reports.
  const name = V.optionalText(rawBody?.part_name, 200);
  const bild = V.optionalImageUrl(rawBody?.image_url);
  const eingabe = { name, kategorie: V.optionalText(rawBody?.category_name, 100), bild };
  const { part_name, gefunden } = await partDescription(k, uid, part_number, color_id, eingabe);

  // Only existence counts: the quantity adds up via a second acquisition.
  if (await manualPartExists(k, uid, part_number, color_id)) {
    await additionalAcquisition(k, uid, part_number, color_id, { condition, unit_price, quantity, acquiredAt });
    return { action: 'updated', part_number };
  }

  // One calculation, the same one used in the CSV import.
  const { erfassungsPreis, effectiveCondition, preisAusZustand, geschaetzt } = await manualPartPurchase(k, uid, {
    partNumber: part_number,
    colorId: color_id,
    unitPrice: unit_price,
    condition,
  });
  // Without a color code, the color dot in the UI would stay grey.
  const rbFarbcode = await k.manualParts.rbColorHex(color_id);

  // Description applies to ALL accounts (catalog), the stock to one.
  await k.katalog.merkeTeil(part_number, gefunden?.part_name, gefunden?.category_name);
  await k.katalog.merkeTeil(part_number, eingabe.name, eingabe.kategorie, k.db, uid);
  await k.katalog.merkeTeilFarbe(part_number, color_id, null, rbFarbcode, gefunden?.image_url);
  await k.katalog.merkeTeilFarbe(part_number, color_id, color_name, color_hex, eingabe.bild, null, k.db, uid);

  // Price, condition and quantity live in the acquisition, not on the row.
  await k.bestand.manuell.legeZeileAn('part', uid, [part_number, color_id]);
  await k.bestand.bucheTageserfassung('part', uid, [part_number, color_id], {
    quantity,
    price: erfassungsPreis,
    geschaetzt,
    condition: effectiveCondition,
    createdAt: acquiredAt,
  });

  // `price_from_condition`: the carried-over market price comes from the OTHER
  // condition — carried over, but flagged.
  return { action: 'added', part_number, part_name, price_from_condition: preisAusZustand };
}

/** Typed and looked-up kept apart: only what Rebrickable returns goes into the shared
 * catalog as verified. Without a name, the own catalog first, then Rebrickable. */
async function partDescription(
  k: PartsContext,
  uid: number,
  part_number: string,
  color_id: number,
  eingabe: { name: string | null; kategorie: string | null; bild: string | null },
) {
  let part_name = eingabe.name;
  let image_url = eingabe.bild;
  let gefunden: Awaited<ReturnType<Quellen['lookupPart']>> | null = null;
  if (part_name) return { part_name, gefunden };

  const hasColor = color_id !== KEINE_FARBE;
  const lokal = await k.katalog.katalogTeil(part_number, hasColor ? color_id : null, uid);
  if (lokal) {
    part_name = lokal.name;
    image_url = image_url || lokal.bild;
  }

  // `hatBild` instead of `image_url`: a local path would fail the URL check, but
  // still proves the fetch has nothing more to get.
  if (!part_name || !(image_url || lokal?.hatBild)) {
    // Without Rebrickable, the part gets logged with whatever the catalog already knows.
    const abruf = await versuche(
      'parts:lookupPart',
      k.fremdquellen.quellen.lookupPart(part_number, hasColor ? color_id : null),
    );
    gefunden = abruf.ok ? abruf.wert : null;
    // `||`: what the catalog already knew stays as-is.
    if (gefunden) part_name = part_name || gefunden.part_name;
  }
  return { part_name, gefunden };
}

/** An already-logged part: just another acquisition; without a condition, the stock's. */
async function additionalAcquisition(
  k: PartsContext,
  uid: number,
  part_number: string,
  color_id: number,
  e: { condition: string | null; unit_price: number | null; quantity: number; acquiredAt: string | null },
) {
  const reCond =
    e.condition && ['N', 'U'].includes(e.condition)
      ? e.condition
      : await k.finanzen.teilZustand(uid, part_number, color_id);
  const reEntered = e.unit_price;
  const rePrice =
    reEntered !== null ? reEntered : await k.finanzen.aktuellerTeilMarktpreis(part_number, color_id, uid, reCond);

  // One acquisition per day and condition (src/bestand/acquisitions.ts).
  await k.bestand.bucheTageserfassung('part', uid, [part_number, color_id], {
    quantity: e.quantity,
    price: (rePrice ?? 0) > 0 ? rePrice : null,
    condition: reCond,
    createdAt: e.acquiredAt,
    geschaetzt: reEntered === null,
  });
}

/** Same path for the webapp and the app.
 * @returns the resulting quantity, if it was part of the request */
export async function changeManualPart(
  k: PartsContext,
  uid: number,
  partNumber: string,
  colorId: number,
  body: Record<string, unknown>,
): Promise<{ quantity?: number; degradiert?: string[] }> {
  const existing = await k.manualParts.manualPartWithCondition(uid, partNumber, colorId);
  if (!existing) fachfehler('nicht_gefunden', 'teil_nicht_manuell');

  const raus: { quantity?: number } = {};
  // If the market price for the new acquisition didn't arrive, `degradiert` says so.
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
      () => k.finanzen.aktuellerTeilMarktpreis(partNumber, colorId, uid, cond),
      ab,
    );
  }
  if (body.unit_price !== undefined) {
    // The rule lives in src/finanzen/preisRegel.ts; only the lookup and table are here.
    const { unitPrice } = await k.finanzen.kaufpreisAusEingabe(
      body.unit_price,
      body.condition,
      existing.condition,
      uid,
      zustand => k.finanzen.aktuellerTeilMarktpreis(partNumber, colorId, uid, zustand),
    );
    // Into the LATEST acquisition: there NULL means "no price known", the 0 shown
    // on display is formed by the read query.
    await k.bestand.neuesteSetzen('part', 'preis', unitPrice, uid, [partNumber, colorId]);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = V0.zustand(body.condition);
    await k.bestand.neuesteSetzen('part', 'zustand', cond, uid, [partNumber, colorId]);
  }
  return { ...raus, ...ab.angabe() };
}

export async function listPartAcquisitions(
  k: PartsContext,
  uidWahl: Sicht | number[],
  partNumber: string,
  colorId: string | number,
) {
  const uid = await k.haushalt.blickfeldAus(uidWahl);
  // The VIEWPOINT: each row comes with its owner, otherwise the picker in the
  // dialog wouldn't know what it's choosing from.
  return k.manualParts.partAcquisitions(uid, partNumber, V0.colorId(colorId));
}

export function manualPartExists(
  k: PartsContext,
  uid: number,
  partNumber: string,
  colorId: number,
): Promise<{ id: number } | undefined> {
  return k.manualParts.manualPartRow(uid, partNumber, colorId);
}

/** Same pricing rule as when adding by hand; one bad row doesn't abort the rest. */
export async function importPartsCsv(k: PartsContext, uid: number, text: string) {
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
          'parts:import-lookupPart',
          k.fremdquellen.quellen.lookupPart(partNumber, colorId === KEINE_FARBE ? null : colorId),
        );
        const info = abruf.ok ? abruf.wert : null;
        if (info) {
          partName = info.part_name;
          imageUrl = info.image_url;
          categoryName = info.category_name;
        }
      }
      const { erfassungsPreis, effectiveCondition, geschaetzt } = await manualPartPurchase(k, uid, {
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
        createdAt: acquiredAt || k.uhr.datum().toISOString().slice(0, 10),
      };

      if (await manualPartExists(k, uid, partNumber, colorId)) {
        await k.bestand.bucheTageserfassung('part', uid, [partNumber, colorId], erfassung);
        updated++;
        results.push({ part_number: partNumber, action: 'updated' });
        continue;
      }
      // Catalog before stock: better a description without stock than the other way round.
      const colorHex = await k.manualParts.rbColorHex(colorId);
      if (eingetippt) await k.katalog.merkeTeil(partNumber, partName, null, k.db, uid);
      else await k.katalog.merkeTeil(partNumber, partName, categoryName);
      await k.katalog.merkeTeilFarbe(partNumber, colorId, null, colorHex, imageUrl);
      await k.katalog.merkeTeilFarbe(partNumber, colorId, colorName, null, null, null, k.db, uid);
      await k.bestand.manuell.legeZeileAn('part', uid, [partNumber, colorId]);
      await k.bestand.bucheTageserfassung('part', uid, [partNumber, colorId], erfassung);
      added++;
      results.push({ part_number: partNumber, action: 'added' });
    } catch (e) {
      errors++;
      results.push({
        part_number: partNumber,
        action: 'error',
        error: oeffentlicherFehler(e, 'parts-csv:row').error,
      });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
