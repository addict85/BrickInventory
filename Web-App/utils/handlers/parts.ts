import * as db from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { istErsatzteil, ersatzteilSql } from '../validate';
import { ensureFresh } from '../partsSummary';
import { fetchMissingBlIds } from '../../routes/parts';
import type { RbSetTeil } from '../../clients/rebrickable';
import { getAllSetParts, getRbKey, httpsGetRobust } from '../../clients/rebrickable';
import { clampPageSize, applyManualCondition, withOwners, MAX_PAGE_SIZE, UNPAGED_LIMIT, SET_PARTS_MAX_PAGE_SIZE } from './shared';
import { meldeUndWeiter } from '../../utils/httpError';
import { getGlobalSetting } from '../../utils/settings';
import { neuestesInventar, inventarKandidaten } from '../rbInventar';

/**
 * Leseabfragen für Teile — inklusive der Ausweichebenen (CSV-Zwischenspeicher,
 * Rebrickable), wenn der eigene Bestand ein Set nicht kennt.
 *
 * ── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * — benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
 * zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
 * getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
 * geht in EINE Richtung, es entsteht also kein Kreis.
 */

/**
 * Ein Blickfeld: eine einzelne Konto-ID oder die Liste aus scopeIds()
 * (utils/household.ts). asIds() normalisiert beides auf eine Liste — mit dem
 * Typ entfaellt der Cast `asIds(userId)`, der nur da stand, weil der
 * Parameter keinen hatte. Dieselbe Erklaerung wie in handlers/sets.ts.
 */
type Blickfeld = number | number[];

/** Farbliste des Teilebestands (ohne manuelle Positionen — die haben eine
 *  eigene Ansicht). Hex-Fallback aus rb_colors für Teile ohne eigenen Wert.
 *  Von /api/parts/colors UND /api/v1/parts/colors genutzt (Parität). */
async function getPartsColors(userId: Blickfeld) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Aus der Zusammenfassung: dieselbe Gruppierung, aber über 66'000 statt
  // 171'000 Zeilen und ohne den Join auf sets — die Mengen sind dort bereits
  // mit der Set-Anzahl multipliziert.
  // strict: Kennzahlen müssen zwischen Webapp und App übereinstimmen — ein
  // veralteter Stand darf hier nicht benutzt werden (siehe partsSummary.ts).
  // ::int an JEDEM Zählwert BEIDER Zweige: Ohne die Casts hing der JSON-TYP
  // am Cache-Zustand — SUM(BIGINT) im Zusammenfassungs-Zweig ergibt NUMERIC
  // (der Parser in db/database.ts macht daraus eine ZAHL), SUM(INTEGER) im
  // Live-Zweig ergibt BIGINT (bleibt TEXT). Dieselbe Route lieferte also mal
  // total_quantity: 20, mal "20", je nachdem, ob die Zusammenfassung gerade
  // frisch war. Aufgeflogen im Paritätstest, der die beiden Aufrufe zufällig
  // über eine Frische-Grenze hinweg machte — einzeln war er grün.
  if (await ensureFresh(uids, { strict: true })) {
    return db.all(`
      SELECT ps.color_name, COALESCE(ps.color_hex, rc.rgb) AS color_hex,
             -- DISTINCT über part_key: Im Haushalt steht dasselbe Teil je Konto
             -- einmal in der Tabelle. COUNT(*) zählte dann Konten statt Teile.
             COUNT(DISTINCT ps.part_key)::int AS unique_parts,
             SUM(ps.total_quantity)::int      AS total_quantity
      FROM parts_summary ps
      LEFT JOIN rb_colors rc ON rc.id = ps.color_id
      WHERE ps.user_id = ANY($1)
      GROUP BY ps.color_name, COALESCE(ps.color_hex, rc.rgb)
      ORDER BY total_quantity DESC`, [uids]);
  }
  return db.all(`
    SELECT p.color_name, COALESCE(p.color_hex, rc.rgb) AS color_hex,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(p.quantity * COALESCE(s.quantity,1))::int AS total_quantity
    FROM parts p
    LEFT JOIN sets s ON s.user_id = p.user_id AND s.set_number = p.set_number
    LEFT JOIN rb_colors rc ON rc.id = p.color_id
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    GROUP BY p.color_name, COALESCE(p.color_hex, rc.rgb) ORDER BY total_quantity DESC`, [uids]);
}

