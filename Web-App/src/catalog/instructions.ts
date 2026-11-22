import path from 'node:path';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { INSTRUCTIONS_DIR } from '../infra/appPaths';
import { setTimeout as sleep } from 'node:timers/promises';
import { reportError, logAndContinue } from '../infra/error';
import { withVersion, withoutVersion } from '../infra/setNumber';
import { pathSegment } from '../infra/foreignAddresses';
import { attempts } from '../infra/result';
import type { CatalogContext } from './context';

const PDF_START = Buffer.from('%PDF-');

/** Several sources, because none alone lists all sets; from image pages a PDF
 * if need be. */

/** So that the queue's tick only waits after real fetches; per set of services. */
const fetchState = (k: CatalogContext) => k.compartments.slot('anleitungen:abruf', () => ({ extern: false }));
export function lastFetchWarExtern(k: CatalogContext): boolean {
  return fetchState(k).extern;
}

// Count, read, delete in one place instead of scattered.

export async function instructionCount(k: CatalogContext, setNumber: string): Promise<number> {
  const r = await k.instructions.countInstructions(withVersion(setNumber));
  return Number(r?.c) || 0;
}

export async function instructionsToSet(k: CatalogContext, setNumber: string) {
  return k.instructions.instructionsOfSets(withVersion(setNumber));
}

/** First the automatically imported ones, then the self-uploaded ones. */
export function mergeInstructions<A extends object, B extends object>(shared: A[], own: B[]) {
  return [...shared.map(i => ({ ...i, is_manual: false })), ...own.map(i => ({ ...i, is_manual: true }))];
}

/** Once per set and day for everyone: reloading deletes for everyone and costs
 * quota. In ONE statement so that two requests do not both get through. */
export async function instructionNewLoadAllowed(k: CatalogContext, setNumber: string): Promise<boolean> {
  return k.throttle.oncePerDay(`anleitung-neu|${withVersion(setNumber)}`);
}

export async function deleteInstructions(k: CatalogContext, setNumber: string) {
  return k.instructions.deleteInstructionsOfSets(withVersion(setNumber));
}

// One find for creating and searching.
async function brickinstructionsFund(k: CatalogContext, n: string) {
  const baseNum = pathSegment(withoutVersion(n));
  const folder = String(Math.floor(parseInt(baseNum, 10) / 1000) * 1000).padStart(5, '0');
  const baseUrl = `https://lego.brickinstructions.com/instructions/${folder}/${baseNum}`;
  const pageUrl = `https://lego.brickinstructions.com/lego_instructions/set/${baseNum}/`;
  const hdrs = { 'User-Agent': 'Mozilla/5.0 (compatible; BrickManager/3.0)', Referer: pageUrl };
  const probe = await k.externalSources.sources.httpsGetRobust(`${baseUrl}/001.jpg`, hdrs, 3000);
  if (probe.status !== 200 || !probe.buffer || probe.buffer.length <= 500) return null;
  return { baseUrl, pageUrl, hdrs, firstImage: probe.buffer };
}

export async function scrapeInstructionsFromFallback(k: CatalogContext, setNumber: string) {
  const n = withVersion(setNumber);
  const existing = await instructionCount(k, n);
  if (existing > 0) return existing;
  const biAlreadyTried = await k.instructions.hatBrickinstructions(n);
  if (biAlreadyTried) return 0;
  try {
    const fund = await brickinstructionsFund(k, n);
    if (fund) {
      const { baseUrl, pageUrl, hdrs } = fund;
      const instrDir = INSTRUCTIONS_DIR;
      fs.mkdirSync(instrDir, { recursive: true });
      const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
      const pdfName = `${safeBase}_brickinstructions.pdf`;
      const pdfDest = path.join(instrDir, pdfName);
      const relPath = `/data/instructions/${pdfName}`;
      const desc = `Anleitung ${n} (BrickInstructions)`;
      await k.instructions.rememberInstruction(n, pageUrl, desc, null);
      setImmediate(() => {
        void collectAndBuildPDF(k, baseUrl, hdrs, fund.firstImage, pdfDest, relPath, n).catch(
          logAndContinue('instructions:collectAndBuildPDF'),
        );
      });
      console.log(`[brickinstructions] Fallback triggered for ${n}`);
      return 1;
    }
  } catch (e) {
    // Exception: BrickInstructions is the last source; without it the set stays without instructions (0).
    reportError(`instructions:brickinstructions ${n}`, e);
  }
  return 0;
}

