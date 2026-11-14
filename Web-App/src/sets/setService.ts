import { einstellungMitZugang } from '../einstellungen';
import { deleteSetRows } from './loeschen';
import { toCsv } from '../infra/csvExport';
import { normalisiereSetNummer } from '../infra/setNummer';
import { recordAcquisition } from './erfassen';
import { fachfehler } from '../infra/fehlerTexte';
import { bestandsMenge, zustand } from '../infra/validate';
import * as repo from './repository/sets';
import type { Eingabe } from '../vertrag';
import { versuche, wertOder, Abstriche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

/** Sets anlegen, ändern und ausgeben — eine Umsetzung für Web und App, damit
 * beide dieselben Regeln für Menge, Kaufpreis und Blickfeld erfüllen. */

// `unknown`: Hier kommen Formularfelder und CSV-Zellen an, nicht garantierte Zeichenketten.
export function sanitizeSetNumber(input: unknown) {
  return normalisiereSetNummer(input);
}

/** Reihenfolge Preis-Cache → BrickLink → Historie; bleibt alles leer, trägt
 * src/bestand/kaufpreisNachtrag.ts nach. */
async function priceForNewAcquisition(sk: SetsKontext, userId: number, setNumber: string) {
  // Über das Blickfeld: Mit einer nackten ID fände der Hauptaccount das Set des Unterkontos nicht.
  const blickfeld = wertOder(await versuche('sets:kaufpreis-blickfeld', sk.haushalt.blickfeldIds(userId)), [userId]);
  const cond = await sk.finanzen.resolveSetCondition(blickfeld, setNumber);
  // Die Währung DES KONTOS: Der Preis wird in ihr gesucht und gespeichert.
  const currency = String(await einstellungMitZugang(sk.db, userId, 'currency', 'EUR'));
  const cached = wertOder(
    await versuche('set-service:cached', repo.marktpreisAusCache(sk.db, setNumber, currency, cond)),
    null,
  );
  let pp = Number(cached?.marktpreis ?? 0) || null;
  if (!pp)
    pp = wertOder(
      await versuche('set-service:getCurrentMarketPrice', sk.finanzen.getCurrentMarketPrice(setNumber, userId, cond)),
      null,
    );
  if (!pp) {
    // Der Verlauf füllt die Lücke, wenn Cache und BrickLink-Kontingent beim CSV-Import leer ausgehen; sonst
    // entstünde die Erfassung ohne Kaufpreis.
    const hist = wertOder(
      await versuche('set-service:hist', repo.marktpreisAusVerlauf(sk.db, setNumber, currency, cond)),
      null,
    );
    pp = Number(hist?.marktpreis ?? 0) || null;
  }
  return { price: pp, condition: cond, geschaetzt: pp != null, currency };
}

/** @param pricePlan vorab ermittelt; ohne Angabe wird er hier geholt — dann
 *        darf sk KEINE Transaktion sein, weil ein Netzaufruf darin steckt. */
async function adjustAcquisitionsToQuantity(
  sk: SetsKontext,
  userId: number,
  setNumber: string,
  newTotalQty: number,
  pricePlan: { price: number | null; condition: string; geschaetzt?: boolean; currency?: string } | null = null,
) {
  // Ohne Fang: Mit einer leeren Liste nach einem Lesefehler buchte die Anpassung die ganze Menge neu.
  const rows: { id: number; quantity: number; created_at: Date }[] = await repo.setErfassungenNeuesteZuerst(
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
        // Aufstocken oder neue Tageszeile entscheidet recordAcquisitionForDay(), damit die Regel nur einmal
        // existiert.
        const plan = pricePlan ?? (await priceForNewAcquisition(sk, userId, setNumber));
        await recordAcquisition(sk, {
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
      const plan = pricePlan ?? (await priceForNewAcquisition(sk, userId, setNumber));
      await recordAcquisition(sk, {
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
    const zeile = await repo.setErfassungAlsJson(sk.db, r.id);
    if (zeile) entfallen.push({ ...zeile, quantity: take });
    if (take >= r.quantity) await repo.loescheSetErfassungNachId(sk.db, r.id);
    else await repo.kuerzeSetErfassung(sk.db, take, r.id);
    delta += take;
  }
  return entfallen;
}

/** Was eine Verringerung wegnahm, in der Form der Antwort: Die Oberfläche nennt den Kauf im Rückgängig-Toast. */
function entfallenAntwort(zeilen: Record<string, unknown>[]) {
  return zeilen.map(z => ({
    id: Number(z.id),
    quantity: Number(z.quantity),
    purchase_price: z.purchase_price == null ? null : Number(z.purchase_price),
    currency: z.currency == null ? null : String(z.currency),
    price_estimated: !!z.price_estimated,
    condition: String(z.condition ?? 'N'),
    date: z.tag == null ? null : String(z.tag),
  }));
}

/** Die LETZTE Erfassung, weil der Detail-Dialog genau sie bearbeitet.
 * @param feld  fester Spaltenname, KEINE Eingabe von aussen */
async function schreibeInLetzteErfassung(
  sk: SetsKontext,
  feld: 'purchase_price' | 'condition',
  wert: number | string | null,
  ownerId: number,
  sn: string,
) {
  await repo.schreibeInNeuesteSetErfassung(sk.db, wert, ownerId, sn, feld);
}

export async function updateSet(
  sk: SetsKontext,
  uid: number,
  sn: string,
  body: Eingabe<'PUT /api/v1/sets/:setNumber'>,
) {
  // SCHREIB-Blickfeld statt eigener ID, sonst fände ein Set des Unterkontos keine Zeile.
  const _wids = await sk.haushalt.schreibbereich(uid);
  // Die EIGENE Zeile gewinnt, sonst entschiede die Tabellenreihenfolge.
  const existing = await repo.setZeileImSchreibfeld(sk.db, _wids, sn, uid);
  if (!existing) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
  // Ab hier zählt der BESITZER, sonst entstünden Erfassungen im falschen Konto.
  const ownerId = parseInt(String(existing.user_id), 10);

  const hatDelta = body.quantity_delta !== undefined && body.quantity_delta !== null;
  const hasQuantity = hatDelta || (body.quantity !== undefined && body.quantity !== null);
  let papierkorb: number | null = null;
  let entfallen: ReturnType<typeof entfallenAntwort> = [];
  // Ein Marktpreis, der nicht kam, oder eine Menge, die sich nicht nachlesen liess, steht in `degradiert`.
  const ab = new Abstriche();

  if (hasQuantity) {
    // Relativ, damit zwei gleichzeitige „+1" zwei ergeben statt sich zu überschreiben.
    const delta = hatDelta ? Number(body.quantity_delta) : null;
    if (delta !== null && (!Number.isInteger(delta) || Math.abs(delta) > 9999))
      fachfehler('ungueltig', 'wert_ungueltig');
    // Im Haushalt gehört jede Menge einem Konto; ohne Angabe dem eigenen. Ein fremdes nur im Schreibfeld.
    const ziel = body.owner_user_id == null ? uid : Number(body.owner_user_id);
    if (!_wids.includes(ziel)) fachfehler('verboten', 'kein_schreibrecht');
    const gewuenschtGesamt = delta === null ? bestandsMenge(body.quantity) : null;
    const leseFeld = await sk.haushalt.blickfeldIds(uid);
    // Angezeigt wird der Haushalt, geändert nur das Zielkonto.
    const eigenesZiel = async (s: SetsKontext) => {
      const gesamtVorher = await repo.setMenge(s.db, 'blickfeld', leseFeld, sn);
      const eigenVorher = await repo.setMenge(s.db, 'eines', ziel, sn);
      // Bei 0 gedeckelt: Exemplare eines anderen Kontos kann ich nicht wegnehmen.
      const aenderung = delta ?? Number(gewuenschtGesamt) - gesamtVorher;
      return { eigenVorher, eigenZiel: Math.max(0, eigenVorher + aenderung) };
    };
    // Der Marktpreis wird VOR der Sperre geholt (Netzaufruf); massgeblich ist die Rechnung in der Sperre.
    const vorab = await eigenesZiel(sk);
    const plan =
      vorab.eigenZiel > vorab.eigenVorher
        ? await ab.oder('kaufpreis', priceForNewAcquisition(sk, ziel, sn), { price: null, condition: 'N' })
        : { price: null, condition: 'N' };
    await sk.transaktion(
      async t => {
        const { eigenVorher, eigenZiel } = await eigenesZiel(t);
        if (eigenZiel === eigenVorher) return;
        // Gehörte das Set bisher nur einem anderen Konto, liefe die Anpassung sonst ins Leere.
        if (eigenVorher === 0 && eigenZiel > 0) await repo.uebernimmSetZeile(t.db, ziel, leseFeld, sn);
        // Menge 0 geht durch den Papierkorb, damit ein Tippfehler sich zurückholen lässt.
        if (eigenZiel === 0) {
          entfallen = entfallenAntwort(await repo.setErfassungenAlsJson(t.db, ziel, sn));
          papierkorb = await t.bestand.legeInPapierkorb('set', ziel, sn);
          await deleteSetRows(t, [ziel], sn);
        } else {
          // Auch einzelne Käufe gehen durch den Papierkorb: Sonst verschwände ein Kaufpreis ohne Rückweg.
          const weg = await adjustAcquisitionsToQuantity(t, ziel, sn, eigenZiel, plan);
          entfallen = entfallenAntwort(weg);
          papierkorb = await t.bestand.legeKaeufeInPapierkorb(ziel, sn, weg);
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
      const lastCond = await repo.zustandNeuesteSetErfassung(sk.db, ownerId, sn);
      pp = await sk.finanzen.getCurrentMarketPrice(sn, ownerId, lastCond?.condition || null);
    }
    const val = pp !== null && !Number.isNaN(pp) ? pp : null;
    await schreibeInLetzteErfassung(sk, 'purchase_price', val, ownerId, sn);
  }
  // null heisst „nicht gesetzt", nicht 'N'.
  if (body.condition !== undefined && body.condition !== null && !hasQuantity) {
    // ownerId: Mit dem Aufrufer träfe das UPDATE beim Unterkonto keine Zeile.
    await schreibeInLetzteErfassung(sk, 'condition', zustand(body.condition), ownerId, sn);
  }
  // Geschrieben ist schon; scheitert nur das Nachlesen, sagt die Antwort „unbekannt“ statt 0.
  const nachher = await ab.oder(
    'menge',
    async () => (await repo.setMenge(sk.db, 'blickfeld', await sk.haushalt.blickfeldIds(uid), sn)) ?? 0,
    null,
  );
  return {
    quantity: nachher,
    ...(papierkorb ? { papierkorb } : {}),
    ...(entfallen.length ? { entfallen } : {}),
    ...ab.angabe(),
  };
}

export async function buildSetsCsv(sk: SetsKontext, uid: number) {
  const rows = await repo.setsFuerCsv(sk.db, uid);

  return toCsv(
    ['set_number', 'quantity', 'purchase_price', 'condition', 'acquired_at'],
    rows.map(r => ({ ...r, purchase_price: r.purchase_price ?? '' })),
  );
}
