/** SQL, Rebrickable und Aufträge stehen nur hier und darunter, damit die Routen
 * nur Anfrage und Antwort kennen. */
import { blickfeldAus } from '../haushalt/haushalt';
import type { Sicht } from '../haushalt/haushalt';
import { logAndContinue, meldeUndLiefere, meldeFehler, vorDem, fehlertext, ohneFehlendeDatei, oeffentlicherFehler } from '../infra/fehler';
import fs from 'fs';
import path from 'path';
import { APP_ROOT } from '../infra/appPaths';
import { stelleAuftragEin } from '../auftraege/dienst';
import { resolveImageLocal, proxyImageUrl } from '../katalog/bilder/images';
import { getSetting } from '../einstellungen/settings';
import { setBildSichtbar } from '../katalog/bilder/bildBlickfeld';
import { normalizeSetNumber } from './setAdd';
import { istErsatzteil } from '../infra/validate';
import { istVermutung } from '../katalog/barcodeQuelle';
import { setnummerKandidaten } from '../katalog/produkttitel';
import { fetchPrice, resolveSetCondition } from '../finanzen/financeCalc';
import { neuestesInventar } from '../katalog/rbInventar';
import { mitVersion, ohneVersion } from '../infra/setNummer';
import { figurenAusKatalog } from '../katalog/minifigsImport';
import { csvEinlesen, entschaerfungRueckgaengig, parseCsvDate, zeilenListe } from '../infra/csvExport';
import { jobGet, jobSet, jobUpdate, emitJobStatus } from '../auftraege/importAuftrag';
import { getSetByBarcode, getSetByEan, getMinifigInfo, getSetMinifigs, rebrickableJson, produktTitel } from '../katalog/quellen';
import { getAllSetParts } from '../katalog/rebrickableKatalog';
import type { RbSetTeil } from '../katalog/quellen';
import { fehlerWerfen } from '../infra/fehlerTexte';
import { merkeFigur, merkeSetFiguren } from '../katalog/katalogPflege';
import { randomUUID } from 'crypto';
import * as repo from './repository/setDetail';
import type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';
export type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';


/** Ohne Eintrag null. */
export async function setInfo(setNumber: string): Promise<SetStamm | null> {
  return (await repo.setStamm(mitVersion(setNumber))) ?? null;
}

/** Was das fragende Konto über eine Nummer erfahren darf: Ein fremder Platzhalter
 * antwortet wie eine nie erfasste Nummer, ein fremdes Bild wird nicht genannt. */
export async function setInfoFuerKonto(uid: number, setNumber: string) {
  const n = mitVersion(setNumber);
  const stamm = await setInfo(n);
  const imBlickfeld = !!(stamm?.image_local || stamm?.platzhalter) && await setBildSichtbar(uid, n);
  if (!stamm || (stamm.platzhalter && !imBlickfeld)) return { success: true as const, set_number: n, name: n, im_katalog: false as const };
  const { platzhalter: _platzhalter, ...row } = stamm;
  return { success: true as const, set_number: n, ...row, image_local: imBlickfeld ? row.image_local : null,
    name: row.name || n, im_katalog: true as const };
}

/** Ein fremdes Set-Bild liefert die Bildroute nicht aus (bildBlickfeld.ts); der Treffer nennt es auch nicht. */
export async function setZumBarcodeFuerKonto(uid: number, rohBarcode: string): Promise<BarcodeTreffer | null> {
  const treffer = await setZumBarcode(rohBarcode);
  if (treffer?.image_local && !await setBildSichtbar(uid, treffer.set_number)) treffer.image_local = null;
  return treffer;
}

export interface BarcodeTreffer {
  success: true; unsicher: boolean; set_number: string; name: string | null;
  year?: number | null; pieces?: number | null; theme?: string | null; minifigs: number | null;
  image_url: string | null; image_local?: string | null | undefined; source: string;
}

/** Rebrickable zuerst: Dort stehen Figurenzahl und Bild am verlässlichsten.
 * Jede Antwort sagt, wie sie zustande kam (src/katalog/barcodeQuelle.ts). */