/**
 * WHERE-Klausel und Parameter der Teileliste aus den Abfrageparametern.
 *
 * ── Warum eigenständig (Nachtrag 148) ───────────────────────────────────────
 * getParts() war 256 Zeilen und tat drei Dinge: Filter bauen, Abfragen
 * ausführen, und bei einem leeren Ergebnis auf Katalog bzw. Rebrickable
 * ausweichen. Der Filterteil ist der einzige davon, der ohne Datenbank
 * nachvollziehbar ist — er nimmt Werte entgegen und gibt eine Zeichenkette
 * zurück.
 *
 * Die laufende Nummer `pi` kommt mit zurück, weil der Aufrufer LIMIT/OFFSET
 * danach anhängt.
 */
function teileFilter(uids: number[], query: any) {
  const { color, category, search, spare, set_number } = query;
  let where = 'p.user_id = ANY($1)';
  const params: any[] = [uids];
  let pi = 2;

  if (set_number) {
    const alt = set_number.includes('-') ? set_number.replace(/-\d+$/, '') : set_number + '-1';
    where += ` AND (p.set_number = $${pi} OR p.set_number = $${pi+1})`;
    params.push(set_number, alt); pi += 2;
  }
  if (color)    { where += ` AND p.color_name = $${pi++}`;    params.push(color); }
  // Kategorie auch über den Teilekatalog auflösen — parts.category_name steht
  // bei vielen Teilen auf 'Unknown', weil die Set-Teile-Antwort von
  // Rebrickable kein part_cat_id mitliefert. Die Filterliste zeigt deshalb die
  // über rb_parts aufgelöste ID; hier muss dieselbe Auflösung greifen, sonst
  // fände ein Klick nichts.
  if (category) {
    where += ` AND (p.category_name = $${pi}
                    OR EXISTS (SELECT 1 FROM rb_parts rp
                                WHERE rp.part_num = p.part_number
                                  AND rp.part_cat_id::text = $${pi}))`;
    pi++; params.push(category);
  }
  if (spare === '0') where += ' AND p.is_spare = 0';
  if (spare === '1') where += ' AND p.is_spare = 1';
  // Manuell erfasste Teile aus der Set-Teile-Übersicht ausschließen — sie haben
  // ihren eigenen Bereich ("Manuell erfasste Teile") und gehören nicht in die
  // nach Farbe/Kategorie gruppierte Set-Teileliste.
  if (query.exclude_manual === '1' || query.exclude_manual === true) {
    where += " AND COALESCE(p.source,'set') <> 'manual'";
  }
  if (search) {
    where += ` AND (LOWER(p.part_number) LIKE $${pi} OR LOWER(p.part_name) LIKE $${pi})`;
    params.push(`%${search.toLowerCase()}%`); pi++;
  }


  return { where, params, pi };
}

/**
 * Teileliste EINES Sets, wenn der Nutzer selbst keine Zeilen dazu hat.
 *
 * Zwei Ersatzquellen in dieser Reihenfolge: der eingespielte Rebrickable-CSV-
 * Katalog (lokal, kostet nichts) und erst danach die Rebrickable-API (zählt
 * auf das Tageskontingent). Geblättert wird hier nicht — die Menge ist durch
 * das Set begrenzt, page_size ist deshalb die Zeilenzahl.
 *
 * Gibt null zurück, wenn auch dort nichts zu finden war; dann bleibt es beim
 * leeren Ergebnis aus der Datenbank.
 */
