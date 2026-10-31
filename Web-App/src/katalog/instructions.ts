import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import * as db from '../../db/database';
import { INSTRUCTIONS_DIR } from '../infra/appPaths';
import { downloadFile, scrapeInstructions, sleep, httpsGetRobust } from '../../clients/rebrickable';
import * as brickset from '../../clients/brickset';
import { meldeUndWeiter, fehlertext, logAndContinue, meldeUndLiefere } from '../infra/httpError';
import { mitVersion, ohneVersion } from '../sets/setNummer';
import { pfadSegment } from '../infra/fremdeAdressen';

/**
 * Bauanleitungen beschaffen: Rebrickable → Brickset → BrickLink-Designer →
 * brickinstructions.com, und aus Bildseiten notfalls ein PDF bauen.
 * Ausführlich: docs/begruendungen/src/katalog/instructions.ts.md#abschnitt
 */

/**
 * @param info bekommt den HTTP-Status der letzten Antwort: Nur ein 404 heisst
 *   „gibt es nicht"; ein 403 ist Drosselung und darf kein Bild aussperren.
 */
// Direct brickinstructions.com fallback — used when Brickset quota is exhausted
// and entry is manually deleted from retry queue
/**
 * Ob der letzte `downloadSetInstructions()`-Aufruf einen fremden Server
 * befragt hat.
 * Ausführlich: docs/begruendungen/src/katalog/instructions.ts.md#letzterabrufwarextern
 */
let _letzterAbrufWarExtern = false;
export function letzterAbrufWarExtern(): boolean { return _letzterAbrufWarExtern; }

// shared_instructions: zaehlen, lesen, loeschen
// Diese drei Fragen standen ueber den Baum verstreut — die Zaehlung dreimal
// (hier zweimal, jobs/bricksetRetry, jobs/instructionQueue), das Lesen zweimal
// (routes/sets, src/sets/abfragen), das Loeschen zweimal (routes/sets, …
// Ausführlich: docs/begruendungen/src/katalog/instructions.ts.md#anzahlanleitungen

/** Wie viele Anleitungen sind fuer dieses Set hinterlegt? */
export async function anzahlAnleitungen(setNumber: string): Promise<number> {
  const r = await db.get('SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1',
    [mitVersion(setNumber)]).catch(meldeUndLiefere('anleitung:mitVersion', null));
  return parseInt(r?.c) || 0;
}

/** Die hinterlegten Anleitungen zu einem Set. */
export async function anleitungenZuSet(setNumber: string) {
  return db.all('SELECT * FROM shared_instructions WHERE set_number = $1',
    [mitVersion(setNumber)]).catch(meldeUndLiefere('anleitung:mitVersion', []));
}

/**
 * Die Anleitungen eines Sets, wie ein Client sie sieht: erst die automatisch
 * importierten (shared_instructions), dann die selbst hochgeladenen
 * (instructions).
 * Ausführlich: docs/begruendungen/src/katalog/instructions.ts.md#anleitungenzusammenlegen
 */
export function anleitungenZusammenlegen(geteilt: any[], eigene: any[]): any[] {
  return [
    ...geteilt.map(i => ({ ...i, is_manual: false })),
    ...eigene.map(i => ({ ...i, is_manual: true })),
  ];
}

/**
 * Darf ein Konto die geteilten Anleitungen dieses Sets jetzt neu laden?
 * Einmal je Set und Tag für alle zusammen: Das Neuladen löscht die Anleitung
 * für alle und kostet Kontingent der Quellen. In EINER Anweisung, damit zwei
 * gleichzeitige Anfragen nicht beide durchkommen.
 */
export async function anleitungNeuLadenErlaubt(setNumber: string): Promise<boolean> {
  const z = await db.get(
    `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET count = 1, first_at = NOW(), last_at = NOW()
       WHERE rate_limit_attempts.first_at < NOW() - INTERVAL '1 day'
     RETURNING key`, [`anleitung-neu|${mitVersion(setNumber)}`]);
  return !!z;
}

/** Alle Anleitungen eines Sets entfernen (vor dem Neuholen). */
export async function loescheAnleitungen(setNumber: string) {
  return db.run('DELETE FROM shared_instructions WHERE set_number = $1', [mitVersion(setNumber)]);
}

/**
 * Wo liegt dieses Set bei brickinstructions.com, und ist dort ueberhaupt etwas?
 * Ausführlich: docs/begruendungen/src/katalog/instructions.ts.md#brickinstructionsfund
 * @returns null, wenn dort nichts liegt
 */
