import path from 'path';
import fs from 'fs';
import * as db from '../db/database';
import { INSTRUCTIONS_DIR } from './appPaths';
import { downloadFile, scrapeInstructions, sleep, httpsGetRobust } from '../clients/rebrickable';
import * as brickset from '../clients/brickset';
import { meldeUndWeiter } from './httpError';

/**
 * Bauanleitungen beschaffen: Rebrickable → Brickset → BrickLink-Designer →
 * brickinstructions.com, und aus Bildseiten notfalls ein PDF bauen.
 *
 * ── Warum das nicht mehr in routes/sets.ts steht (Nachtrag 127) ─────────────
 *
 * Die Kette hatte drei Aufrufer ausserhalb — die Anleitungs-Warteschlange, den
 * Admin-Endpunkt und den Brickset-Client — und keiner konnte sie importieren:
 * `routes/sets.ts` ist ein Router. Der Brickset-Client holte sie deshalb per
 * spätem `require('../routes/sets')`, was den Kreis
 *
 *     sets → brickset → sets
 *
 * schloss. Die Warteschlange ging noch einen Schritt weiter und packte den
 * Aufruf in ein `try/catch` mit anschliessender `typeof`-Prüfung — eine
 * Vorsichtsmassnahme, die nur nötig war, weil niemand garantieren konnte, dass
 * der Name zur Laufzeit existiert. Genau diese Sorte Absicherung erübrigt sich
 * mit einem echten Import: tsc prüft den Namen.
 *
 * Hier ist die Kette ein Blatt — db, appPaths und die beiden API-Clients, kein
 * Rückbezug auf eine Route.
 *
 * Der Name `fetchInstructions`, unter dem routes/sets.ts sie nach aussen gab,
 * entfällt: Die Funktion heisst downloadSetInstructions und heisst jetzt
 * überall so.
 */

/**
 * Setbild in den lokalen Cache holen.
 *
 * Drei Dinge waren hier offen und sind es nicht mehr:
 *  1. Weiterleitungen wurden per REKURSION ohne Tiefenbegrenzung verfolgt —
 *     eine Kette, die im Kreis zeigt, lief endlos weiter. Jetzt höchstens
 *     fünf Sprünge, wie es der Bild-Proxy auch hält.
 *  2. Keine Grössenbegrenzung: Alles landete im Speicher, egal wie gross.
 *     Der Bild-Proxy kappt ebenfalls — beide Grenzen gehören zusammen.
 *  3. fs.existsSync + fs.writeFileSync blockieren den Event-Loop des Workers.
 *     Genau das ist in routes/parts.ts schon behoben worden (siehe Kommentar
 *     dort); diese Stelle war übersehen worden.
 */
/**
 * @param info Optionales Feld, in das der HTTP-Status der letzten Antwort
 *   geschrieben wird.
 *
 * ── Warum das nötig wurde (Nachtrag 112) ────────────────────────────────────
 * Die Funktion antwortet auf JEDEN Fehlschlag mit `null` — bei 404 („dieses
 * Bild gibt es nicht") ebenso wie bei 403 („du fragst zu schnell"). Der
 * Hintergrund-Job leitete daraus eine Fehlanzeige ab und sperrte das Bild für
 * sieben Tage.
 *
 * Bei einer Drosselung ist das falsch herum: Gerade dann sind die Bilder
 * vorhanden, und ausgerechnet der Ansturm, der die Drosselung auslöst, würde
 * hunderte davon dauerhaft aussperren. Der Bild-Proxy unterscheidet die beiden
 * Fälle längst (nur 404 wird gemerkt, 403 nicht) — der Job konnte es nicht,
 * weil ihm die Auskunft fehlte.
 *
 * Bestehende Aufrufer bleiben unberührt: Wer `info` weglässt, merkt nichts.
 */