async function teileErsatzquelle(set_number: string) {
    // Hier standen n und alt einzeln, und alt war
    //   set_number.includes('-') ? set_number.replace(/-\d+$/,'') : set_number + '-1'
    // — fuer eine Nummer OHNE Versionsanhang also derselbe Wert wie n. Das
    // schlug zweimal durch: Die Inventar-Abfrage unten fragte zweimal
    // dasselbe (die blanke Nummer wurde nie geprueft), und die
    // Rebrickable-Schleife `for (const sn of [n, alt])` holte denselben Satz
    // zweimal ueber die Leitung, auf Kosten des dortigen Tageskontingents.
    // Alle anderen sieben Fundstellen bildeten die Kandidaten richtig.
    const [n, alt] = inventarKandidaten(set_number);
    const invId = await neuestesInventar(set_number).catch(() => null);
    if (invId) {
      const csvParts = await db.all(`
        SELECT ip.part_num AS part_number,
               COALESCE(m.bl_part_num, ip.part_num) AS bl_part_number,
               p.name AS part_name, ip.color_id,
               c.name AS color_name, c.rgb AS color_hex,
               NULL AS category_name,
               p.part_img_url AS image_url, NULL AS image_local,
               -- Dieselbe Lesart wie istErsatzteil(); istErsatzteil() liest
               -- den Wert unten ohnehin noch einmal, aber ein 't'-only-Vergleich
               -- hier haette '1' schon vorher verworfen.
               ${ersatzteilSql('ip.is_spare')} AS is_spare,
               ip.quantity AS total_quantity,
               $2 AS in_sets
        FROM rb_inventory_parts ip
        LEFT JOIN rb_parts p ON p.part_num = ip.part_num
        LEFT JOIN rb_colors c ON c.id = ip.color_id
        LEFT JOIN rb_bl_mapping m ON m.part_num = ip.part_num
        WHERE ip.inventory_id = $1`, [invId, set_number]
      ).catch(() => []);
      if (csvParts.length > 0)
        // page_size gehört in JEDEN Rückgabeweg (Nachtrag 132): Der Client
        // liest daraus, ob eine weitere Seite nötig ist. Auf dieser
        // Ausweichebene wird nicht geblättert — die Antwort enthält alles,
        // also ist die Seitengrösse die Zahl der Zeilen. Fehlte das Feld,
        // stand beim Client `undefined`, und die Prüfung „total > page_size"
        // konnte nie greifen.
        return { parts: csvParts, total: csvParts.length, source: 'csv_cache', page_size: csvParts.length };
    }

    // Rebrickable-Rückfallebene.
    //
    // VORHER stand hier `require('../../routes/parts').fetchRebrickableParts` —
    // einen Namen, den routes/parts.ts NIE exportiert hat (die Exportliste am
    // Dateiende führt ihn nicht). Der Ausdruck war also `undefined(…)`, und
    // weil der TypeError SYNCHRON fliegt, fing ihn auch das `.catch(() => [])`
    // daneben nicht ab: Die Anfrage endete mit einem 500er statt mit einer
    // leeren Liste. Aufgefallen ist das nie, weil der Zweig nur greift, wenn
    // ein Set weder eigene Teile noch einen CSV-Eintrag hat.
    //
    // Statt den Namen zu exportieren, geht der Weg jetzt über getAllSetParts()
    // in clients/rebrickable.ts. Die Funktion kann längst alles, was die
    // 90-zeilige Zweitfassung nachbaute — und zwar besser: CSV zuerst,
    // Tageskontingent über consumeRebrickableDaily(), Drossel über den
    // Limiter, Antwort im subsets_cache. Die Zweitfassung holte ohne all das
    // und ist entfallen.
    const rbKey = await getGlobalSetting('rebrickable_api_key');
    if (rbKey) {
      for (const sn of [n, alt]) {
        const items = await getAllSetParts(sn).catch(() => []);
        if (!items?.length) continue;
        const rbParts = items
          .filter((it: RbSetTeil) => !it.is_spare)
          .map((it: RbSetTeil) => ({
            part_number:    it.part?.part_num,
            bl_part_number: it.part?.external_ids?.BrickLink?.[0] || it.part?.part_num,
            part_name:      it.part?.name || it.part?.part_num,
            color_id:       it.color?.id ?? 0,
            color_name:     it.color?.name || '',
            color_hex:      it.color?.rgb || null,
            category_name:  null,
            image_url:      it.part?.part_img_url || null,
            image_local:    null,
            is_spare:       0,
            total_quantity: it.quantity,
            quantity:       it.quantity,
            in_sets:        set_number,
          }))
          .filter((p: { part_number?: string | null }) => p.part_number);
        // Siehe oben: auch hier wird nicht geblättert, page_size = Zeilenzahl.
        if (rbParts.length) return { parts: rbParts, total: rbParts.length, source: 'rebrickable', page_size: rbParts.length };
      }
    }

  return null;
}

