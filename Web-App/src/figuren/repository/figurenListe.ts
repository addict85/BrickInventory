import { blJoin, blNummerSql } from '../../../db/blZuordnungSql';
import { mengeAus, mengeJoin, teilmengeAus, teilmengeJoin } from '../../../db/bestandsmenge';
import * as db from '../../../db/database';
import { figurSichtJoin, FIGUR } from '../../../db/katalogSicht';
import { LIKE_ESCAPE as E, enthaeltMuster } from '../../../db/likeSuche';

// Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#figurensuche
function figurenSuche(nummer: string, name: string, pi: number) {
  return `(${nummer} ILIKE $${pi}${E} OR ${name} ILIKE $${pi}${E})`;
}

/** Gezählt werden die Gruppen, sonst zählte eine Figur aus fünf Sets fünfmal. */
export async function figurenGruppiert(uids: number[], f: { search?: string | null; source?: string | null; setNumber: string | null;
  seite: { groesse: number; versatz: number } | null }) {
  const { search, source } = f;
  const params: any[] = [uids]; let pi = 2;
  let where = 'm.user_id = ANY($1)';
  if (f.setNumber) {
    where += ` AND m.set_number = $${pi++}`;
    params.push(f.setNumber);
  }
  if (source === 'set')    where += " AND m.source = 'set'";
  if (source === 'manual') where += " AND m.source = 'manual'";
  if (search) {
    // Der Figurenname steht im Katalog; figurSichtJoin hängt an jeder Abfrage,
    // die diese Bedingung benutzt.
    where += ` AND ${figurenSuche('m.fig_number', FIGUR.name, pi)}`;
    params.push(enthaeltMuster(search)); pi++;
  }
  const figParams = [...params];
  let figLimit = '';
  if (f.seite) {
    figParams.push(f.seite.groesse, f.seite.versatz);
    figLimit = ` LIMIT $${figParams.length - 1} OFFSET $${figParams.length}`;
  }
  // Die Zählung braucht keinen Join auf sets.
  const figCount = f.seite
    ? await db.get(`SELECT COUNT(*)::int AS c FROM (
         SELECT 1 FROM minifigs m
         ${figurSichtJoin('m.user_id', 'm.fig_number')}
         WHERE ${where} GROUP BY LOWER(TRIM(m.fig_number)), m.source) g`, params)
    : null;

  const figs = await db.all(`
    SELECT MIN(m.id) AS id,
           -- Besitzer der GRUPPE. Die Zeile fasst dieselbe Figur ueber alle
           -- Konten des Haushalts zusammen, hat also keine einzelne user_id
           -- mehr — genau wie die Galerie-Kachel (owner_ids in
           -- handlers/sets.ts). Ohne dieses Aggregat blieb die
           -- Besitzer-Plakette leer, obwohl beide Clients sie zeichnen:
           -- ownerBadges(f) in public/js/06-minifigs.js und OwnerBadges in
           -- MinifigsScreen.kt. NACHGEMESSEN im Haushalt: Galerie JA,
           -- manuelle Figuren JA, Set-Figuren nein.
           array_agg(DISTINCT m.user_id) AS owner_ids,
           MIN(TRIM(m.fig_number)) AS fig_number,
           -- MAX, weil die Gruppe mehrere Schreibweisen derselben Nummer zusammenfasst.
           MAX(${FIGUR.name}) AS fig_name,
           -- Die Stückzahl der Bestandszeile (Migration 0038): manuell die
           -- Summe der Erfassungen, aus einem Set die Katalogzahl. Hier
           -- stand m.quantity.
           SUM(${teilmengeAus('m', 'fig')})::int AS quantity,
           MAX(${FIGUR.bild}) AS image_url,
           MAX(${FIGUR.bildDatei}) AS image_local,
           m.source,
           -- Preis aus der neuesten Erfassung. Hier stand
           -- MAX(m.unit_price) — eine Abschrift an der Bestandszeile, die
           -- Migration 0035 geloescht hat. MAX ueber die Gruppe bleibt, weil
           -- sie mehrere Schreibweisen derselben Figurennummer zusammenfasst.
           --
           -- stored_condition ist mitentfallen: Den gespeicherten Zustand
           -- gibt es nicht mehr, und fuer Set-Figuren stand er seit jeher auf
           -- dem Vorgabewert 'N'.
           MAX(neu.unit_price) AS unit_price,
           MIN(m.set_number) AS set_number,
           -- Die Set-Menge als Faktor, aus den Erfassungen (Migration 0036
           -- hat sets.quantity geloescht). Der zweite Parameter 1 steht fuer
           -- „keine Erfassung", weil der Wert in einer
           -- MULTIPLIKATION steht: eine manuell erfasste Figur zaehlt einfach.
           SUM(${teilmengeAus('m', 'fig')} * ${mengeAus('sm', 1)})::int AS total_quantity,
           STRING_AGG(DISTINCT m.set_number, ',') FILTER (WHERE m.set_number IS NOT NULL) AS in_sets,
           -- Lagerort der GRUPPE, wortgleich zu handlers/parts.ts: Dieselbe
           -- Figur steckt in mehreren Sets und damit in mehreren Zeilen. Liegen
           -- die an verschiedenen Orten, sollen beide dastehen statt einer
           -- willkuerlich gewaehlt zu werden; NULLIF macht aus dem leeren
           -- Ergebnis wieder NULL, also „nicht erfasst".
           NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage,
           MAX(s.added_at) AS set_added_at
    FROM minifigs m
    ${mengeJoin('m')}
    ${teilmengeJoin('m', 'fig')}
    -- Die sets-Zeile bleibt verbunden — aber nur noch fuer added_at („seit
    -- wann haelt dieses Konto das Set?"). Keine Gegenstriche um den
    -- Spaltennamen: Der Kommentar steht in einem Template-Literal, und ein
    -- Gegenstrich beendet es (gemessen, tsc meldete „',' expected").
    -- Die MENGE kommt aus mengeJoin()
    -- darueber; sie stand bis Migration 0036 in derselben Zeile, und genau
    -- deshalb war beim Entfernen der Spalte nicht zu sehen, dass dieser JOIN
    -- noch eine zweite Aufgabe hat. GEMESSEN: „missing FROM-clause entry for
    -- table s" in vier Testdateien.
    LEFT JOIN sets s ON s.user_id = m.user_id AND s.set_number = m.set_number
    -- Der Name aus dem Vorrat (Migration 0031: die Zeile traegt eine ID).
    -- LEFT JOIN, damit eine Figur ohne Ort nicht aus der Liste faellt.
    LEFT JOIN storage_locations lo ON lo.id = m.storage_id
    -- Über den Primärschlüssel, also höchstens eine Zeile je Treffer.
    ${figurSichtJoin('m.user_id', 'm.fig_number')}
    -- Die neueste Erfassung je Figur — dieselbe Ordnung wie latestSql in
    -- routes/api_v1/acquisitions.ts, damit „neuester Preis" und „neueste
    -- Erfassung" dasselbe heissen.
    LEFT JOIN LATERAL (
      SELECT a.unit_price
        FROM minifig_acquisitions a
       WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ) neu ON TRUE
    WHERE ${where}
    -- LOWER(TRIM(...)): Import-Pfade (Rebrickable-API vs. CSV-Katalog) können
    -- dieselbe Figurennummer mit Whitespace-/Case-Varianten liefern — die
    -- würden die Gruppierung sonst unsichtbar aushebeln.
    GROUP BY LOWER(TRIM(m.fig_number)), m.source
    ORDER BY MAX(${FIGUR.name}) ASC, LOWER(TRIM(m.fig_number)) ASC${figLimit}`, figParams);
  return { figCount, figs };
}

