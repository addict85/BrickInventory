/** Hier und nicht in einer Route, weil Sitzungsroute und v1-Fabrik beide darauf
 * zugreifen — eine Route soll keine andere importieren. */
import { haushaltBereich, type Sicht } from '../haushalt';
import { logAndContinue, oeffentlicherFehler } from '../infra/fehler';
import { Abstriche, versuche } from '../infra/ergebnis';
import { csvGemeinsameFelder, csvZeilenAusAnfrage } from '../infra/csvExport';
import { bestandBereich, recordAcquisitionForDay, mengenwunsch, passeManuelleMengeAn } from '../bestand';
import { getMinifigInfo, merkeFigur, katalogFigur, merkeEigeneBlNummer } from '../katalog';
import { zustandFuerPreis } from '../einstellungen';
import {
  figMarktpreisMitHerkunft,
  getCurrentFigMarketPrice,
  kaufpreisAusEingabe,
  manuellerKaufpreis,
} from '../finanzen';
import * as V from '../infra/validate';
import { geldEingabe } from '../infra/geld';
import { fachfehler } from '../infra/fehlerTexte';
import { figurenBereich } from './prozess';

// Ohne BrickLink-Figurennummer wird der Marktpreis aus den Teilepreisen
// geschätzt: Für Teile ist die Zuordnung RB→BL verlässlich, für Figuren nicht.

// Preis und Zustand einmal für Einzelerfassung und CSV-Import; ohne Preis gilt der Marktpreis.
export async function resolveManualFigPurchase(
  uid: number,
  {
    figNumber,
    blFigNumber = null,
    unitPrice = null,
    condition = null,
  }: { figNumber: string; blFigNumber?: string | null; unitPrice?: unknown; condition?: string | null },
) {
  // Dieselbe Regel wie bei den Teilen (src/finanzen/preisRegel.ts), damit eine
  // Figur ohne Marktpreis nicht anders zählt als ein Teil.
  const r = await manuellerKaufpreis(uid, { unitPrice, condition }, zustand =>
    figMarktpreisMitHerkunft(figNumber, uid, blFigNumber || null, zustand),
  );
  return {
    effectiveUnitPrice: r.unitPrice,
    effectivePurchasePrice: r.kaufpreis,
    erfassungsPreis: r.erfassungsPreis,
    effectiveCondition: r.zustand,
    preisAusZustand: r.preisAusZustand,
    geschaetzt: r.geschaetzt,
  };
}

/** Zwilling zu addManualPart — eine Umsetzung für Webapp und App. */
export async function addManualFig(uid: number, body: Record<string, unknown>) {
  // Ohne mitgegebenen Ort gilt der Vorgabeort des Kontos.
  const ort = await bestandBereich().lagerortDienst.ortFuerNeuerfassung(uid, body?.storage);
  const ergebnis = await addManualFigIntern(uid, body);
  if (ort && ergebnis?.fig_number) {
    await bestandBereich().lagerortDienst.setzeLagerort('fig', [uid], [String(ergebnis.fig_number)], ort);
  }
  return ergebnis;
}