/**
 * Seitenabfrage aus parts_summary. Gibt null zurück, wenn die Zusammenfassung
 * nicht benutzbar ist — dann übernimmt die Live-Abfrage darunter.
 */
async function tryPartsSummary(userId: Blickfeld, o: any) {
  const uids = asIds(userId);
  // Die Zusammenfassung ist JE KONTO aufgebaut. Für den Haushalt wird über
  // alle beteiligten Konten gelesen und über part_key verdichtet — dasselbe
  // Teil in zwei Konten ergibt EINE Zeile mit der Summe der Mengen, genau wie
  // innerhalb eines Kontos dasselbe Teil aus zwei Sets.
  //
  // ensureFresh() prüft dafür jedes Konto einzeln und meldet nur dann frisch,
  // wenn alle es sind (utils/partsSummary.ts).
  if (!(await ensureFresh(uids))) return null;

  const cond: string[] = ['user_id = ANY($1)'];
  const params: any[] = [uids];
  // Der Filter schickt den FARBNAMEN, nicht die ID — `parseInt('Black')` ergibt
  // NaN, und die Bedingung traf dann auf nichts zu: „Keine Teile gefunden",
  // sobald eine Farbe angeklickt wurde. Der Live-Pfad darunter vergleicht
  // ebenfalls über color_name; beide müssen dasselbe tun.
  if (o.color) { cond.push(`color_name = $${params.length + 1}`); params.push(o.color); }
  // Die Zusammenfassung führt category_name so, wie es in parts steht — also
  // teilweise 'Unknown'. Ein Kategorie-Filter würde hier andere Ergebnisse
  // liefern als der Live-Pfad mit seiner Auflösung über rb_parts. Statt zwei
  // Wahrheiten: bei gesetztem Kategorie-Filter auf den Live-Pfad ausweichen.
  if (o.category) return null;
  if (o.spare === '0' || o.spare === '1') {
    cond.push(`COALESCE(is_spare, 0) = $${params.length + 1}`);         params.push(parseInt(o.spare));
  }
  if (o.search) {
    const i = params.length + 1;
    cond.push(`(part_name ILIKE $${i} OR part_number ILIKE $${i} OR bl_part_number ILIKE $${i})`);
    params.push(`%${o.search}%`);
  }
  const where = cond.join(' AND ');

  // Mit page_size gilt dieselbe Obergrenze wie im Live-Pfad; ohne page_size
  // greift UNPAGED_LIMIT.
  //
  // Hier stand: „Ohne page_size wird alles geliefert (die Android-App ruft so
  // auf)". Der zweite Teil stimmt nicht mehr — die App schickt page_size=500
  // und blättert über onLoadMore nach (BrickApiService.getParts,
  // CollectionGraph). Ein veralteter Kommentar, der eine unbegrenzte Antwort
  // als gewollt auswies.
  const obergrenze = o.set_number ? SET_PARTS_MAX_PAGE_SIZE : MAX_PAGE_SIZE;
  const size = o.page_size
    ? Math.min(obergrenze, Math.max(1, parseInt(String(o.page_size)) || 100))
    : UNPAGED_LIMIT;
  const pg   = Math.max(1, parseInt(String(o.page)) || 1);
  const limit = ` LIMIT ${size} OFFSET ${(pg - 1) * size}`;

  // Über mehrere Konten muss verdichtet werden: Der Schlüssel der Tabelle
  // enthält user_id, dasselbe Teil steht also je Konto einmal drin. Ohne
  // Gruppierung erschiene es mehrfach — und die Gesamtzahl (COUNT) zählte
  // Konten statt Teile.
  //
  // Gruppiert wird über part_key, den die Tabelle bereits führt (BrickLink-
  // Nummer, ersatzweise die Rebrickable-Nummer) — dieselbe Zusammenfassung wie
  // beim Aufbau innerhalb eines Kontos.
  const multi = uids.length > 1;
  const cols = multi
    ? `MIN(part_number) AS part_number, MIN(bl_part_number) AS bl_part_number, color_id,
       MIN(part_name) AS part_name, MIN(color_name) AS color_name, MIN(color_hex) AS color_hex,
       MIN(category_name) AS category_name, MIN(image_url) AS image_url,
       MIN(image_local) AS image_local, MAX(COALESCE(is_spare,0)) AS is_spare,
       SUM(total_quantity)::int AS total_quantity` +
      (o.withSets ? ", STRING_AGG(DISTINCT in_sets, ',') AS in_sets" : '')
    : `part_number, bl_part_number, color_id, part_name, color_name, color_hex,
       category_name, image_url, image_local, is_spare, total_quantity::int` +
      (o.withSets ? ', in_sets' : '');
  const groupSql = multi ? ' GROUP BY part_key, color_id' : '';
  const orderSql = multi ? 'MIN(color_name) ASC, MIN(part_name) ASC' : 'color_name ASC, part_name ASC';

  const [countRow, rows] = await Promise.all([
    multi
      ? db.get(`SELECT COUNT(*)::int AS c FROM (
                  SELECT 1 FROM parts_summary WHERE ${where} GROUP BY part_key, color_id
                ) t`, params)
      : db.get(`SELECT COUNT(*)::int AS c FROM parts_summary WHERE ${where}`, params),
    db.all(`SELECT ${cols} FROM parts_summary WHERE ${where}${groupSql}
            ORDER BY ${orderSql}${limit}`, params),
  ]);

  return {
    parts: rows.map(r => ({ ...r, total_quantity: parseInt(r.total_quantity) || 0,
                            image_local: resolveImageLocal(r.image_local) })),
    total: parseInt(countRow?.c || 0),
    source: 'summary',
    page_size: size,
  };
}

