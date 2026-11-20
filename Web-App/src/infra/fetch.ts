/** Der eine Weg nach draussen. Ein Wurf aus einem Antwort-Rückruf ist eine
 * uncaughtException und beendet den Server; deshalb ruft nur diese Datei
 * https.get und https.request, und jeder Fehler wird hier zur Ablehnung. */
import https from 'node:https';
import { PassThrough, type Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage, ClientRequest } from 'node:http';
import { hostAllowed, nextRedirect, REDIRECT_LIMIT } from './foreignAddresses';
import { publicLookup } from './targetAddress';

export type FetchReason = 'adresse' | 'umleitung' | 'zu-gross' | 'zeitlimit' | 'netz' | 'abgebrochen';

export class AbrufFehler extends Error {
  readonly grund: FetchReason;
  /** Wie in clients/fetchError.ts: ein erneuter Versuch kann gelingen. */
  readonly isTransient: boolean;
  constructor(grund: FetchReason, text: string, ursache?: unknown) {
    super(text, ursache === undefined ? undefined : { cause: ursache });
    this.name = 'AbrufFehler';
    this.grund = grund;
    this.isTransient = grund === 'zeitlimit' || grund === 'netz';
  }
}

export interface FetchOptions {
  /** Gilt für die erste Adresse und für jeden Sprung. */
  hosts: readonly string[];
  maxBytes: number;
  /** Gesamtfrist vom ersten Sprung bis zum letzten Byte. */
  zeitlimitMs: number;
  kopfzeilen?: Record<string, string>;
  redirects?: number;
  /** Bringt seine eigene Namensauflösung mit; ohne ihn prüft publicLookup das Ziel. */
  agent?: https.Agent;
  /** POST folgt keiner Umleitung: Ein 303 hiesse GET, ein 307 sendete den Rumpf weiter. */
  methode?: 'GET' | 'POST';
  rumpf?: string;
  /** Ein Auftrag, der abgebrochen wird, beendet auch seinen Abruf samt Körper. */
  signal?: AbortSignal;
}

export interface FetchHeader {
  status: number;
  kopf: IncomingHttpHeaders;
  /** Die Adresse nach allen Umleitungen. */
  url: string;
}

export interface FetchResponse extends FetchHeader {
  koerper: Buffer;
}

export interface FetchStream extends FetchHeader {
  /** Der Körper, begrenzt auf maxBytes; darüber endet er mit AbrufFehler. */
  strom(): Readable;
  verwerfen(): void;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** Ohne Anfrageteil: Dort stehen API-Schlüssel (Brickset), und Fehlertexte landen im Log. */
function addressShort(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).slice(0, 120);
  } catch {
    return '(unlesbare Adresse)';
  }
}

