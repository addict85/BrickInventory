/** SQL, Rebrickable und Aufträge stehen nur hier und darunter, damit die Routen nur Anfrage und Antwort kennen. */
import { blickfeldAus, schreibziel } from '../haushalt/haushalt';
import type { Sicht } from '../haushalt/haushalt';
import { vorDem, fehlertext, ohneFehlendeDatei, oeffentlicherFehler } from '../infra/fehler';
import fs from 'fs';
import path from 'path';
import { APP_ROOT, DATA_DIR } from '../infra/appPaths';
import { stelleAuftragEin } from '../auftraege/dienst';
import { resolveImageLocal, proxyImageUrl } from '../katalog/bilder/images';
import { getSetting } from '../einstellungen/settings';
import { normalisiereLagerort, setzeLagerort, orteFuer, vorgabeVon } from '../bestand/lagerort';
import { alarmeFuer, loescheAlarm, setzeAlarm } from '../finanzen/preisalarm';
import { importAlsAuftrag } from '../auftraege/importAlsAuftrag';
import { anleitungEinreihen } from '../auftraege/anleitungsAuftrag';
import { anleitungenZuSet, anleitungenZusammenlegen, loescheAnleitungen, anleitungNeuLadenErlaubt, anzahlAnleitungen } from '../katalog/instructions';
import { importPartsForSet } from '../katalog/partsImport';
import { zaehleAnfrage } from '../konto/loginLimiter';
import { setNummerImBlickfeld } from '../katalog/bilder/bildBlickfeld';
import { normalizeSetNumber, findSetInScope } from './erfassen';
import { istErsatzteil } from '../infra/validate';
import { istVermutung } from '../katalog/barcodeQuelle';
import { setnummerKandidaten } from '../katalog/produkttitel';
import { fetchPrice, resolveSetCondition } from '../finanzen/financeCalc';
import { neuestesInventar } from '../katalog/rbInventar';
import { mitVersion, ohneVersion, normalisiereSetNummer, moeglicheSetNummer } from '../infra/setNummer';
import { figurenAusKatalog } from '../katalog/minifigsImport';
import { csvEinlesen, entschaerfungRueckgaengig, parseCsvDate, zeilenListe } from '../infra/csvExport';
import type { CsvImportBericht } from '../infra/csvExport';
import { jobGet, jobSet, jobUpdate, emitJobStatus, buildJobStatus, csvImportBus, beiImportStand } from '../auftraege/importAuftrag';
import { getSetPriceHistory } from '../finanzen/priceHistory';
import { verschiebeSet } from './setMove';
import { getSetByBarcode, getSetByEan, getMinifigInfo, getSetMinifigs, rebrickableJson, produktTitel, RbSet, RbSetFigur, rbSeite, ersteBlNummer } from '../katalog/quellen';
import { getAllSetParts } from '../katalog/rebrickableKatalog';
import type { RbSetTeil } from '../katalog/quellen';
import { fachfehler } from '../infra/fehlerTexte';
import type { Sprache } from '../infra/fehlerTexte';
import { merkeFigur, merkeSetFiguren } from '../katalog/katalogPflege';
import { randomUUID } from 'crypto';
import * as repo from './repository/setDetail';
import * as katalogStamm from '../katalog/setStamm';
import type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';
import { versuche, wertOder } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';
export type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';


/** Ohne Eintrag null. */
export async function setInfo(sk: SetsKontext, setNumber: string): Promise<SetStamm | null> {
  return (await repo.setStamm(sk.db, mitVersion(setNumber))) ?? null;
}

/** Was das fragende Konto über eine Nummer erfahren darf: Ein fremder Platzhalter
 * antwortet wie eine nie erfasste Nummer, sonst verriete er die Erfassung eines anderen. */
export async function setInfoFuerKonto(sk: SetsKontext, uid: number, setNumber: string) {
  const n = mitVersion(setNumber);
  const stamm = await setInfo(sk, n);
  const fremderPlatzhalter = !!stamm?.platzhalter && !(await setNummerImBlickfeld(uid, n));
  if (!stamm || fremderPlatzhalter) return { set_number: n, name: n, im_katalog: false as const };
  const { platzhalter: _platzhalter, ...row } = stamm;
  return { set_number: n, ...row, name: row.name || n, im_katalog: true as const };
}

