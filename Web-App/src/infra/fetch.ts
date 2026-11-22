/** The one way outside. A throw from a response callback is an
 * uncaughtException and ends the server; that is why only this file calls
 * https.get and https.request, and every error becomes a rejection here. */
import https from 'node:https';
import { PassThrough, type Readable } from 'node:stream';
import type { IncomingHttpHeaders, IncomingMessage, ClientRequest } from 'node:http';
import { hostAllowed, nextRedirect, REDIRECT_LIMIT } from './foreignAddresses';
import { publicLookup } from './targetAddress';
import { counter, histogram } from './metrics';

const externalCalls = counter(
  'external_requests_total',
  'Requests to external services by host and outcome (status class or error reason).',
);
const externalTime = histogram('external_request_duration_seconds', 'Time to the response head, by host.');

/** Only a host of the call's own list becomes a label: a foreign one comes from outside and is unbounded. */
function measured<T extends FetchHeader>(url: string, o: FetchOptions, p: Promise<T>): Promise<T> {
  const start = process.hrtime.bigint();
  let host = 'other';
  try {
    const h = new URL(url).host;
    if (o.hosts.includes(h)) host = h;
  } catch {
    host = 'invalid';
  }
  const record = (outcome: string) => {
    externalCalls.inc({ host, outcome });
    externalTime.observe({ host }, Number(process.hrtime.bigint() - start) / 1e9);
  };
  return p.then(
    r => {
      record(`${Math.floor(r.status / 100)}xx`);
      return r;
    },
    (e: unknown) => {
      record(e instanceof FetchError ? e.grund : 'netz');
      throw e;
    },
  );
}

export type FetchReason = 'adresse' | 'umleitung' | 'zu-gross' | 'zeitlimit' | 'netz' | 'abgebrochen';

