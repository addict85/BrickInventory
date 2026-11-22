import type { DbInterface } from '../../../db/database';

/** Parts and figures of a set in the account's inventory: existing rows keep storage location
 * and date, whatever the set no longer contains goes. The catalog delivers the numbers. */
function addSetMinifigsOne(tx: DbInterface, userId: number, setNumber: string, numbers: string[]) {
  return tx.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, source)
       SELECT $1, $2, f, 'set' FROM unnest($3::text[]) AS f ON CONFLICT DO NOTHING`,
    [userId, setNumber, numbers],
  );
}

function removeForeignSetMinifigs(tx: DbInterface, userId: number, setNumber: string, numbers: string[]) {
  return tx.run(
    `DELETE FROM minifigs WHERE user_id=$1 AND set_number=$2 AND source='set' AND NOT (fig_number = ANY($3::text[]))`,
    [userId, setNumber, numbers],
  );
}

function addSetPartsOne(tx: DbInterface, userId: number, n: string, parts: string[], colors: number[]) {
  return tx.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id)
           SELECT $1, $2, p, f FROM unnest($3::text[], $4::int[]) AS x(p, f) ON CONFLICT DO NOTHING`,
    [userId, n, parts, colors],
  );
}

function removeForeignSetParts(tx: DbInterface, userId: number, n: string, parts: string[], colors: number[]) {
  return tx.run(
    `DELETE FROM parts WHERE user_id=$1 AND set_number=$2 AND source='set'
              AND (part_number, color_id) NOT IN (SELECT * FROM unnest($3::text[], $4::int[]))`,
    [userId, n, parts, colors],
  );
}

export async function enterSetMinifigs(tx: DbInterface, userId: number, setNumber: string, numbers: string[]) {
  await addSetMinifigsOne(tx, userId, setNumber, numbers);
  await removeForeignSetMinifigs(tx, userId, setNumber, numbers);
}

export async function enterSetParts(tx: DbInterface, userId: number, n: string, parts: string[], colors: number[]) {
  await addSetPartsOne(tx, userId, n, parts, colors);
  await removeForeignSetParts(tx, userId, n, parts, colors);
}
