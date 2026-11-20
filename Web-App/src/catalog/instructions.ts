import path from 'node:path';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { INSTRUCTIONS_DIR } from '../infra/appPaths';
import { setTimeout as warte } from 'node:timers/promises';
import { reportError, logAndContinue } from '../infra/fehler';
import { withVersion, withoutVersion } from '../infra/setNummer';
import { pathSegment } from '../infra/fremdeAdressen';
import { versuche } from '../infra/ergebnis';
import type { CatalogContext } from './context';

const PDF_START = Buffer.from('%PDF-');

/** Mehrere Quellen, weil keine allein alle Sets führt; aus Bildseiten notfalls
 * ein PDF. */

/** Damit der Takt der Warteschlange nur nach echten Abrufen wartet; je Satz Dienste. */
const abruf = (k: CatalogContext) => k.faecher.fach('anleitungen:abruf', () => ({ extern: false }));
export function lastFetchWarExtern(k: CatalogContext): boolean {
  return abruf(k).extern;
}

// Zählen, lesen, löschen an einer Stelle statt verstreut.

export async function anzahlAnleitungen(k: CatalogContext, setNumber: string): Promise<number> {
  const r = await k.anleitungen.zaehleAnleitungen(withVersion(setNumber));
  return Number(r?.c) || 0;
}

export async function instructionsToSet(k: CatalogContext, setNumber: string) {
  return k.anleitungen.instructionsOfSets(withVersion(setNumber));
}

/** Erst die automatisch importierten, dann die selbst hochgeladenen. */
export function mergeInstructions<A extends object, B extends object>(geteilt: A[], eigene: B[]) {
  return [...geteilt.map(i => ({ ...i, is_manual: false })), ...eigene.map(i => ({ ...i, is_manual: true }))];
}

/** Einmal je Set und Tag für alle: Neuladen löscht für alle und kostet
 * Kontingent. In EINER Anweisung, damit zwei Anfragen nicht beide durchkommen. */
export async function instructionNewLoadAllowed(k: CatalogContext, setNumber: string): Promise<boolean> {
  return k.throttle.oncePerDay(`anleitung-neu|${withVersion(setNumber)}`);
}

export async function deleteInstructions(k: CatalogContext, setNumber: string) {
  return k.anleitungen.deleteInstructionsOfSets(withVersion(setNumber));
}

// Ein Fund für Anlegen und Suchen.
async function brickinstructionsFund(k: CatalogContext, n: string) {
  const baseNum = pathSegment(withoutVersion(n));
  const folder = String(Math.floor(parseInt(baseNum, 10) / 1000) * 1000).padStart(5, '0');
  const baseUrl = `https://lego.brickinstructions.com/instructions/${folder}/${baseNum}`;
  const pageUrl = `https://lego.brickinstructions.com/lego_instructions/set/${baseNum}/`;
  const hdrs = { 'User-Agent': 'Mozilla/5.0 (compatible; BrickManager/3.0)', Referer: pageUrl };
  const probe = await k.externalSources.quellen.httpsGetRobust(`${baseUrl}/001.jpg`, hdrs, 3000);
  if (probe.status !== 200 || !probe.buffer || probe.buffer.length <= 500) return null;
  return { baseUrl, pageUrl, hdrs, firstImage: probe.buffer };
}