async function brickinstructionsFund(n: string) {
  const baseNum = pfadSegment(ohneVersion(n));
  const folder  = String(Math.floor(parseInt(baseNum) / 1000) * 1000).padStart(5, '0');
  const baseUrl = `https://lego.brickinstructions.com/instructions/${folder}/${baseNum}`;
  const pageUrl = `https://lego.brickinstructions.com/lego_instructions/set/${baseNum}/`;
  const hdrs    = { 'User-Agent': 'Mozilla/5.0 (compatible; BrickManager/3.0)', 'Referer': pageUrl };
  const probe   = await httpsGetRobust(`${baseUrl}/001.jpg`, hdrs, 3000);
  if (probe.status !== 200 || !probe.buffer || probe.buffer.length <= 500) return null;
  return { baseUrl, pageUrl, hdrs, erstesBild: probe.buffer };
}

export async function scrapeInstructionsFromFallback(setNumber: string) {
  const n = mitVersion(setNumber);
  const existing = await anzahlAnleitungen(n);
  if (existing > 0) return existing;
  const biAlreadyTried = await db.get("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [n]);
  if (biAlreadyTried) return 0;
  try {
    const fund = await brickinstructionsFund(n);
    if (fund) {
      const { baseUrl, pageUrl, hdrs } = fund;
      const instrDir = INSTRUCTIONS_DIR;
      fs.mkdirSync(instrDir, { recursive: true });
      const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
      const pdfName  = `${safeBase}_brickinstructions.pdf`;
      const pdfDest  = path.join(instrDir, pdfName);
      const relPath  = `/data/instructions/${pdfName}`;
      const desc     = `Anleitung ${n} (BrickInstructions)`;
      await db.run('INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING',
        [n, pageUrl, desc, null]).catch(logAndContinue('anleitung:desc'));
      setImmediate(() => { collectAndBuildPDF(baseUrl, hdrs, fund.erstesBild, pdfDest, relPath, n).catch(logAndContinue('anleitung:collectAndBuildPDF')); });
      console.log(`[brickinstructions] Fallback triggered for ${n}`);
      return 1;
    }
  } catch (e) { console.log(`[brickinstructions] Fallback failed for ${n}: ${fehlertext(e)}`); }
  return 0;
}

/**
 * @param eigenerTakt Der Aufrufer hält selbst Abstand zwischen zwei Sets (die
 *   Anleitungs-Warteschlange); dann entfallen die Pausen am Ende.
 */
export async function downloadSetInstructions(setNumber: string,
                                       eigenerTakt = false) {
  const n = mitVersion(setNumber);

  // Wurde für DIESES Set überhaupt ein fremder Server befragt?
  // Der Takt der Warteschlange (15 s) ist dazu da, Brickset und
  // brickinstructions.com zu schonen. Er hing bisher am DURCHGANG, nicht am
  // Abruf — und damit auch an Sets, die längst eine Anleitung haben und hier …
  // Ausführlich: docs/begruendungen/src/katalog/instructions.ts.md#downloadsetinstructions
  _letzterAbrufWarExtern = false;

  const existing = await anzahlAnleitungen(n);
  if (existing > 0) { return existing; }

  let instrList: any[] = [];
  let bricksetSucceededEmpty = false;
  _letzterAbrufWarExtern = true;   // ab hier wird wirklich gefragt
  try { instrList = await scrapeInstructions(n); } catch (e) { meldeUndWeiter('anleitungen:auslesen', e); }
  if (!instrList.length) {
    const bsResult = await brickset.getInstructions(n).catch(() => ({ instructions: [], usesFallback: true }));
    instrList = bsResult.instructions || [];
    // usesFallback=true means Brickset responded (success or non-quota error) with no instructions
    // usesFallback=false means quota hit — stay in queue, don't use fallback yet
    bricksetSucceededEmpty = bsResult.usesFallback && instrList.length === 0;
  }

  // Fallback 2: BrickLink Designer Programme (bdpinstructions.s3.amazonaws.com)
  // downloadFile streams directly to disk — no memory buffering for large PDFs
  if (!instrList.length && bricksetSucceededEmpty) {
    try {
      const baseNum  = ohneVersion(n);
      const bdpUrl   = `https://bdpinstructions.s3.amazonaws.com/${pfadSegment(baseNum)}.pdf`;
      const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
      const pdfName  = `${safeBase}_bdp.pdf`;
      const instrDir = INSTRUCTIONS_DIR;
      fs.mkdirSync(instrDir, { recursive: true });
      const pdfDest  = path.join(instrDir, pdfName);
      const relPath  = `/data/instructions/${pdfName}`;
      const ok = await downloadFile(bdpUrl, pdfDest);
      if (ok) {
        console.log(`[instr] BDP fallback downloaded: ${bdpUrl}`);
        await db.run(
          'INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING',
          [n, bdpUrl, `Anleitung ${n} (BDP)`, relPath]
        ).catch(logAndContinue('anleitung:ok'));
        if (!eigenerTakt) await sleep(5000);
        return 1;
      }
    } catch(e) { console.log(`[instr] BDP failed: ${fehlertext(e)}`); }
    if (!eigenerTakt) await sleep(5000); // throttle regardless of result
  }

  const biAlreadyTried = await db.get("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [n]);
  if (!instrList.length && bricksetSucceededEmpty && !biAlreadyTried) {
    try {
      const fund = await brickinstructionsFund(n);
      if (fund) {
        const { baseUrl, pageUrl, hdrs } = fund;
        instrList.push({ url:pageUrl, description:`Anleitung ${n} (BrickInstructions)`,
          brickinstructions_base:baseUrl, brickinstructions_hdrs:hdrs, brickinstructions_first:fund.erstesBild });
        
      }
    } catch (e) { console.log(`  BrickInstructions probe failed: ${fehlertext(e)}`); }
  }

  if (!instrList.length) {  return 0; }

  const instrDir = INSTRUCTIONS_DIR;
  fs.mkdirSync(instrDir, { recursive: true });
  let saved = 0;
  for (let i = 0; i < instrList.length; i++) {
    const instr = instrList[i];
    if (!instr.url) continue;
    const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
    if (instr.brickinstructions_base) {
      const pdfName = `${safeBase}_brickinstructions.pdf`;
      const pdfDest = path.join(instrDir, pdfName);
      const relPath = `/data/instructions/${pdfName}`;
      try { await db.run('INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING', [n, instr.url, instr.description, null]); saved++; } catch (e) { meldeUndWeiter('anleitungen:pdf-eintragen', e); }
      setImmediate(() => { collectAndBuildPDF(instr.brickinstructions_base, instr.brickinstructions_hdrs, instr.brickinstructions_first, pdfDest, relPath, n).catch(logAndContinue('anleitung:collectAndBuildPDF')); });
      continue;
    }
    const safeName = `${safeBase}_${i + 1}.pdf`;
    const dest = path.join(instrDir, safeName);
    const relPath = `/data/instructions/${safeName}`;
    const ok = await downloadFile(instr.url, dest);
    try { await db.run('INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING', [n, instr.url, instr.description||`Anleitung ${n}`, ok?relPath:null]); saved++; } catch (e) { meldeUndWeiter('anleitungen:datei-eintragen', e); }
    if (i < instrList.length - 1) await sleep(200);
  }
  
  return saved;
}

// BrickInstructions PDF helpers (unchanged — file system ops)
async function collectAndBuildPDF(baseUrl: string, hdrs: Record<string, string>,
                                  firstPageBuf: Buffer, pdfDest: string,
                                  relPath: string, setNumber: string) {
  try {
    const imageBuffers = [firstPageBuf];
    for (let p = 2; p <= 99; p++) {
      await sleep(500);
      try { const r = await httpsGetRobust(`${baseUrl}/${String(p).padStart(3,'0')}.jpg`, hdrs, 8000); if (r.status!==200||!r.buffer||r.buffer.length<500) break; imageBuffers.push(r.buffer); } catch (_) { break; }
    }
    console.log(`  Building PDF for ${setNumber}: ${imageBuffers.length} pages`);
    await sleep(100);
    const ok = await buildImagePDF_fromBuffers(imageBuffers, pdfDest);
    if (ok) {
      await db.run('UPDATE shared_instructions SET local_path = $1 WHERE set_number = $2 AND local_path IS NULL', [relPath, setNumber]);
      console.log(`  ✅ PDF ready for ${setNumber}`);
    }
  } catch (e) { console.log(`  PDF build failed for ${setNumber}: ${fehlertext(e)}`); }
}

async function buildImagePDF_fromBuffers(imgBuffers: Buffer[], destPath: string) {
  if (fs.existsSync(destPath)) return true;
  return new Promise(resolve => {
    try {
      const doc = new PDFDocument({ autoFirstPage:false, margin:0 });
      const chunks: any[] = [];
      doc.on('data', (d: Buffer) => chunks.push(d));
      doc.on('end', () => { try { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(true); } catch(_){ resolve(false); } });
      doc.on('error', () => resolve(false));
      for (const buf of imgBuffers) { try { doc.addPage({ size:'A4', layout:'landscape', margin:0 }); doc.image(buf, 0, 0, { fit:[doc.page.width, doc.page.height], align:'center', valign:'center' }); } catch (e) { meldeUndWeiter('anleitung:image', e); } }
      doc.end();
    } catch(_){ resolve(false); }
  });
}