/** Set-Bilder gehen an jedes Konto (bildBlickfeld.ts); der Treffer nennt sein Bild. */
export async function setZumBarcodeFuerKonto(sk: SetsKontext, _uid: number, rohBarcode: string): Promise<BarcodeTreffer | null> {
  return setZumBarcode(sk, rohBarcode);
}

export interface BarcodeTreffer {
  unsicher: boolean; set_number: string; name: string | null;
  year?: number | null; pieces?: number | null; theme?: string | null; minifigs: number | null;
  image_url: string | null; image_local?: string | null | undefined; source: string;
}

/** Rebrickable zuerst: Dort stehen Figurenzahl und Bild am verlässlichsten.
 * Jede Antwort sagt, wie sie zustande kam (src/katalog/barcodeQuelle.ts). */
async function barcodeErgebnis(sk: SetsKontext, setNumber: string, name: string | null, source: string): Promise<BarcodeTreffer> {
  const rbData = await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/`, RbSet);
  const mfData = rbData ? await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/minifigs/?page_size=1`, rbSeite(RbSetFigur)) : null;
  // Ohne Fang: Eine gestörte Datenbank ist kein „nicht im Katalog“.
  const local = await repo.setKatalog(sk.db, setNumber);

  const minifigs = mfData?.count ?? local?.minifigs ?? null;
  const image_url = rbData?.set_img_url || local?.image_url || null;
  const image_local = local?.image_local ? resolveImageLocal(local.image_local) : null;
  const unsicher = istVermutung(source);

  if (local) {
    return { unsicher, set_number: setNumber,
      name: local.name || rbData?.name || name, year: local.year || rbData?.year || null,
      pieces: local.pieces || rbData?.num_parts || null, theme: local.theme,
      minifigs, image_local, image_url, source };
  }
  if (rbData?.set_num) {
    // In den Katalog wie jeder Abruf; der Treffer gilt auch, wenn das Ablegen scheitert.
    await versuche('sets:katalog schreiben', katalogStamm.merkeSetKatalog(sk.db, setNumber, rbData.name ?? null,
      rbData.year ?? null, null, rbData.num_parts ?? null, minifigs, rbData.set_img_url ?? null, null,
      Number(rbData.theme_id) || null));
    return { unsicher, set_number: setNumber, name: rbData.name || name, year: rbData.year ?? null,
      pieces: rbData.num_parts ?? null, theme: null, minifigs, image_url, source };
  }
  return { unsicher, set_number: setNumber, name, minifigs, image_url, source };
}

async function imKatalog(sk: SetsKontext, ...nummern: string[]): Promise<{ set_number: string; name: string | null } | undefined> {
  return repo.ersterKatalogTreffer(sk.db, nummern);
}

/** Reihenfolge: eigener Katalog, EAN über Rebrickable, Brickset und UPCitemdb,
 * dann Bestellnummer — die billigste Quelle zuerst. */
export async function setZumBarcode(sk: SetsKontext, rohBarcode: string): Promise<BarcodeTreffer | null> {
  const barcode = rohBarcode.trim();
  const direct = await repo.katalogCacheNachNummer(sk.db, mitVersion(barcode));
  if (direct) return barcodeErgebnis(sk, direct.set_number, direct.name, 'catalog_cache');

  if (/^\d{12,13}$/.test(barcode)) {
    const ean13 = barcode.length === 12 ? '0' + barcode : barcode;
    const rb = await rebrickableJson(`/lego/sets/?search=${encodeURIComponent(ean13)}&page_size=5`, rbSeite(RbSet));
    for (const set of (rb?.results || [])) {
      const detail = await rebrickableJson(`/lego/sets/${encodeURIComponent(set.set_num)}/`, RbSet);
      const extIds = Object.values(detail?.external_ids || {}).flat().map(String);
      if (extIds.includes(ean13) || extIds.includes(barcode)) return barcodeErgebnis(sk, set.set_num, set.name ?? null, 'rebrickable-ean');
    }
    const plausibel = rb?.results.find(s => (s.year ?? 0) > 2010 && (s.num_parts ?? 0) > 0);
    if (plausibel) return barcodeErgebnis(sk, plausibel.set_num, plausibel.name ?? null, 'rebrickable-search');

    const bsEan = await getSetByEan(ean13);
    if (bsEan) {
      const r = await barcodeErgebnis(sk, bsEan.set_number, bsEan.name, 'brickset-ean');
      return { ...r, year: r.year || bsEan.year, theme: r.theme || bsEan.theme, pieces: r.pieces || bsEan.pieces };
    }

    // Der Titel ist Händlertext: Erst die Kandidaten, die der Katalog kennt; sonst bleibt der erste als
    // markierte Vermutung stehen.
    const titel = await produktTitel(ean13);
    if (titel) {
      const kandidaten = setnummerKandidaten(titel);
      for (const k of kandidaten) {
        const bekannt = await imKatalog(sk, k, normalizeSetNumber(k));
        if (bekannt) return barcodeErgebnis(sk, bekannt.set_number, titel, 'upcitemdb');
      }
      if (kandidaten[0]) return barcodeErgebnis(sk, normalizeSetNumber(kandidaten[0]), titel, 'upcitemdb');
    }
  }

  if (/^\d{5,8}$/.test(barcode)) {
    const bs = await getSetByBarcode(barcode);
    if (bs) return barcodeErgebnis(sk, bs.set_number, bs.name, 'brickset-item');
    const rb = await rebrickableJson(`/lego/sets/${barcode}-1/`, RbSet);
    if (rb?.set_num) return barcodeErgebnis(sk, rb.set_num, rb.name ?? null, 'rebrickable-direct');
  }
  return null;
}


