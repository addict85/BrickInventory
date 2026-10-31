/**
 * Fehlende Bilder im Hintergrund laden — der geplante Auftrag 'bild_nachlauf'
 * (stündlich, der erste 30 s nach dem Start; src/auftraege/zeitplan.ts).
 */
import { setsMitFehlendenKatalogbildern, manuelleTeileOhneBild, figurenOhneBild } from '../src/katalog/bildlage';
import { logAndContinue, meldeUndLiefere } from '../src/infra/httpError';
import { generateThumb } from '../src/katalog/bilder/thumbs';
import { setzeTeilBildLokal, setzeFigurBildLokal } from '../src/katalog/katalogPflege';
import { KEINE_FARBE } from '../src/infra/validate';
import * as enrich from './partsCatalogEnrich';
import * as monitor from '../src/auftraege/jobMonitor';
import { AuftragUnterbrochen, type AuftragsKontext } from './auftragsWorker';

async function bildNachlauf(k: AuftragsKontext): Promise<void> {
  const sets = await setsMitFehlendenKatalogbildern().catch(meldeUndLiefere('bild-nachlauf:sets', []));
  // Manuell erfasste Teile mit fehlendem lokalen Bild — im selben Job
  // dauerhaft in den lokalen Cache laden (statt nur über den Proxy). Nur
  // geprüfte Adressen (bild_von IS NULL): Die Datei gilt für alle Konten.
  // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-manualparts
  const manualParts = await manuelleTeileOhneBild().catch(meldeUndLiefere('bild-nachlauf:manualParts', []));
  // Minifiguren — ALLE, nicht nur manuell erfasste.
  // Ausführlich: docs/begruendungen/server.ts.md#electprimaryworker-figstofetch
  const figsToFetch = await figurenOhneBild().catch(meldeUndLiefere('bild-nachlauf:figsToFetch', []));
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
      await k.fortschritt({ erledigt: done, gesamt: total });
    }
    if (k.beendet) throw new AuftragUnterbrochen();
  };
  for (const set_number of sets) {
    await enrich.downloadSetImages(set_number).catch(e => console.warn(`[img-dl-bg] ${set_number}: ${e.message}`));
    await tick();
  }
  for (const p of manualParts) {
    const local = await enrich.downloadImage(p.image_url, p.part_number, p.color_id ?? KEINE_FARBE, 'part').catch(meldeUndLiefere('bild-nachlauf:downloadImage', null));
    if (local) {
      // In den Katalog (src/katalog/katalogPflege.ts) — einmal fuer alle
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
}

export { bildNachlauf };
