import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { INSTRUCTIONS_DIR } from '../infra/appPaths';
import { setTimeout as warte } from 'node:timers/promises';
import { downloadFile, scrapeInstructions, httpsGetRobust, brickset } from './quellen';
import { meldeFehler, fehlertext, logAndContinue, meldeUndLiefere } from '../infra/fehler';
import { mitVersion, ohneVersion } from '../infra/setNummer';
import { pfadSegment } from '../infra/fremdeAdressen';
import { katalog } from './prozess';

const PDF_ANFANG = Buffer.from('%PDF-');

/** Mehrere Quellen, weil keine allein alle Sets führt; aus Bildseiten notfalls
 * ein PDF. */

/** Damit der Takt der Warteschlange nur nach echten Abrufen wartet. */
let _letzterAbrufWarExtern = false;
export function letzterAbrufWarExtern(): boolean { return _letzterAbrufWarExtern; }

// Zählen, lesen, löschen an einer Stelle statt verstreut.

export async function anzahlAnleitungen(setNumber: string): Promise<number> {
  const r = await katalog().anleitungen.zaehleAnleitungen(mitVersion(setNumber)).catch(meldeUndLiefere('anleitung:mitVersion', null));
  return Number(r?.c) || 0;
}

export async function anleitungenZuSet(setNumber: string) {
  return katalog().anleitungen.anleitungenDesSets(mitVersion(setNumber)).catch(meldeUndLiefere('anleitung:mitVersion', []));
}

/** Erst die automatisch importierten, dann die selbst hochgeladenen. */
export function anleitungenZusammenlegen<A extends object, B extends object>(geteilt: A[], eigene: B[]) {
  return [
    ...geteilt.map(i => ({ ...i, is_manual: false })),
    ...eigene.map(i => ({ ...i, is_manual: true })),
  ];
}

/** Einmal je Set und Tag für alle: Neuladen löscht für alle und kostet
 * Kontingent. In EINER Anweisung, damit zwei Anfragen nicht beide durchkommen. */
export async function anleitungNeuLadenErlaubt(setNumber: string): Promise<boolean> {
  const z = await katalog().anleitungen.zaehleQuellenAufruf(`anleitung-neu|${mitVersion(setNumber)}`);
  return !!z;
}

export async function loescheAnleitungen(setNumber: string) {
  return katalog().anleitungen.loescheAnleitungenDesSets(mitVersion(setNumber));
}

