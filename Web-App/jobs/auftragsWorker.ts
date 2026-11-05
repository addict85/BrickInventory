import { randomUUID } from 'crypto';
import {
  type AuftragsArt, type AuftragsZeile, type Fortschritt,
} from '../src/auftraege/auftraege';
import { AUFTRAG_KANAL, imNamenDesAuftrags, gibZurueck, verschoben, fehlgeschlagen, erledigt, setzeFortschritt, lebenszeichen, belegeAuftrag } from '../src/auftraege/dienst';
import { planeNaechsten, hatZeitplan } from '../src/auftraege/zeitplan';
import { pruefeNutzlast, NutzlastUngueltig, type Nutzlast } from '../src/auftraege/nutzlasten';
import { listen, unlisten } from '../db/pgNotify';
import { fehlertext, logAndContinue } from '../src/infra/fehler';
import { konfig } from '../src/infra/konfig';

export interface AuftragsKontext {
  /** false: Der Auftrag gehört nicht mehr diesem Lauf (abgebrochen, neu vergeben). */
  lebenszeichen(): Promise<boolean>;
  /** Zählt als Lebenszeichen. */
  fortschritt(f: Fortschritt): Promise<boolean>;
  /** Ein langer Auftrag hört an der nächsten sicheren Stelle auf. */
  readonly beendet: boolean;
  readonly versuch: number;
}

/** Wird zurückgegeben und später fortgesetzt, ohne als gescheitert zu gelten. */
class AuftragUnterbrochen extends Error {
  constructor() { super('Auftrag unterbrochen'); }
}

/** Die Gegenseite drosselt oder ein Kontingent ist erschöpft. `zaehlt`
 * entscheidet, ob es als Versuch gilt (und damit irgendwann endet). */
class AuftragVerschieben extends Error {
  constructor(readonly bis: Date, readonly grund: string, readonly zaehlt = false) { super(grund); }
}

/** Die Nutzlast kommt geprüft an (src/auftraege/nutzlasten.ts). */
export interface Bearbeiter<A extends AuftragsArt = AuftragsArt> {
  ausfuehren(nutzlast: Nutzlast<A>, k: AuftragsKontext, a: AuftragsZeile): Promise<void>;
  aufgegeben?(nutzlast: Nutzlast<A>, fehler: string, a: AuftragsZeile): Promise<void>;
  /** Höchstens einer dieser Art gleichzeitig, auch über Prozesse hinweg. */
  exklusiv?: boolean;
}

export interface WorkerOptionen {
  parallel?: number;
  taktMs?: number;
  fristSek?: number;
}

export type Bearbeitertabelle = { [A in AuftragsArt]?: Bearbeiter<A> };

/** Mehrere Worker teilen sich die Arbeit über SKIP LOCKED; das NOTIFY beim
 * Einstellen weckt früher als der Takt. */
