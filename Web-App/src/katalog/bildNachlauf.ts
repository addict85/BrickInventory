/** Stündlich, der erste 30 s nach dem Start (src/auftraege/zeitplan.ts). */
import { logAndContinue, meldeFehler } from '../infra/fehler';
import { generateThumb } from '../bilder';
import { setzeTeilBildLokal, setzeFigurBildLokal } from './katalogPflege';
import { KEINE_FARBE } from '../infra/validate';
import * as enrich from './teileAnreicherung';
import { AuftragUnterbrochen, type AuftragsKontext } from '../auftraege';
import { versuche } from '../infra/ergebnis';
import type { KatalogKontext } from './kontext';

async function bildNachlauf(kx: KatalogKontext, k: AuftragsKontext): Promise<void> {
  const { sets, teile: manualParts, figuren: figsToFetch } = await kx.bilder.bilderFuerNachlauf();
  if (!sets.length && !manualParts.length && !figsToFetch.length) {
    await k.fortschritt({ erledigt: 0, gesamt: 0, text: 'Alle Bilder gecacht' });
    return;
  }
  console.log(
    `[img-dl-bg] fehlende Bilder: ${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`,
  );
  let done = 0;
  const total = sets.length + manualParts.length + figsToFetch.length;
  await k.fortschritt({
    erledigt: 0,
    gesamt: total,
    text: `${sets.length} Set(s), ${manualParts.length} Teil(e), ${figsToFetch.length} Minifig(s)`,
  });
  const tick = async () => {
    done++;
    if (done % 10 === 0 || done === total) {
      await k.fortschritt({ erledigt: done, gesamt: total, text: `${done} / ${total} geladen` });
    }
    if (k.beendet) throw new AuftragUnterbrochen();
  };
  for (const set_number of sets) {
    await enrich.downloadSetImages(kx, set_number).catch((e: unknown) => meldeFehler(`bild-nachlauf:${set_number}`, e));
    await tick();
  }
  for (const p of manualParts) {
    // Ein Fehler lässt das Teil ohne Bild; der nächste Nachlauf versucht es wieder.
    const r = await versuche(
      'bild-nachlauf:downloadImage',
      enrich.downloadImage(p.image_url, p.part_number, p.color_id ?? KEINE_FARBE, 'part'),
    );
    const local = r.ok ? r.wert : null;
    if (local) {
      // Einmal für alle Konten in den Katalog. Ein Schreibfehler bricht den Lauf ab wie bei
      // den Figuren; der nächste findet die Datei und schreibt nach.
      await setzeTeilBildLokal(kx, p.part_number, p.color_id ?? KEINE_FARBE, local);
      // Die Vorschau gleich anstossen, sonst bliebe es bis zum nächsten Neustart
      // bei der Originalgrösse.
      generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
    }
    await tick();
  }
  for (const f of figsToFetch) {
    const r = await versuche(
      'bild-nachlauf:downloadImage',
      enrich.downloadImage(f.image_url, f.fig_number, 0, 'minifig'),
    );
    const local = r.ok ? r.wert : null;
    if (local) {
      // Eine Zeile: Der Katalog führt die Figur seit Migration 0034 genau einmal. Ein
      // Schreibfehler bricht den Lauf ab; der nächste findet die Datei und schreibt nach.
      await setzeFigurBildLokal(kx, f.fig_number, local);
      generateThumb(local).catch(logAndContinue('bild-nachlauf:generateThumb'));
    }
    await tick();
  }
  await k.fortschritt({ erledigt: total, gesamt: total, text: 'Alle Bilder gecacht' });
}

export { bildNachlauf };