// Direct brickinstructions.com fallback — used when Brickset quota is exhausted
// and entry is manually deleted from retry queue
/**
 * Ob der letzte `downloadSetInstructions()`-Aufruf einen fremden Server
 * befragt hat.
 *
 * Modulweit und nicht als Rückgabewert, weil drei der vier Aufrufer das
 * Ergebnis ohnehin verwerfen (`.catch(() => {})`) — eine geänderte Signatur
 * hätte dort nur Rauschen erzeugt. Der Job liest es unmittelbar nach seinem
 * eigenen Aufruf; dazwischen läuft nichts anderes, weil die Warteschlange
 * genau einen Vorgang gleichzeitig bearbeitet (`_running`).
 */
let _letzterAbrufWarExtern = false;
function letzterAbrufWarExtern(): boolean { return _letzterAbrufWarExtern; }

async function scrapeInstructionsFromFallback(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const existing = (await db.get('SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1', [n])).c;
  if (parseInt(existing) > 0) return parseInt(existing);
  const biAlreadyTried = await db.get("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [n]);
  if (biAlreadyTried) return 0;
  try {
    const baseNum = n.replace(/-[0-9]+$/, '');
    const folder  = String(Math.floor(parseInt(baseNum) / 1000) * 1000).padStart(5, '0');
    const baseUrl = `https://lego.brickinstructions.com/instructions/${folder}/${baseNum}`;
    const pageUrl = `https://lego.brickinstructions.com/lego_instructions/set/${baseNum}/`;
    const hdrs    = { 'User-Agent': 'Mozilla/5.0 (compatible; BrickManager/3.0)', 'Referer': pageUrl };
    const probe   = await httpsGetRobust(`${baseUrl}/001.jpg`, hdrs, 3000);
    if (probe.status === 200 && probe.buffer && probe.buffer.length > 500) {
      const instrDir = INSTRUCTIONS_DIR;
      fs.mkdirSync(instrDir, { recursive: true });
      const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
      const pdfName  = `${safeBase}_brickinstructions.pdf`;
      const pdfDest  = path.join(instrDir, pdfName);
      const relPath  = `/data/instructions/${pdfName}`;
      const desc     = `Anleitung ${n} (BrickInstructions)`;
      await db.run('INSERT INTO shared_instructions (set_number,url,description,local_path) VALUES ($1,$2,$3,$4) ON CONFLICT (set_number,url) DO NOTHING',
        [n, pageUrl, desc, null]).catch(() => {});
      setImmediate(() => { collectAndBuildPDF(baseUrl, hdrs, probe.buffer, pdfDest, relPath, n).catch(() => {}); });
      console.log(`[brickinstructions] Fallback triggered for ${n}`);
      return 1;
    }
  } catch (e) { console.log(`[brickinstructions] Fallback failed for ${n}: ${e.message}`); }
  return 0;
}

/**
 * @param eigenerTakt Der Aufrufer sorgt selbst für den Abstand zwischen zwei
 *   Sets — dann entfallen die Pausen am Ende dieser Funktion.
 *
 *   Die Anleitungs-Warteschlange wartet nach jedem Set ohnehin 15 Sekunden.
 *   Die 5 Sekunden hier liefen davor, also 20 statt 15 — ohne dass irgendein
 *   Server dadurch besser geschont würde, denn der nächste Abruf kommt so oder
 *   so frühestens nach 15 Sekunden.
 *
 *   Für die beiden anderen Aufrufer (Set erfassen, Brickset-Wiederholung) gibt
 *   es KEINEN Takt darüber. Dort bleiben die Pausen; deshalb ein Schalter und
 *   kein Löschen.
 */
// Der frühere `sendProgress`-Parameter ist ersatzlos entfallen. NACHGEMESSEN:
// alle vier Aufrufstellen (setService, instructionQueue, bricksetRetry,
// routes/sets.ts) übergaben `null` — der 'instructions'-Schritt konnte den
// Browser also gar nicht mehr erreichen. Ein Parameter, den jeder Aufrufer mit
// null füllt, sagt dem Leser bloss eine Möglichkeit vor, die es nicht gibt.
async function downloadSetInstructions(setNumber: string,
                                       eigenerTakt = false) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;

  // ── Wurde für DIESES Set überhaupt ein fremder Server befragt? ────────────
  //
  // Der Takt der Warteschlange (15 s) ist dazu da, Brickset und
  // brickinstructions.com zu schonen. Er hing bisher am DURCHGANG, nicht am
  // Abruf — und damit auch an Sets, die längst eine Anleitung haben und hier
  // eine Zeile weiter unten wieder herausfallen, ohne eine einzige Verbindung
  // zu öffnen.
  //
  // Genau derselbe Fehler wie beim Bild-Job (Nachtrag 217): Das Kontingent
  // wurde auf Notizen angewandt statt auf CDN-Anfragen. Dort waren es 37
  // Minuten für nichts, hier 15 Sekunden je bereits erledigtem Set.
  _letzterAbrufWarExtern = false;

  const existing = (await db.get('SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1', [n])).c;
  if (parseInt(existing) > 0) {  return parseInt(existing); }

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
      const baseNum  = n.replace(/-[0-9]+$/, '');
      const bdpUrl   = `https://bdpinstructions.s3.amazonaws.com/${baseNum}.pdf`;
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
        ).catch(() => {});
        if (!eigenerTakt) await sleep(5000);
        return 1;
      }
    } catch(e) { console.log(`[instr] BDP failed: ${e.message}`); }
    if (!eigenerTakt) await sleep(5000); // throttle regardless of result
  }

  const biAlreadyTried = await db.get("SELECT 1 FROM shared_instructions WHERE set_number = $1 AND url LIKE '%brickinstructions%'", [n]);
  if (!instrList.length && bricksetSucceededEmpty && !biAlreadyTried) {
    try {
      const baseNum = n.replace(/-[0-9]+$/, '');
      const folder  = String(Math.floor(parseInt(baseNum) / 1000) * 1000).padStart(5, '0');
      const baseUrl = `https://lego.brickinstructions.com/instructions/${folder}/${baseNum}`;
      const pageUrl = `https://lego.brickinstructions.com/lego_instructions/set/${baseNum}/`;
      const hdrs    = { 'User-Agent': 'Mozilla/5.0 (compatible; BrickManager/3.0)', 'Referer': pageUrl };
      const probe   = await httpsGetRobust(`${baseUrl}/001.jpg`, hdrs, 3000);
      if (probe.status === 200 && probe.buffer && probe.buffer.length > 500) {
        instrList.push({ url:pageUrl, description:`Anleitung ${n} (BrickInstructions)`,
          brickinstructions_base:baseUrl, brickinstructions_hdrs:hdrs, brickinstructions_first:probe.buffer });
        
      }
    } catch (e) { console.log(`  BrickInstructions probe failed: ${e.message}`); }
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
      setImmediate(() => { collectAndBuildPDF(instr.brickinstructions_base, instr.brickinstructions_hdrs, instr.brickinstructions_first, pdfDest, relPath, n).catch(()=>{}); });
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
  } catch (e) { console.log(`  PDF build failed for ${setNumber}: ${e.message}`); }
}

async function buildImagePDF_fromBuffers(imgBuffers: Buffer[], destPath: string) {
  if (fs.existsSync(destPath)) return true;
  let PDFDocument; try { PDFDocument = require('pdfkit'); } catch (e) { throw new Error('pdfkit not installed'); }
  return new Promise(resolve => {
    try {
      const doc = new PDFDocument({ autoFirstPage:false, margin:0 });
      const chunks: any[] = [];
      doc.on('data', (d: Buffer) => chunks.push(d));
      doc.on('end', () => { try { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(true); } catch(_){ resolve(false); } });
      doc.on('error', () => resolve(false));
      for (const buf of imgBuffers) { try { doc.addPage({ size:'A4', layout:'landscape', margin:0 }); doc.image(buf, 0, 0, { fit:[doc.page.width, doc.page.height], align:'center', valign:'center' }); } catch(_){} }
      doc.end();
    } catch(_){ resolve(false); }
  });
}


export { downloadSetInstructions, scrapeInstructionsFromFallback, letzterAbrufWarExtern };