function erzeugeWorker(bearbeiter: Bearbeitertabelle, o: WorkerOptionen = {}) {
  const arten = Object.keys(bearbeiter);
  const exklusiv = arten.filter(a => bearbeiter[a as AuftragsArt]?.exklusiv);
  const parallel = Math.max(1, o.parallel ?? konfig().auftragParallel);
  const fristSek = o.fristSek ?? konfig().auftragFristSek;
  const laufend = new Map<string, { a: AuftragsZeile; fertig: Promise<void> }>();
  let beendet = false, gestartet = false, pumpt = false;
  let takt: NodeJS.Timeout | null = null;
  // Das Lebenszeichen des Prozesses hängt hieran: Eine hängende Belegung hält
  // die Runde an, und der Healthcheck soll das sehen.
  let letzteRunde = 0;

  /** Auch nach einem endgültigen Fehler, sonst endete der Zeitplan. */
  async function folgeplan(a: AuftragsZeile): Promise<void> {
    if (hatZeitplan(a.art)) await planeNaechsten(a.art).catch(logAndContinue(`auftraege:plan ${a.art}`));
  }

  async function fuehreAus(a: AuftragsZeile): Promise<void> {
    const b: Bearbeiter | undefined = bearbeiter[a.art];
    let nutzlast: Nutzlast<AuftragsArt> | undefined;
    const k: AuftragsKontext = {
      lebenszeichen: () => lebenszeichen(a, fristSek),
      fortschritt: (f) => setzeFortschritt(a, f, fristSek),
      get beendet() { return beendet; },
      versuch: a.versuche,
    };
    try {
      // Mehr Versuche als erlaubt: Die früheren endeten ohne Rückmeldung (Absturz),
      // ein weiterer Lauf stürzte vermutlich genauso ab.
      if (!b || a.versuche > a.max_versuche) throw new Error(b ? 'ohne Rückmeldung abgebrochen' : `keine Bearbeitung für ${a.art}`);
      const geprueft = nutzlast = pruefeNutzlast(a.art, a.nutzlast);
      await imNamenDesAuftrags(a, () => b.ausfuehren(geprueft, k, a));
      if (await erledigt(a)) await folgeplan(a);
    } catch (e) {
      if (e instanceof AuftragUnterbrochen) { await gibZurueck(a); return; }
      if (e instanceof AuftragVerschieben) {
        if (await verschoben(a, e.bis, e.grund, e.zaehlt)) { if (nutzlast) await b?.aufgegeben?.(nutzlast, e.grund, a); await folgeplan(a); }
        return;
      }
      const text = fehlertext(e) || 'Unbekannter Fehler';
      console.warn(`[auftraege] ${a.art} #${a.id} Versuch ${a.versuche}/${a.max_versuche}: ${text}`);
      // Eine ungültige Nutzlast bleibt ungültig: kein zweiter Versuch.
      if (await fehlgeschlagen(a, text, e instanceof NutzlastUngueltig)) {
        if (nutzlast) await b?.aufgegeben?.(nutzlast, text, a);
        await folgeplan(a);
      }
    }
  }

  async function verarbeiteEinen(): Promise<boolean> {
    const a = await belegeAuftrag(arten, fristSek, randomUUID(), exklusiv);
    if (!a) return false;
    await fuehreAus(a);
    return true;
  }

  // Die laufende Runde, damit stoppe() auf eine Belegung warten kann, die
  // gerade in der Datenbank steht: Sie käme sonst nach dem Abschalten an und
  // bliebe bis zum Ablauf ihrer Frist auf 'laeuft'.
  let pumpLauf: Promise<void> = Promise.resolve();

  function pumpe(): Promise<void> {
    if (pumpt || beendet) return pumpLauf;
    pumpt = true;
    pumpLauf = runde();
    return pumpLauf;
  }

  async function runde(): Promise<void> {
    try {
      while (!beendet && laufend.size < parallel) {
        const a = await belegeAuftrag(arten, fristSek, randomUUID(), exklusiv);
        if (!a) break;
        if (beendet) { await gibZurueck(a).catch(logAndContinue('auftraege:zurückgeben')); break; }
        const fertig = fuehreAus(a)
          .catch(logAndContinue(`auftraege:${a.art}`))
          .finally(() => { laufend.delete(a.id); void pumpe(); });
        laufend.set(a.id, { a, fertig });
      }
    } catch (e) {
      logAndContinue('auftraege:belegen')(e);
    } finally { pumpt = false; letzteRunde = Date.now(); }
  }
  const geweckt = () => { void pumpe(); };

  function starte(): void {
    if (gestartet) return;
    gestartet = true;
    letzteRunde = Date.now();
    listen(AUFTRAG_KANAL, geweckt);
    takt = setInterval(geweckt, o.taktMs ?? 5000);
    takt.unref();
    void pumpe();
  }

  /** Laufende bekommen `wartenMs` für eine sichere Stelle, der Rest geht zurück. */
  async function stoppe(wartenMs = 3000): Promise<void> {
    beendet = true;
    if (takt) clearInterval(takt);
    if (gestartet) unlisten(AUFTRAG_KANAL, geweckt);
    await pumpLauf;
    const alle = [...laufend.values()];
    await Promise.race([Promise.all(alle.map(l => l.fertig)), new Promise(r => setTimeout(r, wartenMs).unref())]);
    const rest = [...laufend.values()];
    for (const { a } of rest) await gibZurueck(a).catch(logAndContinue('auftraege:zurückgeben'));
    console.log(`[auftraege] beendet, ${rest.length} laufende Aufträge zurückgegeben`);
  }

  return { verarbeiteEinen, starte, stoppe, laufend: () => laufend.size, letzteRunde: () => letzteRunde };
}

export { AuftragUnterbrochen, AuftragVerschieben, erzeugeWorker };
