/**
 * Fachdienst Sets: was die Set-Routen an Daten und Fremdabrufen brauchen.
 * Die Routen lesen die Anfrage, rufen hier und schreiben die Antwort; SQL,
 * Rebrickable und Aufträge stehen nur hier und darunter.
 */
import * as db from '../../db/database';
import { logAndContinue, meldeUndLiefere, meldeUndWeiter, vorDem, fehlertext } from '../../src/infra/httpError';
import { stelleAuftragEin } from '../auftraege';
import { resolveImageLocal, proxyImageUrl } from '../images';
import { getSetting } from '../settings';
import { normalizeSetNumber } from '../setAdd';
import { istErsatzteil, ersatzteilSql } from '../../src/infra/validate';
import { istVermutung } from '../barcodeQuelle';
import { setnummerKandidaten } from '../produkttitel';
import { fetchPrice, resolveSetCondition } from '../financeCalc';
import { neuestesInventar } from '../rbInventar';
import { mitVersion, ohneVersion } from '../setNummer';
import { figurenAusKatalog } from '../minifigsImport';
import { mengeSkalar } from '../bestandsmenge';
import { blJoin, blNummerSql } from '../blZuordnung';
import { csvEinlesen, entschaerfungRueckgaengig, parseCsvDate, uebersprungenHinweis } from '../../src/infra/csvExport';
import { jobGet, jobSet, jobUpdate, emitJobStatus } from '../importAuftrag';
import { getSetByBarcode, getSetByEan } from '../../clients/brickset';
import { getAllSetParts, getMinifigInfo, getSetMinifigs, rebrickableJson } from '../../clients/rebrickable';
import type { RbSetTeil } from '../../clients/rebrickable';
import { produktTitel } from '../../clients/upcitemdb';
import { fehlerWerfen } from '../../src/infra/fehlerTexte';
import { merkeFigur, merkeSetFiguren } from '../katalogPflege';
import { randomUUID } from 'crypto';

// ── Katalog ──────────────────────────────────────────────────────────────────

export interface SetStamm {
  name: string | null; year: number | null; theme: string | null; pieces: number | null;
  minifigs?: number | null; image_url: string | null; image_local: string | null;
}

/** Name und Eckdaten eines Sets aus set_stamm (Migration 0076); ohne Eintrag null. */
export async function setInfo(setNumber: string): Promise<SetStamm | null> {
  return (await db.get<SetStamm>(
    'SELECT name, year, theme, pieces, image_url, image_local FROM set_stamm WHERE set_number = $1',
    [mitVersion(setNumber)])) ?? null;
}

// ── Barcode ──────────────────────────────────────────────────────────────────

export interface BarcodeTreffer {
  success: true; unsicher: boolean; set_number: string; name: string | null;
  year?: number | null; pieces?: number | null; theme?: string | null; minifigs: number | null;
  image_url: string | null; image_local?: string | null | undefined; source: string;
}

/**
 * Ergänzt einen Treffer um Bild und Eckdaten: Rebrickable zuerst (dort stehen
 * Figurenzahl und Bild am verlässlichsten), dann der eigene Katalog.
 * Jede Antwort sagt, wie sie zustande kam (utils/barcodeQuelle.ts).
 */
