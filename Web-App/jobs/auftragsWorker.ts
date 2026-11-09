import { belegKennung } from '../src/auftraege/prozess';
import {
  type AuftragsArt, type AuftragsZeile, type Fortschritt, type AuftragsKontext,
  AuftragUnterbrochen, AuftragVerloren, AuftragVerschieben,
} from '../src/auftraege/auftraege';
import {
  imNamenDesAuftrags, gibZurueck, verschoben, fehlgeschlagen, erledigt, beiNeuemAuftrag, beiAuftragsStand,
  setzeFortschritt, lebenszeichen, gehoertNoch, belegeAuftrag, merkeExklusive,
} from '../src/auftraege/dienst';
import { planeNaechsten, hatZeitplan } from '../src/auftraege/zeitplan';
import { pruefeNutzlast, NutzlastUngueltig, type Nutzlast } from '../src/auftraege/nutzlasten';
import { fehlertext, logAndContinue } from '../src/infra/fehler';
import { konfig } from '../src/infra/konfig';

/** Die Nutzlast kommt geprüft an (src/auftraege/nutzlasten.ts). */
export interface Bearbeiter<A extends AuftragsArt = AuftragsArt> {
  ausfuehren(nutzlast: Nutzlast<A>, k: AuftragsKontext, a: AuftragsZeile): Promise<void>;
  aufgegeben?(nutzlast: Nutzlast<A>, fehler: string, a: AuftragsZeile): Promise<void>;
  exklusiv?: boolean;
}

export interface WorkerOptionen {
  parallel?: number;
  taktMs?: number;
  fristSek?: number;
}

export type Bearbeitertabelle = { [A in AuftragsArt]?: Bearbeiter<A> };

interface Lauf { a: AuftragsZeile; ac: AbortController; fertig: Promise<void> }

/** Der Worker hält das Lease selbst: Ein Handler, der nie ein Lebenszeichen
 * gibt, verlöre sonst nach der Frist seine Zeile und liefe doppelt. */
function haltePacht(a: AuftragsZeile, ac: AbortController, fristSek: number): () => void {
  const erneuere = async () => {
    if (ac.signal.aborted) return;
    const ok = await lebenszeichen(a, fristSek).catch((e: unknown) => { logAndContinue(`auftraege:pacht ${a.art}`)(e); return true; });
    if (!ok) ac.abort(new AuftragVerloren());
  };
  const t = setInterval(() => { void erneuere(); }, Math.max(200, Math.floor(fristSek * 1000 / 3)));
  t.unref();
  return () => clearInterval(t);
}

/** Meldungen eines Laufs nacheinander, sonst überholte ein später Stand einen früheren. */
function fortschrittsKette(a: AuftragsZeile, ac: AbortController, fristSek: number) {
  let kette: Promise<boolean> = Promise.resolve(true);
  return (f: Fortschritt): Promise<boolean> => {
    kette = kette.then(() => setzeFortschritt(a, f, fristSek)).then(ok => {
      if (!ok && !ac.signal.aborted) ac.abort(new AuftragVerloren());
      return ok;
    });
    return kette;
  };
}

/** Auch nach einem endgültigen Fehler, sonst endete der Zeitplan. */
async function folgeplan(a: AuftragsZeile): Promise<void> {
  if (hatZeitplan(a.art)) await planeNaechsten(a.art).catch(logAndContinue(`auftraege:plan ${a.art}`));
}

function kontextFuer(a: AuftragsZeile, ac: AbortController, fristSek: number, istBeendet: () => boolean): AuftragsKontext {
  return {
    lebenszeichen: async () => {
      const ok = await lebenszeichen(a, fristSek);
      if (!ok && !ac.signal.aborted) ac.abort(new AuftragVerloren());
      return ok;
    },
    fortschritt: fortschrittsKette(a, ac, fristSek),
    signal: ac.signal,
    get beendet() { return istBeendet() || ac.signal.aborted; },
    versuch: a.versuche,
  };
}

async function fuehreAuftragAus(a: AuftragsZeile, ac: AbortController, b: Bearbeiter | undefined, fristSek: number,
                         istBeendet: () => boolean): Promise<void> {
  let nutzlast: Nutzlast<AuftragsArt> | undefined;
  const k = kontextFuer(a, ac, fristSek, istBeendet);
  const lasseLos = haltePacht(a, ac, fristSek);
  try {
    // Mehr Versuche als erlaubt: Die früheren stürzten ab, ein weiterer vermutlich auch.
    if (!b || a.versuche > a.max_versuche) throw new Error(b ? 'ohne Rückmeldung abgebrochen' : `keine Bearbeitung für ${a.art}`);
    const geprueft = nutzlast = pruefeNutzlast(a.art, a.nutzlast);
    await imNamenDesAuftrags(a, () => b.ausfuehren(geprueft, k, a));
    if (await erledigt(a)) await folgeplan(a);
  } catch (e) {
    await nachFehler(a, b, nutzlast, ac, e);
  } finally { lasseLos(); }
}

