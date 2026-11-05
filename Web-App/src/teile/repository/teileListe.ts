import * as db from '../../../db/database';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../../../db/bestandsmenge';
import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';
import { teilSichtJoin, TEIL } from '../../../db/katalogSicht';
import { LIKE_ESCAPE as E, enthaeltMuster } from '../../../db/likeSuche';

/** Beide Wege (Zusammenfassung und live) liefern dieselbe Form, damit die
 * Oberflächen nicht wissen müssen, woher die Zeilen kommen. */

export interface TeileFilter {
  color?: string | null; category?: string | number | null; search?: string | null;
  spare?: '0' | '1' | null; set_number?: string | null; storage?: string | null; ohneManuelle?: boolean;
}

export type TeileOrdnung = 'farbe' | 'name' | 'menge';
/** Feste Liste, weil der Wert als SQL in die Anfrage geht. */
export function teileOrdnung(wert: unknown): TeileOrdnung {
  return wert === 'name' || wert === 'menge' ? wert : 'farbe';
}
/** Der letzte Schlüssel macht die Seiten stabil. */
function ordnungSql(o: TeileOrdnung, sp: { farbe: string; name: string; menge: string; nummer: string }): string {
  if (o === 'name')  return `${sp.name} ASC, ${sp.farbe} ASC, ${sp.nummer} ASC`;
  if (o === 'menge') return `${sp.menge} DESC, ${sp.name} ASC, ${sp.nummer} ASC`;
  return `${sp.farbe} ASC, ${sp.name} ASC`;
}

/** `pi` ist der Platzhalter für `%text%`. */
function teileSuche(nummer: string, name: string, blNummer: string, pi: number) {
  return `(${nummer} ILIKE $${pi}${E} OR ${name} ILIKE $${pi}${E} OR ${blNummer} ILIKE $${pi}${E})`;
}

export interface TeilZeile {
  part_number: string; bl_part_number: string; part_name: string | null; color_id: number;
  color_name: string | null; color_hex: string | null; category_name: string | null;
  image_url: string | null; image_local: string | null; is_spare: boolean;
  total_quantity: number; storage: string | null; in_sets?: string | null;
}

export interface Seite { groesse: number; versatz: number; mitSets: boolean; ordnung: TeileOrdnung }

export function farbenDesBestands(uids: number[], ausZusammenfassung: boolean) {
  type Farbe = { color_name: string | null; color_hex: string | null; unique_parts: number; total_quantity: number };
  if (ausZusammenfassung) return db.all<Farbe>(`
      SELECT ps.color_name, COALESCE(ps.color_hex, rc.rgb) AS color_hex,
             -- DISTINCT über part_key: Im Haushalt steht dasselbe Teil je Konto einmal.
             COUNT(DISTINCT ps.part_key)::int AS unique_parts,
             SUM(ps.total_quantity)::int      AS total_quantity
      FROM parts_summary ps
      LEFT JOIN rb_colors rc ON rc.id = ps.color_id
      WHERE ps.user_id = ANY($1)
      GROUP BY ps.color_name, COALESCE(ps.color_hex, rc.rgb)
      ORDER BY total_quantity DESC`, [uids]);
  return db.all<Farbe>(`
    SELECT ${TEIL.farbname} AS color_name, COALESCE(${TEIL.farbcode}, rc.rgb) AS color_hex,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int AS total_quantity
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part')}
    ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
    LEFT JOIN rb_colors rc ON rc.id = p.color_id
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    GROUP BY 1, 2 ORDER BY total_quantity DESC`, [uids]);
}