async function barcodeErgebnis(setNumber: string, name: string | null, source: string): Promise<BarcodeTreffer> {
  const rbData = await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/`);
  const mfData = rbData ? await rebrickableJson(`/lego/sets/${encodeURIComponent(setNumber)}/minifigs/?page_size=1`) : null;
  const local = await db.get<SetStamm>(
    'SELECT name, image_local, image_url, year, pieces, theme, minifigs FROM set_catalog WHERE set_number=$1',
    [setNumber]).catch(meldeUndLiefere('sets:barcode-katalog', undefined));

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
    await db.run(
      'INSERT INTO catalog_cache(set_number,name,year,theme,pieces,image_url) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(set_number) DO UPDATE SET name=$2,year=$3,theme=$4,pieces=$5,image_url=$6',
      [setNumber, rbData.name, rbData.year, rbData.theme_name, rbData.num_parts, rbData.set_img_url]
    ).catch(logAndContinue('sets:catalog_cache schreiben'));
    return { success: true, unsicher, set_number: setNumber, name: rbData.name || name, year: rbData.year,
      pieces: rbData.num_parts, theme: rbData.theme_name, minifigs, image_url, source };
  }
  const cat = await db.get<SetStamm>('SELECT name, image_url, year, pieces, theme FROM catalog_cache WHERE set_number=$1',
    [setNumber]).catch(meldeUndLiefere('sets:barcode-cache', undefined));
  if (cat) {
    return { success: true, unsicher, set_number: setNumber, name: cat.name || name, year: cat.year,
      pieces: cat.pieces, theme: cat.theme, minifigs, image_url: cat.image_url || image_url, source };
  }
  return { success: true, unsicher, set_number: setNumber, name, minifigs, image_url, source };
}

async function imKatalog(...nummern: string[]): Promise<{ set_number: string; name: string | null } | undefined> {
  return db.get('SELECT set_number, name FROM catalog_cache WHERE set_number = ANY($1) LIMIT 1', [nummern])
    .catch(meldeUndLiefere('sets:barcode-bekannt', undefined));
}

/**
 * Barcode → Set. Reihenfolge: eigener Katalog, EAN über Rebrickable, Brickset
 * und UPCitemdb, dann Bestellnummer über Brickset und Rebrickable. null heisst:
 * nichts gefunden.
 */
export async function setZumBarcode(rohBarcode: string): Promise<BarcodeTreffer | null> {
  const barcode = rohBarcode.trim();
  const direct = await db.get<{ set_number: string; name: string | null }>(
    'SELECT set_number, name FROM catalog_cache WHERE set_number = $1', [mitVersion(barcode)]);
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

// ── Teile- und Figurenliste eines Sets (ohne Konto) ─────────────────────────

interface ListenTeil {
  part_number: string; color_id: number; total_quantity: number | string; is_spare: unknown;
  bl_part_number?: string | null; part_name?: string | null; rb_image_url?: string | null;
  color_name?: string | null; color_hex?: string | null; bl_color_id?: number | null;
}
interface KatalogTeil {
  part_number: string; color_id: number; bl_part_number: string | null; part_name: string | null;
  color_name: string | null; color_hex: string | null; image_url: string | null; image_local: string | null;
}

function katalogDesSets(setNumber: string): Promise<KatalogTeil[]> {
  return db.all<KatalogTeil>(
    `SELECT c.part_number, c.color_id, ${blNummerSql('c.part_number')} AS bl_part_number,
            c.part_name, c.color_name, c.color_hex, c.image_url, c.image_local
       FROM set_parts_catalog c
       ${blJoin('c.part_number', 'part')}
      WHERE c.set_number = $1`, [mitVersion(setNumber)]);
}

/**
 * Die Teile eines Sets ohne Ersatzteile: aus der geladenen Rebrickable-CSV,
 * sonst über die API. Fehlt der Katalog, wird er erst ergänzt, damit Name und
 * Bild stimmen; die Bilder holt danach ein Auftrag.
 * @param anreichern füllt den Katalog des Sets (jobs/partsCatalogEnrich, über utils/nacharbeit)
 */
/**
 * Die Teileliste eines Sets kommt ungeblättert; die Seitenangaben stehen
 * trotzdem da, weil die App sie mit der Teileliste des Bestands teilt.
 */
const eineSeite = (n: number) => ({ total: n, page: 1, page_size: n });

export async function teilelisteDesSets(setNum: string, anreichern: (sn: string) => Promise<unknown>) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const invId = await neuestesInventar(setNum);
  let teile: ListenTeil[] = [];
  let source = 'db';
  if (invId) {
    teile = await db.all<ListenTeil>(
      `SELECT ip.part_num AS part_number, ip.color_id, ip.quantity AS total_quantity, ip.is_spare,
              COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
              p.name AS part_name, p.part_img_url AS rb_image_url,
              c.name AS color_name, c.rgb AS color_hex, c.bl_color_id
         FROM rb_inventory_parts ip
         LEFT JOIN rb_parts      p ON p.part_num = ip.part_num
         LEFT JOIN rb_colors     c ON c.id       = ip.color_id
         LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
        WHERE ip.inventory_id = $1
          AND NOT ${ersatzteilSql('ip.is_spare')}`, [invId]);
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
  // oft eine BrickLink-Nummer und dürfen nicht zu einer Zeile verschmelzen.
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

/**
 * Die Figuren eines Sets: gemeinsamer Katalog, sonst Rebrickable-CSV, sonst
 * API. Was nicht aus dem Katalog kam, schreibt ein Nachlauf hinein.
 */
export async function figurenlisteDesSets(setNum: string) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const ausgabe = (f: { fig_number: string; fig_name?: string | null; quantity?: number | null; image_url?: string | null }) => ({
    fig_number: f.fig_number, fig_name: f.fig_name || f.fig_number, quantity: f.quantity || 1,
    total_quantity: f.quantity || 1, image_url: proxyImageUrl(f.image_url),
    // Dieselbe Form wie eine Figur des Bestands; die Liste hängt an keinem
    // Konto, also ohne Zustände und Besitzer.
    source: 'set', conditions: [] as string[], owners: [] as unknown[] });

  const katalog = await figurenAusKatalog(setNum);
  if (katalog.length) return { figs: katalog.map(ausgabe), source: 'catalog' };

  type Fig = { fig_number: string; fig_name: string | null; quantity: number; image_url: string | null };
  let figs: Fig[] = [];
  const invId = await neuestesInventar(setNum);
  if (invId) {
    figs = await db.all<Fig>(
      `SELECT ip.part_num AS fig_number, ip.quantity, COALESCE(mc.fig_name, ip.part_num) AS fig_name, mc.image_url
         FROM rb_inventory_parts ip
         LEFT JOIN minifigs_catalog mc ON mc.fig_number = ip.part_num
        WHERE ip.inventory_id = $1 AND ip.part_num LIKE 'fig-%'`, [invId]);
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

// ── Preis ────────────────────────────────────────────────────────────────────

/** Marktpreis eines Sets im Blickfeld, im Zustand seines Bestands. null: kein Set im Blickfeld. */
export async function setPreis(uid: number, blickfeld: number[], sn: string) {
  const set = await db.get('SELECT 1 AS da FROM sets WHERE set_number = $1 AND user_id = ANY($2) LIMIT 1', [sn, blickfeld]);
  if (!set) return null;
  // Die Währung aus der Einstellung, nicht aus der Anfrage: Die App schickte
  // ihren lokalen Startwert mit, bevor sie die Einstellung kannte.
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
    meldeUndWeiter('sets:preis', e);
    return { set_number: sn, currency, min_price: null, avg_price: null, max_price: null, qty_avg_price: null, no_price: true };
  }
}

// ── Export, Anleitungen ─────────────────────────────────────────────────────

/** Sets eines Kontos im Listenformat von Rebrickable („Set Number,Quantity“). */
export async function rebrickableListe(uid: number) {
  const sets = await db.all<{ set_number: string; quantity: number }>(
    `SELECT s.set_number, ${mengeSkalar('s')} AS quantity FROM sets s WHERE s.user_id=$1 ORDER BY s.set_number ASC`, [uid]);
  return sets.map(s => ({ 'Set Number': s.set_number, 'Quantity': s.quantity }));
}

/** Gehört das Set diesem Konto? (Eine Anleitung hängt per Fremdschlüssel am Set.) */
export async function setGehoertKonto(uid: number, sn: string): Promise<boolean> {
  return !!(await db.get('SELECT 1 AS ok FROM sets WHERE user_id = $1 AND set_number = $2', [uid, sn]));
}

export async function anleitungMerken(uid: number, sn: string, pfad: string, beschreibung: string) {
  await db.run('INSERT INTO instructions (user_id,set_number,url,description,local_path) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [uid, sn, pfad, beschreibung, pfad]);
}

/**
 * Löscht eine eigene Anleitung. Die Datei bleibt, solange eine andere Zeile
 * auf sie zeigt; im Zweifel bleibt sie ebenfalls.
 * @returns der lokale Pfad, wenn die Datei jetzt gelöscht werden darf; false, wenn es die Zeile nicht gab
 */
export async function anleitungLoeschen(uid: number, id: string): Promise<string | null | false> {
  const instr = await db.get<{ local_path: string | null }>('SELECT local_path FROM instructions WHERE id = $1 AND user_id = $2', [id, uid]);
  if (!instr) return false;
  await db.run('DELETE FROM instructions WHERE id = $1 AND user_id = $2', [id, uid]);
  if (!instr.local_path?.startsWith('/data/uploads/')) return null;
  const rest = await db.get('SELECT 1 AS ok FROM instructions WHERE local_path = $1 LIMIT 1', [instr.local_path])
    .catch(meldeUndLiefere('sets:anleitung-noch-benutzt', { ok: 1 }));
  return rest ? null : instr.local_path;
}

// ── CSV-Import ───────────────────────────────────────────────────────────────

export interface ImportZeile { sn: string; qty: number; purchasePrice: number | null; condition: string | null; acquiredAt: string | null }

/** Die Zeilen einer Set-CSV in die Form des Auftrags; Spaltennamen ohne Gross/klein und BOM. */
export function setCsvZeilen(text: string): { rows: ImportZeile[]; uebersprungen: number[] } {
  let gelesen;
  try { gelesen = csvEinlesen(text); }
  catch (e) { fehlerWerfen('csv_parse_fehler', 400, { grund: fehlertext(e) }); }
  if (!gelesen.records.length) {
    throw Object.assign(new Error(gelesen.uebersprungen.length
      ? `Keine brauchbare Zeile gefunden — ${uebersprungenHinweis(gelesen.uebersprungen)}`
      : 'Keine Datenzeilen in der Datei'), { status: 400 });
  }
  const rows: ImportZeile[] = [];
  for (const roh of gelesen.records) {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(roh)) row[k.toLowerCase().trim().replace(/^\uFEFF/, '')] = String(entschaerfungRueckgaengig(v) ?? '');
    const rawSn = row.set_number || row['setnummer'] || row['set'] || Object.values(row)[0];
    const sn = rawSn ? vorDem(String(rawSn), ';').trim() : null;
    if (!sn) continue;
    const qty = parseInt(String(row.quantity || row['anzahl'] || row['qty'] || row['menge'] || '1').replace(/[^0-9]/g, '') || '1') || 1;
    const rawPrice = row.purchase_price ?? row['kaufpreis'] ?? row['einkaufspreis'] ?? row['price'] ?? '';
    const preis = String(rawPrice).trim() !== '' ? parseFloat(String(rawPrice).replace(',', '.')) : null;
    const zustand = String(row.condition || row['zustand'] || row['kondition'] || '').trim().toUpperCase();
    rows.push({ sn, qty, purchasePrice: preis !== null && !isNaN(preis) ? preis : null,
      condition: ['N', 'U'].includes(zustand) ? zustand : null,
      // 05.03.2026 ist der 5. März, nicht der 3. Mai.
      acquiredAt: parseCsvDate(row.acquired_at || row['erfassungsdatum'] || row['datum']) });
  }
  return { rows, uebersprungen: gelesen.uebersprungen };
}

/**
 * Startet den Set-Import als Auftrag für den Job-Prozess (jobs/setCsvImport.ts);
 * ein laufender Import desselben Kontos wird abgebrochen.
 */
export async function setCsvImportStarten(userId: number, text: string) {
  const laufend = await jobGet(userId);
  if (laufend && laufend.status === 'running') await jobUpdate(userId, { status: 'cancelled' });
  const { rows, uebersprungen } = setCsvZeilen(text);
  const lauf = randomUUID();
  await jobSet(userId, { status: 'running', total: rows.length, done: 0, current: null,
    results: JSON.stringify([]), error: null, run_id: lauf });
  try {
    await stelleAuftragEin('csv_import', { user_id: userId, lauf, rows }, { userId, maxVersuche: 3 });
  } catch (e) {
    await jobUpdate(userId, { status: 'error', error: fehlertext(e) }, lauf).catch(logAndContinue('csv-import:fehler vermerken'));
    throw e;
  }
  await emitJobStatus(userId);
  return { total: rows.length, uebersprungen };
}

export async function setCsvImportAbbrechen(userId: number) {
  await jobUpdate(userId, { status: 'cancelled' }).catch(logAndContinue('csv-import:abbruch vermerken'));
  await emitJobStatus(userId);
}

