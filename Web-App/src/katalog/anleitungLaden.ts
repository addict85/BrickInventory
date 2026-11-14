/** Brickset und brickinstructions.com wollen Abstand: Nach einem echten Abruf
 * pausiert die ganze Art 15 Sekunden, nach einer Cloudflare-Sperre 5–20
 * Minuten und dann bis zum nächsten Tag. */
import { mitSitzungsSperre } from '../../db/txLock';
import {
  downloadSetInstructions,
  letzterAbrufWarExtern,
  anzahlAnleitungen,
  scrapeInstructionsFromFallback,
} from './instructions';
import { fehlertext } from '../infra/fehler';
import { alsAbrufFehler } from '../fremdquellen';
import { type Nutzlast, type AuftragsLauf, AuftragVerschieben } from '../auftraege';
import { LOCKS } from '../infra/lockNamespaces';
import type { KatalogKontext } from './kontext';

const TAKT_NACH_ABRUF_MS = 15_000;
/** Pausen nach der ersten bis vierten Cloudflare-Sperre; danach bis morgen. */
const CF_PAUSEN_MS = [5, 10, 15, 20].map(min => min * 60 * 1000);

/** 00:05: Dann ist das Tageskontingent wieder frei. */
function naechsterTag(jetzt = new Date()): Date {
  const z = new Date(jetzt);
  z.setHours(0, 5, 0, 0);
  if (z <= jetzt) z.setDate(z.getDate() + 1);
  return z;
}

/** Zwei Job-Prozesse sollen sich den Takt nicht teilen; eigene Verbindung,
 * weil Advisory-Locks an der Sitzung hängen. */
function mitSperre<T>(k: KatalogKontext, lauf: () => Promise<T>): Promise<T> {
  return mitSitzungsSperre(k.db, LOCKS.ANLEITUNGS_QUEUE, lauf, () => {
    throw new AuftragVerschieben(
      new Date(Date.now() + TAKT_NACH_ABRUF_MS),
      'Anleitungen laufen in einem anderen Prozess',
    );
  });
}

async function meldeAnleitungen(k: KatalogKontext, setNumber: string, lauf?: AuftragsLauf): Promise<void> {
  const z = await k.auftraege.zaehleArt('anleitung');
  const offen = z.offen + z.laeuft,
    gesamt = offen + z.erledigt + z.fehler;
  await lauf?.fortschritt?.({
    erledigt: gesamt - offen + 1,
    gesamt,
    text: offen > 1 ? `${setNumber} · ${offen - 1} ausstehend` : 'Alle erledigt',
  });
}

/** Eine Drosselung verschiebt den Auftrag, ohne ihn als Versuch zu zählen. */
async function anleitungLaden(k: KatalogKontext, n: Nutzlast<'anleitung'>, lauf?: AuftragsLauf): Promise<void> {
  const sn = n.set_number;
  if ((await anzahlAnleitungen(k, sn)) > 0) return;
  if (n.nur_ausweichquelle) {
    await scrapeInstructionsFromFallback(k, sn);
    return;
  }
  await mitSperre(k, async () => {
    try {
      // Den Abstand hält die Pause der Art, nicht die Funktion.
      const anzahl = await downloadSetInstructions(k, sn, true);
      console.log(`[instr-queue] ${sn}: ${anzahl} instructions`);
      if (await k.auftraege.liesPause('anleitung')) await k.auftraege.beendePause('anleitung');
      if (letzterAbrufWarExtern(k))
        await k.auftraege.pausiereArt(
          'anleitung',
          new Date(Date.now() + TAKT_NACH_ABRUF_MS),
          'Abstand zwischen zwei Abrufen',
        );
      await meldeAnleitungen(k, sn, lauf);
    } catch (e) {
      const f = alsAbrufFehler(e);
      const msg = fehlertext(e) || '';
      if (f.isCloudflare || msg.includes('1015')) {
        const stufe = (await k.auftraege.liesPause('anleitung'))?.stufe ?? 0;
        const bis = stufe < CF_PAUSEN_MS.length ? new Date(Date.now() + CF_PAUSEN_MS[stufe]!) : naechsterTag();
        const grund =
          stufe < CF_PAUSEN_MS.length
            ? `Cloudflare-Sperre: ${Math.round(CF_PAUSEN_MS[stufe]! / 60000)} min warten (Versuch ${stufe + 1})`
            : 'Cloudflare-Sperre: bis morgen pausiert';
        await k.auftraege.pausiereArt('anleitung', bis, grund, stufe < CF_PAUSEN_MS.length ? stufe + 1 : 0);
        await lauf?.fortschritt?.({ text: grund });
        console.log(`[instr-queue] ${grund}`);
        throw new AuftragVerschieben(bis, grund);
      }
      if (msg.includes('Tageslimit') || msg.includes('rate limit') || msg.includes('429')) {
        const bis = naechsterTag();
        await k.auftraege.pausiereArt('anleitung', bis, 'Tageskontingent erschöpft');
        throw new AuftragVerschieben(bis, 'Tageskontingent erschöpft');
      }
      throw e;
    }
  });
}

export { TAKT_NACH_ABRUF_MS, CF_PAUSEN_MS, naechsterTag, anleitungLaden };