type InstructionSource = {
  url: string;
  description?: string | null | undefined;
  brickinstructions_base?: string;
  brickinstructions_hdrs?: Record<string, string>;
  brickinstructions_first?: Buffer;
};

/** @param ownTick The caller keeps the spacing between two sets itself;
 *   then the pauses at the end are dropped. */
export async function loadSetInstructions(k: CatalogContext, setNumber: string, ownTick = false) {
  const n = withVersion(setNumber);

  // Remember whether a foreign server was asked: the tick should not depend on sets
  // that have long had instructions.
  fetchState(k).extern = false;

  const existing = await instructionCount(k, n);
  if (existing > 0) {
    return existing;
  }

  fetchState(k).extern = true; // from here on a real request is made
  const { instrList, bricksetSucceededEmpty } = await instructionSources(k, n);

  if (!instrList.length && bricksetSucceededEmpty && (await bdpFallback(k, n, ownTick))) return 1;

  const biAlreadyTried = await k.instructions.hatBrickinstructions(n);
  if (!instrList.length && bricksetSucceededEmpty && !biAlreadyTried) {
    const bi = await brickinstructionsSource(k, n);
    if (bi) instrList.push(bi);
  }

  if (!instrList.length) {
    return 0;
  }
  return saveInstructions(k, n, instrList);
}

/** First the Rebrickable page, then Brickset. `bricksetSucceededEmpty`: Brickset
 * answered without instructions — only then are the further fallbacks worthwhile. */
async function instructionSources(k: CatalogContext, n: string) {
  let instrList: InstructionSource[] = [];
  let bricksetSucceededEmpty = false;
  try {
    instrList = await k.externalSources.sources.scrapeInstructions(n);
  } catch (e) {
    reportError('anleitungen:auslesen', e);
  }
  if (!instrList.length) {
    const bs = await attempts('anleitungen:brickset', k.externalSources.sources.brickset.getInstructions(n));
    instrList = bs.ok ? bs.wert.instructions || [] : [];
    // usesFallback false means quota exhausted. An error is not an answer —
    // both stay in the queue.
    bricksetSucceededEmpty = bs.ok && bs.wert.usesFallback && instrList.length === 0;
  }
  return { instrList, bricksetSucceededEmpty };
}

/** Straight to disk, no buffer for large PDFs; the pause also after a failure. */
async function bdpFallback(k: CatalogContext, n: string, ownTick: boolean): Promise<boolean> {
  try {
    const baseNum = withoutVersion(n);
    const bdpUrl = `https://bdpinstructions.s3.amazonaws.com/${pathSegment(baseNum)}.pdf`;
    const safeBase = n.replace(/[^a-z0-9-]/gi, '_');
    const pdfName = `${safeBase}_bdp.pdf`;
    const instrDir = INSTRUCTIONS_DIR;
    fs.mkdirSync(instrDir, { recursive: true });
    const pdfDest = path.join(instrDir, pdfName);
    const relPath = `/data/instructions/${pdfName}`;
    const ok = await k.externalSources.sources.downloadFile(bdpUrl, pdfDest, undefined, PDF_START);
    if (ok) {
      console.log(`[instr] BDP fallback downloaded: ${bdpUrl}`);
      await k.instructions.rememberInstruction(n, bdpUrl, `Anleitung ${n} (BDP)`, relPath);
      if (!ownTick) await sleep(5000);
      return true;
    }
  } catch (e) {
    // Exception: the BDP fallback is one of several sources; false lets the next one be asked.
    reportError(`instructions:bdp ${n}`, e);
  }
  if (!ownTick) await sleep(5000);
  return false;
}

