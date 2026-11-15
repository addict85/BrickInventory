import type { DbSchnittstelle } from '../../../db/database';

/** Teile und Figuren eines Sets im Bestand des Kontos: vorhandene Zeilen behalten Lagerort
 * und Datum, was das Set nicht mehr enthält, geht. Der Katalog liefert die Nummern. */
function fuegeSetFigurenEin(tx: DbSchnittstelle, userId: number, setNumber: string, nummern: string[]) {
  return tx.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, source)
       SELECT $1, $2, f, 'set' FROM unnest($3::text[]) AS f ON CONFLICT DO NOTHING`,
    [userId, setNumber, nummern],
  );
}

function entferneFremdeSetFiguren(tx: DbSchnittstelle, userId: number, setNumber: string, nummern: string[]) {
  return tx.run(
    `DELETE FROM minifigs WHERE user_id=$1 AND set_number=$2 AND source='set' AND NOT (fig_number = ANY($3::text[]))`,
    [userId, setNumber, nummern],
  );
}

function fuegeSetTeileEin(tx: DbSchnittstelle, userId: number, n: string, teile: string[], farben: number[]) {
  return tx.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id)
           SELECT $1, $2, p, f FROM unnest($3::text[], $4::int[]) AS x(p, f) ON CONFLICT DO NOTHING`,
    [userId, n, teile, farben],
  );
}

function entferneFremdeSetTeile(tx: DbSchnittstelle, userId: number, n: string, teile: string[], farben: number[]) {
  return tx.run(
    `DELETE FROM parts WHERE user_id=$1 AND set_number=$2 AND source='set'
              AND (part_number, color_id) NOT IN (SELECT * FROM unnest($3::text[], $4::int[]))`,
    [userId, n, teile, farben],
  );
}

export async function setFigurenEintragen(tx: DbSchnittstelle, userId: number, setNumber: string, nummern: string[]) {
  await fuegeSetFigurenEin(tx, userId, setNumber, nummern);
  await entferneFremdeSetFiguren(tx, userId, setNumber, nummern);
}

export async function setTeileEintragen(
  tx: DbSchnittstelle,
  userId: number,
  n: string,
  teile: string[],
  farben: number[],
) {
  await fuegeSetTeileEin(tx, userId, n, teile, farben);
  await entferneFremdeSetTeile(tx, userId, n, teile, farben);
}
