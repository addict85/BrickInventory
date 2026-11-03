/** Ein bestätigter PDF-Abruf gilt einmal und 60 s: Die GET-Adresse wäre sonst ein
 * Freibrief für jeden Token. Nur der Web-Prozess liefert aus; gespeichert wird der Hash. */
import crypto from 'crypto';

export const TICKET_SEK = 60;
const tickets = new Map<string, { uid: number; ziel: string; bis: number }>();
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function stelleTicketAus(uid: number, ziel: string): string {
  const jetzt = Date.now();
  for (const [k, v] of tickets) if (v.bis < jetzt) tickets.delete(k);
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(hash(ticket), { uid, ziel, bis: jetzt + TICKET_SEK * 1000 });
  return ticket;
}

export function loeseTicketEin(roh: unknown, uid: number, ziel: string): boolean {
  if (typeof roh !== 'string' || !roh) return false;
  const k = hash(roh), t = tickets.get(k);
  if (!t) return false;
  tickets.delete(k);
  return t.uid === uid && t.ziel === ziel && t.bis >= Date.now();
}
