/** Stündlich, der erste 30 s nach dem Start (src/auftraege/zeitplan.ts). */
import { bilderFuerNachlauf } from './bildlage';
import { logAndContinue } from '../infra/fehler';
import { generateThumb } from './bilder/thumbs';
import { setzeTeilBildLokal, setzeFigurBildLokal } from './katalogPflege';
import { KEINE_FARBE } from '../infra/validate';
import * as enrich from './teileAnreicherung';
import { AuftragUnterbrochen, type AuftragsKontext } from '../auftraege/auftraege';
import { versuche } from '../infra/ergebnis';

async function bildNachlauf(k: AuftragsKontext): Promise<void> {
  const { sets, teile: manualParts, figuren: figsToFetch } = await bilderFuerNachlauf();
  if (!sets.length && !manualParts.length && !figsToFetch.length) {
    await k.fortschritt({ erledigt: 0, gesamt: 0, text: 'Alle Bilder gecacht' });
    return;
  }
  console.log(`[img-dl-bg] fehlende Bilder: ${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`);
  let done = 0;
  const total = sets.length + manualParts.length + figsToFetch.length;
  await k.fortschritt({ erledigt: 0, gesamt: total,
    text: `${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)` });
  const tick = async () => {
    done++;
    if (done % 10 === 0 || done === total) {
      await k.fortschritt({ erledigt: done, gesamt: total, text: `${done} / ${total} geladen` });
    }
    if (k.beendet) throw new AuftragUnterbrochen();
  };
  for (const set_number of sets) {
    await enrich.downloadSetImages(set_number).catch(e => console.warn(`[img-dl-bg] ${set_number}: ${e.message}`));
    await tick();
  }
  for (const p of manualParts) {
    // Ein Fehler lässt das Teil ohne Bild; der nächste Nachlauf versucht es wieder.
    const r = await versuche('bild-nachlauf:downloadImage', enrich.downloadImage(p.image_url, p.part_number, p.color_id ?? KEINE_FARBE, 'part'));
    const local = r.ok ? r.wert : null;
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
    const r = await versuche('bild-nachlauf:downloadImage', enrich.downloadImage(f.image_url, f.fig_number, 0, 'minifig'));
    const local = r.ok ? r.wert : null;
    if (local) {
      // Eine Zeile: Der Katalog führt die Figur seit Migration 0034 genau einmal.
      await setzeFigurBildLokal(f.fig_number, local)
        .catch(logAndContinue(`bilder:minifigur ${f.fig_number}`));
      generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
    }
    await tick();
  }
  await k.fortschritt({ erledigt: total, gesamt: total, text: 'Alle Bilder gecacht' });
}

export { bildNachlauf };
