/** SQL, Rebrickable und Aufträge stehen nur hier und darunter, damit die Routen nur Anfrage und Antwort kennen. */
import { deleteSetRows } from './loeschen';
import { toCsv } from '../infra/csvExport';
import { bookEntry } from './erfassen';
import { fachfehler } from '../infra/fehlerTexte';
import { inventoryQuantity, zustand } from '../infra/validate';
import * as repo from './repository/sets';
import type { Eingabe } from '../vertrag';
import { versuche, valueOr, Degradations } from '../infra/ergebnis';
import { normalizeLocation } from '../bestand';
import { normalisiereSetNummer } from '../infra/setNummer';
import * as detailRepo from './repository/setDetail';
import type { SetsContext } from './kontext';
export type { CatalogPart, ListenTeil, SetMaster } from './zeilen';

/** Sets anlegen, ändern und ausgeben — eine Umsetzung für Web und App, damit
 * beide dieselben Regeln für Menge, Kaufpreis und Blickfeld erfüllen. */

/** Reihenfolge Preis-Cache → BrickLink → Historie; bleibt alles leer, trägt
 * src/bestand/kaufpreisNachtrag.ts nach. */
async function priceForNewEntry(sk: SetsContext, userId: number, setNumber: string) {
  // Über das Blickfeld: Mit einer nackten ID fände der Hauptaccount das Set des Unterkontos nicht.
  const blickfeld = valueOr(await versuche('sets:kaufpreis-blickfeld', sk.household.scopeIds(userId)), [userId]);
  const cond = await sk.finances.setState(blickfeld, setNumber);
  // Die Währung DES KONTOS: Der Preis wird in ihr gesucht und gespeichert.
  const currency = String(await sk.einstellungen.userValue(userId, 'currency', 'EUR'));
  const cached = valueOr(
    await versuche('set-service:cached', sk.finances.marketPriceFromCache(setNumber, currency, cond)),
    null,
  );
  let pp = cached?.marktpreis || null;
  if (!pp)
    pp = valueOr(
      await versuche('set-service:aktuellerMarktpreis', sk.finances.aktuellerMarktpreis(setNumber, userId, cond)),
      null,
    );
  if (!pp) {
    // Der Verlauf füllt die Lücke, wenn Cache und BrickLink-Kontingent beim CSV-Import leer ausgehen; sonst
    // entstünde die Erfassung ohne Kaufpreis.
    const hist = valueOr(
      await versuche('set-service:hist', sk.finances.marketPriceFromHistory(setNumber, currency, cond)),
      null,
    );
    pp = hist?.marktpreis || null;
  }
  return { price: pp, condition: cond, geschaetzt: pp != null, currency };
}

/** @param pricePlan vorab ermittelt; ohne Angabe wird er hier geholt — dann
 *        darf sk KEINE Transaktion sein, weil ein Netzaufruf darin steckt. */
async function entriesAnQuantityAlign(
  sk: SetsContext,
  userId: number,
  setNumber: string,
  newTotalQty: number,
  pricePlan: { price: number | null; condition: string; geschaetzt?: boolean; currency?: string } | null = null,
) {
  // Ohne Fang: Mit einer leeren Liste nach einem Lesefehler buchte die Anpassung die ganze Menge neu.
  const rows: { id: number; quantity: number; created_at: Date }[] = await repo.setEntriesNewestFirst(
    sk.db,
    userId,
    setNumber,
  );
  const current = rows.reduce((sum: number, r: { quantity?: number | null }) => sum + (r.quantity || 0), 0);
  let delta = newTotalQty - current;
  if (delta === 0) return [];
  if (delta > 0) {
    if (rows.length) {
      {
        // Aufstocken oder neue Tageszeile entscheidet addPurchaseAtTag(), damit die Regel nur einmal
        // existiert.
        const plan = pricePlan ?? (await priceForNewEntry(sk, userId, setNumber));
        await bookEntry(sk, {
          konto: userId,
          setNumber,
          menge: delta,
          kaufpreis: plan.price,
          zustand: plan.condition,
          geschaetzt: !!plan.geschaetzt,
          waehrung: plan.currency ?? null,
        });
      }
    } else {
      const plan = pricePlan ?? (await priceForNewEntry(sk, userId, setNumber));
      await bookEntry(sk, {
        konto: userId,
        setNumber,
        menge: newTotalQty,
        kaufpreis: plan.price,
        zustand: plan.condition || 'N',
        geschaetzt: !!plan.geschaetzt,
        waehrung: plan.currency ?? null,
      });
    }
    return [];
  }
  const entfallen: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (delta === 0) break;
    const take = Math.min(r.quantity, -delta);
    const zeile = await repo.setEntryAsJson(sk.db, r.id);
    if (zeile) entfallen.push({ ...zeile, quantity: take });
    if (take >= r.quantity) await sk.bestand.erfassung.loesche('set', r.id, userId);
    else await sk.bestand.erfassung.aendere('set', r.id, [userId], { menge: r.quantity - take });
    delta += take;
  }
  return entfallen;
}

