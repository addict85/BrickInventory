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
      record(e instanceof FetchError ? e.reason : 'netz');
      throw e;
    },
  );
}

export type FetchReason = 'adresse' | 'umleitung' | 'zu-gross' | 'time_limit' | 'netz' | 'abgebrochen';

export class FetchError extends Error {
  readonly reason: FetchReason;
  /** As in clients/fetchError.ts: a retry can succeed. */
  readonly isTransient: boolean;
  constructor(reason: FetchReason, text: string, cause?: unknown) {
    super(text, cause === undefined ? undefined : { cause: cause });
    this.name = 'AbrufFehler';
    this.reason = reason;
    this.isTransient = reason === 'time_limit' || reason === 'netz';
  }
}

export interface FetchOptions {
  /** Applies to the first address and to every hop. */
  hosts: readonly string[];
  maxBytes: number;
  /** Total deadline from the first hop to the last byte. */
  timeoutMs: number;
  headers?: Record<string, string>;
  redirects?: number;
  /** Brings its own name resolution; without it publicLookup checks the target. */
  agent?: https.Agent;
  /** POST follows no redirect: a 303 would mean GET, a 307 would pass the body on. */
  method?: 'GET' | 'POST';
  bodyText?: string;
  /** A job that gets aborted also ends its fetch including the body. */
  signal?: AbortSignal;
}

export interface FetchHeader {
  status: number;
  head: IncomingHttpHeaders;
  /** The address after all redirects. */
  url: string;
}

export interface FetchResponse extends FetchHeader {
  body: Buffer;
}

export interface FetchStream extends FetchHeader {
  /** The body, limited to maxBytes; beyond that it ends with AbrufFehler. */
  stream(): Readable;
  discard(): void;
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

interface Run {
  response: IncomingMessage;
  url: string;
  deadline: NodeJS.Timeout;
  abort: (f: FetchError) => void;
}

/** A redirect to follow (or the reason it cannot be followed); null: the response itself counts. */
function redirectHop(
  r: IncomingMessage,
  u: string,
  header: Record<string, string>,
  o: FetchOptions,
  rest: number,
  start: string,
): { next: { url: string; headers: Record<string, string> } } | { error: FetchError } | null {
  const status = r.statusCode ?? 0;
  if (!REDIRECT.has(status) || (o.redirects ?? REDIRECT_LIMIT) <= 0 || (o.method ?? 'GET') !== 'GET') return null;
  if (rest <= 0) return { error: new FetchError('umleitung', `Zu viele Umleitungen: ${addressShort(start)}`) };
  const next = nextRedirect(u, r.headers?.location, header, o.hosts);
  if (next) return { next };
  return {
    error: new FetchError(
      'umleitung',
      `Umleitung ${status} nicht befolgbar (fehlend, kein https oder fremder Host): ${addressShort(u)}`,
    ),
  };
}

function run(start: string, o: FetchOptions): Promise<Run> {
  return new Promise((finished, fail) => {
    let req: ClientRequest | null = null;
    let reply: IncomingMessage | null = null;
    let done = false;
    const abort = (f: FetchError) => {
      clearTimeout(deadline);
      if (!done) {
        done = true;
        fail(f);
      }
      reply?.destroy?.(f);
      req?.destroy?.();
    };
    const deadline = setTimeout(
      () => abort(new FetchError('time_limit', `Zeitlimit ${o.timeoutMs} ms: ${addressShort(start)}`)),
      o.timeoutMs,
    );
    deadline.unref?.();
    const atAbort = () => abort(new FetchError('abgebrochen', `Abgebrochen: ${addressShort(start)}`, o.signal?.reason));
    if (o.signal?.aborted) return atAbort();
    o.signal?.addEventListener('abort', atAbort, { once: true });

    const follow = (u: string, header: Record<string, string>, rest: number) => {
      if (!u.startsWith('https://') || !hostAllowed(u, o.hosts))
        return abort(new FetchError('adresse', `Adresse nicht erlaubt: ${addressShort(u)}`));
      try {
        const atResponse = (r: IncomingMessage) => {
          if (done) {
            r.resume?.();
            return;
          }
          const hop = redirectHop(r, u, header, o, rest, start);
          if (hop) {
            r.resume?.();
            return 'error' in hop ? abort(hop.error) : follow(hop.next.url, hop.next.headers, rest - 1);
          }
          const length = Number(r.headers?.['content-length']);
          if (length > o.maxBytes) {
            r.resume?.();
            return abort(new FetchError('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(u)}`));
          }
          reply = r;
          done = true;
          finished({ response: r, url: u, deadline, abort });
        };
        const connection = o.agent ? { agent: o.agent } : { lookup: publicLookup };
        req =
          o.method === 'POST'
            ? https.request(u, { method: 'POST', family: 4, headers: header, ...connection }, atResponse)
            : https.get(u, { family: 4, headers: header, ...connection }, atResponse);
        req.on('error', (e: Error) => {
          const code = (e as NodeJS.ErrnoException).code;
          abort(
            e instanceof FetchError
              ? e
              : new FetchError(
                  code === 'EZIELGESPERRT' ? 'adresse' : 'netz',
                  `${code || e.message}: ${addressShort(u)}`,
                  e,
                ),
          );
        });
        if (o.method === 'POST') req.end(o.bodyText);
      } catch (e) {
        abort(new FetchError('adresse', `Abruf nicht möglich: ${addressShort(u)}`, e));
      }
    };
    follow(start, o.headers ?? {}, o.redirects ?? REDIRECT_LIMIT);
  });
}

/** Whole response into memory — for API responses and small images. */
export function holeHttps(url: string, o: FetchOptions): Promise<FetchResponse> {
  return measured(url, o, fetchWhole(url, o));
}

async function fetchWhole(url: string, o: FetchOptions): Promise<FetchResponse> {
  const { response: r, url: end, deadline, abort } = await run(url, o);
  return new Promise((finished, fail) => {
    const parts: Buffer[] = [];
    let n = 0,
      from = false;
    const error = (f: FetchError) => {
      if (!from) {
        from = true;
        fail(f);
      }
      abort(f);
    };
    r.on('data', (d: Buffer | string) => {
      const b = typeof d === 'string' ? Buffer.from(d) : d;
      n += b.length;
      if (n > o.maxBytes)
        return error(new FetchError('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(end)}`));
      parts.push(b);
    });
    r.on('end', () => {
      clearTimeout(deadline);
      if (!from) {
        from = true;
        finished({ status: r.statusCode ?? 0, head: r.headers ?? {}, url: end, body: Buffer.concat(parts) });
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
  const { response: r, url: end, deadline, abort } = await run(url, o);
  return {
    status: r.statusCode ?? 0,
    head: r.headers ?? {},
    url: end,
    discard: () => {
      clearTimeout(deadline);
      r.resume?.();
    },
    stream: () => {
      const from = new PassThrough();
      let n = 0;
      r.on('data', (d: Buffer) => {
        n += d.length;
        if (n > o.maxBytes) {
          const f = new FetchError('zu-gross', `Antwort über ${o.maxBytes} Byte: ${addressShort(end)}`);
          from.destroy(f);
          abort(f);
        }
      });
      r.on('end', () => clearTimeout(deadline));
      r.on('error', (e: Error) => {
        clearTimeout(deadline);
        from.destroy(e);
      });
      from.on('close', () => {
        if (!r.complete) abort(new FetchError('netz', `Abgebrochen: ${addressShort(end)}`));
      });
      r.pipe(from);
      return from;
    },
  };
}