export async function scrapeInstructionsFromFallback(k: CatalogContext, setNumber: string) {
  const n = withVersion(setNumber);
  const existing = await anzahlAnleitungen(k, n);
  if (existing > 0) return existing;
  const biAlreadyTried = await k.anleitungen.hatBrickinstructions(n);
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
      await k.anleitungen.rememberInstruction(n, pageUrl, desc, null);
      setImmediate(() => {
        void collectAndBuildPDF(k, baseUrl, hdrs, fund.firstImage, pdfDest, relPath, n).catch(
          logAndContinue('anleitung:collectAndBuildPDF'),
        );
      });
      console.log(`[brickinstructions] Fallback triggered for ${n}`);
      return 1;
    }
  } catch (e) {
    // Ausnahme: BrickInstructions ist die letzte Quelle; ohne sie bleibt das Set ohne Anleitung (0).
    reportError(`anleitung:brickinstructions ${n}`, e);
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

/** @param ownTick Der Aufrufer hält selbst Abstand zwischen zwei Sets;
 *   dann entfallen die Pausen am Ende. */
export async function setAnleitungenLaden(k: CatalogContext, setNumber: string, ownTick = false) {
  const n = withVersion(setNumber);

  // Merken, ob ein fremder Server befragt wurde: Der Takt soll nicht an Sets
  // hängen, die längst eine Anleitung haben.
  abruf(k).extern = false;

  const existing = await anzahlAnleitungen(k, n);
  if (existing > 0) {
    return existing;
  }

  abruf(k).extern = true; // ab hier wird wirklich gefragt
  const { instrList, bricksetSucceededEmpty } = await instructionSources(k, n);

  if (!instrList.length && bricksetSucceededEmpty && (await bdpFallback(k, n, ownTick))) return 1;

  const biAlreadyTried = await k.anleitungen.hatBrickinstructions(n);
  if (!instrList.length && bricksetSucceededEmpty && !biAlreadyTried) {
    const bi = await brickinstructionsSource(k, n);
    if (bi) instrList.push(bi);
  }

  if (!instrList.length) {
    return 0;
  }
  return saveInstructions(k, n, instrList);
}

/** Erst die Rebrickable-Seite, dann Brickset. `bricksetSucceededEmpty`: Brickset hat
 * geantwortet, ohne Anleitung — nur dann lohnen die weiteren Rückfälle. */
async function instructionSources(k: CatalogContext, n: string) {
  let instrList: InstructionSource[] = [];
  let bricksetSucceededEmpty = false;
  try {
    instrList = await k.externalSources.quellen.scrapeInstructions(n);
  } catch (e) {
    reportError('anleitungen:auslesen', e);
  }
  if (!instrList.length) {
    const bs = await versuche('anleitungen:brickset', k.externalSources.quellen.brickset.getInstructions(n));
    instrList = bs.ok ? bs.wert.instructions || [] : [];
    // usesFallback false heisst Kontingent erschöpft. Ein Fehler ist keine Antwort —
    // beides bleibt in der Warteschlange.
    bricksetSucceededEmpty = bs.ok && bs.wert.usesFallback && instrList.length === 0;
  }
  return { instrList, bricksetSucceededEmpty };
}

/** Direkt auf die Platte, kein Puffer für grosse PDFs; die Pause auch nach einem Fehlschlag. */
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
    const ok = await k.externalSources.quellen.downloadFile(bdpUrl, pdfDest, undefined, PDF_START);
    if (ok) {
      console.log(`[instr] BDP fallback downloaded: ${bdpUrl}`);
      await k.anleitungen.rememberInstruction(n, bdpUrl, `Anleitung ${n} (BDP)`, relPath);
      if (!ownTick) await warte(5000);
      return true;
    }
  } catch (e) {
    // Ausnahme: Der BDP-Rückfall ist eine von mehreren Quellen; false lässt die nächste fragen.
    reportError(`anleitung:bdp ${n}`, e);
  }
  if (!ownTick) await warte(5000);
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
    // Ausnahme: Die Suche zeigt dann die übrigen Quellen; null heisst hier „keine Vorschau“.
    reportError(`anleitung:brickinstructions-probe ${n}`, e);
    return null;
  }
}

/** Bildseiten von BrickInstructions werden im Hintergrund zu einem PDF. */
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
      await k.anleitungen.rememberInstruction(n, instr.url, instr.description ?? null, null);
      saved++;
      const { brickinstructions_base: basis, brickinstructions_hdrs: kopf, brickinstructions_first: erstes } = instr;
      setImmediate(() => {
        void collectAndBuildPDF(k, basis, kopf, erstes, pdfDest, relPath, n).catch(
          logAndContinue('anleitung:collectAndBuildPDF'),
        );
      });
      continue;
    }
    const safeName = `${safeBase}_${i + 1}.pdf`;
    const dest = path.join(instrDir, safeName);
    const relPath = `/data/instructions/${safeName}`;
    const ok = await k.externalSources.quellen.downloadFile(instr.url, dest, undefined, PDF_START);
    await k.anleitungen.rememberInstruction(n, instr.url, instr.description || `Anleitung ${n}`, ok ? relPath : null);
    saved++;
    if (i < instrList.length - 1) await warte(200);
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
    await warte(500);
    try {
      const r = await k.externalSources.quellen.httpsGetRobust(
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
  await warte(100);
  const ok = await buildImagePDF_fromBuffers(imageBuffers, pdfDest);
  if (ok) {
    await k.anleitungen.setInstructionFile(relPath, setNumber);
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
          reportError('anleitung:image', e);
        }
      }
      doc.end();
    } catch (_) {
      resolve(false);
    }
  });
}
