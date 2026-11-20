import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

/** bcryptjs rechnet in JavaScript; im Hauptthread hielte jede Prüfung alle anderen
 * Anfragen bis zu 100 ms an. Arbeiter entstehen erst bei Bedarf und halten den
 * Prozess nur, solange sie rechnen. Fehlt die Datei (Quelltext statt Build), rechnet
 * der Hauptthread wie bisher. */
type Auftrag = { art: 'hash' | 'vergleich'; passwort: string; wert: string | number };
type Offen = { auftrag: Auftrag; ok: (v: unknown) => void; fehler: (e: Error) => void };

export interface Pool {
  hash(passwort: string, runden: number): Promise<string>;
  vergleiche(passwort: string, hash: string): Promise<boolean>;
  stand(): { worker: number; frei: number; wartend: number; hauptthread: boolean };
  beende(): Promise<void>;
}

const imHauptthread = (a: Auftrag) =>
  a.art === 'hash' ? bcrypt.hash(a.passwort, Number(a.wert)) : bcrypt.compare(a.passwort, String(a.wert));
const NO_WORKER = '[bcrypt] Worker-Thread startet nicht, Prüfungen laufen im Hauptthread:';

/** idleMs: Ein untätiger Arbeiter endet danach und gibt seinen Speicher frei. */
export function newPool(groesse: number, datei = path.join(__dirname, 'bcryptArbeiter.js'), idleMs = 60_000): Pool {
  let hauptthread = !fs.existsSync(datei);
  const frei: Worker[] = [],
    alle = new Set<Worker>(),
    queue: Offen[] = [];
  const rest = new Map<Worker, NodeJS.Timeout>();
  const laufend = new Map<Worker, { id: number; o: Offen }>();
  let nextId = 0,
    beendet = false;

  const starte = (w: Worker, o: Offen) => {
    const id = ++nextId;
    laufend.set(w, { id, o });
    w.ref();
    w.postMessage({ id, ...o.auftrag });
  };
  const naechster = (w: Worker) => {
    laufend.delete(w);
    const o = queue.shift();
    if (o) {
      starte(w, o);
      return;
    }
    w.unref();
    frei.push(w);
    rest.set(
      w,
      setTimeout(() => {
        rest.delete(w);
        frei.splice(frei.indexOf(w), 1);
        void w.terminate();
      }, idleMs).unref(),
    );
  };
  const takeFree = (): Worker | undefined => {
    const w = frei.pop();
    if (w) {
      clearTimeout(rest.get(w));
      rest.delete(w);
    }
    return w;
  };
  const neu = (): Worker => {
    const w = new Worker(datei);
    let geantwortet = false,
      grund: Error | null = null;
    alle.add(w);
    w.on('message', (m: { id: number; ergebnis?: unknown; fehler?: string }) => {
      const l = laufend.get(w);
      if (!l || l.id !== m.id) return;
      geantwortet = true;
      naechster(w);
      if (m.fehler !== undefined) l.o.fehler(new Error(m.fehler));
      else l.o.ok(m.ergebnis);
    });
    w.on('error', (e: Error) => {
      grund = e;
    });
    w.on('exit', () => {
      alle.delete(w);
      clearTimeout(rest.get(w));
      rest.delete(w);
      if (frei.includes(w)) frei.splice(frei.indexOf(w), 1);
      const l = laufend.get(w);
      laufend.delete(w);
      if (beendet) return;
      // Startet ein Arbeiter gar nicht, startet auch der nächste nicht.
      if (!geantwortet) {
        hauptthread = true;
        console.warn(NO_WORKER, grund?.message ?? 'beendet');
      }
      if (l)
        void (
          hauptthread ? imHauptthread(l.o.auftrag) : Promise.reject(grund ?? new Error('bcrypt-Arbeiter beendet'))
        ).then(l.o.ok, l.o.fehler);
      for (const o of queue.splice(0)) void auftrag(o.auftrag).then(o.ok, o.fehler);
    });
    return w;
  };
  const auftrag = (a: Auftrag): Promise<unknown> => {
    if (hauptthread) return imHauptthread(a);
    return new Promise((ok, fehler) => {
      const o = { auftrag: a, ok, fehler };
      const w = takeFree() ?? (alle.size < groesse ? neu() : undefined);
      if (w) starte(w, o);
      else queue.push(o);
    });
  };
  return {
    hash: (passwort, runden) => auftrag({ art: 'hash', passwort, wert: runden }) as Promise<string>,
    vergleiche: (passwort, hash) => auftrag({ art: 'vergleich', passwort, wert: hash }) as Promise<boolean>,
    stand: () => ({ worker: alle.size, frei: frei.length, wartend: queue.length, hauptthread }),
    beende: async () => {
      beendet = true;
      await Promise.all([...alle].map(w => w.terminate()));
    },
  };
}
