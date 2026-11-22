/** A confirmed PDF fetch is valid once and for 60s: the GET address would otherwise be a
 * free pass for any token. Only the web process serves it out; only the hash is stored. */
import crypto from 'node:crypto';
import type { VoucherContext } from './context';

export const TICKET_SEC = 60;
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const ticketsFor = (k: VoucherContext) =>
  k.faecher.slot('pdfTickets', () => new Map<string, { uid: number; target: string; until: number }>());

export function issueTicket(k: VoucherContext, uid: number, target: string): string {
  const tickets = ticketsFor(k);
  const now = k.uhr.jetzt();
  for (const [key, v] of tickets) if (v.until < now) tickets.delete(key);
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(hash(ticket), { uid, target, until: now + TICKET_SEC * 1000 });
  return ticket;
}

export function redeemTicket(k: VoucherContext, raw: string | undefined, uid: number, target: string): boolean {
  if (typeof raw !== 'string' || !raw) return false;
  const tickets = ticketsFor(k);
  const h = hash(raw),
    t = tickets.get(h);
  if (!t) return false;
  tickets.delete(h);
  return t.uid === uid && t.target === target && t.until >= k.uhr.jetzt();
}