/** Was eine Verringerung wegnahm, in der Form der Antwort: Die Oberfläche nennt den Kauf im Rückgängig-Toast. */
function droppedResponse(zeilen: Record<string, unknown>[]) {
  return zeilen.map(z => ({
    id: Number(z.id),
    quantity: Number(z.quantity),
    purchase_price: z.purchase_price == null ? null : Number(z.purchase_price),
    currency: z.currency == null ? null : String(z.currency),
    price_estimated: !!z.price_estimated,
    condition: String(z.condition ?? 'N'),
    date: z.day == null ? null : String(z.day),
  }));
}

/** Die LETZTE Erfassung, weil der Detail-Dialog genau sie bearbeitet.
 * @param feld  fester Spaltenname, KEINE Eingabe von aussen */
async function writeInLastEntry(
  sk: SetsContext,
  feld: 'purchase_price' | 'condition',
  wert: number | string | null,
  ownerId: number,
  sn: string,
) {
  await sk.bestand.setNewest('set', feld === 'purchase_price' ? 'preis' : 'zustand', wert, ownerId, [sn]);
}

export async function changeSet(
  sk: SetsContext,
  uid: number,
  sn: string,
  body: Eingabe<'PUT /api/v1/sets/:setNumber'>,
) {
  // SCHREIB-Blickfeld statt eigener ID, sonst fände ein Set des Unterkontos keine Zeile.
  const _wids = await sk.household.schreibbereich(uid);
  // Die EIGENE Zeile gewinnt, sonst entschiede die Tabellenreihenfolge.
  const existing = await repo.setRowInWriteField(sk.db, _wids, sn, uid);
  if (!existing) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
  // Ab hier zählt der BESITZER, sonst entstünden Erfassungen im falschen Konto.
  const ownerId = parseInt(String(existing.user_id), 10);

  const hatDelta = body.quantity_delta !== undefined && body.quantity_delta !== null;
  const hasQuantity = hatDelta || (body.quantity !== undefined && body.quantity !== null);
  let papierkorb: number | null = null;
  let entfallen: ReturnType<typeof droppedResponse> = [];
  // Ein Marktpreis, der nicht kam, oder eine Menge, die sich nicht nachlesen liess, steht in `degradiert`.
  const ab = new Degradations();

  if (hasQuantity) {
    // Relativ, damit zwei gleichzeitige „+1" zwei ergeben statt sich zu überschreiben.
    const delta = hatDelta ? Number(body.quantity_delta) : null;
    if (delta !== null && (!Number.isInteger(delta) || Math.abs(delta) > 9999))
      fachfehler('ungueltig', 'wert_ungueltig');
    // Im Haushalt gehört jede Menge einem Konto; ohne Angabe dem eigenen. Ein fremdes nur im Schreibfeld.
    const ziel = body.owner_user_id == null ? uid : Number(body.owner_user_id);
    if (!_wids.includes(ziel)) fachfehler('verboten', 'kein_schreibrecht');
    const desiredTotal = delta === null ? inventoryQuantity(body.quantity) : null;
    const readField = await sk.household.scopeIds(uid);
    // Angezeigt wird der Haushalt, geändert nur das Zielkonto.
    const eigenesZiel = async (s: SetsContext) => {
      const totalBefore = await repo.setMenge(s.db, 'blickfeld', readField, sn);
      const ownBefore = await repo.setMenge(s.db, 'eines', ziel, sn);
      // Bei 0 gedeckelt: Exemplare eines anderen Kontos kann ich nicht wegnehmen.
      const aenderung = delta ?? Number(desiredTotal) - totalBefore;
      return { ownBefore, eigenZiel: Math.max(0, ownBefore + aenderung) };
    };
    // Der Marktpreis wird VOR der Sperre geholt (Netzaufruf); massgeblich ist die Rechnung in der Sperre.
    const upfront = await eigenesZiel(sk);
    const plan =
      upfront.eigenZiel > upfront.ownBefore
        ? await ab.oder('kaufpreis', priceForNewEntry(sk, ziel, sn), { price: null, condition: 'N' })
        : { price: null, condition: 'N' };
    await sk.transaktion(
      async t => {
        const { ownBefore, eigenZiel } = await eigenesZiel(t);
        if (eigenZiel === ownBefore) return;
        // Gehörte das Set bisher nur einem anderen Konto, liefe die Anpassung sonst ins Leere.
        if (ownBefore === 0 && eigenZiel > 0) await t.bestand.putSetAn(ziel, sn);
        // Menge 0 geht durch den Papierkorb, damit ein Tippfehler sich zurückholen lässt.
        if (eigenZiel === 0) {
          entfallen = droppedResponse(await repo.setEntriesAsJson(t.db, ziel, sn));
          papierkorb = await t.bestand.putInTrash('set', ziel, sn);
          await deleteSetRows(t, [ziel], sn);
        } else {
          // Auch einzelne Käufe gehen durch den Papierkorb: Sonst verschwände ein Kaufpreis ohne Rückweg.
          const weg = await entriesAnQuantityAlign(t, ziel, sn, eigenZiel, plan);
          entfallen = droppedResponse(weg);
          papierkorb = await t.bestand.putPurchasesInTrash(ziel, sn, weg);
        }
      },
      { sperren: [{ konto: ziel, schluessel: sn }] },
    );
  }
  // Mit einer Mengenänderung schickt die App alten Preis und Zustand als Echo; angewandt überschrieben sie
  // den Marktpreis der neuen Erfassung.
  if (body.purchase_price !== undefined && !hasQuantity) {
    let pp: number | null = body.purchase_price;
    if (pp === null || Number.isNaN(pp)) {
      // Zustand der LETZTEN Erfassung, sonst käme der Preis für „Neu". Ohne Fang: Nach einem Lesefehler käme
      // sonst der Neupreis in ein gebrauchtes Set.
      const lastCond = await repo.stateNewestSetEntry(sk.db, ownerId, sn);
      pp = await sk.finances.aktuellerMarktpreis(sn, ownerId, lastCond?.condition || null);
    }
    const val = pp !== null && !Number.isNaN(pp) ? pp : null;
    await writeInLastEntry(sk, 'purchase_price', val, ownerId, sn);
  }
  // null heisst „nicht gesetzt", nicht 'N'.
  if (body.condition !== undefined && body.condition !== null && !hasQuantity) {
    // ownerId: Mit dem Aufrufer träfe das UPDATE beim Unterkonto keine Zeile.
    await writeInLastEntry(sk, 'condition', zustand(body.condition), ownerId, sn);
  }
  // Geschrieben ist schon; scheitert nur das Nachlesen, sagt die Antwort „unbekannt“ statt 0.
  const nachher = await ab.oder(
    'menge',
    async () => (await repo.setMenge(sk.db, 'blickfeld', await sk.household.scopeIds(uid), sn)) ?? 0,
    null,
  );
  return {
    quantity: nachher,
    ...(papierkorb ? { papierkorb } : {}),
    ...(entfallen.length ? { entfallen } : {}),
    ...ab.angabe(),
  };
}