export async function seiteAusZusammenfassung(uids: number[], f: TeileFilter, s: Seite) {
  const cond: string[] = ['user_id = ANY($1)'];
  const params: unknown[] = [uids];
  // Der Filter schickt den Farbnamen, nicht die ID — wie im Live-Pfad.
  if (f.color) { cond.push(`color_name = $${params.length + 1}`); params.push(f.color); }
  if (f.category) {
    // Die eigene Kategorie, sonst die aus rb_parts. IN statt EXISTS: Die
    // Unterabfrage hängt nicht an der Zeile und wird einmal als Hashtabelle gebaut.
    const pi = params.length + 1;
    cond.push(`(category_name = $${pi} OR part_number IN (SELECT rp.part_num FROM rb_parts rp
                 WHERE rp.part_cat_id::text = $${pi}))`);
    params.push(String(f.category));
  }
  if (f.spare === '0' || f.spare === '1') {
    cond.push(`is_spare = $${params.length + 1}`); params.push(f.spare === '1');
  }
  if (f.search) {
    cond.push(teileSuche('part_number', 'part_name', 'bl_part_number', params.length + 1));
    params.push(enthaeltMuster(f.search));
  }
  const where = cond.join(' AND ');
  const multi = uids.length > 1;
  const cols = multi
    ? `MIN(part_number) AS part_number, MIN(bl_part_number) AS bl_part_number, color_id,
       MIN(part_name) AS part_name, MIN(color_name) AS color_name, MIN(color_hex) AS color_hex,
       MIN(category_name) AS category_name, MIN(image_url) AS image_url,
       MIN(image_local) AS image_local, bool_or(is_spare) AS is_spare,
       SUM(total_quantity)::int AS total_quantity,
       NULLIF(STRING_AGG(DISTINCT storage, ', '), '') AS storage` +
      (s.mitSets ? ", STRING_AGG(DISTINCT in_sets, ',') AS in_sets" : '')
    : `part_number, bl_part_number, color_id, part_name, color_name, color_hex,
       category_name, image_url, image_local, is_spare, total_quantity::int, storage` +
      (s.mitSets ? ', in_sets' : '');
  const groupSql = multi ? ' GROUP BY part_key, color_id' : '';
  const orderSql = ordnungSql(s.ordnung, multi
    ? { farbe: 'MIN(color_name)', name: 'MIN(part_name)', menge: 'SUM(total_quantity)', nummer: 'part_key, color_id' }
    : { farbe: 'color_name', name: 'part_name', menge: 'total_quantity', nummer: 'part_key, color_id' });
  const [anzahl, zeilen] = await Promise.all([
    multi
      ? db.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM (
                  SELECT 1 FROM parts_summary WHERE ${where} GROUP BY part_key, color_id
                ) t`, params)
      : db.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM parts_summary WHERE ${where}`, params),
    db.all<TeilZeile>(`SELECT ${cols} FROM parts_summary WHERE ${where}${groupSql}
            ORDER BY ${orderSql} LIMIT ${Number(s.groesse)} OFFSET ${Number(s.versatz)}`, params),
  ]);
  return { total: anzahl?.c ?? 0, zeilen };
}

function teileWo(uids: number[], f: TeileFilter) {
  let where = 'p.user_id = ANY($1)';
  const params: unknown[] = [uids];
  let pi = 2;
  if (f.set_number) { where += ` AND p.set_number = $${pi++}`; params.push(f.set_number); }
  // Farbe, Kategorie und Name stehen in den Katalogen (pc/pcc), das
  // Ersatzteilkennzeichen in der Setliste (tm_k aus teilmengeJoin).
  if (f.color) { where += ` AND ${TEIL.farbname} = $${pi++}`; params.push(f.color); }
  // Kategorie auch über rb_parts: Die Set-Teile-Antwort von Rebrickable
  // liefert oft keine, die Filterliste zeigt deshalb die aufgelöste ID.
  if (f.category) {
    where += ` AND (${TEIL.kategorie} = $${pi}
                    OR EXISTS (SELECT 1 FROM rb_parts rp
                                WHERE rp.part_num = p.part_number
                                  AND rp.part_cat_id::text = $${pi}))`;
    pi++; params.push(f.category);
  }
  // Ersatzteil ist eine Eigenschaft der Setliste; ohne Zeile dort keines.
  if (f.spare === '0') where += ' AND NOT COALESCE(tm_k.is_spare, false)';
  if (f.spare === '1') where += ' AND COALESCE(tm_k.is_spare, false)';
  if (f.ohneManuelle) where += " AND COALESCE(p.source,'set') <> 'manual'";
  if (f.search) {
    where += ` AND ${teileSuche('p.part_number', TEIL.name, blNummerSql('p.part_number'), pi)}`;
    params.push(enthaeltMuster(f.search)); pi++;
  }
  // Lagerort als eigener Filter über den Namen aus dem Vorrat (lo).
  if (f.storage) { where += ` AND lo.name = $${pi++}`; params.push(String(f.storage)); }
  return { where, params, pi };
}

/** Mit Setfilter ohne Set-Menge, denn dort geht es um die Teile EINES Sets.
 * Ausführlich: docs/begruendungen/src/teile/repository/teileListe.ts.md#getparts-joinclause */
