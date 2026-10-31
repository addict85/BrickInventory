/** Stündlich, der erste 30 s nach dem Start (src/auftraege/zeitplan.ts). */
import { bilderFuerNachlauf } from '../src/katalog/bildlage';
import { logAndContinue, meldeUndLiefere } from '../src/infra/httpError';
import { generateThumb } from '../src/katalog/bilder/thumbs';
import { setzeTeilBildLokal, setzeFigurBildLokal } from '../src/katalog/katalogPflege';
import { KEINE_FARBE } from '../src/infra/validate';
import * as enrich from '../src/katalog/teileAnreicherung';
import * as monitor from '../src/auftraege/jobMonitor';
import { AuftragUnterbrochen, type AuftragsKontext } from './auftragsWorker';

async function bildNachlauf(k: AuftragsKontext): Promise<void> {
  const { sets, teile: manualParts, figuren: figsToFetch } = await bilderFuerNachlauf();
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
      // Einmal für alle Konten in den Katalog; scheitert es, liegt das Bild zwar
      // auf der Platte, die Oberfläche zeigt es aber nicht — darum mit Protokoll.
      await setzeTeilBildLokal(p.part_number, p.color_id ?? KEINE_FARBE, local)
        .catch(logAndContinue(`bilder:teil ${p.part_number}`));
      // Die Vorschau gleich anstossen, sonst bliebe es bis zum nächsten Neustart
      // bei der Originalgrösse.
      generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
    }
    await tick();
  }
  for (const f of figsToFetch) {
    const local = await enrich.downloadImage(f.image_url, f.fig_number, 0, 'minifig').catch(meldeUndLiefere('bild-nachlauf:downloadImage', null));
    if (local) {
      // Eine Zeile: Der Katalog führt die Figur seit Migration 0034 genau einmal.
      await setzeFigurBildLokal(f.fig_number, local)
        .catch(logAndContinue(`bilder:minifigur ${f.fig_number}`));
      generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
    }
    await tick();
  }
  await monitor.update('imgDl', { status: 'idle', sub: 'Alle Bilder gecacht', label: '📥 Bild-Download (CDN)' }).catch(logAndContinue('bild-nachlauf:Download'));
}

export { bildNachlauf };