async function getParts(userId: Blickfeld, query: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const { color, category, search, spare, set_number,
          page = 1, page_size = null } = query;

  // STRING_AGG(DISTINCT p.set_number) sammelt je Gruppe die Liste aller Sets,
  // in denen das Teil vorkommt. Gemessen an 380 Sets kostet das rund 155 ms
  // Abfragezeit und 2 MB Nutzlast — gebraucht wird die Liste aber nur in der
  // Detailansicht eines Teils, nicht in der Kachelwand. Daher standardmässig
  // aus; `with_sets=1` schaltet sie ein.
  const withSets = query.with_sets === '1' || query.with_sets === true;

  const { where, params, pi } = teileFilter(uids, query);
  // ::int aus demselben Grund wie in getPartsColors (siehe Kommentar dort):
  // Der JSON-Typ von total_quantity darf nicht vom Zweig abhängen —
  // SUM(BIGINT) käme als Zahl, SUM(INTEGER) und die rohe BIGINT-Spalte als
  // Text. Haushalt, Einzelkonto und Live-Abfrage liefern jetzt dieselbe Form.
  const qtyExpr   = set_number ? 'SUM(p.quantity)::int' : 'SUM(p.quantity * COALESCE(s.quantity, 1))::int';
  const joinClause = set_number ? 'FROM parts p' :
    'FROM parts p LEFT JOIN sets s ON s.user_id = p.user_id AND s.set_number = p.set_number';

  // Count for pagination.
  // Vorher COUNT(DISTINCT <concat>) — das baut pro Zeile einen String und
  // sortiert ihn anschliessend. COUNT(*) über dieselbe Gruppierung nutzt den
  // HashAggregate und ist bei 171'000 Zeilen gemessen rund 2,7× schneller
  // (176 ms → 65 ms).
  // ── Schneller Weg: vorberechnete Zusammenfassung ───────────────────────
  // Sie deckt genau den Fall der Teileansicht ab (Set-Teile, gruppiert nach
  // Teil und Farbe). Der Filter set_number ist bewusst ausgenommen: Dort geht
  // es um die Teile EINES Sets, nicht um die Sammlung — dafür ist die
  // Live-Abfrage sowohl passend als auch schnell genug.
  const excludesManual = query.exclude_manual === '1' || query.exclude_manual === true;
  if (excludesManual && !set_number) {
    const summary = await tryPartsSummary(uids, { color, category, search, spare, page, page_size, withSets });
    if (summary) return summary;
  }

  const countSql = `SELECT COUNT(*)::int AS c FROM (
       SELECT 1 FROM parts p WHERE ${where}
       GROUP BY COALESCE(p.bl_part_number, p.part_number), p.color_id
     ) g`;

  // Build paginated query
  //
  // Die Teileliste EINES Sets darf mehr liefern als die allgemeine Liste —
  // sie ist eine begrenzte Menge, und die App holt sie in einem Stück
  // (SET_PARTS_MAX_PAGE_SIZE).
  let limitClause = '';
  const queryParams = [...params];
  const obergrenzeLive = set_number ? SET_PARTS_MAX_PAGE_SIZE : MAX_PAGE_SIZE;
  // Ohne page_size gilt UNPAGED_LIMIT — im Live-Pfad GENAUSO wie im
  // Zusammenfassungs-Pfad. Dass beide Wege sich unterschiedlich deckeln, war
  // schon einmal ein Fehler: Dieselbe Anfrage lieferte je nach Cache-Zustand
  // 500 oder 5000 Zeilen.
  const effektiveGroesse = page_size
    ? Math.min(obergrenzeLive, Math.max(1, parseInt(String(page_size)) || 100))
    : UNPAGED_LIMIT;
  {
    const offset = (Math.max(1, parseInt(page)) - 1) * effektiveGroesse;
    limitClause  = ` LIMIT $${pi} OFFSET $${pi+1}`;
    queryParams.push(effektiveGroesse, offset);
  }

  // Die drei Abfragen hängen nicht voneinander ab und liefen trotzdem
  // nacheinander — bei 380 Sets summierten sich 109 + 159 + 30 ms zu über
  // 600 ms pro Seite. Parallel kostet der Aufruf nur noch so viel wie die
  // langsamste Einzelabfrage.
  const partsSql = `
    SELECT
      -- Use BL part number as the canonical identifier
      COALESCE(p.bl_part_number, p.part_number) AS part_number,
      COALESCE(p.bl_part_number, p.part_number) AS bl_part_number,
      -- Pick one representative part name/image (MIN is deterministic)
      MIN(p.part_name)    AS part_name,
      p.color_id,
      MIN(p.color_name)   AS color_name,
      MIN(p.color_hex)    AS color_hex,
      MIN(p.category_name) AS category_name,
      MIN(p.image_url)    AS image_url,
      MIN(p.image_local)  AS image_local,
      MAX(p.is_spare)     AS is_spare,
      MAX(p.condition)    AS stored_condition,
      -- Sum quantities across all RB part numbers that map to the same BL ID
      ${qtyExpr}          AS total_quantity${withSets ? `,
      STRING_AGG(DISTINCT p.set_number, ',') AS in_sets` : ''}
    ${joinClause}
    WHERE ${where}
    GROUP BY COALESCE(p.bl_part_number, p.part_number), p.color_id
    ORDER BY MIN(p.color_name) ASC, MIN(p.part_name) ASC${limitClause}`;

  // Angezeigter Zustand als Aggregat über die Kaufpreis-Erfassungen manueller
  // Teile: sobald eine Erfassung "Gebraucht" ist, gilt das Teil als gebraucht.
  // Teile aus Sets (source='set') haben keine Erfassungen → gespeicherter Wert.
  //
  // Entfällt komplett, wenn manuelle Teile ohnehin ausgefiltert sind — dann
  // kann keine Zeile des Ergebnisses davon betroffen sein. Genau so ruft die
  // Teile-Seite den Endpunkt auf (exclude_manual=1).
  const usedSql =
    `SELECT COALESCE(p.bl_part_number, p.part_number) AS pid, p.color_id,
            MAX(CASE WHEN pa.condition='U' THEN 1 ELSE 0 END) AS any_used
     FROM parts p
     JOIN part_acquisitions pa ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
     WHERE p.user_id = ANY($1) AND p.source='manual'
     GROUP BY COALESCE(p.bl_part_number, p.part_number), p.color_id`;

  const [countRow, parts, usedPartRows] = await Promise.all([
    db.get(countSql, params),
    db.all(partsSql, queryParams),
    excludesManual ? Promise.resolve([]) : db.all(usedSql, [uids]).catch(() => []),
  ]);
  const total = parseInt(countRow?.c || 0);
  const usedPartMap = new Map<string, boolean>(usedPartRows.map(r => [`${r.pid}|${r.color_id}`, (parseInt(r.any_used) || 0) > 0] as [string, boolean]));

  // Normalize is_spare and resolve image paths
  const { resolveImageLocal } = require('../images');
  const partsResolved = parts.map(p => ({
    ...p,
    condition: usedPartMap.has(`${p.part_number}|${p.color_id}`)
      ? (usedPartMap.get(`${p.part_number}|${p.color_id}`) ? 'U' : 'N')
      : (p.stored_condition || 'N'),
    image_local: resolveImageLocal(p.image_local),
    image_url:   p.image_url || null,
    // Ein echter Wahrheitswert, nicht '1'/'0': Der Treiber liefert das
    // Aggregat als ZEICHENKETTE, und "0" ist in JavaScript wahr. Die
    // Schreibweisen liest istErsatzteil() (utils/validate.ts) an EINER Stelle.
    is_spare: istErsatzteil(p.is_spare)
  }));

  // Background: fetch missing BL IDs
  setImmediate(async () => {
    try {
      const unmapped = await db.get(
        `SELECT 1 FROM parts p LEFT JOIN rb_bl_mapping m ON m.part_num = p.part_number
         WHERE p.user_id = ANY($1) AND m.part_num IS NULL LIMIT 1`, [uids]
      );
      if (unmapped) fetchMissingBlIds().catch(() => {});
    } catch (e) { meldeUndWeiter('teile:bl-nummern-nachladen', e); }
  });

  // Hat der Nutzer für dieses Set keine eigenen Zeilen, auf Katalog bzw.
  // Rebrickable ausweichen (siehe teileErsatzquelle).
  if (!partsResolved.length && set_number) {
    const ersatz = await teileErsatzquelle(set_number);
    if (ersatz) return ersatz;
  }
  return { parts: partsResolved, total, source: 'db', page_size: effektiveGroesse };
}