export async function seiteLive(uids: number[], f: TeileFilter, s: Seite) {
  const { where, params, pi } = teileWo(uids, f);
  // ::int: Der JSON-Typ von total_quantity darf nicht vom Zweig abhängen.
  const qtyExpr = f.set_number
    ? `SUM(${teilmengeAus('p', 'part')})::int`
    : `SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int`;
  const joinClause = (f.set_number ? 'FROM parts p' : `FROM parts p ${mengeJoin('p')}`)
    + ` ${teilmengeJoin('p', 'part', 'tm', '= ANY($1)')}`
    + ` ${blJoin('p.part_number', 'part', 'p.user_id')}`
    + ' LEFT JOIN storage_locations lo ON lo.id = p.storage_id'
    + ` ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}`;
  // Dieselben Joins wie die Hauptabfrage: Jeder hängt am Primärschlüssel und ändert die Zahl nicht.
  const countSql = `SELECT COUNT(*)::int AS c FROM (
       SELECT 1 ${joinClause} WHERE ${where}
       GROUP BY ${blNummerSql('p.part_number')}, p.color_id
     ) g`;
  const partsSql = `
    SELECT
      ${blNummerSql('p.part_number')} AS part_number,
      ${blNummerSql('p.part_number')} AS bl_part_number,
      -- Die Gruppe fasst mehrere Rebrickable-Nummern derselben BrickLink-Nummer zusammen.
      MIN(${TEIL.name})      AS part_name,
      p.color_id,
      MIN(${TEIL.farbname})  AS color_name,
      MIN(${TEIL.farbcode})  AS color_hex,
      MIN(${TEIL.kategorie}) AS category_name,
      MIN(${TEIL.bild})      AS image_url,
      MIN(${TEIL.bildDatei}) AS image_local,
      bool_or(COALESCE(tm_k.is_spare, false)) AS is_spare,
      -- Alle Lagerorte: Dasselbe Teil liegt aus verschiedenen Sets in verschiedenen Kisten.
      NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage,
      ${qtyExpr}          AS total_quantity${s.mitSets ? `,
      STRING_AGG(DISTINCT p.set_number, ',') AS in_sets` : ''}
    ${joinClause}
    WHERE ${where}
    GROUP BY ${blNummerSql('p.part_number')}, p.color_id
    ORDER BY ${ordnungSql(s.ordnung, { farbe: `MIN(${TEIL.farbname})`, name: `MIN(${TEIL.name})`,
      menge: qtyExpr, nummer: `${blNummerSql('p.part_number')}, p.color_id` })} LIMIT $${pi} OFFSET $${pi + 1}`;
  const [anzahl, zeilen] = await Promise.all([
    db.get<{ c: number }>(countSql, params),
    db.all<TeilZeile>(partsSql, [...params, s.groesse, s.versatz]),
  ]);
  return { total: anzahl?.c ?? 0, zeilen };
}

export function gebrauchteManuelle(uids: number[]) {
  return db.all<{ pid: string; color_id: number; any_used: number }>(
    `SELECT ${blNummerSql('p.part_number')} AS pid, p.color_id,
            MAX(CASE WHEN pa.condition='U' THEN 1 ELSE 0 END) AS any_used
     FROM parts p
     ${blJoin('p.part_number', 'part', 'p.user_id')}
     JOIN part_acquisitions pa ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
     WHERE p.user_id = ANY($1) AND p.source='manual'
     GROUP BY ${blNummerSql('p.part_number')}, p.color_id`, [uids]);
}

export async function hatUngeseheneBlNummer(uids: number[]): Promise<boolean> {
  return !!(await db.get(
    `SELECT 1 FROM parts p
     LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = p.part_number
     WHERE p.user_id = ANY($1) AND m.rb_id IS NULL LIMIT 1`, [uids]));
}

export function inventarAlsTeile(inventarId: number, setNumber: string) {
  return db.all<TeilZeile>(`
        SELECT ip.part_num AS part_number,
               COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
               p.name AS part_name, ip.color_id,
               c.name AS color_name, c.rgb AS color_hex,
               NULL AS category_name,
               p.part_img_url AS image_url, NULL AS image_local,
               ip.is_spare,
               ip.quantity AS total_quantity,
               $2 AS in_sets
        FROM rb_inventory_parts ip
        LEFT JOIN rb_parts p ON p.part_num = ip.part_num
        LEFT JOIN rb_colors c ON c.id = ip.color_id
        LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
        WHERE ip.inventory_id = $1`, [inventarId, setNumber]);
}

