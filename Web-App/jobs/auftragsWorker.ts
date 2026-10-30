import { randomUUID } from 'crypto';
import {
  AUFTRAG_KANAL, belegeAuftrag, erledigt, fehlgeschlagen, gibZurueck, lebenszeichen,
  raeumeErledigteAuf, type AuftragsArt, type AuftragsZeile,
} from '../utils/auftraege';
import { listen, unlisten } from '../utils/pgNotify';
import { fehlertext, logAndContinue } from '../utils/httpError';
import { konfig } from '../utils/konfig';

/** Was ein Bearbeiter vom Worker bekommt. */
export interface AuftragsKontext {
  /** Frist verlängern; false heisst: Der Auftrag gehört nicht mehr diesem Lauf. */
  lebenszeichen(): Promise<boolean>;
  /** Der Worker wird beendet; ein langer Auftrag hört an der nächsten sicheren Stelle auf. */
  readonly beendet: boolean;
  readonly versuch: number;
}

/** Ein Auftrag hört auf, ohne gescheitert zu sein; er wird zurückgegeben und später fortgesetzt. */
class AuftragUnterbrochen extends Error {
  constructor() { super('Auftrag unterbrochen'); }
}

export interface Bearbeiter {
  ausfuehren(nutzlast: Record<string, unknown>, k: AuftragsKontext, a: AuftragsZeile): Promise<void>;
  /** Nach dem letzten gescheiterten Versuch: den Stand für die Oberfläche setzen. */
  aufgegeben?(nutzlast: Record<string, unknown>, fehler: string, a: AuftragsZeile): Promise<void>;
}

export interface WorkerOptionen {
  parallel?: number;
  taktMs?: number;
  fristSek?: number;
}

export type Bearbeitertabelle = Partial<Record<AuftragsArt, Bearbeiter>>;

/**
 * Ein Worker über der Auftragstabelle. Mehrere davon (auch in verschiedenen
 * Prozessen) teilen sich die Arbeit über SKIP LOCKED; im Betrieb läuft einer
 * im Primär-Worker (startup/backgroundJobs.ts).
 */
function erzeugeWorker(bearbeiter: Bearbeitertabelle, o: WorkerOptionen = {}) {
  const arten = Object.keys(bearbeiter);
  const parallel = Math.max(1, o.parallel ?? konfig().auftragParallel);
  const fristSek = o.fristSek ?? konfig().auftragFristSek;
  const laufend = new Map<string, { a: AuftragsZeile; fertig: Promise<void> }>();
  let beendet = false, gestartet = false, pumpt = false;
  const zeitgeber: NodeJS.Timeout[] = [];

  async function fuehreAus(a: AuftragsZeile): Promise<void> {
    const b = bearbeiter[a.art];
    const k: AuftragsKontext = {
      lebenszeichen: () => lebenszeichen(a, fristSek),
      get beendet() { return beendet; },
      versuch: a.versuche,
    };
    try {
      // Mehr Versuche als erlaubt heisst: Die früheren endeten ohne Rückmeldung
      // (Absturz mittendrin). Ein weiterer Lauf stürzte vermutlich genauso ab.
      if (!b || a.versuche > a.max_versuche) throw new Error(b ? 'ohne Rückmeldung abgebrochen' : `keine Bearbeitung für ${a.art}`);
      await b.ausfuehren(a.nutzlast, k, a);
      await erledigt(a);
    } catch (e) {
      if (e instanceof AuftragUnterbrochen) { await gibZurueck(a); return; }
      const text = fehlertext(e) || 'Unbekannter Fehler';
      console.warn(`[auftraege] ${a.art} #${a.id} Versuch ${a.versuche}/${a.max_versuche}: ${text}`);
      if (await fehlgeschlagen(a, text)) await b?.aufgegeben?.(a.nutzlast, text, a);
    }
  }

  /** Einen fälligen Auftrag belegen und ausführen. @returns ob einer da war */
  async function verarbeiteEinen(): Promise<boolean> {
    const a = await belegeAuftrag(arten, fristSek, randomUUID());
    if (!a) return false;
    await fuehreAus(a);
    return true;
  }

  async function pumpe(): Promise<void> {
    if (pumpt || beendet) return;
    pumpt = true;
    try {
      while (!beendet && laufend.size < parallel) {
        const a = await belegeAuftrag(arten, fristSek, randomUUID());
        if (!a) break;
        const fertig = fuehreAus(a)
          .catch(logAndContinue(`auftraege:${a.art}`))
          .finally(() => { laufend.delete(a.id); void pumpe(); });
        laufend.set(a.id, { a, fertig });
      }
    } catch (e) {
      logAndContinue('auftraege:belegen')(e);
    } finally { pumpt = false; }
  }
  const geweckt = () => { void pumpe(); };

  function starte(): void {
    if (gestartet) return;
    gestartet = true;
    listen(AUFTRAG_KANAL, geweckt);
    zeitgeber.push(setInterval(geweckt, o.taktMs ?? 5000));
    zeitgeber.push(setInterval(() => {
      raeumeErledigteAuf().catch(logAndContinue('auftraege:aufräumen'));
    }, 60 * 60 * 1000));
    for (const z of zeitgeber) z.unref();
    void pumpe();
  }

  /** Beenden: Laufende bekommen `wartenMs`, um an einer sicheren Stelle aufzuhören, der Rest geht zurück. */
  async function stoppe(wartenMs = 3000): Promise<void> {
    beendet = true;
    for (const z of zeitgeber.splice(0)) clearInterval(z);
    if (gestartet) unlisten(AUFTRAG_KANAL, geweckt);
    const alle = [...laufend.values()];
    await Promise.race([Promise.all(alle.map(l => l.fertig)), new Promise(r => setTimeout(r, wartenMs).unref())]);
    for (const { a } of laufend.values()) await gibZurueck(a).catch(logAndContinue('auftraege:zurückgeben'));
  }

  return { verarbeiteEinen, starte, stoppe, laufend: () => laufend.size };
}

export { AuftragUnterbrochen, erzeugeWorker };