export async function manuelleFigurenListe(uids: number[], search: string | null | undefined, seite: { groesse: number; versatz: number } | null) {
  const params: any[] = [uids];
  // Platzhalter vor LIMIT/OFFSET.
  let suche = '';
  if (search) {
    params.push(enthaeltMuster(search));
    suche = ` AND ${figurenSuche('m.fig_number', FIGUR.name, params.length)}`;
  }
  let limit = '';
  if (seite) {
    params.push(seite.groesse, seite.versatz);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const figs = await db.all(
    // Name und Bild: geprüft aus dem Katalog, sonst die eigene Angabe des Kontos.
    // Ausführlich: docs/begruendungen/src/figuren/abfragen.ts.md#getmanualminifigs
    `SELECT m.id, m.user_id, m.set_number, m.fig_number,
            -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
            -- stand m.bl_fig_number, eine Abschrift je Konto. Der Feldname
            -- nach aussen bleibt.
            ${blNummerSql('m.fig_number', 'blz')} AS bl_fig_number,
            -- Die Stückzahl aus den Erfassungen (Migration 0038); hier stand
            -- m.quantity. Diese Liste zeigt nur manuelle Figuren.
            ${teilmengeAus('m', 'fig')} AS quantity,
            m.source, m.storage_id,
            -- Preis und Zustand aus der NEUESTEN Erfassung (Migration 0035).
            -- Die beiden Bedeutungen bleiben unterschieden, so wie
            -- src/finanzen/preisRegel.ts sie ausschreibt: unit_price ist der
            -- eingegebene Preis und darf leer sein, purchase_price ist der
            -- ANZEIGEWERT und ist nie leer.
            neu.unit_price,
            COALESCE(neu.unit_price, 0) AS purchase_price,
            COALESCE(neu.condition, 'N') AS condition,
            ${FIGUR.name} AS fig_name, ${FIGUR.bild} AS image_url, ${FIGUR.bildDatei} AS image_local,
            lo.name AS storage
       FROM minifigs m
       ${teilmengeJoin('m', 'fig')}
       ${blJoin('m.fig_number', 'fig')}
       ${figurSichtJoin('m.user_id', 'm.fig_number')}
       LEFT JOIN storage_locations lo ON lo.id = m.storage_id
       LEFT JOIN LATERAL (
         SELECT a.unit_price, a.condition
           FROM minifig_acquisitions a
          WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 1
       ) neu ON TRUE
      WHERE m.user_id = ANY($1) AND m.source = 'manual'${suche}
      ORDER BY ${FIGUR.name} ASC, m.fig_number ASC${limit}`,
    params);
  return figs;
}

export function zustandszahlenManuellerFiguren(uids: number[]) {
  return db.all(`SELECT LOWER(TRIM(a.fig_number)) AS fkey,
            COUNT(*)::int AS acq_count,
            COUNT(*) FILTER (WHERE a.condition = 'U')::int AS used_count
     FROM minifig_acquisitions a
     WHERE a.user_id = ANY($1)
     GROUP BY LOWER(TRIM(a.fig_number))`, [uids]);
}

export function figurenKennzahlen(uids: number[]) {
  return db.get(`
    SELECT COUNT(*)::int AS types,
           COALESCE(SUM(g.menge), 0)::int AS total_quantity,
           COUNT(*) FILTER (WHERE g.source = 'manual')::int AS manual
      FROM (
        SELECT m.source, SUM(${teilmengeAus('m', 'fig')} * ${mengeAus('sm', 1)}) AS menge
          FROM minifigs m
          ${mengeJoin('m', 'sm', '= ANY($1)')}
          ${teilmengeJoin('m', 'fig')}
         WHERE m.user_id = ANY($1)
         GROUP BY LOWER(TRIM(m.fig_number)), m.source
      ) g`, [uids]);
}