export async function setsAlsCsv(sk: SetsContext, uid: number) {
  const rows = await repo.setsForCsv(sk.db, uid);

  return toCsv(
    ['set_number', 'quantity', 'purchase_price', 'condition', 'acquired_at'],
    rows.map(r => ({ ...r, purchase_price: r.purchase_price ?? '' })),
  );
}

export async function rebrickableList(sk: SetsContext, uid: number) {
  const sets = await detailRepo.setsWithQuantity(sk.db, uid);
  return sets.map(s => ({ 'Set Number': s.set_number, Quantity: s.quantity }));
}

/** Eine Anleitung hängt per Fremdschlüssel am Set. */
export async function setBelongsAccount(sk: SetsContext, uid: number, sn: string): Promise<boolean> {
  return !!(await detailRepo.setOfAccount(sk.db, uid, sn));
}

/** Trifft alle Zeilen des Sets im Schreibbereich: Wer die Kiste packt, packt
 * sie für alle, die darin nachsehen. */
export async function setLocationOfSets(sk: SetsContext, uid: number, sn: string, storage: string | null | undefined) {
  const ort = normalizeLocation(storage);
  const n = await sk.bestand.locationService.setLocation('set', { schreiber: uid }, [normalisiereSetNummer(sn)], ort);
  return { ort, n };
}

/** Die Liste kann über mehrere Konten spannen, die Vorgabe ist immer die des
 * Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung. */
export async function locationsWithDefault(sk: SetsContext, uid: number, owner: string | undefined) {
  const [orte, vorgabe] = await Promise.all([
    sk.bestand.locationsFor(uid, owner),
    sk.bestand.locationService.vorgabeVon(uid),
  ]);
  return { orte, vorgabe };
}
