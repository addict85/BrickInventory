import * as db from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { clampPageSize, applyManualCondition, withOwners } from './shared';
import { mitVersion } from '../setNummer';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../bestandsmenge';
import { marktpreiseAusCacheFuerFiguren } from '../marketPrice';
import { blJoin, blNummerSql } from '../blZuordnung';

/**
 * Leseabfragen für Minifiguren.
 * Ausführlich: docs/begruendungen/utils/handlers/minifigs.ts.md#abschnitt
 */

/**
 * Volltextsuche über Figurennummer und Name.
 * Ausführlich: docs/begruendungen/utils/handlers/minifigs.ts.md#figurensuche
 */
function figurenSuche(nummer: string, name: string, pi: number) {
  return `(${nummer} ILIKE $${pi} OR ${name} ILIKE $${pi})`;
}

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
    where += ` AND m.set_number = $${pi++}`;
    params.push(mitVersion(set_number));
  }
  if (source === 'set')    where += " AND m.source = 'set'";
  if (source === 'manual') where += " AND m.source = 'manual'";
  if (search) {
    // Der Figurenname steht seit Migration 0034 im Katalog; der Alias mc
    // haengt an jeder Abfrage, die diese Bedingung benutzt.
    where += ` AND ${figurenSuche('m.fig_number', 'mc.fig_name', pi)}`;
    params.push(`%${search}%`); pi++;
  }
  // Je Figur und Quelle eine Zeile mit der Gesamtmenge (wie Teile); gezählt
  // werden die Gruppen, sonst zählte eine Figur aus fünf Sets fünfmal.
  const figParams = [...params];
  let figLimit = '';
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    const off  = (Math.max(1, parseInt(page) || 1) - 1) * size;
    figParams.push(size, off);
    figLimit = ` LIMIT $${figParams.length - 1} OFFSET $${figParams.length}`;
  }
  // Die Zählung braucht keinen Join auf sets; kein Text im SQL, das
  // test/gallery-paging.test.js kurz halten will.
  const figCount = page_size
    ? await db.get(`SELECT COUNT(*)::int AS c FROM (
         SELECT 1 FROM minifigs m
         LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
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
           -- Name und Bild aus minifigs_catalog (Migration 0034): Sie
           -- haengen an der Figur, nicht am Konto, das sie besitzt. MAX
           -- bleibt, weil die Gruppe mehrere Schreibweisen derselben
           -- Figurennummer zusammenfasst.
           MAX(mc.fig_name) AS fig_name,
           -- Die Stückzahl der Bestandszeile (Migration 0038): manuell die
           -- Summe der Erfassungen, aus einem Set die Katalogzahl. Hier
           -- stand m.quantity.
           SUM(${teilmengeAus('m', 'fig')})::int AS quantity,
           MAX(mc.image_url) AS image_url,
           MAX(mc.image_local) AS image_local,
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
    -- Beschreibung aus dem Katalog. Verbunden ueber den Primaerschluessel,
    -- also hoechstens eine Zeile je Treffer — die Gruppierung und die
    -- Gesamtzahl bleiben unberuehrt. Genau (nicht ueber LOWER(TRIM(...))):
    -- Migration 0034 fuellt den Katalog aus denselben Zeichenketten, die in
    -- minifigs stehen, und eine Normalisierung im Join haette den
    -- Primaerschluessel umgangen.
    LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
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
    ORDER BY MAX(mc.fig_name) ASC, LOWER(TRIM(m.fig_number)) ASC${figLimit}`, figParams);

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
  );
  const usedFigMap = new Map<string, boolean>(usedFigRows.map(r => [r.fkey, (parseInt(r.any_used) || 0) > 0] as [string, boolean]));

  const mappedFigs = figs.map(({ owner_ids, ...f }: any) => ({
    ...f,
    // owner_ids nur im Haushalt (wie bei Sets); im Einzelkonto wäre „gehört
    // mir“ an jeder Kachel Rauschen, deshalb oben abgetrennt.
    ...(uids.length > 1 ? { owner_ids: (owner_ids || []).map((n: any) => parseInt(n)) } : {}),
    image_local: resolveImageLocal(f.image_local),
    // Ohne Erfassung 'N' — nicht mehr der gespeicherte Wert, den es seit
    // Migration 0035 nicht mehr gibt. Fuer Set-Figuren dasselbe Ergebnis wie
    // vorher: Dort stand die Spalte seit jeher auf dem Vorgabewert.
    condition: usedFigMap.get(String(f.fig_number).trim().toLowerCase()) ? 'U' : 'N',
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
 * Ausführlich: docs/begruendungen/utils/handlers/minifigs.ts.md#getminifigstats
 * @param userId Blickfeld (scopeIds) oder eine einzelne ID
 */
async function getMinifigStats(userId: number | number[]) {
  const uids = asIds(userId as any);
  const row = await db.get(`
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
  return {
    types: row?.types ?? 0,
    total_quantity: row?.total_quantity ?? 0,
    manual: row?.manual ?? 0,
    // Alter Name der Webapp-Antwort — dieselbe Zahl, damit die Kachel nicht
    // von der Umbenennung abhängt.
    unique_figs: row?.types ?? 0,
  };
}

/**
 * Manuell erfasste Minifiguren.
 * @param viewerId wessen Einstellungen gelten (Währung); `userId` sagt, wessen Daten.
 */
async function getManualMinifigs(userId: number | number[], viewerId: number,
                                 { page = 1, page_size = null, search = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  const params: any[] = [uids];
  // Der Suchtext der Filterleiste wirkt auch hier (wie getManualParts);
  // Platzhalter vor LIMIT/OFFSET.
  let suche = '';
  if (search) {
    params.push(`%${search}%`);
    suche = ` AND ${figurenSuche('m.fig_number', 'mc.fig_name', params.length)}`;
  }
  let limit = '';
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    params.push(size, (Math.max(1, parseInt(page) || 1) - 1) * size);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const figs = await db.all(
    // Spalten ausgeschrieben, kein m.*
    // Name und Bild kommen seit Migration 0034 aus minifigs_catalog —
    // sie haengen an der Figur, nicht am Konto, das sie besitzt.
    // Ausführlich: docs/begruendungen/utils/handlers/minifigs.ts.md#getmanualminifigs
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
            -- utils/preisRegel.ts sie ausschreibt: unit_price ist der
            -- eingegebene Preis und darf leer sein, purchase_price ist der
            -- ANZEIGEWERT und ist nie leer.
            neu.unit_price,
            COALESCE(neu.unit_price, 0) AS purchase_price,
            COALESCE(neu.condition, 'N') AS condition,
            mc.fig_name, mc.image_url, mc.image_local,
            lo.name AS storage
       FROM minifigs m
       ${teilmengeJoin('m', 'fig')}
       ${blJoin('m.fig_number', 'fig')}
       LEFT JOIN minifigs_catalog mc ON mc.fig_number = m.fig_number
       LEFT JOIN storage_locations lo ON lo.id = m.storage_id
       LEFT JOIN LATERAL (
         SELECT a.unit_price, a.condition
           FROM minifig_acquisitions a
          WHERE a.user_id = m.user_id AND a.fig_number = m.fig_number
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 1
       ) neu ON TRUE
      WHERE m.user_id = ANY($1) AND m.source = 'manual'${suche}
      ORDER BY mc.fig_name ASC, m.fig_number ASC${limit}`,
    params);
  const mapped = figs.map(f => ({ ...f, image_local: resolveImageLocal(f.image_local) }));
  const mitZustand = await applyManualCondition(uids, mapped, 'fig');

  // Der Marktpreis gehoert dazu
  // NUR aus dem Cache, in EINER Abfrage fuer die ganze Liste: Ein Live-Abruf
  // je Eintrag waere genau der Zustand, von dem der Umzug weg von der
  // Bewertung wegfuehren sollte. Siehe utils/marketPrice.ts.
  // Ausführlich: docs/begruendungen/utils/handlers/minifigs.ts.md#getmanualminifigs-preise
  const preise = await marktpreiseAusCacheFuerFiguren(mitZustand, viewerId)
    .catch(() => new Map<string, number>());
  const mitPreis = mitZustand.map((f: any) =>
    ({ ...f, avg_price: preise.get(String(f.fig_number)) ?? null }));

  return withOwners(uids, mitPreis);
}

export { getMinifigs, getMinifigStats, getManualMinifigs };