async function nachFehler(a: AuftragsZeile, b: Bearbeiter | undefined, nutzlast: Nutzlast<AuftragsArt> | undefined,
                          ac: AbortController, e: unknown): Promise<void> {
  // Nach einem Abbruch zählt der Grund des Signals, nicht die Ausnahme, die er im Handler auslöste.
  const grund: unknown = ac.signal.aborted ? ac.signal.reason : e;
  if (grund instanceof AuftragVerloren) { console.warn(`[auftraege] ${a.art} #${a.id}: ${grund.message}`); return; }
  if (grund instanceof AuftragUnterbrochen) { await gibZurueck(a); return; }
  if (e instanceof AuftragVerschieben) {
    if (await verschoben(a, e.bis, e.grund, e.zaehlt)) { if (nutzlast) await b?.aufgegeben?.(nutzlast, e.grund, a); await folgeplan(a); }
    return;
  }
  const text = fehlertext(e) || 'Unbekannter Fehler';
  console.warn(`[auftraege] ${a.art} #${a.id} Versuch ${a.versuche}/${a.max_versuche}: ${text}`);
  if (await fehlgeschlagen(a, text, e instanceof NutzlastUngueltig)) {
    if (nutzlast) await b?.aufgegeben?.(nutzlast, text, a);
    await folgeplan(a);
  }
}

/** Mehrere Worker teilen sich die Arbeit über SKIP LOCKED; das NOTIFY beim
 * Einstellen weckt früher als der Takt. */
function erzeugeWorker(bearbeiter: Bearbeitertabelle, o: WorkerOptionen = {}) {
  const arten = Object.keys(bearbeiter);
  const exklusiv = arten.filter(a => bearbeiter[a as AuftragsArt]?.exklusiv);
  const parallel = Math.max(1, o.parallel ?? konfig().auftragParallel);
  const fristSek = o.fristSek ?? konfig().auftragFristSek;
  const laufend = new Map<string, Lauf>();
  let beendet = false, gestartet = false, pumpt = false;
  let takt: NodeJS.Timeout | null = null;
  let abmelden: (() => void)[] = [];
  // Am Ende jeder Runde: Daran hängt das Lebenszeichen (startup/jobsProzess.ts).
  let letzteRunde = 0;
  const exklusivGemerkt = merkeExklusive(exklusiv).catch(logAndContinue('auftraege:exklusiv'));

  async function belegeUndStarte(): Promise<Lauf | null> {
    await exklusivGemerkt;
    const a = await belegeAuftrag(arten, fristSek, belegKennung(), exklusiv, [...laufend.keys()]);
    if (!a) return null;
    if (beendet) { await gibZurueck(a).catch(logAndContinue('auftraege:zurückgeben')); return null; }
    const ac = new AbortController();
    const lauf: Lauf = { a, ac, fertig: Promise.resolve() };
    laufend.set(a.id, lauf);
    lauf.fertig = fuehreAuftragAus(a, ac, bearbeiter[a.art], fristSek, () => beendet).catch(logAndContinue(`auftraege:${a.art}`)).finally(() => { laufend.delete(a.id); });
    return lauf;
  }

  async function verarbeiteEinen(): Promise<boolean> {
    const l = await belegeUndStarte();
    if (!l) return false;
    await l.fertig;
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
        const l = await belegeUndStarte();
        if (!l) break;
        void l.fertig.finally(() => { void pumpe(); });
      }
    } catch (e) {
      logAndContinue('auftraege:belegen')(e);
    } finally { pumpt = false; letzteRunde = Date.now(); }
  }
  const geweckt = () => { void pumpe(); };

  /** Ein Abbruch über die Verwaltung meldet sich per NOTIFY: sofort nachsehen, nicht erst beim nächsten Lebenszeichen. */
  const standGeaendert = (schluessel?: string) => {
    for (const { a, ac } of laufend.values()) {
      if (ac.signal.aborted || (schluessel !== undefined && schluessel !== (a.schluessel ?? a.id))) continue;
      void gehoertNoch(a).then(ja => { if (!ja && !ac.signal.aborted) ac.abort(new AuftragVerloren()); },
        logAndContinue(`auftraege:stand ${a.art}`));
    }
  };

  function starte(): void {
    if (gestartet) return;
    gestartet = true;
    letzteRunde = Date.now();
    abmelden = [beiNeuemAuftrag(geweckt), beiAuftragsStand(standGeaendert)];
    takt = setInterval(geweckt, o.taktMs ?? 5000);
    takt.unref();
    void pumpe();
  }

  async function stoppe(wartenMs = 3000): Promise<void> {
    beendet = true;
    if (takt) clearInterval(takt);
    for (const ab of abmelden) ab();
    await pumpLauf;
    const alle = [...laufend.values()];
    for (const l of alle) if (!l.ac.signal.aborted) l.ac.abort(new AuftragUnterbrochen());
    await Promise.race([Promise.all(alle.map(l => l.fertig)), new Promise(r => setTimeout(r, wartenMs).unref())]);
    const rest = [...laufend.values()];
    for (const { a } of rest) await gibZurueck(a).catch(logAndContinue('auftraege:zurückgeben'));
    console.log(`[auftraege] beendet, ${rest.length} laufende Aufträge zurückgegeben`);
  }

  return { verarbeiteEinen, starte, stoppe, laufend: () => laufend.size, letzteRunde: () => letzteRunde };
}

export { AuftragUnterbrochen, AuftragVerloren, AuftragVerschieben, erzeugeWorker };
export type { AuftragsKontext };