async function brickinstructionsSource(k: CatalogContext, n: string): Promise<InstructionSource | null> {
  try {
    const fund = await brickinstructionsFund(k, n);
    if (!fund) return null;
    const { baseUrl, pageUrl, hdrs } = fund;
    return {
      url: pageUrl,
      description: `Anleitung ${n} (BrickInstructions)`,
      brickinstructions_base: baseUrl,
      brickinstructions_hdrs: hdrs,
      brickinstructions_first: fund.firstImage,
    };
  } catch (e) {
    // Exception: the search then shows the remaining sources; null here means "no preview".
    reportError(`instructions:brickinstructions-probe ${n}`, e);
    return null;
  }
}

/** Image pages from BrickInstructions are turned into a PDF in the background. */
async function saveInstructions(k: CatalogContext, n: string, instrList: InstructionSource[]): Promise<number> {
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
      await k.instructions.rememberInstruction(n, instr.url, instr.description ?? null, null);
      saved++;
      const { brickinstructions_base: basis, brickinstructions_hdrs: header, brickinstructions_first: erstes } = instr;
      setImmediate(() => {
        void collectAndBuildPDF(k, basis, header, erstes, pdfDest, relPath, n).catch(
          logAndContinue('instructions:collectAndBuildPDF'),
        );
      });
      continue;
    }
    const safeName = `${safeBase}_${i + 1}.pdf`;
    const dest = path.join(instrDir, safeName);
    const relPath = `/data/instructions/${safeName}`;
    const ok = await k.externalSources.sources.downloadFile(instr.url, dest, undefined, PDF_START);
    await k.instructions.rememberInstruction(n, instr.url, instr.description || `Anleitung ${n}`, ok ? relPath : null);
    saved++;
    if (i < instrList.length - 1) await sleep(200);
  }

  return saved;
}

async function collectAndBuildPDF(
  k: CatalogContext,
  baseUrl: string,
  hdrs: Record<string, string>,
  firstPageBuf: Buffer,
  pdfDest: string,
  relPath: string,
  setNumber: string,
) {
  const imageBuffers = [firstPageBuf];
  for (let p = 2; p <= 99; p++) {
    await sleep(500);
    try {
      const r = await k.externalSources.sources.httpsGetRobust(
        `${baseUrl}/${String(p).padStart(3, '0')}.jpg`,
        hdrs,
        8000,
      );
      if (r.status !== 200 || !r.buffer || r.buffer.length < 500) break;
      imageBuffers.push(r.buffer);
    } catch (_) {
      break;
    }
  }
  console.log(`  Building PDF for ${setNumber}: ${imageBuffers.length} pages`);
  await sleep(100);
  const ok = await buildImagePDF_fromBuffers(imageBuffers, pdfDest);
  if (ok) {
    await k.instructions.setInstructionFile(relPath, setNumber);
    console.log(`  ✅ PDF ready for ${setNumber}`);
  }
}

async function buildImagePDF_fromBuffers(imgBuffers: Buffer[], destPath: string) {
  if (fs.existsSync(destPath)) return true;
  return new Promise(resolve => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (d: Buffer) => chunks.push(d));
      doc.on('end', () => {
        try {
          fs.writeFileSync(destPath, Buffer.concat(chunks));
          resolve(true);
        } catch (_) {
          resolve(false);
        }
      });
      doc.on('error', () => resolve(false));
      for (const buf of imgBuffers) {
        try {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
          doc.image(buf, 0, 0, { fit: [doc.page.width, doc.page.height], align: 'center', valign: 'center' });
        } catch (e) {
          reportError('instructions:image', e);
        }
      }
      doc.end();
    } catch (_) {
      resolve(false);
    }
  });
}