async function barcodeErgebnis(setNumber: string, name: string | null, source: string): Promise<BarcodeTreffer> {
  const rbData = await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/`);
  const mfData = rbData ? await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/minifigs/?page_size=1`) : null;
  const local = await repo.setKatalog(setNumber).catch(meldeUndLiefere('sets:barcode-katalog', undefined));

  const minifigs = mfData?.count ?? local?.minifigs ?? null;
  const image_url = rbData?.set_img_url || local?.image_url || null;
  const image_local = local?.image_local ? resolveImageLocal(local.image_local) : null;
  const unsicher = istVermutung(source);

  if (local) {
    return { success: true, unsicher, set_number: setNumber,
      name: local.name || rbData?.name || name, year: local.year || rbData?.year,
      pieces: local.pieces || rbData?.num_parts, theme: local.theme || rbData?.theme_name,
      minifigs, image_local, image_url, source };
  }
  if (rbData?.set_num) {
    await repo.merkeKatalogCache(setNumber, rbData.name, rbData.year, rbData.theme_name, rbData.num_parts, rbData.set_img_url).catch(logAndContinue('sets:catalog_cache schreiben'));
    return { success: true, unsicher, set_number: setNumber, name: rbData.name || name, year: rbData.year,
      pieces: rbData.num_parts, theme: rbData.theme_name, minifigs, image_url, source };
  }
  const cat = await repo.katalogCacheEintrag(setNumber).catch(meldeUndLiefere('sets:barcode-cache', undefined));
  if (cat) {
    return { success: true, unsicher, set_number: setNumber, name: cat.name || name, year: cat.year,
      pieces: cat.pieces, theme: cat.theme, minifigs, image_url: cat.image_url || image_url, source };
  }
  return { success: true, unsicher, set_number: setNumber, name, minifigs, image_url, source };
}

async function imKatalog(...nummern: string[]): Promise<{ set_number: string; name: string | null } | undefined> {
  return repo.ersterKatalogTreffer(nummern)
    .catch(meldeUndLiefere('sets:barcode-bekannt', undefined));
}

/** Reihenfolge: eigener Katalog, EAN über Rebrickable, Brickset und UPCitemdb,
 * dann Bestellnummer — die billigste Quelle zuerst. */
export async function setZumBarcode(rohBarcode: string): Promise<BarcodeTreffer | null> {
  const barcode = rohBarcode.trim();
  const direct = await repo.katalogCacheNachNummer(mitVersion(barcode));
  if (direct) return barcodeErgebnis(direct.set_number, direct.name, 'catalog_cache');

  if (/^\d{12,13}$/.test(barcode)) {
    const ean13 = barcode.length === 12 ? '0' + barcode : barcode;
    const rb = await rebrickableJson(`/lego/sets/?search=${encodeURIComponent(ean13)}&page_size=5`);
    for (const set of (rb?.results || [])) {
      const detail = await rebrickableJson(`/lego/sets/${encodeURIComponent(set.set_num)}/`);
      const extIds = Object.values(detail?.external_ids || {}).flat().map(String);
      if (extIds.includes(ean13) || extIds.includes(barcode)) return barcodeErgebnis(set.set_num, set.name, 'rebrickable-ean');
    }
    const plausibel = rb?.results?.find((s: { year: number; num_parts: number }) => s.year > 2010 && s.num_parts > 0);
    if (plausibel) return barcodeErgebnis(plausibel.set_num, plausibel.name, 'rebrickable-search');

    const bsEan = await getSetByEan(ean13);
    if (bsEan) {
      const r = await barcodeErgebnis(bsEan.set_number, bsEan.name, 'brickset-ean');
      return { ...r, year: r.year || bsEan.year, theme: r.theme || bsEan.theme, pieces: r.pieces || bsEan.pieces };
    }

    // Der Titel ist Händlertext: Erst die Kandidaten, die der Katalog kennt;
    // sonst bleibt der erste als markierte Vermutung stehen.
    const titel = await produktTitel(ean13);
    if (titel) {
      const kandidaten = setnummerKandidaten(titel);
      for (const k of kandidaten) {
        const bekannt = await imKatalog(k, normalizeSetNumber(k));
        if (bekannt) return barcodeErgebnis(bekannt.set_number, titel, 'upcitemdb');
      }
      if (kandidaten[0]) return barcodeErgebnis(normalizeSetNumber(kandidaten[0]), titel, 'upcitemdb');
    }
  }

  if (/^\d{5,8}$/.test(barcode)) {
    const bs = await getSetByBarcode(barcode);
    if (bs) return barcodeErgebnis(bs.set_number, bs.name, 'brickset-item');
    const rb = await rebrickableJson(`/lego/sets/${barcode}-1/`);
    if (rb?.set_num) return barcodeErgebnis(rb.set_num, rb.name, 'rebrickable-direct');
  }
  return null;
}