function katalogDesSets(sk: SetsKontext, setNumber: string): Promise<KatalogTeil[]> {
  return repo.katalogTeileDesSets(sk.db, mitVersion(setNumber));
}

/** Ungeblättert; die Seitenangaben stehen da, weil die App sie mit der Teileliste des Bestands teilt. */
const eineSeite = (n: number) => ({ total: n, page: 1, page_size: n });

export const QUELLE_GESTOERT = 'quelle_gestoert';

export async function teilelisteDesSets(sk: SetsKontext, setNum: string, anreichern: (sn: string) => Promise<unknown>) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const invId = await neuestesInventar(setNum);
  let teile: ListenTeil[] = [];
  let source = 'db';
  if (invId) {
    teile = await repo.inventarTeileDesSets(sk.db, invId);
  }
  if (!teile.length) {
    source = 'api';
    // Ist Rebrickable gestört, sagt die Antwort das; eine leere Liste hiesse „das Set hat keine Teile“.
    const mit = await versuche('sets:getAllSetParts', getAllSetParts(n));
    const rb = mit.ok && mit.wert ? mit : await versuche('sets:getAllSetParts', getAllSetParts(bare));
    if (!rb.ok) return { parts: [], source: QUELLE_GESTOERT, error: rb.fehler.grund, ...eineSeite(0) };
    teile = (rb.wert || []).map((r: RbSetTeil) => ({
      part_number: r.part.part_num, bl_part_number: ersteBlNummer(r.part.external_ids) || r.part.part_num,
      part_name: r.part.name || r.part.part_num, color_id: r.color.id, color_name: r.color.name || '',
      color_hex: r.color.rgb || null, rb_image_url: r.part.part_img_url || null,
      total_quantity: r.quantity, is_spare: !!r.is_spare }));
  }
  if (!teile.length) return { parts: [], source: 'not_found', ...eineSeite(0) };

  const katalog = new Map<string, KatalogTeil>();
  const merke = (zeilen: KatalogTeil[]) => { for (const r of zeilen) katalog.set(`${r.part_number}|${r.color_id}`, r); };
  merke(await katalogDesSets(sk, setNum));
  if (teile.some(p => !katalog.has(`${p.part_number}|${p.color_id}`))) {
    await versuche('sets:enrichSetParts', anreichern(setNum));
    merke(await katalogDesSets(sk, setNum));
  }

  // Schlüssel ist die Rebrickable-Nummer samt Farbe: Formvarianten teilen sich oft eine BrickLink-Nummer und
  // dürfen nicht verschmelzen.
  const zeilen = new Map<string, {
    part_number: string; bl_part_number: string; part_name: string; color_id: number; bl_color_id: number | null;
    color_name: string; color_hex: string | null; image_url: string | null; total_quantity: number; is_spare: boolean;
  }>();
  for (const p of teile) {
    const key = `${p.part_number}|${p.color_id}`;
    const cat = katalog.get(key);
    const menge = parseInt(String(p.total_quantity)) || 0;
    const bild = cat?.image_local || (cat?.image_url ? proxyImageUrl(cat.image_url) : null) || p.rb_image_url || null;
    const da = zeilen.get(key);
    if (da) { da.total_quantity += menge; continue; }
    zeilen.set(key, {
      part_number: p.part_number, bl_part_number: cat?.bl_part_number || p.bl_part_number || p.part_number,
      part_name: cat?.part_name || p.part_name || p.part_number, color_id: p.color_id,
      bl_color_id: p.bl_color_id ?? null, color_name: cat?.color_name || p.color_name || '',
      color_hex: cat?.color_hex || p.color_hex || null, image_url: bild, total_quantity: menge,
      is_spare: istErsatzteil(p.is_spare) });
  }
  await versuche(`sets:bilder einstellen ${setNum}`,
    stelleAuftragEin('bilder', { set_number: setNum }, { schluessel: `bilder:${n}`, maxVersuche: 3 }));
  return { parts: [...zeilen.values()], source, ...eineSeite(zeilen.size) };
}

