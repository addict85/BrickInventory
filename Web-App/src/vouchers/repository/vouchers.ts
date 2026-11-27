/** Only this repository encrypts and decrypts number and PIN: even the number unlocks it. */
import type { DbInterface } from '../../../db/database';
import { encrypt, decrypt, searchValue, context, rekey, readOldValue } from '../../infra/secret';

export interface VoucherRow {
  id: number;
  number: string;
  pin: string | null;
  amount: string | number;
  currency: string;
  pdf_path: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  balance_checked_at: string | Date | null;
}
/** currency null: the database sets the account's currency (trigger vouchers_currency). */
export interface VoucherFields {
  number: string;
  pin: string | null;
  amount: number;
  currency: string | null;
}

const COLUMNS =
  'id, number, pin, amount, currency, pdf_path, created_at, updated_at, balance_checked_at AS balance_checked_at';

/** Account and row as context: a number or PIN copied into another voucher stays unreadable.
 * NOTE: these tags are part of the encryption AAD / HMAC input for data already stored —
 * they must not change, even though the code around them does. */
export const numberContext = (uid: number, id: number) => context('vouchers.number', uid, id);
export const pinContext = (uid: number, id: number) => context('vouchers.pin', uid, id);
export const numberSearch = (uid: number, number: string) => searchValue('gutschein-nummer', `${uid}:${number}`);

/** Account in the HMAC: the same card in two accounts should not be recognizable as the same. */
export function numberColumns(uid: number, id: number, number: string): { number: string; number_search: string } {
  return {
    number: encrypt(number, numberContext(uid, id)) as string,
    number_search: numberSearch(uid, number),
  };
}

/** Wrong key: empty number, the contract requires a string. */
function readable(uid: number, z: VoucherRow): VoucherRow {
  return {
    ...z,
    number: decrypt(z.number, numberContext(uid, z.id)) ?? '',
    pin: decrypt(z.pin, pinContext(uid, z.id)),
  };
}

/** The ID before the INSERT: it is part of the encryption context. */
async function newId(db: DbInterface): Promise<number> {
  return (await db.get<{ id: number }>("SELECT nextval(pg_get_serial_sequence('vouchers', 'id'))::int AS id"))!.id;
}

export async function vouchersOfAccount(
  db: DbInterface,
  uid: number,
  order: 'neueste' | 'aelteste' = 'neueste',
): Promise<VoucherRow[]> {
  const row = order === 'neueste' ? 'created_at DESC, id DESC' : 'created_at, id';
  return (
    await db.all<VoucherRow>(
      `SELECT ${COLUMNS} FROM vouchers WHERE user_id = $1 AND deleted_at IS NULL ORDER BY ${row}`,
      [uid],
    )
  ).map(z => readable(uid, z));
}

export async function voucher(db: DbInterface, uid: number, id: number): Promise<VoucherRow | undefined> {
  const z = await db.get<VoucherRow>(
    `SELECT ${COLUMNS} FROM vouchers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, uid],
  );
  return z && readable(uid, z);
}

/** Locks the row until the end of the transaction: whoever reads, merges and writes
 * should not overwrite a concurrent change. */
export async function lockedVoucher(db: DbInterface, uid: number, id: number): Promise<VoucherRow | undefined> {
  const z = await db.get<VoucherRow>(
    `SELECT ${COLUMNS} FROM vouchers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [id, uid],
  );
  return z && readable(uid, z);
}

/** undefined if the number already exists — no silent overwrite. */
export async function insertVoucher(db: DbInterface, uid: number, w: VoucherFields): Promise<VoucherRow | undefined> {
  const id = await newId(db);
  const n = numberColumns(uid, id, w.number);
  const z = await db.get<VoucherRow>(
    `INSERT INTO vouchers (id, user_id, number, number_search, pin, amount, currency) VALUES ($7,$1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, number_search) WHERE deleted_at IS NULL DO NOTHING RETURNING ${COLUMNS}`,
    [uid, n.number, n.number_search, encrypt(w.pin, pinContext(uid, id)), w.amount, w.currency, id],
  );
  return z && readable(uid, z);
}