function katalogDesSets(setNumber: string): Promise<KatalogTeil[]> {
  return repo.katalogTeileDesSets(mitVersion(setNumber));
}

/** Ungeblättert; die Seitenangaben stehen da, weil die App sie mit der
 * Teileliste des Bestands teilt. */
const eineSeite = (n: number) => ({ total: n, page: 1, page_size: n });

export async function teilelisteDesSets(setNum: string, anreichern: (sn: string) => Promise<unknown>) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const invId = await neuestesInventar(setNum);
  let teile: ListenTeil[] = [];
  let source = 'db';
  if (invId) {
    teile = await repo.inventarTeileDesSets(invId);
  }
  if (!teile.length) {
    source = 'api';
    const rb = await getAllSetParts(n).catch(meldeUndLiefere('sets:getAllSetParts', null))
            || await getAllSetParts(bare).catch(meldeUndLiefere('sets:getAllSetParts', null));
    teile = (rb || []).map((r: RbSetTeil) => ({
      part_number: r.part.part_num, bl_part_number: r.part.external_ids?.BrickLink?.[0] || r.part.part_num,
      part_name: r.part.name || r.part.part_num, color_id: r.color.id, color_name: r.color.name || '',
      color_hex: r.color.rgb || null, rb_image_url: r.part.part_img_url || null,
      total_quantity: r.quantity, is_spare: !!r.is_spare }));
  }
  if (!teile.length) return { parts: [], source: 'not_found', ...eineSeite(0) };

  const katalog = new Map<string, KatalogTeil>();
  const merke = (zeilen: KatalogTeil[]) => { for (const r of zeilen) katalog.set(`${r.part_number}|${r.color_id}`, r); };
  merke(await katalogDesSets(setNum));
  if (teile.some(p => !katalog.has(`${p.part_number}|${p.color_id}`))) {
    await anreichern(setNum).catch(logAndContinue('sets:enrichSetParts'));
    merke(await katalogDesSets(setNum));
  }

  // Schlüssel ist die Rebrickable-Nummer samt Farbe: Formvarianten teilen sich
  // oft eine BrickLink-Nummer und dürfen nicht verschmelzen.
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
  await stelleAuftragEin('bilder', { set_number: setNum }, { schluessel: `bilder:${n}`, maxVersuche: 3 })
    .catch(logAndContinue(`sets:bilder einstellen ${setNum}`));
  return { parts: [...zeilen.values()], source, ...eineSeite(zeilen.size) };
}

/** Was nicht aus dem Katalog kam, schreibt ein Nachlauf hinein. */
export async function figurenlisteDesSets(setNum: string) {
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
    figs = await repo.inventarFigurenDesSets(invId);
  }
  if (!figs.length) {
    figs = (await getSetMinifigs(n).catch(meldeUndLiefere('sets:getSetMinifigs', null))
         || await getSetMinifigs(bare).catch(meldeUndLiefere('sets:getSetMinifigs', null))) || [];
  }
  if (!figs.length) return { figs: [], source: 'not_found' };
  setImmediate(() => { figurenMerken(n, figs).catch(logAndContinue('sets:figurenkatalog schreiben')); });
  return { figs: figs.map(ausgabe), source: 'csv_cache' };
}

async function figurenMerken(n: string, figs: Array<{ fig_number: string; fig_name: string | null; quantity: number; image_url: string | null }>) {
  for (const f of figs) {
    let bild = f.image_url || null;
    if (!bild) bild = (await getMinifigInfo(f.fig_number).catch(meldeUndLiefere('sets:minifigur-info', null)))?.image_url || null;
    await merkeFigur(f.fig_number, f.fig_name, bild);
    await merkeSetFiguren(n, [{ figNumber: f.fig_number, quantity: f.quantity }]);
  }
}