export class FetchError extends Error {
  readonly grund: FetchReason;
  /** As in clients/fetchError.ts: a retry can succeed. */
  readonly isTransient: boolean;
  constructor(grund: FetchReason, text: string, cause?: unknown) {
    super(text, cause === undefined ? undefined : { cause: cause });
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
  abbrechen: (f: FetchError) => void;
}

function run(start: string, o: FetchOptions): Promise<Lauf> {
  return new Promise((finished, fail) => {
    let req: ClientRequest | null = null;
    let reply: IncomingMessage | null = null;
    let done = false;
    const abbrechen = (f: FetchError) => {
      clearTimeout(frist);
      if (!done) {
        done = true;
        fail(f);
      }
      reply?.destroy?.(f);
      req?.destroy?.();
    };
    const frist = setTimeout(
      () => abbrechen(new FetchError('zeitlimit', `Zeitlimit ${o.zeitlimitMs} ms: ${addressShort(start)}`)),
      o.zeitlimitMs,
    );
    frist.unref?.();
    const atAbort = () =>
      abbrechen(new FetchError('abgebrochen', `Abgebrochen: ${addressShort(start)}`, o.signal?.reason));
    if (o.signal?.aborted) return atAbort();
    o.signal?.addEventListener('abort', atAbort, { once: true });

    const sprung = (u: string, header: Record<string, string>, rest: number) => {
      if (!u.startsWith('https://') || !hostAllowed(u, o.hosts))
        return abbrechen(new FetchError('adresse', `Adresse nicht erlaubt: ${addressShort(u)}`));
      try {
        const atResponse = (r: IncomingMessage) => {
          if (done) {
            r.resume?.();
            return;
          }
          const status = r.statusCode ?? 0;
          if (REDIRECT.has(status) && (o.redirects ?? REDIRECT_LIMIT) > 0 && (o.methode ?? 'GET') === 'GET') {
            r.resume?.();
            if (rest <= 0)
              return abbrechen(new FetchError('umleitung', `Zu viele Umleitungen: ${addressShort(start)}`));
            const next = nextRedirect(u, r.headers?.location, header, o.hosts);
            if (!next)
              return abbrechen(
                new FetchError(
                  'umleitung',
                  `Umleitung ${status} nicht befolgbar (fehlend, kein https oder fremder Host): ${addressShort(u)}`,
                ),
              );
            return sprung(next.url, next.kopfzeilen, rest - 1);
          }
          const length = Number(r.headers?.['content-length']);
          if (length > o.maxBytes) {
            r.resume?.();
            return abbrechen(new FetchError('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(u)}`));
          }
          reply = r;
          done = true;
          finished({ antwort: r, url: u, frist, abbrechen });
        };
        const connection = o.agent ? { agent: o.agent } : { lookup: publicLookup };
        req =
          o.methode === 'POST'
            ? https.request(u, { method: 'POST', family: 4, headers: header, ...connection }, atResponse)
            : https.get(u, { family: 4, headers: header, ...connection }, atResponse);
        req.on('error', (e: Error) => {
          const code = (e as NodeJS.ErrnoException).code;
          abbrechen(
            e instanceof FetchError
              ? e
              : new FetchError(
                  code === 'EZIELGESPERRT' ? 'adresse' : 'netz',
                  `${code || e.message}: ${addressShort(u)}`,
                  e,
                ),
          );
        });
        if (o.methode === 'POST') req.end(o.rumpf);
      } catch (e) {
        abbrechen(new FetchError('adresse', `Abruf nicht möglich: ${addressShort(u)}`, e));
      }
    };
    sprung(start, o.kopfzeilen ?? {}, o.redirects ?? REDIRECT_LIMIT);
  });
}

/** Whole response into memory — for API responses and small images. */
export function holeHttps(url: string, o: FetchOptions): Promise<FetchResponse> {
  return measured(url, o, fetchWhole(url, o));
}

async function fetchWhole(url: string, o: FetchOptions): Promise<FetchResponse> {
  const { antwort: r, url: end, frist, abbrechen } = await run(url, o);
  return new Promise((finished, fail) => {
    const parts: Buffer[] = [];
    let n = 0,
      from = false;
    const error = (f: FetchError) => {
      if (!from) {
        from = true;
        fail(f);
      }
      abbrechen(f);
    };
    r.on('data', (d: Buffer | string) => {
      const b = typeof d === 'string' ? Buffer.from(d) : d;
      n += b.length;
      if (n > o.maxBytes)
        return error(new FetchError('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(end)}`));
      parts.push(b);
    });
    r.on('end', () => {
      clearTimeout(frist);
      if (!from) {
        from = true;
        finished({ status: r.statusCode ?? 0, kopf: r.headers ?? {}, url: end, koerper: Buffer.concat(parts) });
      }
    });
    r.on('error', (e: Error) =>
      error(e instanceof FetchError ? e : new FetchError('netz', `${e.message}: ${addressShort(end)}`, e)),
    );
  });
}

/** Only the head; the body as a limited stream — for files and the image proxy. */
export function openHttps(url: string, o: FetchOptions): Promise<FetchStream> {
  return measured(url, o, openLimited(url, o));
}

async function openLimited(url: string, o: FetchOptions): Promise<FetchStream> {
  const { antwort: r, url: end, frist, abbrechen } = await run(url, o);
  return {
    status: r.statusCode ?? 0,
    kopf: r.headers ?? {},
    url: end,
    verwerfen: () => {
      clearTimeout(frist);
      r.resume?.();
    },
    strom: () => {
      const from = new PassThrough();
      let n = 0;
      r.on('data', (d: Buffer) => {
        n += d.length;
        if (n > o.maxBytes) {
          const f = new FetchError('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(end)}`);
          from.destroy(f);
          abbrechen(f);
        }
      });
      r.on('end', () => clearTimeout(frist));
      r.on('error', (e: Error) => {
        clearTimeout(frist);
        from.destroy(e);
      });
      from.on('close', () => {
        if (!r.complete) abbrechen(new FetchError('netz', `Abgebrochen: ${addressShort(end)}`));
      });
      r.pipe(from);
      return from;
    },
  };
}
