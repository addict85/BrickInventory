import type { DbSchnittstelle } from '../../../db/database';
import { inKontowaehrung, kontowaehrungJoin, teilmengeAus, teilmengeJoin } from '../../../db/bestandsmenge';
import { teilSichtJoin, figurSichtJoin, setStammJoin, TEIL, FIGUR, SET } from '../../../db/katalogSicht';

/** Kaufpreis mengengewichtet in Kontowährung. */
export function erfassungsKennzahlen(db: DbSchnittstelle, art: 'part' | 'fig', uids: number[]) {
  return db.all<{ part_number?: string; color_id?: number | null; fig_number?: string;
                  acq_count: string; used_count: string; avg_purchase_price: number | null }>(art === 'part'
    ? `SELECT part_number, color_id,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('part_acquisitions')})::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('part_acquisitions')}), 0) AS avg_purchase_price
           FROM part_acquisitions ${kontowaehrungJoin('part_acquisitions')}
          WHERE part_acquisitions.user_id = ANY($1)
          GROUP BY part_number, color_id`
    : `SELECT fig_number,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('minifig_acquisitions')})::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL AND ${inKontowaehrung('minifig_acquisitions')}), 0) AS avg_purchase_price
           FROM minifig_acquisitions ${kontowaehrungJoin('minifig_acquisitions')}
          WHERE minifig_acquisitions.user_id = ANY($1)
          GROUP BY fig_number`, [uids]);
}

/** Spalten, über die gesucht werden darf. Siehe verwendendeSets(). */
const SUCHSPALTEN = new Set(['part_number', 'color_id', 'fig_number']);

/** Figuren haben weder Farbe noch Kategorie; feste NULL, damit beide Zweige
 * dieselbe Form liefern. */
const KOPFFELDER = {
  parts: `x.part_number AS nummer, MAX(${TEIL.name}) AS name,
          MAX(x.color_id) AS color_id, MAX(${TEIL.farbname}) AS color_name,
          MAX(${TEIL.farbcode}) AS color_hex, MAX(${TEIL.kategorie}) AS category_name,
          MAX(${TEIL.bildDatei}) AS teil_image_local, MAX(${TEIL.bild}) AS teil_image_url,
          bool_or(COALESCE(spc.is_spare, false)) AS is_spare,
          NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage`,
  minifigs: `x.fig_number AS nummer, MAX(${FIGUR.name}) AS name,
          NULL::int AS color_id, NULL::text AS color_name,
          NULL::text AS color_hex, NULL::text AS category_name,
          MAX(${FIGUR.bildDatei}) AS teil_image_local, MAX(${FIGUR.bild}) AS teil_image_url,
          false AS is_spare, NULL::text AS storage`,
} as const;

// Seit 0034 steht die Beschreibung im Katalog; JOINs über den Primärschlüssel ändern die Gruppierung nicht.
const KATALOGJOIN = {
  parts: `${teilSichtJoin('x.user_id', 'x.part_number', 'x.color_id')}
          LEFT JOIN set_teile spc ON spc.set_number  = x.set_number
                                         AND spc.part_number = x.part_number
                                         AND spc.color_id    = x.color_id`,
  minifigs: figurSichtJoin('x.user_id', 'x.fig_number'),
} as const;

const SCHLUESSELSPALTE = { parts: 'x.part_number', minifigs: 'x.fig_number' } as const;

const ART = { parts: 'part', minifigs: 'fig' } as const;

/** Ein Set, das den Bestandteil enthält, mit den Kopffeldern des Bestandteils. */
export interface VerwendungsZeile {
  set_number: string; owner_user_id: number; quantity: number; set_name: string | null;
  set_image_local: string | null; set_image_url: string | null; nummer: string; name: string | null;
  color_id: number | null; color_name: string | null; color_hex: string | null; category_name: string | null;
  teil_image_local: string | null; teil_image_url: string | null; is_spare: unknown; storage: string | null;
}