/** Im Zustand des Bestands. null: kein Set im Blickfeld. */
export async function setPreis(uid: number, blickfeldWahl: Sicht | number[], sn: string) {
  const blickfeld = await blickfeldAus(blickfeldWahl);
  const set = await repo.setImFeld(sn, blickfeld);
  if (!set) return null;
  // Die Währung aus der Einstellung: Die App schickte ihren lokalen Startwert mit, bevor sie die Einstellung kannte.
  const currency  = await getSetting(uid, 'currency', 'EUR');
  const guideType = await getSetting(uid, 'price_guide_type', 'sold');
  const ttlHours  = await getSetting(uid, 'price_cache_ttl', '24');
  try {
    const cond = await resolveSetCondition(blickfeld, sn);
    const pd = await fetchPrice(sn, cond, guideType, currency, ttlHours);
    return { set_number: sn, currency, min_price: pd.min_price, avg_price: pd.avg_price,
      max_price: pd.max_price, qty_avg_price: pd.qty_avg_price, from_cache: pd.from_cache,
      no_price: !!(pd as { no_price?: boolean }).no_price };
  } catch (e) {
    meldeFehler('sets:preis', e);
    return { set_number: sn, currency, min_price: null, avg_price: null, max_price: null, qty_avg_price: null, no_price: true };
  }
}

export async function rebrickableListe(uid: number) {
  const sets = await repo.setsMitMenge(uid);
  return sets.map(s => ({ 'Set Number': s.set_number, 'Quantity': s.quantity }));
}

/** Eine Anleitung hängt per Fremdschlüssel am Set. */
export async function setGehoertKonto(uid: number, sn: string): Promise<boolean> {
  return !!(await repo.setDesKontos(uid, sn));
}

export async function anleitungMerken(uid: number, sn: string, pfad: string, beschreibung: string) {
  await repo.fuegeAnleitungEin(uid, sn, pfad, beschreibung, pfad);
}

/** Die Datei bleibt, solange eine andere Zeile auf sie zeigt.
 * @returns false, wenn es die Zeile nicht gab */
export async function anleitungLoeschen(uid: number, id: string): Promise<boolean> {
  const instr = await repo.anleitungsPfad(id, uid);
  if (!instr) return false;
  await repo.loescheAnleitung(id, uid);
  if (!instr.local_path?.startsWith('/data/uploads/')) return true;
  const rest = await repo.anleitungsdateiBenutzt(instr.local_path)
    .catch(meldeUndLiefere('sets:anleitung-noch-benutzt', { ok: 1 }));
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
  catch (e) { fehlerWerfen('csv_parse_fehler', 400, { grund: fehlertext(e) }); }
  if (!gelesen.records.length) {
    if (gelesen.uebersprungen.length) fehlerWerfen('csv_keine_brauchbare_zeile', 400, { zeilen: zeilenListe(gelesen.uebersprungen) });
    fehlerWerfen('csv_keine_datenzeilen', 400);
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
async function schonVorhanden(userId: number, rows: ImportZeile[]): Promise<string[]> {
  const da = new Set((await repo.setsMitMenge(userId)).map(s => s.set_number));
  const treffer = rows.filter(r => !r.fehler).map(r => normalizeSetNumber(r.sn)).filter(sn => da.has(sn));
  return [...new Set(treffer)];
}

/** Ein laufender Import desselben Kontos wird abgebrochen; `nurPruefen` liest nur. */
export async function setCsvImportStarten(userId: number, text: string, nurPruefen = false) {
  const { rows, uebersprungen } = setCsvZeilen(text);
  const vorhanden = await schonVorhanden(userId, rows);
  if (nurPruefen) return { total: rows.length, uebersprungen, vorhanden, gestartet: false };
  const laufend = await jobGet(userId);
  if (laufend && laufend.status === 'running') await jobUpdate(userId, { status: 'cancelled' });
  const lauf = randomUUID();
  await jobSet(userId, { status: 'running', total: rows.length, done: 0, current: null,
    results: JSON.stringify([]), error: null, run_id: lauf });
  try {
    await stelleAuftragEin('csv_import', { user_id: userId, lauf, rows }, { userId, maxVersuche: 3 });
  } catch (e) {
    await jobUpdate(userId, { status: 'error', error: oeffentlicherFehler(e, 'csv-import:einstellen').error }, lauf).catch(logAndContinue('csv-import:fehler vermerken'));
    throw e;
  }
  await emitJobStatus(userId);
  return { total: rows.length, uebersprungen, vorhanden, gestartet: true };
}

export async function setCsvImportAbbrechen(userId: number) {
  await jobUpdate(userId, { status: 'cancelled' }).catch(logAndContinue('csv-import:abbruch vermerken'));
  await emitJobStatus(userId);
}

