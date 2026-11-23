/** Violations of the CSP (report-uri and report-to) end up in the log: a
 * rejected Trusted Types assignment or a foreign script would otherwise only be noticed in the
 * browser. Public, because the browser reports without login; hence small,
 * throttled and without a response body. */
import express from 'express';
import type { Request, Response } from 'express';
import { processWide } from '../infra/processWide';
import { throttleAddress } from '../infra/throttleAddress';

const WINDOW_MS = 60_000;
const PER_ADDRESS = 10;
/** The minute does not remember more senders; whoever comes after that is discarded. */
const AT_MOST_ADDRESSES = 1000;
const F = processWide('cspReport', () => ({ since: Date.now(), throttled: 0, perAddress: new Map<string, number>() }));

export function cspMessageFree(address: string, now = Date.now()): boolean {
  const _perAddress = F.perAddress;
  if (now - F.since >= WINDOW_MS) {
    if (F.throttled) console.warn(`[csp] ${F.throttled} gedrosselt`);
    _perAddress.clear();
    F.throttled = 0;
    F.since = now;
  }
  // Per sender instead of shared, otherwise real reports would drown in a foreign flood; IPv6 per /64.
  const a = throttleAddress(address);
  const n = (_perAddress.get(a) ?? 0) + 1;
  const free = n <= PER_ADDRESS && (_perAddress.has(a) || _perAddress.size < AT_MOST_ADDRESSES);
  if (_perAddress.has(a) || _perAddress.size < AT_MOST_ADDRESSES) _perAddress.set(a, n);
  if (!free) F.throttled++;
  return free;
}

type Violation = { rule: unknown; blocked: unknown; page: unknown; probe: unknown };

const field = (o: unknown, k: string): unknown =>
  o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined;

/** report-uri sends { "csp-report": {…} }, report-to a list of { type, body }. */
function violations(data: unknown): Violation[] {
  return (Array.isArray(data) ? data : [data]).slice(0, 5).flatMap((e: unknown) => {
    const alt = field(e, 'csp-report');
    if (alt)
      return [
        {
          rule: field(alt, 'effective-directive') ?? field(alt, 'violated-directive'),
          blocked: field(alt, 'blocked-uri'),
          page: field(alt, 'document-uri'),
          probe: field(alt, 'script-sample'),
        },
      ];
    const b = field(e, 'type') === 'csp-violation' ? field(e, 'body') : null;
    return b
      ? [
          {
            rule: field(b, 'effectiveDirective'),
            blocked: field(b, 'blockedURL'),
            page: field(b, 'documentURL'),
            probe: field(b, 'sample'),
          },
        ]
      : [];
  });
}

/** What the browser writes here has a fixed shape; anything else is not a
 * real report and would otherwise end up in the log as free text. */
const DIRECTIVE = /^[a-z][a-z-]{1,39}$/;
const KEYWORD = /^(inline|eval|wasm-eval|self|data|blob|trusted-types-(sink|policy))$/;

function directive(v: unknown): string | null {
  const first =
    String(v ?? '')
      .trim()
      .split(/\s/)[0] ?? '';
  return DIRECTIVE.test(first) ? first : null;
}

/** Only http(s)/ws(s) and without the query part: an address can carry a reset or confirmation link. */
function reportAddress(v: unknown, keyword = false): string {
  const s = String(v ?? '');
  if (keyword && KEYWORD.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/^(https?|wss?):$/.test(u.protocol)) return /^(data|blob):$/.test(u.protocol) ? u.protocol.slice(0, -1) : '?';
    return (u.origin + u.pathname).slice(0, 160);
  } catch {
    return '?';
  }
}

/** When the browser opens a raster image directly, it styles its own image view inline;
 * our CSP on the image blocks that. No attack, no row. SVG stays reported. */
function imageView(page: unknown): boolean {
  try {
    return /\.(jpe?g|png|gif|webp|avif)$/i.test(new URL(String(page ?? '')).pathname);
  } catch {
    return false;
  }
}

/** The sample shows which assignment Trusted Types rejected; otherwise it is foreign text. */
function probe(rule: string, v: unknown): string {
  if (!rule.includes('trusted-types') || typeof v !== 'string') return '';
  return v.replace(/[^\x20-\x7e]/g, ' ').slice(0, 80);
}

export function buildCspReportRouter() {
  return express
    .Router()
    .post('/csp-bericht', express.raw({ type: () => true, limit: '8kb' }), (req: Request, res: Response) => {
      res.status(204).end();
      if (!cspMessageFree(req.ip ?? '?')) return;
      let data: unknown;
      try {
        data = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '');
      } catch {
        return;
      }
      for (const v of violations(data)) {
        const rule = directive(v.rule);
        if (!rule || imageView(v.page)) continue;
        const p = probe(rule, v.probe);
        // The parts are already filtered; the replacement is the form CodeQL recognizes as protection.
        console.warn(
          `[csp] ${rule} blockierte ${reportAddress(v.blocked, true)} auf ${reportAddress(v.page)}${p ? ` (${p})` : ''}`.replace(
            /\n|\r/g,
            '',
          ),
        );
      }
    });
}
