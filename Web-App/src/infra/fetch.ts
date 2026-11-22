/** The one way outside. A throw from a response callback is an
 * uncaughtException and ends the server; that is why only this file calls
 * https.get and https.request, and every error becomes a rejection here. */
import https from 'node:https';
import { PassThrough, type Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage, ClientRequest } from 'node:http';
import { hostAllowed, nextRedirect, REDIRECT_LIMIT } from './foreignAddresses';
import { publicLookup } from './targetAddress';

export type FetchReason = 'adresse' | 'umleitung' | 'zu-gross' | 'zeitlimit' | 'netz' | 'abgebrochen';

export class AbrufFehler extends Error {
  readonly grund: FetchReason;
  /** As in clients/fetchError.ts: a retry can succeed. */
  readonly isTransient: boolean;
  constructor(grund: FetchReason, text: string, ursache?: unknown) {
    super(text, ursache === undefined ? undefined : { cause: ursache });
    this.name = 'AbrufFehler';
    this.grund = grund;
    this.isTransient = grund === 'zeitlimit' || grund === 'netz';
  }
}

export interface FetchOptions {
  /** Applies to the first address and to every hop. */
  hosts: readonly string[];
  maxBytes: number;
  /** Total deadline from the first hop to the last byte. */
  zeitlimitMs: number;
  kopfzeilen?: Record<string, string>;
  redirects?: number;
  /** Brings its own name resolution; without it publicLookup checks the target. */
  agent?: https.Agent;
  /** POST follows no redirect: a 303 would mean GET, a 307 would pass the body on. */
  methode?: 'GET' | 'POST';
  rumpf?: string;
  /** A job that gets aborted also ends its fetch including the body. */
  signal?: AbortSignal;
}

export interface FetchHeader {
  status: number;
  kopf: IncomingHttpHeaders;
  /** The address after all redirects. */
  url: string;
}

export interface FetchResponse extends FetchHeader {
  koerper: Buffer;
}

export interface FetchStream extends FetchHeader {
  /** The body, limited to maxBytes; beyond that it ends with AbrufFehler. */
  strom(): Readable;
  verwerfen(): void;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** Without the query part: API keys are in it (Brickset), and error texts end up in the log. */
function addressShort(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).slice(0, 120);
  } catch {
    return '(unlesbare Adresse)';
  }
}

/** Foreign response text for the log: single-line and short so that it does not forge lines. */
export function excerpt(text: unknown, n = 120): string {
  return (
    String(text ?? '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: filtering out control characters is the purpose of this spot.
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

/** Whole response into memory — for API responses and small images. */
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

/** Only the head; the body as a limited stream — for files and the image proxy. */
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