/** Fremder Antworttext fürs Log: einzeilig und kurz, damit er keine Zeilen fälscht. */
export function excerpt(text: unknown, n = 120): string {
  return (
    String(text ?? '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen herauszufiltern ist der Zweck dieser Stelle.
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .slice(0, n)
  );
}

interface Lauf {
  antwort: IncomingMessage;
  url: string;
  frist: NodeJS.Timeout;
  abbrechen: (f: AbrufFehler) => void;
}

function run(start: string, o: FetchOptions): Promise<Lauf> {
  return new Promise((fertig, scheitern) => {
    let req: ClientRequest | null = null;
    let antwort: IncomingMessage | null = null;
    let erledigt = false;
    const abbrechen = (f: AbrufFehler) => {
      clearTimeout(frist);
      if (!erledigt) {
        erledigt = true;
        scheitern(f);
      }
      antwort?.destroy?.(f);
      req?.destroy?.();
    };
    const frist = setTimeout(
      () => abbrechen(new AbrufFehler('zeitlimit', `Zeitlimit ${o.zeitlimitMs} ms: ${addressShort(start)}`)),
      o.zeitlimitMs,
    );
    frist.unref?.();
    const atAbort = () =>
      abbrechen(new AbrufFehler('abgebrochen', `Abgebrochen: ${addressShort(start)}`, o.signal?.reason));
    if (o.signal?.aborted) return atAbort();
    o.signal?.addEventListener('abort', atAbort, { once: true });

    const sprung = (u: string, kopf: Record<string, string>, rest: number) => {
      if (!u.startsWith('https://') || !hostAllowed(u, o.hosts))
        return abbrechen(new AbrufFehler('adresse', `Adresse nicht erlaubt: ${addressShort(u)}`));
      try {
        const atResponse = (r: IncomingMessage) => {
          if (erledigt) {
            r.resume?.();
            return;
          }
          const status = r.statusCode ?? 0;
          if (REDIRECT.has(status) && (o.redirects ?? REDIRECT_LIMIT) > 0 && (o.methode ?? 'GET') === 'GET') {
            r.resume?.();
            if (rest <= 0)
              return abbrechen(new AbrufFehler('umleitung', `Zu viele Umleitungen: ${addressShort(start)}`));
            const weiter = nextRedirect(u, r.headers?.location, kopf, o.hosts);
            if (!weiter)
              return abbrechen(
                new AbrufFehler(
                  'umleitung',
                  `Umleitung ${status} nicht befolgbar (fehlend, kein https oder fremder Host): ${addressShort(u)}`,
                ),
              );
            return sprung(weiter.url, weiter.kopfzeilen, rest - 1);
          }
          const laenge = Number(r.headers?.['content-length']);
          if (laenge > o.maxBytes) {
            r.resume?.();
            return abbrechen(new AbrufFehler('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(u)}`));
          }
          antwort = r;
          erledigt = true;
          fertig({ antwort: r, url: u, frist, abbrechen });
        };
        const verbindung = o.agent ? { agent: o.agent } : { lookup: publicLookup };
        req =
          o.methode === 'POST'
            ? https.request(u, { method: 'POST', family: 4, headers: kopf, ...verbindung }, atResponse)
            : https.get(u, { family: 4, headers: kopf, ...verbindung }, atResponse);
        req.on('error', (e: Error) => {
          const code = (e as NodeJS.ErrnoException).code;
          abbrechen(
            e instanceof AbrufFehler
              ? e
              : new AbrufFehler(
                  code === 'EZIELGESPERRT' ? 'adresse' : 'netz',
                  `${code || e.message}: ${addressShort(u)}`,
                  e,
                ),
          );
        });
        if (o.methode === 'POST') req.end(o.rumpf);
      } catch (e) {
        abbrechen(new AbrufFehler('adresse', `Abruf nicht möglich: ${addressShort(u)}`, e));
      }
    };
    sprung(start, o.kopfzeilen ?? {}, o.redirects ?? REDIRECT_LIMIT);
  });
}

/** Ganze Antwort in den Speicher — für API-Antworten und kleine Bilder. */
export async function holeHttps(url: string, o: FetchOptions): Promise<FetchResponse> {
  const { antwort: r, url: ende, frist, abbrechen } = await run(url, o);
  return new Promise((fertig, scheitern) => {
    const teile: Buffer[] = [];
    let n = 0,
      aus = false;
    const fehler = (f: AbrufFehler) => {
      if (!aus) {
        aus = true;
        scheitern(f);
      }
      abbrechen(f);
    };
    r.on('data', (d: Buffer | string) => {
      const b = typeof d === 'string' ? Buffer.from(d) : d;
      n += b.length;
      if (n > o.maxBytes)
        return fehler(new AbrufFehler('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(ende)}`));
      teile.push(b);
    });
    r.on('end', () => {
      clearTimeout(frist);
      if (!aus) {
        aus = true;
        fertig({ status: r.statusCode ?? 0, kopf: r.headers ?? {}, url: ende, koerper: Buffer.concat(teile) });
      }
    });
    r.on('error', (e: Error) =>
      fehler(e instanceof AbrufFehler ? e : new AbrufFehler('netz', `${e.message}: ${addressShort(ende)}`, e)),
    );
  });
}

/** Nur der Kopf; der Körper als begrenzter Strom — für Dateien und den Bild-Proxy. */
export async function openHttps(url: string, o: FetchOptions): Promise<FetchStream> {
  const { antwort: r, url: ende, frist, abbrechen } = await run(url, o);
  return {
    status: r.statusCode ?? 0,
    kopf: r.headers ?? {},
    url: ende,
    verwerfen: () => {
      clearTimeout(frist);
      r.resume?.();
    },
    strom: () => {
      const aus = new PassThrough();
      let n = 0;
      r.on('data', (d: Buffer) => {
        n += d.length;
        if (n > o.maxBytes) {
          const f = new AbrufFehler('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(ende)}`);
          aus.destroy(f);
          abbrechen(f);
        }
      });
      r.on('end', () => clearTimeout(frist));
      r.on('error', (e: Error) => {
        clearTimeout(frist);
        aus.destroy(e);
      });
      aus.on('close', () => {
        if (!r.complete) abbrechen(new AbrufFehler('netz', `Abgebrochen: ${addressShort(ende)}`));
      });
      r.pipe(aus);
      return aus;
    },
  };
}