export function kategorien(uids: number[], ausZusammenfassung: boolean) {
  type Kategorie = { category_name: string | null; label: string | null; unique_parts: number; total_quantity: number };
  const kategorie = (spalte: string, nummer: string) => `
      LEFT JOIN rb_part_categories rc
             ON rc.id = (CASE WHEN ${spalte} ~ '^[0-9]+$' THEN ${spalte}::int ELSE NULL END)
      LEFT JOIN rb_parts rp ON rp.part_num = ${nummer}
      LEFT JOIN rb_part_categories rp_cat ON rp_cat.id = rp.part_cat_id`;
  // Ohne Katalog bleibt ein eingetragener Name („Bricks“); was keinen hat, steht als EIN Eintrag ohne Namen da.
  const name = (k: string) => `COALESCE(rc.name, rp_cat.name, CASE WHEN ${k} ~ '^[0-9]+$' THEN NULL ELSE NULLIF(${k}, '') END)`;
  const schluessel = (k: string) => `CASE WHEN ${name(k)} IS NULL THEN NULL ELSE COALESCE(rc.id::text, rp_cat.id::text, ${k}) END`;
  const gruppe = 'GROUP BY 1, 2 ORDER BY total_quantity DESC';
  if (ausZusammenfassung) return db.all<Kategorie>(`
      SELECT ${schluessel('ps.category_name')}                         AS category_name,
             ${name('ps.category_name')}                                AS label,
             COUNT(DISTINCT ps.part_key)::int AS unique_parts,
             SUM(ps.total_quantity)::int      AS total_quantity
        FROM parts_summary ps
        ${kategorie('ps.category_name', 'ps.part_number')}
       WHERE ps.user_id = ANY($1)
      ${gruppe}`, [uids]);
  return db.all<Kategorie>(`
    SELECT ${schluessel(TEIL.kategorie)}                             AS category_name,
           ${name(TEIL.kategorie)}                                    AS label,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int AS total_quantity
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part', 'tm', '= ANY($1)')}
    ${teilSichtJoin('p.user_id', 'p.part_number', 'p.color_id')}
    ${kategorie(TEIL.kategorie, 'p.part_number')}
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    ${gruppe}`, [uids]);
}

export async function kennzahlen(uids: number[], ausZusammenfassung: boolean) {
  type Roh = { unique_parts: string | number | null; unique_colors: string | number | null; total_parts: string | number | null };
  // Sorten und Farben zählen Set-Teile UND einzeln erfasste Teile, denn die
  // Liste darunter zeigt beide. Die Gesamtzahl bleibt ohne einzelne Teile;
  // die kommen als manual_parts dazu (Aufschlüsselung in der Kachel).
  const r = ausZusammenfassung
    ? await db.get<Roh>(`
      WITH arten AS (
        SELECT part_number, color_id FROM parts_summary WHERE user_id = ANY($1)
        UNION
        SELECT part_number, color_id FROM parts WHERE user_id = ANY($1) AND source = 'manual')
      SELECT (SELECT COUNT(DISTINCT part_number) FROM arten)::int AS unique_parts,
             (SELECT COUNT(DISTINCT color_id) FROM arten)::int    AS unique_colors,
             (SELECT COALESCE(SUM(total_quantity), 0) FROM parts_summary WHERE user_id = ANY($1)) AS total_parts`, [uids])
    : await db.get<Roh>(`
    SELECT COUNT(DISTINCT p.part_number) AS unique_parts,
           COUNT(DISTINCT p.color_id)    AS unique_colors,
           SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})
             FILTER (WHERE COALESCE(p.source, 'set') <> 'manual') AS total_parts
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part')}
    WHERE p.user_id = ANY($1)`, [uids]);
  if (!r) return null;
  // Einzeln erfasste Teile stehen nicht in der Zusammenfassung; die Oberfläche
  // zählt sie zur Gesamtzahl, damit Sammlung und Teile-Reiter dieselbe zeigen.
  const einzeln = await db.get<{ t: string | number | null }>(`
    SELECT SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}) AS t
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part')}
    WHERE p.user_id = ANY($1) AND p.source = 'manual'`, [uids]);
  const zahl = (v: string | number | null) => parseInt(String(v ?? 0)) || 0;
  return { unique_parts: zahl(r.unique_parts), unique_colors: zahl(r.unique_colors), total_parts: zahl(r.total_parts),
           manual_parts: zahl(einzeln?.t ?? null) };
}

export interface ManuellesTeil {
  id: number; user_id: number; part_number: string; bl_part_number: string; part_name: string | null;
  color_id: number; color_name: string | null; color_hex: string | null; category_name: string | null;
  quantity: number; image_url: string | null; image_local: string | null; unit_price: string | null;
  purchase_price: string; source: string; condition: string; storage: string | null; created_at: Date;
}