// Ein Fund für Anlegen und Suchen.
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
  const biAlreadyTried = await katalog().anleitungen.hatBrickinstructions(n);
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
      await katalog().anleitungen.merkeAnleitung(n, pageUrl, desc, null).catch(logAndContinue('anleitung:desc'));
      setImmediate(() => { void collectAndBuildPDF(baseUrl, hdrs, fund.erstesBild, pdfDest, relPath, n).catch(logAndContinue('anleitung:collectAndBuildPDF')); });
      console.log(`[brickinstructions] Fallback triggered for ${n}`);
      return 1;
    }
  } catch (e) { console.log(`[brickinstructions] Fallback failed for ${n}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')); }
  return 0;
}

/** @param eigenerTakt Der Aufrufer hält selbst Abstand zwischen zwei Sets;
 *   dann entfallen die Pausen am Ende. */
export async function downloadSetInstructions(setNumber: string,
                                       eigenerTakt = false) {
  const n = mitVersion(setNumber);

  // Merken, ob ein fremder Server befragt wurde: Der Takt soll nicht an Sets
  // hängen, die längst eine Anleitung haben.
  _letzterAbrufWarExtern = false;

  const existing = await anzahlAnleitungen(n);
  if (existing > 0) { return existing; }

  let instrList: { url: string; description?: string | null | undefined; brickinstructions_base?: string;
                   brickinstructions_hdrs?: Record<string, string>; brickinstructions_first?: Buffer }[] = [];
  let bricksetSucceededEmpty = false;
  _letzterAbrufWarExtern = true;   // ab hier wird wirklich gefragt
  try { instrList = await scrapeInstructions(n); } catch (e) { meldeFehler('anleitungen:auslesen', e); }
  if (!instrList.length) {
    const bsResult = await brickset.getInstructions(n).catch(meldeUndLiefere('anleitungen:brickset', { instructions: [], usesFallback: true }));
    instrList = bsResult.instructions || [];
    // usesFallback: Brickset hat geantwortet, ohne Anleitung; false heisst
    // Kontingent erschöpft — dann in der Warteschlange bleiben.
    bricksetSucceededEmpty = bsResult.usesFallback && instrList.length === 0;
  }

  // downloadFile schreibt direkt auf die Platte — kein Puffer für grosse PDFs.
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
      const ok = await downloadFile(bdpUrl, pdfDest, undefined, PDF_ANFANG);
      if (ok) {
        console.log(`[instr] BDP fallback downloaded: ${bdpUrl}`);
        await katalog().anleitungen.merkeAnleitung(n, bdpUrl, `Anleitung ${n} (BDP)`, relPath).catch(logAndContinue('anleitung:ok'));
        if (!eigenerTakt) await warte(5000);
        return 1;
      }
    } catch(e) { console.log(`[instr] BDP failed: ${fehlertext(e)}`); }
    if (!eigenerTakt) await warte(5000); // throttle regardless of result
  }

  const biAlreadyTried = await katalog().anleitungen.hatBrickinstructions(n);
  if (!instrList.length && bricksetSucceededEmpty && !biAlreadyTried) {
    try {
      const fund = await brickinstructionsFund(n);
      if (fund) {
        const { baseUrl, pageUrl, hdrs } = fund;
        instrList.push({ url:pageUrl, description:`Anleitung ${n} (BrickInstructions)`,
          brickinstructions_base:baseUrl, brickinstructions_hdrs:hdrs, brickinstructions_first:fund.erstesBild });
        
      }
    } catch (e) { console.log(`  BrickInstructions probe failed: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')); }
  }

  if (!instrList.length) {  return 0; }

  const instrDir = INSTRUCTIONS_DIR;
  fs.mkdirSync(instrDir, { recursive: true });
  let saved = 0;
  for (let i = 0; i < instrList.length; i++) {
    const instr = instrList[i];
    if (!instr?.url) continue;
    const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
    if (instr.brickinstructions_base && instr.brickinstructions_hdrs && instr.brickinstructions_first) {
      const pdfName = `${safeBase}_brickinstructions.pdf`;
      const pdfDest = path.join(instrDir, pdfName);
      const relPath = `/data/instructions/${pdfName}`;
      try { await katalog().anleitungen.merkeAnleitung(n, instr.url, instr.description ?? null, null); saved++; } catch (e) { meldeFehler('anleitungen:pdf-eintragen', e); }
      const { brickinstructions_base: basis, brickinstructions_hdrs: kopf, brickinstructions_first: erstes } = instr;
      setImmediate(() => { void collectAndBuildPDF(basis, kopf, erstes, pdfDest, relPath, n).catch(logAndContinue('anleitung:collectAndBuildPDF')); });
      continue;
    }
    const safeName = `${safeBase}_${i + 1}.pdf`;
    const dest = path.join(instrDir, safeName);
    const relPath = `/data/instructions/${safeName}`;
    const ok = await downloadFile(instr.url, dest, undefined, PDF_ANFANG);
    try { await katalog().anleitungen.merkeAnleitung(n, instr.url, instr.description||`Anleitung ${n}`, ok?relPath:null); saved++; } catch (e) { meldeFehler('anleitungen:datei-eintragen', e); }
    if (i < instrList.length - 1) await warte(200);
  }
  
  return saved;
}

async function collectAndBuildPDF(baseUrl: string, hdrs: Record<string, string>,
                                  firstPageBuf: Buffer, pdfDest: string,
                                  relPath: string, setNumber: string) {
  try {
    const imageBuffers = [firstPageBuf];
    for (let p = 2; p <= 99; p++) {
      await warte(500);
      try { const r = await httpsGetRobust(`${baseUrl}/${String(p).padStart(3,'0')}.jpg`, hdrs, 8000); if (r.status!==200||!r.buffer||r.buffer.length<500) break; imageBuffers.push(r.buffer); } catch (_) { break; }
    }
    console.log(`  Building PDF for ${setNumber}: ${imageBuffers.length} pages`);
    await warte(100);
    const ok = await buildImagePDF_fromBuffers(imageBuffers, pdfDest);
    if (ok) {
      await katalog().anleitungen.setzeAnleitungsdatei(relPath, setNumber);
      console.log(`  ✅ PDF ready for ${setNumber}`);
    }
  } catch (e) { console.log(`  PDF build failed for ${setNumber}: ${fehlertext(e)}`); }
}

async function buildImagePDF_fromBuffers(imgBuffers: Buffer[], destPath: string) {
  if (fs.existsSync(destPath)) return true;
  return new Promise(resolve => {
    try {
      const doc = new PDFDocument({ autoFirstPage:false, margin:0 });
      const chunks: Buffer[] = [];
      doc.on('data', (d: Buffer) => chunks.push(d));
      doc.on('end', () => { try { fs.writeFileSync(destPath, Buffer.concat(chunks)); resolve(true); } catch(_){ resolve(false); } });
      doc.on('error', () => resolve(false));
      for (const buf of imgBuffers) { try { doc.addPage({ size:'A4', layout:'landscape', margin:0 }); doc.image(buf, 0, 0, { fit:[doc.page.width, doc.page.height], align:'center', valign:'center' }); } catch (e) { meldeFehler('anleitung:image', e); } }
      doc.end();
    } catch(_){ resolve(false); }
  });
}

