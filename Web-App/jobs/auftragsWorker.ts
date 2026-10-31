import { randomUUID } from 'crypto';
import {
  AUFTRAG_KANAL, belegeAuftrag, erledigt, fehlgeschlagen, gibZurueck, lebenszeichen, setzeFortschritt,
  verschoben, imNamenDesAuftrags, type AuftragsArt, type AuftragsZeile, type Fortschritt,
} from '../utils/auftraege';
import { planeNaechsten, hatZeitplan } from '../utils/zeitplan';
import { listen, unlisten } from '../db/pgNotify';
import { fehlertext, logAndContinue } from '../src/infra/httpError';
import { konfig } from '../src/infra/konfig';

/** Was ein Bearbeiter vom Worker bekommt. */
export interface AuftragsKontext {
  /** Frist verlängern; false heisst: Der Auftrag gehört nicht mehr diesem Lauf (abgebrochen, neu vergeben). */
  lebenszeichen(): Promise<boolean>;
  /** Den Stand für die Verwaltung setzen; zählt als Lebenszeichen. */
  fortschritt(f: Fortschritt): Promise<boolean>;
  /** Der Worker wird beendet; ein langer Auftrag hört an der nächsten sicheren Stelle auf. */
  readonly beendet: boolean;
  readonly versuch: number;
}

/** Ein Auftrag hört auf, ohne gescheitert zu sein; er wird zurückgegeben und später fortgesetzt. */
class AuftragUnterbrochen extends Error {
  constructor() { super('Auftrag unterbrochen'); }
}

/**
 * Später weitermachen: Die Gegenseite drosselt, ein Kontingent ist erschöpft.
 * `zaehlt` entscheidet, ob es als Versuch gilt (und damit irgendwann endet).
 */
class AuftragVerschieben extends Error {
  constructor(readonly bis: Date, readonly grund: string, readonly zaehlt = false) { super(grund); }
}

export interface Bearbeiter {
  ausfuehren(nutzlast: Record<string, unknown>, k: AuftragsKontext, a: AuftragsZeile): Promise<void>;
  /** Nach dem letzten gescheiterten Versuch: den Stand für die Oberfläche setzen. */
  aufgegeben?(nutzlast: Record<string, unknown>, fehler: string, a: AuftragsZeile): Promise<void>;
  /** Höchstens einer dieser Art gleichzeitig, auch über Prozesse hinweg. */
  exklusiv?: boolean;
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
 * im Job-Prozess (startup/jobsProzess.ts). Der Takt holt Aufträge, deren
 * faellig_ab erreicht ist; das NOTIFY beim Einstellen weckt früher.
 */
function erzeugeWorker(bearbeiter: Bearbeitertabelle, o: WorkerOptionen = {}) {
  const arten = Object.keys(bearbeiter);
  const exklusiv = arten.filter(a => bearbeiter[a as AuftragsArt]?.exklusiv);
  const parallel = Math.max(1, o.parallel ?? konfig().auftragParallel);
  const fristSek = o.fristSek ?? konfig().auftragFristSek;
  const laufend = new Map<string, { a: AuftragsZeile; fertig: Promise<void> }>();
  let beendet = false, gestartet = false, pumpt = false;
  let takt: NodeJS.Timeout | null = null;

  /** Nach dem Ende eines geplanten Laufs den nächsten eintragen — auch nach einem endgültigen Fehler. */
  async function folgeplan(a: AuftragsZeile): Promise<void> {
    if (hatZeitplan(a.art)) await planeNaechsten(a.art).catch(logAndContinue(`auftraege:plan ${a.art}`));
  }

  async function fuehreAus(a: AuftragsZeile): Promise<void> {
    const b = bearbeiter[a.art];
    const k: AuftragsKontext = {
      lebenszeichen: () => lebenszeichen(a, fristSek),
      fortschritt: (f) => setzeFortschritt(a, f, fristSek),
      get beendet() { return beendet; },
      versuch: a.versuche,
    };
    try {
      // Mehr Versuche als erlaubt heisst: Die früheren endeten ohne Rückmeldung
      // (Absturz mittendrin). Ein weiterer Lauf stürzte vermutlich genauso ab.
      if (!b || a.versuche > a.max_versuche) throw new Error(b ? 'ohne Rückmeldung abgebrochen' : `keine Bearbeitung für ${a.art}`);
      await imNamenDesAuftrags(a, () => b.ausfuehren(a.nutzlast, k, a));
      if (await erledigt(a)) await folgeplan(a);
    } catch (e) {
      if (e instanceof AuftragUnterbrochen) { await gibZurueck(a); return; }
      if (e instanceof AuftragVerschieben) {
        if (await verschoben(a, e.bis, e.grund, e.zaehlt)) { await b?.aufgegeben?.(a.nutzlast, e.grund, a); await folgeplan(a); }
        return;
      }
      const text = fehlertext(e) || 'Unbekannter Fehler';
      console.warn(`[auftraege] ${a.art} #${a.id} Versuch ${a.versuche}/${a.max_versuche}: ${text}`);
      if (await fehlgeschlagen(a, text)) { await b?.aufgegeben?.(a.nutzlast, text, a); await folgeplan(a); }
    }
  }

  /** Einen fälligen Auftrag belegen und ausführen. @returns ob einer da war */
  async function verarbeiteEinen(): Promise<boolean> {
    const a = await belegeAuftrag(arten, fristSek, randomUUID(), exklusiv);
    if (!a) return false;
    await fuehreAus(a);
    return true;
  }

  async function pumpe(): Promise<void> {
    if (pumpt || beendet) return;
    pumpt = true;
    try {
      while (!beendet && laufend.size < parallel) {
        const a = await belegeAuftrag(arten, fristSek, randomUUID(), exklusiv);
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
    takt = setInterval(geweckt, o.taktMs ?? 5000);
    takt.unref();
    void pumpe();
  }

  /** Beenden: Laufende bekommen `wartenMs`, um an einer sicheren Stelle aufzuhören, der Rest geht zurück. */
  async function stoppe(wartenMs = 3000): Promise<void> {
    beendet = true;
    if (takt) clearInterval(takt);
    if (gestartet) unlisten(AUFTRAG_KANAL, geweckt);
    const alle = [...laufend.values()];
    await Promise.race([Promise.all(alle.map(l => l.fertig)), new Promise(r => setTimeout(r, wartenMs).unref())]);
    const rest = [...laufend.values()];
    for (const { a } of rest) await gibZurueck(a).catch(logAndContinue('auftraege:zurückgeben'));
    console.log(`[auftraege] beendet, ${rest.length} laufende Aufträge zurückgegeben`);
  }

  return { verarbeiteEinen, starte, stoppe, laufend: () => laufend.size };
}

export { AuftragUnterbrochen, AuftragVerschieben, erzeugeWorker };