/** Was nicht aus dem Katalog kam, schreibt ein Nachlauf hinein. */
export async function figurenlisteDesSets(sk: SetsKontext, setNum: string) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const ausgabe = (f: { fig_number: string; fig_name?: string | null; quantity?: number | null; image_url?: string | null }) => ({
    fig_number: f.fig_number, fig_name: f.fig_name || f.fig_number, quantity: f.quantity || 1,
    total_quantity: f.quantity || 1, image_url: proxyImageUrl(f.image_url),
    // Dieselbe Form wie eine Figur des Bestands, ohne Zustände und Besitzer.
    source: 'set', conditions: [] as string[], owners: [] as { id: number; username: string }[] });

  const katalog = await figurenAusKatalog(setNum);
  if (katalog.length) return { figs: katalog.map(ausgabe), source: 'catalog' };

  type Fig = { fig_number: string; fig_name: string | null; quantity: number; image_url: string | null };
  let figs: Fig[] = [];
  const invId = await neuestesInventar(setNum);
  if (invId) {
    figs = await repo.inventarFigurenDesSets(sk.db, invId);
  }
  if (!figs.length) {
    const mit = await versuche('sets:getSetMinifigs', getSetMinifigs(n));
    const rb = mit.ok && mit.wert ? mit : await versuche('sets:getSetMinifigs', getSetMinifigs(bare));
    if (!rb.ok) return { figs: [], source: QUELLE_GESTOERT, error: rb.fehler.grund };
    figs = rb.wert || [];
  }
  if (!figs.length) return { figs: [], source: 'not_found' };
  setImmediate(() => { void versuche('sets:figurenkatalog schreiben', figurenMerken(n, figs)); });
  return { figs: figs.map(ausgabe), source: 'csv_cache' };
}

async function figurenMerken(n: string, figs: Array<{ fig_number: string; fig_name: string | null; quantity: number; image_url: string | null }>) {
  for (const f of figs) {
    let bild = f.image_url || null;
    if (!bild) bild = wertOder(await versuche('sets:minifigur-info', getMinifigInfo(f.fig_number)), null)?.image_url || null;
    await merkeFigur(f.fig_number, f.fig_name, bild);
    await merkeSetFiguren(n, [{ figNumber: f.fig_number, quantity: f.quantity }]);
  }
}

/** Im Zustand des Bestands. null: kein Set im Blickfeld. */
export async function setPreis(sk: SetsKontext, uid: number, blickfeldWahl: Sicht | number[], sn: string) {
  const blickfeld = await blickfeldAus(blickfeldWahl);
  const set = await repo.setImFeld(sk.db, sn, blickfeld);
  if (!set) return null;
  // Die Währung aus der Einstellung: Die App schickte ihren lokalen Startwert mit, bevor sie die Einstellung
  // kannte.
  const currency  = await getSetting(uid, 'currency', 'EUR');
  const guideType = await getSetting(uid, 'price_guide_type', 'sold');
  const ttlHours  = await getSetting(uid, 'price_cache_ttl', '24');
  const preis = await versuche('sets:preis', async () =>
    fetchPrice(sn, await resolveSetCondition(blickfeld, sn), guideType, currency, ttlHours));
  if (!preis.ok) return { set_number: sn, currency, min_price: null, avg_price: null, max_price: null, qty_avg_price: null,
    no_price: true, error: preis.fehler.grund };
  const pd = preis.wert;
  return { set_number: sn, currency, min_price: pd.min_price, avg_price: pd.avg_price,
    max_price: pd.max_price, qty_avg_price: pd.qty_avg_price, from_cache: pd.from_cache,
    no_price: !!(pd as { no_price?: boolean }).no_price };
}

