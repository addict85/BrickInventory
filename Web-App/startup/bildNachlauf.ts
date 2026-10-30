/**
 * Fehlende Bilder im Hintergrund laden: 30 s nach dem Start, danach stündlich.
 * Nur im Primär-Worker (server.ts ruft es hinter der Primär-Prüfung auf).
 */
import * as db from '../db/database';
import { fehlertext, logAndContinue, meldeUndLiefere } from '../utils/httpError';
import { generateThumb } from '../utils/thumbs';
import { setzeTeilBildLokal, setzeFigurBildLokal } from '../utils/katalogPflege';
import { KEINE_FARBE } from '../utils/validate';

export function starteBildNachlauf(): void {
  const run = async () => {
    try {
      const enrich  = require('../jobs/partsCatalogEnrich') as typeof import('../jobs/partsCatalogEnrich');
      const monitor = require('../utils/jobMonitor') as typeof import('../utils/jobMonitor');
      const sets = await db.all(
        `SELECT DISTINCT set_number FROM set_parts_catalog
         WHERE image_url IS NOT NULL AND image_local IS NULL
         UNION
         SELECT DISTINCT set_number FROM set_minifigs_catalog
         WHERE image_url IS NOT NULL AND image_local IS NULL`
      ).catch(meldeUndLiefere('bild-nachlauf:sets', []));
      // Manuell erfasste Teile mit fehlendem lokalen Bild — im selben Job
      // dauerhaft in den lokalen Cache laden (statt nur über den Proxy). Nur
      // geprüfte Adressen (bild_von IS NULL): Die Datei gilt für alle Konten.
      // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-manualparts
      const manualParts = await db.all(
        `SELECT DISTINCT pcc.part_number, pcc.color_id, pcc.image_url
           FROM part_color_catalog pcc
           JOIN parts p ON p.part_number = pcc.part_number
                       AND p.color_id    = pcc.color_id
                       AND p.source      = 'manual'
          WHERE pcc.image_url IS NOT NULL AND pcc.image_local IS NULL AND pcc.bild_von IS NULL`
      ).catch(meldeUndLiefere('bild-nachlauf:manualParts', []));
      // Minifiguren — ALLE, nicht nur manuell erfasste.
      // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-figstofetch
      const figsToFetch = await db.all(
        `SELECT mc.fig_number, mc.image_url FROM minifigs_catalog mc
          WHERE mc.image_url IS NOT NULL AND mc.image_local IS NULL AND mc.bild_von IS NULL
            AND EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_number = mc.fig_number)
          ORDER BY mc.fig_number`
      ).catch(meldeUndLiefere('bild-nachlauf:figsToFetch', []));
      if (!sets.length && !manualParts.length && !figsToFetch.length) {
        await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht', label: '📥 Bild-Download (CDN)' }).catch(logAndContinue('bild-nachlauf:Download'));
        return;
      }
      console.log(`[img-dl-bg] fehlende Bilder: ${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`);
      await monitor.update('imgDl', { status: 'running', progress: 0,
        total: sets.length + manualParts.length + figsToFetch.length,
        sub: `${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`,
        label: '📥 Bild-Download (CDN)' }).catch(logAndContinue('bild-nachlauf:Download'));
      let done = 0;
      const total = sets.length + manualParts.length + figsToFetch.length;
      const tick = async () => {
        done++;
        if (done % 10 === 0 || done === total) {
          await monitor.update('imgDl', { status: 'running', progress: done, total,
            sub: `${done} / ${total} geladen`, label: '📥 Bild-Download (CDN)' }).catch(logAndContinue('bild-nachlauf:Download'));
        }
      };
      for (const { set_number } of sets) {
        await enrich.downloadSetImages(set_number).catch(e => console.warn(`[img-dl-bg] ${set_number}: ${e.message}`));
        await tick();
      }
      for (const p of manualParts) {
        const local = await enrich.downloadImage(p.image_url, p.part_number, p.color_id ?? KEINE_FARBE, 'part').catch(meldeUndLiefere('bild-nachlauf:downloadImage', null));
        if (local) {
          // In den Katalog (utils/katalogPflege.ts) — einmal fuer alle
          // Konten. Mit Protokoll, falls es scheitert: Das Bild liegt dann
          // auf der Platte, der Katalog zeigt aber nicht darauf. In der
          // Oberflaeche fehlt es weiterhin, und der naechste Start laedt es
          // erneut herunter.
          await setzeTeilBildLokal(p.part_number, p.color_id ?? KEINE_FARBE, local)
            .catch(logAndContinue(`bilder:teil ${p.part_number}`));
          // Fehlte bisher: Ohne diesen Aufruf blieb es bei der Originalgrösse,
          // dauerhaft — anders als bei Sets (downloadSetImages() oben), wo
          // die Vorschau schon immer angestossen wurde. Der einmalige
          // Startup-Job weiter unten ("Generate missing thumbnails") hätte
          // das irgendwann nachgeholt, aber erst beim NÄCHSTEN
          // Server-Neustart — nicht wenn das Bild gerade frisch da ist.
          generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
        }
        await tick();
      }
      for (const f of figsToFetch) {
        const local = await enrich.downloadImage(f.image_url, f.fig_number, 0, 'minifig').catch(meldeUndLiefere('bild-nachlauf:downloadImage', null));
        if (local) {
          // Eine Zeile, nicht mehr alle Zeilen dieser Figur ueber Nutzer
          // und Quellen hinweg: Die Datei heisst nach der Nummer, und der
          // Katalog fuehrt sie seit Migration 0034 genau einmal.
          await setzeFigurBildLokal(f.fig_number, local)
            .catch(logAndContinue(`bilder:minifigur ${f.fig_number}`));
          // Dieselbe fehlende Vorschau-Erzeugung wie bei den Teilen oben.
          generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
        }
        await tick();
      }
      await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht', label: '📥 Bild-Download (CDN)' }).catch(logAndContinue('bild-nachlauf:Download'));
    } catch(e) { console.error('[img-dl-bg] error:', fehlertext(e)); }
  };
  setTimeout(() => run().finally(() => setInterval(run, 60 * 60 * 1000)), 30_000);
}