async function addManualFigIntern(uid: number, body: Record<string, unknown>) {
  // Gleiche Eingangsvalidierung wie bei manuellen Teilen: Die Felder werden gerendert.
  const num = V.requireItemNumber(body?.fig_number, 'fig_number');
  const blNum = body?.bl_fig_number ? V.requireItemNumber(body.bl_fig_number, 'bl_fig_number') : null;
  const quantity = V.acquisitionQuantity(body?.quantity, 1);
  const condition = V.optionalCondition(body?.condition);
  const unit_price = geldEingabe(body?.unit_price, 'Stückpreis');
  // Erlaubt mehrere Erfassungen derselben Figur zu verschiedenen Zeitpunkten.
  const acquiredAt = String(body?.acquired_at || '').trim() || null;
  let fig_name = V.optionalText(body?.fig_name, 200);
  let image_url = V.optionalImageUrl(body?.image_url);
  // Nur Nachgeschlagenes geht als geprüft in den Katalog.
  const eingabe = { name: fig_name, bild: image_url };
  let gefunden: Awaited<ReturnType<typeof getMinifigInfo>> | null = null;

  if (!fig_name) {
    // Erst der eigene Katalog, dann der fremde Dienst: minifigs_catalog führt
    // Name und Bild, ein Abruf je Figur wäre unnötig.
    const lokal = await katalogFigur(num, uid);
    if (lokal) {
      fig_name = fig_name || lokal.name;
      image_url = image_url || lokal.bild;
    }
    // `hatBild` statt `image_url`: Ein lokaler Pfad fiele bei der URL-Prüfung
    // durch, beweist aber, dass der Abruf nichts mehr zu holen hat.
    if (!fig_name || !(image_url || lokal?.hatBild)) {
      // Ohne Rebrickable wird die Figur mit dem erfasst, was der Katalog schon weiss.
      const abruf = await versuche('figuren:getMinifigInfo', getMinifigInfo(num));
      const info = abruf.ok ? abruf.wert : null;
      gefunden = info;
      // `||`: Was der Katalog schon wusste, bleibt stehen.
      if (info) {
        fig_name = fig_name || info.fig_name;
        image_url = image_url || info.image_url;
      }
    }
  }

  const existing = await manuelleFigur(uid, num);

  if (existing) {
    // Auch eine erneut erfasste Figur bekommt eine Erfassung (Kaufpreis, Datum);
    // die Menge ergibt sich daraus beim Lesen.
    const re = await resolveManualFigPurchase(uid, {
      figNumber: num,
      blFigNumber: blNum,
      unitPrice: unit_price,
      condition,
    });
    // Pro Tag und Zustand EINE Erfassung (src/bestand/acquisitions.ts).
    await recordAcquisitionForDay('fig', uid, [num], {
      quantity,
      // In der Stammzeile ist die 0 ein Anzeigewert, in der Erfassung hiesse sie
      // „für null gekauft".
      price: re.erfassungsPreis,
      geschaetzt: re.geschaetzt,
      condition: re.effectiveCondition,
      createdAt: acquiredAt,
    });

    return { action: 'updated', fig_number: num };
  }

  const { erfassungsPreis, effectiveCondition, preisAusZustand, geschaetzt } = await resolveManualFigPurchase(uid, {
    figNumber: num,
    blFigNumber: blNum,
    unitPrice: unit_price,
    condition,
  });
  // Der Katalog zuerst: Fällt die Anfrage dazwischen aus, ist eine Beschreibung
  // ohne Bestand unsichtbar, ein Bestand ohne Namen nicht.
  await merkeFigur(num, gefunden?.fig_name, gefunden?.image_url);
  await merkeFigur(num, eingabe.name, eingabe.bild, null, figurenBereich().db, uid);
  // Ohne Menge, Preis und Zustand: Sie stehen in der Erfassung darunter.
  await figurenBereich().manuelleFiguren.legeFigurManuellAn(uid, num);
  if (blNum) await merkeEigeneBlNummer(uid, 'fig', num, blNum).catch(logAndContinue(`minifiguren:bl-nummer ${num}`));
  // Mit dem tatsächlich verwendeten Kaufpreis (Marktpreis oder Schätzung), damit
  // Erfassungshistorie und G&V stimmen.
  await recordAcquisitionForDay('fig', uid, [num], {
    quantity,
    price: erfassungsPreis,
    geschaetzt,
    condition: effectiveCondition,
    createdAt: acquiredAt,
  });

  return { action: 'added', fig_number: num, fig_name, price_from_condition: preisAusZustand };
}

/** Zwilling zu updateManualPart.
 * @returns die Menge danach, wenn sie Teil der Anfrage war */