export async function rebrickableListe(sk: SetsKontext, uid: number) {
  const sets = await repo.setsMitMenge(sk.db, uid);
  return sets.map(s => ({ 'Set Number': s.set_number, 'Quantity': s.quantity }));
}

/** Eine Anleitung hängt per Fremdschlüssel am Set. */
export async function setGehoertKonto(sk: SetsKontext, uid: number, sn: string): Promise<boolean> {
  return !!(await repo.setDesKontos(sk.db, uid, sn));
}

export async function anleitungMerken(sk: SetsKontext, uid: number, sn: string, pfad: string, beschreibung: string) {
  await repo.fuegeAnleitungEin(sk.db, uid, sn, pfad, beschreibung, pfad);
}

/** Die Datei bleibt, solange eine andere Zeile auf sie zeigt.
 * @returns false, wenn es die Zeile nicht gab */
export async function anleitungLoeschen(sk: SetsKontext, uid: number, id: string): Promise<boolean> {
  const instr = await repo.anleitungsPfad(sk.db, id, uid);
  if (!instr) return false;
  await repo.loescheAnleitung(sk.db, id, uid);
  if (!instr.local_path?.startsWith('/data/uploads/')) return true;
  // Weiss die Datenbank nicht, ob noch jemand die Datei braucht, bleibt sie liegen.
  const rest = wertOder(await versuche('sets:anleitung-noch-benutzt', repo.anleitungsdateiBenutzt(sk.db, instr.local_path)), { ok: 1 });
  // Der Eintrag ist schon weg; eine liegen gebliebene Datei kostet nur Platz.
  if (!rest) await fs.promises.unlink(path.join(APP_ROOT, instr.local_path.slice(1)))
    .catch(ohneFehlendeDatei('anleitung:datei-loeschen'));
  return true;
}

export interface ImportZeile {
  sn: string; qty: number; purchasePrice: number | null; condition: string | null; acquiredAt: string | null;
  zeile?: number; fehler?: { code: 'csv_menge_ungueltig' | 'csv_keine_setnummer'; wert?: string };
}

/** Aus „x“ eine 1 und aus „-2“ eine 2 zu machen buchte still etwas anderes, als in der Datei steht. */
function csvMenge(roh: string): number | null {
  const s = roh.trim();
  if (s === '') return 1;
  return /^\d{1,6}$/.test(s) && Number(s) >= 1 ? Number(s) : null;
}

/** Spaltennamen ohne Gross/klein und BOM. */
export function setCsvZeilen(text: string): { rows: ImportZeile[]; uebersprungen: number[] } {
  let gelesen;
  try { gelesen = csvEinlesen(text); }
  catch (e) { fachfehler('ungueltig', 'csv_parse_fehler', { grund: fehlertext(e) }); }
  if (!gelesen.records.length) {
    if (gelesen.uebersprungen.length) fachfehler('ungueltig', 'csv_keine_brauchbare_zeile', { zeilen: zeilenListe(gelesen.uebersprungen) });
    fachfehler('ungueltig', 'csv_keine_datenzeilen');
  }
  const rows: ImportZeile[] = [];
  for (const [i, roh] of gelesen.records.entries()) {
    const zeile = gelesen.zeilen[i];
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh)) row[k.toLowerCase().trim().replace(/^\uFEFF/, '')] = String(entschaerfungRueckgaengig(v) ?? '');
    const rawSn = row.set_number || row['setnummer'] || row['set'] || Object.values(row)[0];
    const sn = rawSn ? vorDem(String(rawSn), ';').trim() : '';
    const leer = { sn, qty: 0, purchasePrice: null, condition: null, acquiredAt: null, ...(zeile ? { zeile } : {}) };
    if (!sn) { rows.push({ ...leer, fehler: { code: 'csv_keine_setnummer' } }); continue; }
    const mengeRoh = String(row.quantity ?? row['anzahl'] ?? row['qty'] ?? row['menge'] ?? '');
    const qty = csvMenge(mengeRoh);
    if (qty === null) { rows.push({ ...leer, fehler: { code: 'csv_menge_ungueltig', wert: mengeRoh.trim().slice(0, 20) } }); continue; }
    const rawPrice = row.purchase_price ?? row['kaufpreis'] ?? row['einkaufspreis'] ?? row['price'] ?? '';
    const preis = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
    const zustand = String(row.condition || row['zustand'] || row['kondition'] || '').trim().toUpperCase();
    rows.push({ sn, qty, ...(zeile ? { zeile } : {}), purchasePrice: preis !== null && !isNaN(preis) ? preis : null,
      condition: ['N', 'U'].includes(zustand) ? zustand : null,
      // 05.03.2026 ist der 5. März, nicht der 3. Mai.
      acquiredAt: parseCsvDate(row.acquired_at || row['erfassungsdatum'] || row['datum']) });
  }
  return { rows, uebersprungen: gelesen.uebersprungen };
}