async function getPartsStats(userId: Blickfeld) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Ebenfalls aus der Zusammenfassung. Die Kennzahlen beziehen sich wie die
  // Liste auf Set-Teile; manuell erfasste haben ihren eigenen Bereich.
  // strict: Kennzahlen müssen zwischen Webapp und App übereinstimmen — ein
  // veralteter Stand darf hier nicht benutzt werden (siehe partsSummary.ts).
  // Über mehrere Konten hinweg tragen die DISTINCT-Zählungen von selbst: Ein
  // Teil, das in zwei Konten liegt, hat dieselbe Nummer und zählt einmal. Nur
  // die Summe addiert sich, und das ist gewollt.
  if (await ensureFresh(uids, { strict: true })) {
    const r = await db.get(`
      SELECT COUNT(DISTINCT part_number)::int AS unique_parts,
             COUNT(DISTINCT color_id)::int    AS unique_colors,
             COALESCE(SUM(total_quantity), 0) AS total_parts
        FROM parts_summary WHERE user_id = ANY($1)`, [uids]).catch(() => null);
    if (r) return {
      unique_parts:  parseInt(r.unique_parts  || 0),
      unique_colors: parseInt(r.unique_colors || 0),
      total_parts:   parseInt(r.total_parts   || 0),
    };
  }
  const row = await db.get(`
    SELECT COUNT(DISTINCT p.part_number) AS unique_parts,
           COUNT(DISTINCT p.color_id)    AS unique_colors,
           SUM(p.quantity * COALESCE(s.quantity, 1)) AS total_parts
    FROM parts p
    LEFT JOIN sets s ON s.user_id = p.user_id AND s.set_number = p.set_number
    WHERE p.user_id = ANY($1)`, [uids]);
  return {
    unique_parts:  parseInt(row?.unique_parts  || 0),
    unique_colors: parseInt(row?.unique_colors || 0),
    total_parts:   parseInt(row?.total_parts   || 0),
  };
}

