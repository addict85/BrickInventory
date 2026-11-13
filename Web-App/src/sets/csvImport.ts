/** CSV-Import der Sets: Zeilen lesen, Auftrag starten, Stand melden. */
import { vorDem, fehlertext, oeffentlicherFehler } from '../infra/fehler';
import { buildJobStatus, csvImportBus } from '../auftraege';
import { normalizeSetNumber } from './erfassen';
import { csvEinlesen, entschaerfungRueckgaengig, parseCsvDate, zeilenListe } from '../infra/csvExport';
import { fachfehler, type Sprache } from '../infra/fehlerTexte';
import { randomUUID } from 'node:crypto';
import * as repo from './repository/setDetail';
import { versuche } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

export interface ImportZeile {
  sn: string;
  qty: number;
  purchasePrice: number | null;
  condition: string | null;
  acquiredAt: string | null;
  zeile?: number;
  fehler?: { code: 'csv_menge_ungueltig' | 'csv_keine_setnummer'; wert?: string };
}

/** Aus „x“ eine 1 und aus „-2“ eine 2 zu machen buchte still etwas anderes, als in der Datei steht. */
function csvMenge(roh: string): number | null {
  const s = roh.trim();
  if (s === '') return 1;
  return /^\d{1,6}$/.test(s) && Number(s) >= 1 ? Number(s) : null;
}

/** Spaltennamen ohne Gross/klein und BOM. */
export function setCsvZeilen(text: string): { rows: ImportZeile[]; uebersprungen: number[] } {
  let gelesen: ReturnType<typeof csvEinlesen>;
  try {
    gelesen = csvEinlesen(text);
  } catch (e) {
    fachfehler('ungueltig', 'csv_parse_fehler', { grund: fehlertext(e) });
  }
  if (!gelesen.records.length) {
    if (gelesen.uebersprungen.length)
      fachfehler('ungueltig', 'csv_keine_brauchbare_zeile', { zeilen: zeilenListe(gelesen.uebersprungen) });
    fachfehler('ungueltig', 'csv_keine_datenzeilen');
  }
  const rows: ImportZeile[] = [];
  for (const [i, roh] of gelesen.records.entries()) {
    const zeile = gelesen.zeilen[i];
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh))
      row[
        k
          .toLowerCase()
          .trim()
          .replace(/^\uFEFF/, '')
      ] = String(entschaerfungRueckgaengig(v) ?? '');
    const rawSn = row.set_number || row.setnummer || row.set || Object.values(row)[0];
    const sn = rawSn ? vorDem(String(rawSn), ';').trim() : '';
    const leer = { sn, qty: 0, purchasePrice: null, condition: null, acquiredAt: null, ...(zeile ? { zeile } : {}) };
    if (!sn) {
      rows.push({ ...leer, fehler: { code: 'csv_keine_setnummer' } });
      continue;
    }
    const mengeRoh = String(row.quantity ?? row.anzahl ?? row.qty ?? row.menge ?? '');
    const qty = csvMenge(mengeRoh);
    if (qty === null) {
      rows.push({ ...leer, fehler: { code: 'csv_menge_ungueltig', wert: mengeRoh.trim().slice(0, 20) } });
      continue;
    }
    const rawPrice = row.purchase_price ?? row.kaufpreis ?? row.einkaufspreis ?? row.price ?? '';
    const preis = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
    const zustand = String(row.condition || row.zustand || row.kondition || '')
      .trim()
      .toUpperCase();
    rows.push({
      sn,
      qty,
      ...(zeile ? { zeile } : {}),
      purchasePrice: preis !== null && !Number.isNaN(preis) ? preis : null,
      condition: ['N', 'U'].includes(zustand) ? zustand : null,
      // 05.03.2026 ist der 5. März, nicht der 3. Mai.
      acquiredAt: parseCsvDate(row.acquired_at || row.erfassungsdatum || row.datum),
    });
  }
  return { rows, uebersprungen: gelesen.uebersprungen };
}

/** Der Import erhöht bei vorhandenen Sets die Menge, das Einzel-Erfassen lehnt sie ab: Die Oberfläche fragt. */
async function schonVorhanden(sk: SetsKontext, userId: number, rows: ImportZeile[]): Promise<string[]> {
  const da = new Set((await repo.setsMitMenge(sk.db, userId)).map(s => s.set_number));
  const treffer = rows
    .filter(r => !r.fehler)
    .map(r => normalizeSetNumber(r.sn))
    .filter(sn => da.has(sn));
  return [...new Set(treffer)];
}

/** Ein laufender Import desselben Kontos wird abgebrochen; `nurPruefen` liest nur. */
export async function setCsvImportStarten(sk: SetsKontext, userId: number, text: string, nurPruefen = false) {
  const { rows, uebersprungen } = setCsvZeilen(text);
  const vorhanden = await schonVorhanden(sk, userId, rows);
  if (nurPruefen) return { total: rows.length, uebersprungen, vorhanden, gestartet: false };
  const laufend = await sk.auftraege.jobGet(userId);
  if (laufend && laufend.status === 'running') await sk.auftraege.jobUpdate(userId, { status: 'cancelled' });
  const lauf = randomUUID();
  await sk.auftraege.jobSet(userId, {
    status: 'running',
    total: rows.length,
    done: 0,
    current: null,
    results: JSON.stringify([]),
    error: null,
    run_id: lauf,
  });
  try {
    await sk.auftraege.stelleAuftragEin('csv_import', { user_id: userId, lauf, rows }, { userId, maxVersuche: 3 });
  } catch (e) {
    await versuche(
      'csv-import:fehler vermerken',
      sk.auftraege.jobUpdate(
        userId,
        { status: 'error', error: oeffentlicherFehler(e, 'csv-import:einstellen').error },
        lauf,
      ),
    );
    throw e;
  }
  await sk.auftraege.emitJobStatus(userId);
  return { total: rows.length, uebersprungen, vorhanden, gestartet: true };
}

export async function setCsvImportAbbrechen(k: SetsKontext, userId: number) {
  // Ohne Fang: Schlägt das Vermerken fehl, liefe der Import weiter, während die Antwort „abgebrochen“ sagte.
  await k.auftraege.jobUpdate(userId, { status: 'cancelled' });
  await k.auftraege.emitJobStatus(userId);
}

type Kopf = { headers?: Record<string, unknown> };

export async function csvImportStand(k: SetsKontext, uid: number, req: Kopf) {
  return buildJobStatus(await k.auftraege.jobGet(uid), req);
}

/** Im offenen Strom gibt es keinen Statuscode mehr: Ein Lesefehler wird zu „kein Import“. */
export async function csvImportStandFuerStrom(k: SetsKontext, uid: number, req: Kopf, sprache: Sprache) {
  return buildJobStatus(await k.auftraege.jobGet(uid), req, sprache);
}

/** Meldet jeden Stand des CSV-Imports dieses Kontos, aus diesem und aus anderen Prozessen. */
export function csvImportStandAbonnieren(k: SetsKontext, uid: number, melde: () => void): () => void {
  const lokal = () => melde();
  csvImportBus.on(`progress:${uid}`, lokal);
  const abmelden = k.auftraege.beiImportStand(konto => {
    if (String(konto) === String(uid)) melde();
  });
  return () => {
    csvImportBus.off(`progress:${uid}`, lokal);
    abmelden();
  };
}
