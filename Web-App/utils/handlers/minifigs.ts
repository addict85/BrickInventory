import * as db from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { clampPageSize, applyManualCondition, withOwners } from './shared';
import { beideSchreibweisen } from '../setNummer';

/**
 * Leseabfragen für Minifiguren.
 *
 * ── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * — benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
 * zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
 * getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
 * geht in EINE Richtung, es entsteht also kein Kreis.
 */

/**
 * Filter lagen hier schon serverseitig; ergänzt sind nur page/page_size.
 * Ohne page_size unverändertes Verhalten — die Android-App ruft so auf.
 */
async function getMinifigs(userId: number | number[], { search, source, set_number, page = 1, page_size = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const params: any[] = [uids]; let pi = 2;
  let where = 'm.user_id = ANY($1)';
  if (set_number) {
    where += ` AND (m.set_number = $${pi} OR m.set_number = $${pi+1})`;
    params.push(...beideSchreibweisen(set_number)); pi += 2;
  }
  if (source === 'set')    where += " AND m.source = 'set'";
  if (source === 'manual') where += " AND m.source = 'manual'";
  if (search) {
    where += ` AND (LOWER(m.fig_number) LIKE $${pi} OR LOWER(m.fig_name) LIKE $${pi})`;
    params.push(`%${search.toLowerCase()}%`); pi++;
  }
  // Gruppierung pro Figur (und Quelle): Dieselbe Figur aus mehreren Sets
  // erscheint EINMAL mit aufsummierter Gesamtmenge — analog Teile/Sets.
  // Vorher wurde nach m.id gruppiert, wodurch jede Set-Zeile einzeln blieb
  // und identische Figuren mehrfach in der Übersicht auftauchten.
  // Zählen über dieselbe Gruppierung — COUNT(*) über die Gruppen, nicht über
  // die Zeilen, sonst zählt eine Figur aus fünf Sets fünfmal.
  const figParams = [...params];
  let figLimit = '';
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    const off  = (Math.max(1, parseInt(page) || 1) - 1) * size;
    figParams.push(size, off);
    figLimit = ` LIMIT $${figParams.length - 1} OFFSET $${figParams.length}`;
  }
  const figCount = page_size
    ? await db.get(`SELECT COUNT(*)::int AS c FROM (
         SELECT 1 FROM minifigs m
         LEFT JOIN sets s ON s.user_id = m.user_id AND s.set_number = m.set_number
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
           MAX(m.fig_name) AS fig_name,
           SUM(m.quantity) AS quantity,
           MAX(m.image_url) AS image_url,
           MAX(m.image_local) AS image_local,
           m.source,
           MAX(m.unit_price) AS unit_price,
           MAX(m.condition) AS stored_condition,
           MAX(m.note) AS note,
           MIN(m.set_number) AS set_number,
           SUM(m.quantity * COALESCE(s.quantity, 1)) AS total_quantity,
           STRING_AGG(DISTINCT m.set_number, ',') FILTER (WHERE m.set_number IS NOT NULL) AS in_sets,
           MAX(s.added_at) AS set_added_at
    FROM minifigs m
    LEFT JOIN sets s ON s.user_id = m.user_id AND s.set_number = m.set_number
    WHERE ${where}
    -- LOWER(TRIM(...)): Import-Pfade (Rebrickable-API vs. CSV-Katalog) können
    -- dieselbe Figurennummer mit Whitespace-/Case-Varianten liefern — die
    -- würden die Gruppierung sonst unsichtbar aushebeln.
    GROUP BY LOWER(TRIM(m.fig_number)), m.source
    ORDER BY MAX(m.fig_name) ASC, LOWER(TRIM(m.fig_number)) ASC${figLimit}`, figParams);

  // Angezeigter Zustand als Aggregat über die Kaufpreis-Erfassungen manueller
  // Figuren: eine "Gebraucht"-Erfassung genügt, damit die Figur als gebraucht
  // gilt. Figuren aus Sets haben keine Erfassungen → gespeicherter Wert.
  const usedFigRows = await db.all(
    `SELECT LOWER(TRIM(a.fig_number)) AS fkey,
            MAX(CASE WHEN a.condition='U' THEN 1 ELSE 0 END) AS any_used
     FROM minifig_acquisitions a
     WHERE a.user_id = ANY($1)
     GROUP BY LOWER(TRIM(a.fig_number))`,
    [uids]
  ).catch(() => []);
  const usedFigMap = new Map<string, boolean>(usedFigRows.map(r => [r.fkey, (parseInt(r.any_used) || 0) > 0] as [string, boolean]));

  const mappedFigs = figs.map(({ owner_ids, ...f }: any) => ({
    ...f,
    // Nur im Haushalt: Im Einzelkonto waere „gehoert mir" an jeder Kachel
    // Rauschen — dieselbe Entscheidung wie bei den Sets.
    //
    // owner_ids wird beim Zerlegen oben ABGETRENNT und hier bewusst wieder
    // hinzugefuegt. Mit `...f` allein waere das Aggregat aus der Abfrage auch
    // im Einzelkonto durchgerutscht — der Test hat genau das gemeldet.
    ...(uids.length > 1 ? { owner_ids: (owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    image_local: resolveImageLocal(f.image_local),
    condition: usedFigMap.has(String(f.fig_number).trim().toLowerCase())
      ? (usedFigMap.get(String(f.fig_number).trim().toLowerCase()) ? 'U' : 'N')
      : (f.stored_condition || 'N'),
  }));

  // Objektform wie bei getSets, damit die Gesamtzahl für den Endlos-Scroll
  // mitkommt. Ohne Paginierung entspricht total der Listenlänge.
  return {
    figs: await withOwners(uids, mappedFigs),
    total: figCount ? parseInt(figCount.c) : mappedFigs.length,
  };
}

/**
 * Kennzahlen des Minifiguren-Reiters: Arten, Gesamtstückzahl, manuell erfasste.
 *
 * ── Warum das hierher gehört ────────────────────────────────────────────────
 * Die drei Zahlen entstanden vorher auf ZWEI verschiedene Weisen. Die Webapp
 * holte sie von `/api/minifigs/stats`, die App rechnete sie aus ihrer geladenen
 * Liste (`figs.size`, `sumOf { totalQuantity ?: quantity }`,
 * `count { source == "manual" }`). Das ergab zwei Fehler auf einmal:
 *
 *   • Die Server-Fassung zählte `COUNT(DISTINCT LOWER(TRIM(fig_number)))`,
 *     die Liste daneben gruppiert aber nach Nummer UND Quelle. Eine Figur, die
 *     einmal aus einem Set und einmal manuell erfasst ist, steht in der Liste
 *     zweimal und zählte oben einmal — die Kachel widersprach der Liste
 *     darunter.
 *   • Die Server-Fassung las `WHERE m.user_id = $1`, also ohne Blickfeld und
 *     ohne Kontofilter. Im Haushalt zeigte die Kachel die eigenen Zahlen,
 *     während die Liste darunter alle Konten zeigte, und das Umschalten des
 *     Filters änderte oben nichts.
 *
 * Jetzt zählt diese Funktion über GENAU DIESELBE Gruppierung wie getMinifigs()
 * und über dasselbe Blickfeld. Kachel und Liste können nicht mehr
 * auseinanderlaufen, weil es dieselbe Regel ist.
 *
 * @param userId Blickfeld (scopeIds) oder eine einzelne ID
 */
async function getMinifigStats(userId: number | number[]) {
  const uids = asIds(userId as any);
  const row = await db.get(`
    SELECT COUNT(*)::int AS types,
           COALESCE(SUM(g.menge), 0)::int AS total_quantity,
           COUNT(*) FILTER (WHERE g.source = 'manual')::int AS manual
      FROM (
        SELECT m.source, SUM(m.quantity * COALESCE(s.quantity, 1)) AS menge
          FROM minifigs m
          LEFT JOIN sets s ON s.user_id = m.user_id AND s.set_number = m.set_number
         WHERE m.user_id = ANY($1)
         GROUP BY LOWER(TRIM(m.fig_number)), m.source
      ) g`, [uids]);
  return {
    types: row?.types ?? 0,
    total_quantity: row?.total_quantity ?? 0,
    manual: row?.manual ?? 0,
    // Alter Name der Webapp-Antwort — dieselbe Zahl, damit die Kachel nicht
    // von der Umbenennung abhängt.
    unique_figs: row?.types ?? 0,
  };
}

/** Manuell erfasste Minifiguren.
 *  Von /api/minifigs/manual UND /api/v1/minifigs/manual genutzt (Parität). */
async function getManualMinifigs(userId: number | number[], { page = 1, page_size = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const params: any[] = [uids];
  let limit = '';
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    params.push(size, (Math.max(1, parseInt(page) || 1) - 1) * size);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const figs = await db.all(
    `SELECT * FROM minifigs WHERE user_id = ANY($1) AND source = 'manual' ORDER BY fig_name ASC, fig_number ASC${limit}`,
    params);
  const mapped = figs.map(f => ({ ...f, image_local: resolveImageLocal(f.image_local) }));
  return withOwners(uids, await applyManualCondition(uids, mapped, 'fig'));
}

export { getMinifigs, getMinifigStats, getManualMinifigs };