export async function setsMitBestandteil(db: DbSchnittstelle, uids: number[], tabelle: 'parts' | 'minifigs', schluessel: Record<string, string | number>) {
  const spalten = Object.keys(schluessel);
  // Die Namen kommen aus Literalen, die Schranke steht trotzdem: Ein Spaltenname
  // lässt sich nicht als Parameter binden.
  for (const sp of spalten) {
    if (!SUCHSPALTEN.has(sp)) throw new Error(`verwendendeSets: unerlaubte Spalte ${sp}`);
  }
  const params: (number[] | string | number | undefined)[] = [uids];
  const bedingungen = spalten.map(sp => `x.${sp} = $${params.push(schluessel[sp])}`);
  return db.all<VerwendungsZeile>(
    `SELECT x.set_number,
            x.user_id            AS owner_user_id,
            -- Die Stückzahl der Bestandszeile (Migration 0038): Fuer ein
            -- Set-Teil die Katalogzahl, fuer ein manuelles die Summe der
            -- Erfassungen. Hier stand SUM(x.quantity).
            --
            -- Die Art steht nicht im Alias: Diese Abfrage bedient BEIDE
            -- Tabellen ueber ${tabelle}, und der Helfer braucht dieselbe
            -- Unterscheidung — deshalb kommt sie wie KOPFFELDER aus einer
            -- Zuordnung je Tabelle.
            SUM(${teilmengeAus('x', ART[tabelle])})::int AS quantity,
            ${SET.name}          AS set_name,
            c.image_local        AS set_image_local,
            c.image_url          AS set_image_url,
            ${KOPFFELDER[tabelle]}
       FROM ${tabelle} x
       ${teilmengeJoin('x', ART[tabelle])}
       -- Zwei JOINs, ausgeschrieben: sets sagt, WELCHES Konto das Set haelt
       -- (deshalb ueber user_id UND set_number), set_catalog sagt, wie es
       -- heisst und wie es aussieht (nur ueber set_number — der Name haengt
       -- nicht am Konto). Keine Gegenstriche: Der Kommentar steht in einem
       -- Template-Literal, und ein Gegenstrich beendet es.
       LEFT JOIN sets s ON s.user_id = x.user_id AND s.set_number = x.set_number
       LEFT JOIN set_catalog c ON c.set_number = x.set_number
       ${setStammJoin('x.set_number')}
       -- Der Lagerortname aus dem Vorrat (Migration 0031). Steht hier und
       -- nicht nur im parts-Zweig von KOPFFELDER, weil der minifigs-Zweig ihn
       -- als feste NULL fuehrt — ein unbenutzter LEFT JOIN kostet dort nichts
       -- und haelt die Abfrage in EINER Form.
       LEFT JOIN storage_locations lo ON lo.id = x.storage_id
       ${KATALOGJOIN[tabelle]}
      WHERE x.user_id = ANY($1)
        AND x.set_number IS NOT NULL
        AND ${bedingungen.join(' AND ')}
      GROUP BY x.set_number, x.user_id, ${SCHLUESSELSPALTE[tabelle]},
               rs.name, c.image_local, c.image_url
      ORDER BY x.set_number`,
    params);
}

/** Mit dem Set gehen seine Teile und Figuren. */
export async function entferneSetInhalt(tx: DbSchnittstelle, uids: number[], setNumber: string): Promise<void> {
  await tx.run('DELETE FROM parts WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
  await tx.run('DELETE FROM minifigs WHERE user_id = ANY($1) AND set_number = $2', [uids, setNumber]);
}

/** Nur Schlüssel und Herkunft: Beschreibung und Stückzahl stehen im Katalog. */
export async function kopiereSetInhalt(tx: DbSchnittstelle, tabelle: 'parts' | 'minifigs', sn: string, von: number, nach: number): Promise<number> {
  const sql = {
    parts: `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
            SELECT $1, set_number, part_number, color_id, source FROM parts
             WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
    minifigs: `INSERT INTO minifigs (user_id, set_number, fig_number, source)
               SELECT $1, set_number, fig_number, source FROM minifigs
                WHERE user_id = $2 AND set_number = $3 AND COALESCE(source,'set') <> 'manual'`,
  }[tabelle];
  return (await tx.run(sql, [nach, von, sn])).changes ?? 0;
}

/** Ohne Menge: Sie entsteht aus der Erfassung, die gleich mitwandert. */
export async function legeManuellAn(tx: DbSchnittstelle, art: 'part' | 'fig', uid: number, schluessel: (string | number)[]): Promise<void> {
  if (art === 'part')
    await tx.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,$3,'manual')`, [uid, ...schluessel]);
  else
    await tx.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, ...schluessel]);
}

export function loescheTeilZeile(dbh: Pick<DbSchnittstelle, 'run'>, ownerId: number, partNumber: string, colorId: number) {
  return dbh.run("DELETE FROM parts WHERE user_id=$1 AND part_number=$2 AND color_id=$3 AND source='manual'",
    [ownerId, partNumber, colorId]);
}

export function loescheFigurZeile(dbh: Pick<DbSchnittstelle, 'run'>, ownerId: number, figNumber: string) {
  return dbh.run("DELETE FROM minifigs WHERE user_id=$1 AND fig_number=$2 AND source='manual'", [ownerId, figNumber]);
}