/** Der Import erhöht bei vorhandenen Sets die Menge, das Einzel-Erfassen lehnt sie ab: Die Oberfläche fragt. */
async function schonVorhanden(sk: SetsKontext, userId: number, rows: ImportZeile[]): Promise<string[]> {
  const da = new Set((await repo.setsMitMenge(sk.db, userId)).map(s => s.set_number));
  const treffer = rows.filter(r => !r.fehler).map(r => normalizeSetNumber(r.sn)).filter(sn => da.has(sn));
  return [...new Set(treffer)];
}

/** Ein laufender Import desselben Kontos wird abgebrochen; `nurPruefen` liest nur. */
export async function setCsvImportStarten(sk: SetsKontext, userId: number, text: string, nurPruefen = false) {
  const { rows, uebersprungen } = setCsvZeilen(text);
  const vorhanden = await schonVorhanden(sk, userId, rows);
  if (nurPruefen) return { total: rows.length, uebersprungen, vorhanden, gestartet: false };
  const laufend = await jobGet(userId);
  if (laufend && laufend.status === 'running') await jobUpdate(userId, { status: 'cancelled' });
  const lauf = randomUUID();
  await jobSet(userId, { status: 'running', total: rows.length, done: 0, current: null,
    results: JSON.stringify([]), error: null, run_id: lauf });
  try {
    await stelleAuftragEin('csv_import', { user_id: userId, lauf, rows }, { userId, maxVersuche: 3 });
  } catch (e) {
    await versuche('csv-import:fehler vermerken', jobUpdate(userId, { status: 'error', error: oeffentlicherFehler(e, 'csv-import:einstellen').error }, lauf));
    throw e;
  }
  await emitJobStatus(userId);
  return { total: rows.length, uebersprungen, vorhanden, gestartet: true };
}

export async function setCsvImportAbbrechen(userId: number) {
  // Ohne Fang: Schlägt das Vermerken fehl, liefe der Import weiter, während die Antwort „abgebrochen“ sagte.
  await jobUpdate(userId, { status: 'cancelled' });
  await emitJobStatus(userId);
}

// ── Was die Set-Routen aus anderen Bereichen brauchen; Absagen sind Fachfehler ──

/** Die Währung aus den Einstellungen, nicht aus der Anfrage: Zwei Quellen
 * liefen beim nächsten Wechsel auseinander. */
export async function waehrungVon(uid: number): Promise<string> {
  return String(await getSetting(uid, 'currency', 'EUR'));
}

/** Trifft alle Zeilen des Sets im Schreibbereich: Wer die Kiste packt, packt
 * sie für alle, die darin nachsehen. */
export async function lagerortDesSetsSetzen(uid: number, sn: string, storage: unknown) {
  const ort = normalisiereLagerort(storage);
  const n = await setzeLagerort('set', { schreiber: uid }, [normalizeSetNumber(sn)], ort);
  return { ort, n };
}

/** Die Liste kann über mehrere Konten spannen, die Vorgabe ist immer die des
 * Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung. */
export async function lagerorteMitVorgabe(uid: number, owner: string | undefined) {
  const [orte, vorgabe] = await Promise.all([orteFuer(uid, owner), vorgabeVon(uid)]);
  return { orte, vorgabe };
}

// ── Preisalarm: gehört genau EINEM Konto, deshalb uid statt Blickfeld ────────

export function setAlarmeLesen(uid: number, sn: string) {
  return alarmeFuer(uid, normalizeSetNumber(sn));
}

export async function alarmDesSetsSetzen(uid: number, sn: string, eingabe: Parameters<typeof setzeAlarm>[3]) {
  return setzeAlarm(uid, normalizeSetNumber(sn), await waehrungVon(uid), eingabe);
}

