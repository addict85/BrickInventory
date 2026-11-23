/** A confirmed PDF fetch is valid once and for 60s: the GET address would otherwise be a
 * free pass for any token. In the database (pdf_tickets), so any web process may serve the
 * fetch; only the hash is stored. */
import crypto from 'node:crypto';
import type { VoucherContext } from './context';

export const TICKET_SEC = 60;
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function issueTicket(k: VoucherContext, uid: number, target: string): Promise<string> {
  const now = k.clock.now();
  // The account's own expired tickets go along; the hourly cleanup takes the rest.
  await k.pdfTickets.deleteExpired(now);
  const ticket = crypto.randomBytes(32).toString('base64url');
  await k.pdfTickets.insert(hash(ticket), uid, target, now + TICKET_SEC * 1000);
  return ticket;
}

export async function redeemTicket(
  k: VoucherContext,
  raw: string | undefined,
  uid: number,
  target: string,
): Promise<boolean> {
  if (typeof raw !== 'string' || !raw) return false;
  const t = await k.pdfTickets.take(hash(raw), k.clock.now());
  return !!t && t.user_id === uid && t.target === target && t.valid;
}

export function cleanupTickets(k: VoucherContext): Promise<number> {
  return k.pdfTickets.deleteExpired(k.clock.now());
}