async function getBlColorMap() {
  // Try DB first (populated after CSV sync + API fetch)
  const rows = await db.all(`SELECT id, bl_color_id FROM rb_colors WHERE bl_color_id IS NOT NULL`);
  if (rows.length > 0) {
    const map: any = {};
    for (const r of rows) map[r.id] = r.bl_color_id;
    return { map, source: 'db' };
  }
  // Fallback: fetch from Rebrickable API and cache in DB
  const key = await getRbKey().catch(() => null);
  if (!key) return { map: {}, source: 'empty' };
  // map traegt die Zuordnung Rebrickable-Farb-ID -> BrickLink-Farb-ID.
  // Ohne Typ ist `{}` fuer den Pruefer leer, und `map[c.id] = blId` waere
  // ein Schreibzugriff auf ein Feld, das es laut Typ nicht gibt.
  let page = 1, map: Record<string, any> = {}, hasNext = true;
  while (hasNext) {
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/colors/?page_size=200&page=${page}`,
      { Authorization: `key ${key}` }, 15000
    ).catch(() => ({ status: 0, body: '' }));
    if (status !== 200) break;
    const data = JSON.parse(body);
    for (const c of (data.results || [])) {
      const blId = c.external_ids?.BrickLink?.ext_ids?.[0] ?? c.external_ids?.BrickLink?.[0];
      if (blId != null) {
        map[c.id] = blId;
        db.run(`UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2`, [blId, c.id]).catch(() => {});
      }
    }
    hasNext = !!data.next;
    page++;
  }
  return { map, source: 'api' };
}

async function getManualParts(userId: Blickfeld, { page = 1, page_size = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const params: any[] = [uids];
  let limit = '';
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    params.push(size, (Math.max(1, parseInt(page) || 1) - 1) * size);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  return db.all(`
    SELECT id, user_id, part_number, bl_part_number, part_name, color_id, color_name, color_hex,
           category_name, quantity, image_url, image_local, unit_price, purchase_price, note, source,
           -- condition FEHLTE in dieser Liste. applyManualCondition() unten
           -- faellt ohne Erfassungen auf genau diesen gespeicherten Wert
           -- zurueck (stored || 'N') — und bekam undefined. NACHGEMESSEN:
           -- (Keine Backticks in diesem Kommentar: Er steht INNERHALB eines
           --  Template-Literals und wuerde es sonst beenden.)
           -- Ein manuell als „Gebraucht" erfasstes Teil ohne Kaufpreis-Eintrag
           -- kam als „Neu" heraus.
           --
           -- Die Schwesterfunktion getManualMinifigs() macht SELECT * und
           -- hatte den Fehler deshalb nie. Zwei Fassungen derselben Abfrage,
           -- eine davon mit Spaltenliste — und in der fehlte die eine Spalte,
           -- auf die es ankommt.
           condition,
           created_at
    FROM parts WHERE user_id = ANY($1) AND source = 'manual'
    ORDER BY part_name ASC, part_number ASC${limit}`, params)
    .then(async (rows) => withOwners(uids, await applyManualCondition(uids, rows, 'part')));
}

export { getPartsColors, tryPartsSummary, getParts, getPartsStats, getBlColorMap, getManualParts };