/** Looks for the existing row first: the PIN needs its ID as context.
 * @returns whether the voucher was newly created */
export async function replaceVoucher(db: DbInterface, uid: number, w: VoucherFields): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const da = await db.get<{ id: number }>(
      'SELECT id FROM vouchers WHERE user_id = $1 AND number_search = $2 AND deleted_at IS NULL',
      [uid, numberSearch(uid, w.number)],
    );
    if (!da) {
      if (await insertVoucher(db, uid, w)) return true;
      continue;
    }
    const r = await db.run(
      `UPDATE vouchers SET pin = COALESCE($1, pin), amount = $2, currency = $3, updated_at = NOW()
      WHERE id = $4 AND user_id = $5 AND deleted_at IS NULL`,
      [encrypt(w.pin, pinContext(uid, da.id)), w.amount, w.currency, da.id, uid],
    );
    if (r.changes) return false;
  }
  throw new Error('Voucher is changing concurrently elsewhere');
}

export async function updateVoucher(
  db: DbInterface,
  uid: number,
  id: number,
  w: VoucherFields,
): Promise<VoucherRow | undefined> {
  const n = numberColumns(uid, id, w.number);
  const z = await db.get<VoucherRow>(
    `UPDATE vouchers SET number=$1, number_search=$2, pin=$3, amount=$4, currency=$5, updated_at=NOW()
      WHERE id=$6 AND user_id=$7 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
    [n.number, n.number_search, encrypt(w.pin, pinContext(uid, id)), w.amount, w.currency, id, uid],
  );
  return z && readable(uid, z);
}

export async function rememberVoucherPdf(db: DbInterface, uid: number, id: number, relPath: string) {
  await db.run('UPDATE vouchers SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [
    relPath,
    id,
    uid,
  ]);
}

/** Only marks the row: number, PIN and PDF stay until the cleanup, so that undo restores them.
 * @returns whether a live row was there */
export async function markVoucherDeleted(db: DbInterface, uid: number, id: number, nowMs: number): Promise<boolean> {
  const r = await db.run(
    'UPDATE vouchers SET deleted_at = to_timestamp($3 / 1000.0) WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, uid, nowMs],
  );
  return r.changes > 0;
}

/** Only a row deleted since `sinceMs`: past the window the cleanup may already be removing it. */
export async function restoreVoucherRow(
  db: DbInterface,
  uid: number,
  id: number,
  sinceMs: number,
): Promise<VoucherRow | undefined> {
  const z = await db.get<VoucherRow>(
    `UPDATE vouchers SET deleted_at = NULL
      WHERE id = $1 AND user_id = $2 AND deleted_at >= to_timestamp($3 / 1000.0) RETURNING ${COLUMNS}`,
    [id, uid, sinceMs],
  );
  return z && readable(uid, z);
}

/** Under row security only the account's own rows; in the system frame (cleanup) all of them.
 * @returns the removed rows, so that the caller deletes their PDFs */
export function purgeDeletedVoucherRows(db: DbInterface, beforeMs: number) {
  return db.all<{ user_id: number; pdf_path: string | null }>(
    'DELETE FROM vouchers WHERE deleted_at < to_timestamp($1 / 1000.0) RETURNING user_id, pdf_path',
    [beforeMs],
  );
}

export async function rememberBalance(
  db: DbInterface,
  uid: number,
  id: number,
  amount: number,
  currency: string,
): Promise<VoucherRow | undefined> {
  const z = await db.get<VoucherRow>(
    `UPDATE vouchers SET amount = $1, currency = $2, balance_checked_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND user_id = $4 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
    [amount, currency, id, uid],
  );
  return z && readable(uid, z);
}

/** Plaintext (before 0087) and v1 to v2, ahead of the first request. `AND number = $…`
 * leaves a meanwhile-changed row alone, and a wrong key leaves the row as it is. */
