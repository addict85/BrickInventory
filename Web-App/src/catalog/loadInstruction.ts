/** Brickset und brickinstructions.com wollen Abstand: Nach einem echten Abruf
 * pausiert die ganze Art 15 Sekunden, nach einer Cloudflare-Sperre 5–20
 * Minuten und dann bis zum nächsten Tag. */
import { withSessionLock } from '../../db/txLock';
import {
  setAnleitungenLaden,
  lastFetchWarExtern,
  anzahlAnleitungen,
  scrapeInstructionsFromFallback,
} from './instructions';
import { fehlertext } from '../infra/fehler';
import { asFetchError } from '../externalSources';
import { type Nutzlast, type JobRun, JobMove } from '../jobQueue';
import { LOCKS } from '../infra/lockNamespaces';
import type { CatalogContext } from './context';

const TICK_AFTER_FETCH_MS = 15_000;
/** Pausen nach der ersten bis vierten Cloudflare-Sperre; danach bis morgen. */
const CF_PAUSES_MS = [5, 10, 15, 20].map(min => min * 60 * 1000);

/** 00:05: Dann ist das Tageskontingent wieder frei. */
function nextTag(jetzt: Date): Date {
  const z = new Date(jetzt);
  z.setHours(0, 5, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

/** Zwei Job-Prozesse sollen sich den Takt nicht teilen; eigene Verbindung,
 * weil Advisory-Locks an der Sitzung hängen. */
function withLock<T>(k: CatalogContext, lauf: () => Promise<T>): Promise<T> {
  return withSessionLock(k.db, LOCKS.ANLEITUNGS_QUEUE, lauf, () => {
    throw new JobMove(new Date(k.uhr.jetzt() + TICK_AFTER_FETCH_MS), 'Anleitungen laufen in einem anderen Prozess');
  });
}

async function reportInstructions(k: CatalogContext, setNumber: string, lauf?: JobRun): Promise<void> {
  const z = await k.jobQueue.countKind('anleitung');
  const offen = z.offen + z.laeuft,
    gesamt = offen + z.erledigt + z.fehler;
  await lauf?.fortschritt?.({
    erledigt: gesamt - offen + 1,
    gesamt,
    text: offen > 1 ? `${setNumber} · ${offen - 1} ausstehend` : 'Alle erledigt',
  });
}

/** Eine Drosselung verschiebt den Auftrag, ohne ihn als Versuch zu zählen. */
async function anleitungLaden(k: CatalogContext, n: Nutzlast<'anleitung'>, lauf?: JobRun): Promise<void> {
  const sn = n.set_number;
  if ((await anzahlAnleitungen(k, sn)) > 0) return;
  if (n.nur_ausweichquelle) {
    await scrapeInstructionsFromFallback(k, sn);
    return;
  }
  await withLock(k, async () => {
    try {
      // Den Abstand hält die Pause der Art, nicht die Funktion.
      const anzahl = await setAnleitungenLaden(k, sn, true);
      console.log(`[instr-queue] ${sn}: ${anzahl} instructions`);
      if (await k.jobQueue.liesPause('anleitung')) await k.jobQueue.endPause('anleitung');
      if (lastFetchWarExtern(k))
        await k.jobQueue.pauseKind(
          'anleitung',
          new Date(k.uhr.jetzt() + TICK_AFTER_FETCH_MS),
          'Abstand zwischen zwei Abrufen',
        );
      await reportInstructions(k, sn, lauf);
    } catch (e) {
      const f = asFetchError(e);
      const msg = fehlertext(e) || '';
      if (f.isCloudflare || msg.includes('1015')) {
        const stufe = (await k.jobQueue.liesPause('anleitung'))?.level ?? 0;
        const bis =
          stufe < CF_PAUSES_MS.length ? new Date(k.uhr.jetzt() + CF_PAUSES_MS[stufe]!) : nextTag(k.uhr.datum());
        const grund =
          stufe < CF_PAUSES_MS.length
            ? `Cloudflare-Sperre: ${Math.round(CF_PAUSES_MS[stufe]! / 60000)} min warten (Versuch ${stufe + 1})`
            : 'Cloudflare-Sperre: bis morgen pausiert';
        await k.jobQueue.pauseKind('anleitung', bis, grund, stufe < CF_PAUSES_MS.length ? stufe + 1 : 0);
        await lauf?.fortschritt?.({ text: grund });
        console.log(`[instr-queue] ${grund}`);
        throw new JobMove(bis, grund);
      }
      if (msg.includes('Tageslimit') || msg.includes('rate limit') || msg.includes('429')) {
        const bis = nextTag(k.uhr.datum());
        await k.jobQueue.pauseKind('anleitung', bis, 'Tageskontingent erschöpft');
        throw new JobMove(bis, 'Tageskontingent erschöpft');
      }
      throw e;
    }
  });
}

export { TICK_AFTER_FETCH_MS, CF_PAUSES_MS, nextTag, anleitungLaden };