export async function updateManualFig(
  uid: number,
  figNumber: string,
  body: Record<string, unknown>,
): Promise<{ quantity?: number; degradiert?: string[] }> {
  const existing = await figurenBereich().manuelleFiguren.figurZeileMitZustand(uid, figNumber);
  if (!existing) fachfehler('nicht_gefunden', 'minifig_nicht_manuell');

  const raus: { quantity?: number } = {};
  // Kam der Marktpreis für die neue Erfassung nicht, sagt es `degradiert`.
  const ab = new Abstriche();
  const wunsch = mengenwunsch(body);
  if (wunsch) {
    const cond = await zustandFuerPreis(undefined, existing.condition, uid);
    raus.quantity = await passeManuelleMengeAn(
      'fig',
      uid,
      [figNumber],
      wunsch,
      cond,
      () => getCurrentFigMarketPrice(figNumber, uid, existing.bl_fig_number, cond),
      ab,
    );
  }
  let newBlNum = existing.bl_fig_number;
  if (body.bl_fig_number !== undefined) {
    newBlNum = body.bl_fig_number ? String(body.bl_fig_number).trim() : null;
    // Geleert heisst „keine abweichende Nummer", nicht „nie nachgesehen".
    await merkeEigeneBlNummer(uid, 'fig', figNumber, newBlNum || figNumber);
  }
  if (body.unit_price !== undefined) {
    // Dieselbe Regel wie bei den Teilen (src/finanzen/preisRegel.ts).
    const { unitPrice } = await kaufpreisAusEingabe(body.unit_price, body.condition, existing.condition, uid, zustand =>
      getCurrentFigMarketPrice(figNumber, uid, newBlNum, zustand),
    );
    // In die NEUESTE Erfassung, wie bei den Teilen.
    await figurenBereich().manuelleFiguren.setzeFigurpreisNeueste(uid, figNumber, unitPrice);
  }
  if (body.condition !== undefined && body.condition !== null) {
    const cond = V.zustand(body.condition);
    await figurenBereich().manuelleFiguren.setzeFigurzustandNeueste(uid, figNumber, cond);
  }
  return { ...raus, ...ab.angabe() };
}

/** `uid` ist das Blickfeld (Liste). */
export async function getFigAcquisitions(uidWahl: Sicht | number[], figNumber: string) {
  const uid = await haushaltBereich().haushalt.blickfeldAus(uidWahl);
  return figurenBereich().manuelleFiguren.figurErfassungen(uid, figNumber);
}

export function manuelleFigur(uid: number, figNumber: string): Promise<{ id: number } | undefined> {
  return figurenBereich().manuelleFiguren.figurZeileManuell(uid, figNumber);
}

/** Dieselbe Preisregel wie beim Anlegen von Hand, samt Schätzung aus den Teilen. */
export async function importiereFigurenCsv(uid: number, text: string) {
  const { records, bereinigt, uebersprungen } = csvZeilenAusAnfrage(text);
  let added = 0,
    updated = 0,
    errors = 0;
  const results: Array<{ fig_number: string; action: string; fig_name?: string | null; error?: string }> = [];

  for (const row of bereinigt) {
    const figNumber = String(row.fig_number || row.Nummer || row.fig_num || Object.values(row)[0] || '').trim();
    if (!figNumber) continue;
    const blFigNumber = String(row.bl_fig_number || row['BrickLink-Nr'] || '').trim() || null;
    const { menge: qty, preis: unitPrice, erfasstAm: acquiredAt, zustand: rawCondition } = csvGemeinsameFelder(row);

    try {
      let figName = row.fig_name || row.Name || null;
      const eingetippt = !!figName;
      let imageUrl: string | null = null;
      if (!figName) {
        // Ohne Rebrickable wird die Figur ohne Namen erfasst; der Bildnachlauf holt ihn nicht nach.
        const abruf = await versuche('figuren:import-info', getMinifigInfo(figNumber));
        const info = abruf.ok ? abruf.wert : null;
        if (info) {
          figName = info.fig_name;
          imageUrl = info.image_url;
        }
      }
      const { erfassungsPreis, effectiveCondition, geschaetzt } = await resolveManualFigPurchase(uid, {
        figNumber,
        blFigNumber,
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

      if (await manuelleFigur(uid, figNumber)) {
        await recordAcquisitionForDay('fig', uid, [figNumber], erfassung);
        updated++;
        results.push({ fig_number: figNumber, action: 'updated' });
        continue;
      }
      // Ein Name aus der Datei ist eine Eingabe dieses Kontos (katalogPflege.ts).
      await merkeFigur(figNumber, figName, imageUrl, null, figurenBereich().db, eingetippt ? uid : null);
      await figurenBereich().manuelleFiguren.legeFigurManuellAn(uid, figNumber);
      if (blFigNumber)
        await merkeEigeneBlNummer(uid, 'fig', figNumber, blFigNumber).catch(
          logAndContinue(`minifigs:import ${figNumber} (bl-nummer)`),
        );
      await recordAcquisitionForDay('fig', uid, [figNumber], erfassung);
      added++;
      results.push({ fig_number: figNumber, action: 'added', fig_name: figName });
    } catch (e) {
      errors++;
      results.push({
        fig_number: figNumber,
        action: 'error',
        error: oeffentlicherFehler(e, 'figuren-csv:zeile').error,
      });
    }
  }
  return { added, updated, errors, records, results, uebersprungen };
}