export function manuelleTeile(uids: number[], f: { search?: string | null; storage?: string | null },
                              seite: { groesse: number; versatz: number } | null) {
  const params: unknown[] = [uids];
  let filter = '';
  if (f.search) {
    params.push(enthaeltMuster(f.search));
    filter = ` AND ${teileSuche('t.part_number', TEIL.name, blNummerSql('t.part_number'), params.length)}`;
  }
  if (f.storage) { params.push(String(f.storage)); filter += ` AND lo.name = $${params.length}`; }
  let limit = '';
  if (seite) {
    params.push(seite.groesse, seite.versatz);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  return db.all<ManuellesTeil>(`
    SELECT t.id, t.user_id, t.part_number,
           ${blNummerSql('t.part_number')} AS bl_part_number,
           ${TEIL.name} AS part_name, t.color_id,
           ${TEIL.farbname} AS color_name, ${TEIL.farbcode} AS color_hex,
           ${TEIL.kategorie} AS category_name,
           ${teilmengeAus('t', 'part')} AS quantity,
           ${TEIL.bild} AS image_url, ${TEIL.bildDatei} AS image_local,
           -- unit_price ist der eingegebene Preis und darf leer sein, purchase_price
           -- der Anzeigewert (0 heisst „nichts bekannt“), siehe src/finanzen/preisRegel.ts.
           neu.unit_price,
           COALESCE(neu.unit_price, 0) AS purchase_price,
           t.source,
           COALESCE(neu.condition, 'N') AS condition,
           lo.name AS storage,
           -- Der Name nach aussen bleibt, damit Oberflächen und App unverändert lesen.
           t.added_at AS created_at
    FROM parts t
    ${teilmengeJoin('t', 'part')}
    ${blJoin('t.part_number', 'part', 't.user_id')}
    ${teilSichtJoin('t.user_id', 't.part_number', 't.color_id')}
    LEFT JOIN storage_locations lo ON lo.id = t.storage_id
    -- Die neueste Erfassung: dieselbe Ordnung wie überall, sonst hätten
    -- „neuester Preis“ und „neueste Erfassung“ zwei Bedeutungen.
    LEFT JOIN LATERAL (
      SELECT a.unit_price, a.condition
        FROM part_acquisitions a
       WHERE a.user_id = t.user_id AND a.part_number = t.part_number
         AND a.color_id = t.color_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ) neu ON TRUE
    WHERE t.user_id = ANY($1) AND t.source = 'manual'${filter}
    ORDER BY ${TEIL.name} ASC, t.part_number ASC${limit}`, params);
}

type Bestand = { gesamt: number; lose: number };

/** gesamt samt Set-Faktor, lose nur aus manuellen Erfassungen. */
export function besitzteTeile(uids: number[], nummern: string[], farbIds: number[]) {
  return db.all<Bestand & { part_number: string; color_id: number }>(
    `SELECT p.part_number,
            p.color_id,
            COALESCE(SUM(CASE WHEN COALESCE(p.source,'set') = 'manual'
                              THEN ${teilmengeAus('p', 'part')}
                              ELSE ${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}
                         END), 0)::int                                AS gesamt,
            COALESCE(SUM(CASE WHEN COALESCE(p.source,'set') = 'manual'
                              THEN ${teilmengeAus('p', 'part')} ELSE 0 END), 0)::int AS lose
       FROM parts p
       ${mengeJoin('p', 'sm', '= ANY($1)')}
       ${teilmengeJoin('p', 'part')}
       JOIN unnest($2::text[], $3::int[]) AS g(part_number, color_id)
         ON g.part_number = p.part_number AND g.color_id = p.color_id
      WHERE p.user_id = ANY($1)
      GROUP BY p.part_number, p.color_id`, [uids, nummern, farbIds]);
}

export function besitzteFiguren(uids: number[], nummern: string[]) {
  return db.all<Bestand & { part_number: string }>(
    `SELECT m.fig_number                                                AS part_number,
            COALESCE(SUM(CASE WHEN COALESCE(m.source,'set') = 'manual'
                              THEN ${teilmengeAus('m', 'fig')}
                              ELSE ${teilmengeAus('m', 'fig')} * ${mengeAus('sm', 1)}
                         END), 0)::int                                  AS gesamt,
            COALESCE(SUM(CASE WHEN COALESCE(m.source,'set') = 'manual'
                              THEN ${teilmengeAus('m', 'fig')} ELSE 0 END), 0)::int AS lose
       FROM minifigs m
       ${mengeJoin('m', 'sm', '= ANY($1)')}
       ${teilmengeJoin('m', 'fig')}
       JOIN unnest($2::text[]) AS g(fig_number)
         ON g.fig_number = m.fig_number
      WHERE m.user_id = ANY($1)
      GROUP BY m.fig_number`, [uids, nummern]);
}
