import type { DbInterface } from '../../../db/database';

/** Times come from the services' clock (ms) so that tests can move it. */
export async function insertTicket(
  db: DbInterface,
  hash: string,
  uid: number,
  target: string,
  untilMs: number,
): Promise<void> {
  await db.run(
    'INSERT INTO pdf_tickets (ticket_hash, user_id, target, expires_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))',
    [hash, uid, target, untilMs],
  );
}

/** Deleting and reading in one statement: of two concurrent redeems only one gets the row. */
export function takeTicket(db: DbInterface, hash: string, nowMs: number) {
  return db.get<{ user_id: number; target: string; valid: boolean }>(
    `DELETE FROM pdf_tickets WHERE ticket_hash = $1
     RETURNING user_id, target, expires_at >= to_timestamp($2 / 1000.0) AS valid`,
    [hash, nowMs],
  );
}

/** Under row security only the account's own rows; in the system frame all of them. */
export async function deleteExpiredTickets(db: DbInterface, nowMs: number): Promise<number> {
  return (await db.run('DELETE FROM pdf_tickets WHERE expires_at < to_timestamp($1 / 1000.0)', [nowMs])).changes;
}