export function alarmDesSetsLoeschen(uid: number, sn: string, condition: unknown) {
  return loescheAlarm(uid, normalizeSetNumber(sn), String(condition || 'N'));
}

export async function alarmCsvImportStarten(uid: number, text: string) {
  return importAlsAuftrag<CsvImportBericht>(uid, 'alarme_csv', { waehrung: await waehrungVon(uid), text });
}

/** Nur zu Sets im Blickfeld und gedrosselt: Jeder Import kann Rebrickable-Kontingent kosten. */
export async function teileDesSetsImportieren(sk: SetsKontext, uid: number, sn: string): Promise<number> {
  const set = await findSetInScope(sk, uid, sn);
  if (!set) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
  const takt = await zaehleAnfrage('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (takt.count > 30) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: takt.waitMin });
  return importPartsForSet(set.set_number, set.owner_user_id);
}

/** Die Anleitungen sind geteilt: Ersetzen darf nur der Verwalter (ein leerer
 * Abruf löschte sie sonst für alle). Andere holen, was fehlt, einmal je Set und Tag. */
export async function anleitungenNeuLaden(sk: SetsKontext, uid: number, roh: string, verwalter: boolean) {
  const sn = normalisiereSetNummer(roh);
  if (!moeglicheSetNummer(sn)) fachfehler('ungueltig', 'setnummer_ungueltig');
  if (verwalter) await loescheAnleitungen(sn);
  else {
    if (!(await findSetInScope(sk, uid, sn))) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
    if ((await anzahlAnleitungen(sn)) > 0) fachfehler('verboten', 'nur_admins');
    if (!(await anleitungNeuLadenErlaubt(sn))) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: 24 * 60 });
  }
  const auftrag = await anleitungEinreihen(sn, { jetzt: true });
  const instructions = anleitungenZusammenlegen(await anleitungenZuSet(sn), []);
  return { instructions, auftrag };
}

/** Hochgeladene Anleitungen liegen je Konto in einem eigenen Ordner darunter. */
export const ANLEITUNGS_WURZEL = path.join(DATA_DIR, 'uploads');

type Kopf = { headers?: Record<string, unknown> };

export async function csvImportStand(uid: number, req: Kopf) {
  return buildJobStatus(await jobGet(uid), req);
}

/** Im offenen Strom gibt es keinen Statuscode mehr: Ein Lesefehler wird zu „kein Import“. */
export async function csvImportStandFuerStrom(uid: number, req: Kopf, sprache: Sprache) {
  return buildJobStatus(await jobGet(uid), req, sprache);
}

/** Die Route kennt den Auftragsweg der Teile nicht; ohne Inventar reichert der Job-Prozess an. */
export function teilelisteFuerKonto(sk: SetsKontext, setNum: string) {
  return teilelisteDesSets(sk, setNum, sn => sk.nacharbeit.setTeileAnreichern(sn));
}

export async function setPreisVerlauf(uid: number, sicht: Sicht | number[], sn: string) {
  return getSetPriceHistory(sicht, sn, await waehrungVon(uid));
}

/** Meldet jeden Stand des CSV-Imports dieses Kontos, aus diesem und aus anderen Prozessen. */
export function csvImportStandAbonnieren(uid: number, melde: () => void): () => void {
  const lokal = () => melde();
  csvImportBus.on(`progress:${uid}`, lokal);
  const abmelden = beiImportStand((konto) => { if (String(konto) === String(uid)) melde(); });
  return () => { csvImportBus.off(`progress:${uid}`, lokal); abmelden(); };
}

/** Drei Erfassungen sind drei Käufe und können im Haushalt verschiedenen Kindern
 * gehören; wer alles will, wählt alle Zeilen. */
export async function setVerschieben(sk: SetsKontext, uid: number, roh: string, von: unknown, nach: unknown, erfassungen: number[]) {
  if (!erfassungen.length) fachfehler('ungueltig', 'kaufpreise_angeben');
  const sn = mitVersion(roh);
  const fromId = await schreibziel(uid, von ?? uid);
  const toId = await schreibziel(uid, nach);
  if (fromId === toId) fachfehler('ungueltig', 'quelle_ziel_identisch');
  return { set_number: sn, from_user_id: fromId, to_user_id: toId, ...await verschiebeSet(sk, sn, fromId, toId, erfassungen) };
}