export async function reencryptNumbers(db: DbInterface): Promise<number> {
  let n = 0;
  for (const z of await db.all<{
    id: number;
    user_id: number;
    number: string;
    pin: string | null;
    number_search: string | null;
  }>(
    "SELECT id, user_id, number, pin, number_search FROM vouchers WHERE number NOT LIKE 'v2:%' OR pin NOT LIKE 'v2:%' OR number_search IS NULL",
  )) {
    const number = readOldValue(z.number, numberContext(z.user_id, z.id));
    if (number === null) continue;
    const fresh = z.number.startsWith('v2:') ? z.number : numberColumns(z.user_id, z.id, number).number;
    const pin = rekey(z.pin, pinContext(z.user_id, z.id)) ?? z.pin;
    n +=
      (
        await db.run(
          `UPDATE vouchers SET number = $1, number_search = $2, pin = $3
      WHERE id = $4 AND number = $5 AND pin IS NOT DISTINCT FROM $6`,
          [fresh, numberSearch(z.user_id, number), pin, z.id, z.number, z.pin],
        )
      ).changes || 0;
  }
  return n;
}

/** After a key rotation, including the search value (it hangs off the key). Same
 * condition as above leaves a meanwhile-changed row alone. Deleted rows too, here and above:
 * an undo after the rotation must still open them. */
export async function reencryptAllVouchers(db: DbInterface): Promise<number> {
  let n = 0;
  for (const z of await db.all<{
    id: number;
    user_id: number;
    number: string;
    pin: string | null;
    number_search: string | null;
  }>("SELECT id, user_id, number, pin, number_search FROM vouchers WHERE number LIKE 'v2:%'")) {
    const number = decrypt(z.number, numberContext(z.user_id, z.id));
    if (number === null) continue;
    const fresh = rekey(z.number, numberContext(z.user_id, z.id)) ?? z.number;
    const pin = rekey(z.pin, pinContext(z.user_id, z.id)) ?? z.pin;
    const search = numberSearch(z.user_id, number);
    if (fresh === z.number && pin === z.pin && search === z.number_search) continue;
    n +=
      (
        await db.run(
          `UPDATE vouchers SET number = $1, number_search = $2, pin = $3
      WHERE id = $4 AND number = $5 AND pin IS NOT DISTINCT FROM $6`,
          [fresh, search, pin, z.id, z.number, z.pin],
        )
      ).changes || 0;
  }
  return n;
}

/** Copies before a migration (schema name checked by the pattern); `all` after a key rotation. */
export async function reencryptCopies(db: DbInterface, all = false): Promise<number> {
  let n = 0;
  for (const { schema } of await db.all<{ schema: string }>(
    `SELECT table_schema AS schema FROM information_schema.tables
      WHERE table_name = 'vouchers' AND table_schema ~ '^vor_migration_[0-9]+$'`,
  )) {
    for (const z of await db.all<{ id: number; user_id: number; number: string; pin: string | null }>(
      `SELECT id, user_id, number, pin FROM ${schema}.vouchers${all ? '' : " WHERE number NOT LIKE 'v2:%' OR pin NOT LIKE 'v2:%'"}`,
    )) {
      const number = rekey(z.number, numberContext(z.user_id, z.id));
      const pin = rekey(z.pin, pinContext(z.user_id, z.id));
      if (number === undefined && pin === undefined) continue;
      n +=
        (
          await db.run(`UPDATE ${schema}.vouchers SET number = $1, pin = $2 WHERE id = $3`, [
            number ?? z.number,
            pin ?? z.pin,
            z.id,
          ])
        ).changes || 0;
    }
  }
  return n;
}

/** Across accounts, for the nightly run: only cards with a PIN, since LEGO asks for it. */
export function accountsWithCards(db: DbInterface): Promise<{ user_id: number; cards: number }[]> {
  return db.all<{ user_id: number; cards: number }>(
    `SELECT user_id, COUNT(*)::int AS cards FROM vouchers
      WHERE deleted_at IS NULL AND pin IS NOT NULL GROUP BY user_id ORDER BY user_id`,
  );
}
