import * as db from '../../db/database';
import { resolveImageLocal } from '../katalog/bilder/images';
import { asIds } from '../haushalt/haushalt';
import type { BlickfeldEingabe } from '../haushalt/haushalt';
import { istErsatzteil, ersatzteilSql, colorId } from '../infra/validate';
import { ensureFresh } from './partsSummary';
// Direkt aus src/katalog/partsImport, nicht ueber routes/parts: Die Route hat die
// Funktion selbst nur importiert und weiterexportiert (Object.assign am
// Dateiende). Der Umweg sah wie Fachlogik in einer Route aus und war doch
// nur ein Durchreichen — er zog aber eine echte Abhaengigkeit von dieser
// Datei auf die aeusserste Schicht.
import { fetchMissingBlIds } from '../katalog/partsImport';
import type { RbSetTeil } from '../../clients/rebrickable';
import { getRbKey, httpsGetRobust } from '../../clients/rebrickable';
import { getAllSetParts } from '../katalog/rebrickableKatalog';
import { clampPageSize, applyManualCondition, withOwners, MAX_PAGE_SIZE, UNPAGED_LIMIT, SET_PARTS_MAX_PAGE_SIZE } from '../bestand/gemeinsam';
import { meldeUndWeiter, logAndContinue, meldeUndLiefere } from '../infra/httpError';
import { farbkarte as blFarbkarte } from '../finanzen/financeCalc';
import { getGlobalSetting } from '../konto/settings';
import { neuestesInventar } from '../katalog/rbInventar';
import { mitVersion, ohneVersion } from '../sets/setNummer';
import { merkeBlFarbnummer, blFarbnummerAus, blJoin, blNummerSql } from '../katalog/blZuordnung';
import { mengeJoin, mengeAus, teilmengeJoin, teilmengeAus } from '../../db/bestandsmenge';

/**
 * Leseabfragen für Teile — inklusive der Ausweichebenen (CSV-Zwischenspeicher,
 * Rebrickable), wenn der eigene Bestand ein Set nicht kennt.
 * Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#abschnitt
 */

/** Ein Blickfeld: eine Konto-ID oder die Liste aus scopeIds(); asIds() macht eine Liste daraus. */
import type { BlickfeldEingabe as Blickfeld } from '../haushalt/haushalt';
import * as httpError from '../infra/httpError';
import { marktpreiseAusCacheFuerTeile } from '../finanzen/marketPrice';

/** Farbliste des Teilebestands (ohne manuelle Positionen — die haben eine
 *  eigene Ansicht). Hex-Fallback aus rb_colors für Teile ohne eigenen Wert.
 *  Von /api/parts/colors UND /api/v1/parts/colors genutzt (Parität). */
export async function getPartsColors(userId: Blickfeld) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Aus der Zusammenfassung: dieselbe Gruppierung, aber über 66'000 statt
  // 171'000 Zeilen und ohne den Join auf sets — die Mengen sind dort bereits
  // mit der Set-Anzahl multipliziert.
  // strict: Kennzahlen müssen zwischen Webapp und App übereinstimmen — ein …
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getpartscolors
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
  // Farbbezeichnung und Farbcode aus part_color_catalog (Migration 0034):
  // Sie haengen am Teil-Farb-Paar, nicht am Konto, das das Teil besitzt.
  // Der Hex-Ausweich ueber rb_colors bleibt — fuer Teile, deren Katalogzeile
  // noch keinen Farbcode hat.
  return db.all(`
    SELECT pcc.color_name, COALESCE(pcc.color_hex, rc.rgb) AS color_hex,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int AS total_quantity
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part')}
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number
                                    AND pcc.color_id    = p.color_id
    LEFT JOIN rb_colors rc ON rc.id = p.color_id
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    GROUP BY pcc.color_name, COALESCE(pcc.color_hex, rc.rgb) ORDER BY total_quantity DESC`, [uids]);
}

/**
 * Volltextsuche über Teilenummer, Name und BrickLink-Nummer.
 * Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#teilesuche
 * @param nummer    Spalte mit der Rebrickable-Teilenummer
 * @param name      Spalte mit dem Teilenamen (darf NULL sein)
 * @param blNummer  Ausdruck für die BrickLink-Nummer (blNummerSql oder Spalte)
 * @param pi        Nummer des Platzhalters; der Aufrufer schiebt `%text%` hinein
 */
function teileSuche(nummer: string, name: string, blNummer: string, pi: number) {
  return `(${nummer} ILIKE $${pi} OR ${name} ILIKE $${pi} OR ${blNummer} ILIKE $${pi})`;
}

/**
 * WHERE-Klausel und Parameter der Teileliste aus den Abfrageparametern.
 * Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#teilefilter
 */
function teileFilter(uids: number[], query: any) {
  const { color, category, search, spare, set_number } = query;
  let where = 'p.user_id = ANY($1)';
  const params: any[] = [uids];
  let pi = 2;

  if (set_number) {
    where += ` AND p.set_number = $${pi++}`;
    params.push(mitVersion(set_number));
  }
  // Farbe, Kategorie und Name stehen in den Katalogen (Aliase pc/pcc aus
  // katalogJoin), das Ersatzteilkennzeichen in der Setliste (tm_k aus
  // teilmengeJoin).
  if (color)    { where += ` AND pcc.color_name = $${pi++}`;  params.push(color); }
  // Kategorie auch über rb_parts auflösen — die Kategorie steht bei vielen
  // Teilen auf 'Unknown', weil die Set-Teile-Antwort von
  // Rebrickable kein part_cat_id mitliefert. Die Filterliste zeigt deshalb die
  // über rb_parts aufgelöste ID; hier muss dieselbe Auflösung greifen, sonst
  // fände ein Klick nichts.
  if (category) {
    where += ` AND (pc.category_name = $${pi}
                    OR EXISTS (SELECT 1 FROM rb_parts rp
                                WHERE rp.part_num = p.part_number
                                  AND rp.part_cat_id::text = $${pi}))`;
    pi++; params.push(category);
  }
  // is_spare aus set_parts_catalog: Es ist eine Eigenschaft der TEILELISTE
  // eines Sets, nicht des Teils — derselbe Stein ist in einem Set Ersatzteil
  // und im naechsten Pflichtteil. COALESCE, weil ein Teil ohne Katalogzeile
  // (manuell erfasst) kein Ersatzteil ist.
  if (spare === '0') where += ' AND COALESCE(tm_k.is_spare, 0) = 0';
  if (spare === '1') where += ' AND COALESCE(tm_k.is_spare, 0) = 1';
  // Manuell erfasste Teile aus der Set-Teile-Übersicht ausschließen — sie haben
  // ihren eigenen Bereich ("Manuell erfasste Teile") und gehören nicht in die
  // nach Farbe/Kategorie gruppierte Set-Teileliste.
  if (query.exclude_manual === '1' || query.exclude_manual === true) {
    where += " AND COALESCE(p.source,'set') <> 'manual'";
  }
  if (search) {
    where += ` AND ${teileSuche('p.part_number', 'pc.part_name', blNummerSql('p.part_number'), pi)}`;
    params.push(`%${search}%`); pi++;
  }
  // Lagerort als eigener Filter, nicht als Teil der Volltextsuche: „Kiste 3"
  // soll genau die Teile in Kiste 3 zeigen und nicht zusaetzlich jedes Teil,
  // dessen Name zufaellig „Kiste" enthaelt.
  if (query.storage) {
    // Ueber den Namen aus dem Vorrat (lo), nicht mehr ueber eine Spalte an der
    // Zeile: Die traegt seit Migration 0031 die ID. Der Aufrufer schickt
    // weiter den Namen — die Oberflaechen und die API bleiben unveraendert.
    where += ` AND lo.name = $${pi++}`;
    params.push(String(query.storage));
  }

  return { where, params, pi };
}

/**
 * Teileliste EINES Sets, wenn der Nutzer selbst keine Zeilen dazu hat.
 * Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#teileersatzquelle
 */
async function teileErsatzquelle(set_number: string) {
    // Rebrickable kennt manche Sets nur ohne Versionsanhang.
    const n = mitVersion(set_number), alt = ohneVersion(n);
    const invId = await neuestesInventar(set_number).catch(meldeUndLiefere('teile:neuestesInventar', null));
    if (invId) {
      const csvParts = await db.all(`
        SELECT ip.part_num AS part_number,
               COALESCE(m.bl_id, ip.part_num) AS bl_part_number,
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
        LEFT JOIN bl_zuordnung  m ON m.art = 'part' AND m.rb_id = ip.part_num
        WHERE ip.inventory_id = $1`, [invId, set_number]
      );
      if (csvParts.length > 0)
        // page_size gehört in jeden Rückgabeweg: Der Client entscheidet daran,
        // ob er weiterblättert. Hier kommt alles, also ist es die Zeilenzahl.
        return { parts: csvParts, total: csvParts.length, source: 'csv_cache', page_size: csvParts.length };
    }

    // Rebrickable-Rückfallebene.
    // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#teileersatzquelle-rbkey
    const rbKey = await getGlobalSetting('rebrickable_api_key');
    if (rbKey) {
      for (const sn of [n, alt]) {
        const items = await getAllSetParts(sn).catch(meldeUndLiefere('teile:getAllSetParts', []));
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
 * Reihenfolge der Teileliste. Nur nach Farbe gruppiert die Oberfläche; die
 * anderen beiden sind für die ungruppierte Liste. Feste Liste, weil der Wert
 * als SQL in die Anfrage geht. Der letzte Schlüssel macht die Seiten stabil.
 */
type TeileOrdnung = 'farbe' | 'name' | 'menge';
function teileOrdnung(wert: unknown): TeileOrdnung {
  return wert === 'name' || wert === 'menge' ? wert : 'farbe';
}
function ordnungSql(o: TeileOrdnung, sp: { farbe: string; name: string; menge: string; nummer: string }): string {
  if (o === 'name')  return `${sp.name} ASC, ${sp.farbe} ASC, ${sp.nummer} ASC`;
  if (o === 'menge') return `${sp.menge} DESC, ${sp.name} ASC, ${sp.nummer} ASC`;
  return `${sp.farbe} ASC, ${sp.name} ASC`;
}

export async function tryPartsSummary(userId: Blickfeld, o: any) {
  const uids = asIds(userId);
  // Seitenabfrage aus der Zusammenfassung; null heisst: Die Live-Abfrage
  // übernimmt. Sie ist je Konto gebaut, frisch nur, wenn alle Konten es sind.
  if (!(await ensureFresh(uids))) return null;

  const cond: string[] = ['user_id = ANY($1)'];
  const params: any[] = [uids];
  // Der Filter schickt den FARBNAMEN, nicht die ID — `parseInt('Black')` ergibt
  // NaN, und die Bedingung traf dann auf nichts zu: „Keine Teile gefunden",
  // sobald eine Farbe angeklickt wurde. Der Live-Pfad darunter vergleicht
  // ebenfalls über color_name; beide müssen dasselbe tun.
  if (o.color) { cond.push(`color_name = $${params.length + 1}`); params.push(o.color); }
  // Kategorie wie im Live-Pfad: die eigene, sonst die aus rb_parts (die
  // Set-Teile-Antwort liefert oft keine und hinterlässt 'Unknown').
  if (o.category) {
    const pi = params.length + 1;
    // IN statt EXISTS: Die Unterabfrage hängt nicht an der Zeile und wird
    // einmal als Hashtabelle gebaut, statt je Zeile der Zusammenfassung.
    cond.push(`(category_name = $${pi} OR part_number IN (SELECT rp.part_num FROM rb_parts rp
                 WHERE rp.part_cat_id::text = $${pi}))`);
    params.push(String(o.category));
  }
  if (o.spare === '0' || o.spare === '1') {
    cond.push(`COALESCE(is_spare, 0) = $${params.length + 1}`);         params.push(parseInt(o.spare));
  }
  if (o.search) {
    cond.push(teileSuche('part_number', 'part_name', 'bl_part_number', params.length + 1));
    params.push(`%${o.search}%`);
  }
  const where = cond.join(' AND ');

  // Dieselbe Obergrenze wie im Live-Pfad; ohne page_size UNPAGED_LIMIT.
  const obergrenze = o.set_number ? SET_PARTS_MAX_PAGE_SIZE : MAX_PAGE_SIZE;
  const size = o.page_size
    ? Math.min(obergrenze, Math.max(1, parseInt(String(o.page_size)) || 100))
    : UNPAGED_LIMIT;
  const pg   = Math.max(1, parseInt(String(o.page)) || 1);
  const limit = ` LIMIT ${size} OFFSET ${(pg - 1) * size}`;

  // Über mehrere Konten wird über part_key verdichtet: Dasselbe Teil steht
  // je Konto einmal in der Tabelle und soll eine Zeile mit der Summe sein.
  const multi = uids.length > 1;
  const cols = multi
    ? `MIN(part_number) AS part_number, MIN(bl_part_number) AS bl_part_number, color_id,
       MIN(part_name) AS part_name, MIN(color_name) AS color_name, MIN(color_hex) AS color_hex,
       MIN(category_name) AS category_name, MIN(image_url) AS image_url,
       MIN(image_local) AS image_local, MAX(COALESCE(is_spare,0)) AS is_spare,
       SUM(total_quantity)::int AS total_quantity,
       NULLIF(STRING_AGG(DISTINCT storage, ', '), '') AS storage` +
      (o.withSets ? ", STRING_AGG(DISTINCT in_sets, ',') AS in_sets" : '')
    : `part_number, bl_part_number, color_id, part_name, color_name, color_hex,
       category_name, image_url, image_local, is_spare, total_quantity::int, storage` +
      (o.withSets ? ', in_sets' : '');
  const groupSql = multi ? ' GROUP BY part_key, color_id' : '';
  const orderSql = ordnungSql(teileOrdnung(o.ordnung), multi
    ? { farbe: 'MIN(color_name)', name: 'MIN(part_name)', menge: 'SUM(total_quantity)', nummer: 'part_key, color_id' }
    : { farbe: 'color_name', name: 'part_name', menge: 'total_quantity', nummer: 'part_key, color_id' });

  // Scheitert die Abfrage, ist das ein RUECKFALL, kein Fehler
  // Das ist der Kern des Fehlers, nicht die fehlende Spalte: Diese Funktion
  // heisst `try…` und gibt sonst ueberall `null` zurueck, wenn die
  // Zusammenfassung nicht benutzbar ist — bei fehlender Frische, bei einem …
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#trypartssummary-countrow
  let countRow, rows;
  try {
    [countRow, rows] = await Promise.all([
      multi
        ? db.get(`SELECT COUNT(*)::int AS c FROM (
                    SELECT 1 FROM parts_summary WHERE ${where} GROUP BY part_key, color_id
                  ) t`, params)
        : db.get(`SELECT COUNT(*)::int AS c FROM parts_summary WHERE ${where}`, params),
      db.all(`SELECT ${cols} FROM parts_summary WHERE ${where}${groupSql}
              ORDER BY ${orderSql}${limit}`, params),
    ]);
  } catch (e) {
    httpError.meldeUndWeiter('teile:zusammenfassung', e);
    return null;
  }

  // is_spare als echter Wahrheitswert — wie im Live-Zweig
  // Die Teileliste der Android-App blieb LEER. Ein einziger solcher Wert
  // laesst die ganze Seite scheitern; das Kotlin-Modell fuehrt is_spare als
  // Boolean, und `coerceInputValues` faengt nur null, keinen Typwechsel.
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#trypartssummary
  return {
    parts: rows.map(r => ({ ...r, total_quantity: parseInt(r.total_quantity) || 0,
                            is_spare: istErsatzteil(r.is_spare),
                            image_local: resolveImageLocal(r.image_local) })),
    total: parseInt(countRow?.c || 0),
    source: 'summary',
    page_size: size,
  };
}

export async function getParts(userId: Blickfeld, query: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
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
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getparts-qtyexpr
  const qtyExpr   = set_number
    ? `SUM(${teilmengeAus('p', 'part')})::int`
    : `SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int`;
  // Der Vorrat haengt in BEIDEN Zweigen mit dran: Seit Migration 0031 traegt
  // die Zeile eine ID, der Name steht in storage_locations. LEFT JOIN, damit
  // ein Teil ohne Ort nicht aus der Liste faellt.
  const lagerJoin = ' LEFT JOIN storage_locations lo ON lo.id = p.storage_id';
  // Die Beschreibung kommt aus den Katalogen (Migration 0034)
  // pc  je Teilenummer:          Name, Kategorie
  // pcc je Teilenummer + Farbe:  Farbbezeichnung, Farbcode, Bild
  // Das Ersatzteilkennzeichen kommt aus tm_k (set_teile), das für die Menge
  // ohnehin angehängt ist — ein zweiter Join derselben Liste kostete ein Viertel.
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getparts-katalogjoin
  const katalogJoin =
    ' LEFT JOIN part_catalog pc ON pc.part_number = p.part_number'
  + ' LEFT JOIN part_color_catalog pcc ON pcc.part_number = p.part_number'
  + '                                 AND pcc.color_id    = p.color_id';
  // Ohne set_number-Filter haengt die Set-Menge mit dran (der Faktor in
  // qtyExpr). Mit Filter nicht: Dort geht es um die Teile EINES Sets.
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getparts-joinclause
  const joinClause = (set_number ? 'FROM parts p' : `FROM parts p ${mengeJoin('p')}`)
    + ` ${teilmengeJoin('p', 'part', 'tm', '= ANY($1)')}`
    + ` ${blJoin('p.part_number', 'part')}`
    + lagerJoin + katalogJoin;

  // Count for pagination.
  // Vorher COUNT(DISTINCT <concat>) — das baut pro Zeile einen String und
  // sortiert ihn anschliessend. COUNT(*) über dieselbe Gruppierung nutzt den
  // HashAggregate und ist bei 171'000 Zeilen gemessen rund 2,7× schneller …
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getparts-excludesmanual
  const excludesManual = query.exclude_manual === '1' || query.exclude_manual === true;
  // Mit Set- oder Lagerortfilter die Live-Abfrage: Die Zusammenfassung kennt
  // den Lagerort nur verdichtet, und der Filter macht die Menge ohnehin klein.
  if (excludesManual && !set_number && !query.storage) {
    const summary = await tryPartsSummary(uids, { color, category, search, spare, page, page_size, withSets, ordnung: query.ordnung });
    if (summary) return summary;
  }

  // Dieselben Joins wie die Hauptabfrage, nicht nur `FROM parts p`
  // Die zusaetzlichen Joins aendern die Zahl nicht: Jeder haengt am
  // Primaerschluessel seiner Tabelle, liefert also hoechstens eine Zeile.
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getparts-countsql
  const countSql = `SELECT COUNT(*)::int AS c FROM (
       SELECT 1 ${joinClause} WHERE ${where}
       GROUP BY ${blNummerSql('p.part_number')}, p.color_id
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
      -- Use BL part number as the canonical identifier. Sie kommt seit
      -- Migration 0037 aus bl_zuordnung (blz) und stand vorher je Konto
      -- an der Bestandszeile.
      ${blNummerSql('p.part_number')} AS part_number,
      ${blNummerSql('p.part_number')} AS bl_part_number,
      -- Pick one representative part name/image (MIN is deterministic).
      -- Die Werte kommen aus den Katalogen (Migration 0034); MIN bleibt,
      -- weil die Gruppe mehrere Rebrickable-Nummern derselben BL-Nummer
      -- zusammenfasst.
      MIN(pc.part_name)    AS part_name,
      p.color_id,
      MIN(pcc.color_name)  AS color_name,
      MIN(pcc.color_hex)   AS color_hex,
      MIN(pc.category_name) AS category_name,
      MIN(pcc.image_url)   AS image_url,
      MIN(pcc.image_local) AS image_local,
      MAX(COALESCE(tm_k.is_spare, 0)) AS is_spare,
      -- Lagerort: string_agg statt MIN, und das ist kein Zierrat. Diese
      -- Abfrage fasst je Teil-Farb-Paar MEHRERE Zeilen zusammen (dasselbe
      -- Teil aus verschiedenen Sets, im Haushalt zusaetzlich aus verschiedenen
      -- Konten). Die anderen Aggregate greifen dabei einen stellvertretenden
      -- Wert, weil Name und Bild fuer alle gleich sind. Der Lagerort ist das
      -- nicht: Dasselbe Teil liegt in zwei Kisten, und MIN() haette eine davon
      -- gezeigt und die andere verschwiegen — so, dass es wie eine
      -- vollstaendige Antwort aussieht.
      NULLIF(STRING_AGG(DISTINCT lo.name, ', '), '') AS storage,
      -- Sum quantities across all RB part numbers that map to the same BL ID
      ${qtyExpr}          AS total_quantity${withSets ? `,
      STRING_AGG(DISTINCT p.set_number, ',') AS in_sets` : ''}
    ${joinClause}
    WHERE ${where}
    GROUP BY ${blNummerSql('p.part_number')}, p.color_id
    ORDER BY ${ordnungSql(teileOrdnung(query.ordnung), { farbe: 'MIN(pcc.color_name)', name: 'MIN(pc.part_name)',
      menge: qtyExpr, nummer: `${blNummerSql('p.part_number')}, p.color_id` })}${limitClause}`;

  // Angezeigter Zustand: nur noch aus den Erfassungen
  // Sobald eine Erfassung „Gebraucht" ist, gilt das Teil als gebraucht.
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getparts-usedsql
  const usedSql =
    `SELECT ${blNummerSql('p.part_number')} AS pid, p.color_id,
            MAX(CASE WHEN pa.condition='U' THEN 1 ELSE 0 END) AS any_used
     FROM parts p
     ${blJoin('p.part_number', 'part')}
     JOIN part_acquisitions pa ON pa.user_id=p.user_id AND pa.part_number=p.part_number AND pa.color_id=p.color_id
     WHERE p.user_id = ANY($1) AND p.source='manual'
     GROUP BY ${blNummerSql('p.part_number')}, p.color_id`;

  const [countRow, parts, usedPartRows] = await Promise.all([
    db.get(countSql, params),
    db.all(partsSql, queryParams),
    excludesManual ? Promise.resolve([]) : db.all(usedSql, [uids]),
  ]);
  const total = parseInt(countRow?.c || 0);
  const usedPartMap = new Map<string, boolean>(usedPartRows.map(r => [`${r.pid}|${r.color_id}`, (parseInt(r.any_used) || 0) > 0] as [string, boolean]));

  // Normalize is_spare and resolve image paths
  const partsResolved = parts.map(p => ({
    ...p,
    // Ohne Erfassung 'N' — nicht mehr der gespeicherte Wert, den es nicht
    // mehr gibt (Migration 0035). Fuer Set-Teile ist das dasselbe Ergebnis
    // wie vorher, siehe die Begruendung bei usedSql.
    condition: usedPartMap.get(`${p.part_number}|${p.color_id}`) ? 'U' : 'N',
    image_local: resolveImageLocal(p.image_local),
    image_url:   p.image_url || null,
    // Ein echter Wahrheitswert, nicht '1'/'0': Der Treiber liefert das
    // Aggregat als ZEICHENKETTE, und "0" ist in JavaScript wahr. Die
    // Schreibweisen liest istErsatzteil() (src/infra/validate.ts) an EINER Stelle.
    is_spare: istErsatzteil(p.is_spare)
  }));

  // Background: fetch missing BL IDs
  setImmediate(async () => {
    try {
      // Gefragt wird nach der ZEILE: Eine mit leerer bl_id heisst „nachgesehen,
      // keine abweichende Nummer“ und löst kein Nachladen aus.
      const unmapped = await db.get(
        `SELECT 1 FROM parts p
         LEFT JOIN bl_zuordnung m ON m.art = 'part' AND m.rb_id = p.part_number
         WHERE p.user_id = ANY($1) AND m.rb_id IS NULL LIMIT 1`, [uids]
      );
      if (unmapped) fetchMissingBlIds().catch(logAndContinue('teile:fetchMissingBlIds'));
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

/**
 * Die Kategorien der Set-Teile mit Zahl und Menge. Die Kategorie kommt aus
 * dem eigenen Katalog, sonst aus rb_parts: Die Set-Teile-Antwort von
 * Rebrickable liefert meist keine, und die Liste bestünde sonst aus „Unbekannt“.
 * Aus der Zusammenfassung, wenn sie frisch ist; gezählt werden dann die Gruppen
 * der Teileliste (BrickLink-Nummer und Farbe), wie bei der Farbliste.
 */
export async function getPartsCategories(userId: Blickfeld) {
  const uids = asIds(userId);
  const kategorie = (spalte: string, nummer: string) => `
      LEFT JOIN rb_part_categories rc
             ON rc.id = (CASE WHEN ${spalte} ~ '^[0-9]+$' THEN ${spalte}::int ELSE NULL END)
      LEFT JOIN rb_parts rp ON rp.part_num = ${nummer}
      LEFT JOIN rb_part_categories rp_cat ON rp_cat.id = rp.part_cat_id`;
  const gruppe = `GROUP BY COALESCE(rc.id::text, rp_cat.id::text, {k}), COALESCE(rc.name, rp_cat.name, 'Unbekannt')
      ORDER BY total_quantity DESC`;
  if (await ensureFresh(uids, { strict: true })) {
    return db.all(`
      SELECT COALESCE(rc.id::text, rp_cat.id::text, ps.category_name) AS category_name,
             COALESCE(rc.name, rp_cat.name, 'Unbekannt')                AS label,
             COUNT(DISTINCT ps.part_key)::int AS unique_parts,
             SUM(ps.total_quantity)::int      AS total_quantity
        FROM parts_summary ps
        ${kategorie('ps.category_name', 'ps.part_number')}
       WHERE ps.user_id = ANY($1)
      ${gruppe.replace('{k}', 'ps.category_name')}`, [uids]);
  }
  return db.all(`
    SELECT COALESCE(rc.id::text, rp_cat.id::text, pc.category_name) AS category_name,
           COALESCE(rc.name, rp_cat.name, 'Unbekannt')              AS label,
           COUNT(DISTINCT p.part_number)::int AS unique_parts,
           SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)})::int AS total_quantity
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part', 'tm', '= ANY($1)')}
    LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
    ${kategorie('pc.category_name', 'p.part_number')}
    WHERE p.user_id = ANY($1) AND COALESCE(p.source,'set') <> 'manual'
    ${gruppe.replace('{k}', 'pc.category_name')}`, [uids]);
}

export async function getPartsStats(userId: Blickfeld) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  // Kennzahlen der Set-Teile aus der Zusammenfassung — strict, weil Webapp und
  // App dieselben Zahlen zeigen müssen. DISTINCT zählt ein Teil in zwei Konten
  // einmal, die Summe addiert sich.
  if (await ensureFresh(uids, { strict: true })) {
    const r = await db.get(`
      SELECT COUNT(DISTINCT part_number)::int AS unique_parts,
             COUNT(DISTINCT color_id)::int    AS unique_colors,
             COALESCE(SUM(total_quantity), 0) AS total_parts
        FROM parts_summary WHERE user_id = ANY($1)`, [uids]);
    if (r) return {
      unique_parts:  parseInt(r.unique_parts  || 0),
      unique_colors: parseInt(r.unique_colors || 0),
      total_parts:   parseInt(r.total_parts   || 0),
    };
  }
  // Derselbe Filter wie in der Zusammenfassung, und warum er gefehlt hat
  // Der Kommentar oben sagt es schon: „Die Kennzahlen beziehen sich wie die
  // Liste auf Set-Teile; manuell erfasste haben ihren eigenen Bereich." Die
  // Zusammenfassung setzt das um (`COALESCE(p.source, 'set') <> 'manual'` in …
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getpartsstats-row
  const row = await db.get(`
    SELECT COUNT(DISTINCT p.part_number) AS unique_parts,
           COUNT(DISTINCT p.color_id)    AS unique_colors,
           SUM(${teilmengeAus('p', 'part')} * ${mengeAus('sm', 1)}) AS total_parts
    FROM parts p
    ${mengeJoin('p', 'sm', '= ANY($1)')}
    ${teilmengeJoin('p', 'part')}
    WHERE p.user_id = ANY($1) AND COALESCE(p.source, 'set') <> 'manual'`, [uids]);
  return {
    unique_parts:  parseInt(row?.unique_parts  || 0),
    unique_colors: parseInt(row?.unique_colors || 0),
    total_parts:   parseInt(row?.total_parts   || 0),
  };
}

export async function getBlColorMap() {
  // Zuerst die Datenbank über farbkarte() (src/finanzen/financeCalc.ts), die die Karte
  // zehn Minuten merkt.
  const karte = await blFarbkarte();
  if (karte.size > 0) {
    const map: any = {};
    for (const [id, blId] of karte) map[id] = blId;
    return { map, source: 'db' };
  }
  // Fallback: fetch from Rebrickable API and cache in DB
  const key = await getRbKey().catch(meldeUndLiefere('teile:getRbKey', null));
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
      const blId = blFarbnummerAus(c);
      if (blId != null) {
        map[c.id] = blId;
        merkeBlFarbnummer(c.id, blId).catch(logAndContinue('teile:merkeBlFarbnummer'));
      }
    }
    hasNext = !!data.next;
    page++;
  }
  return { map, source: 'api' };
}

/**
 * @param viewerId Wessen EINSTELLUNGEN gelten (Waehrung fuer den Marktpreis) —
 *   getrennt von `userId`, das sagt, wessen DATEN gelesen werden.
 * @param search  Suchtext der Filterleiste. Siehe die Begruendung unten.
 */
export async function getManualParts(userId: Blickfeld, viewerId: number,
                              { page = 1, page_size = null, search = null, storage = null }: any = {}) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in src/haushalt/haushalt.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId);
  const params: any[] = [uids];
  // Der Suchtext wirkt auch hier
  // Dass er BEIDE Listen trifft, ist keine Auslegung: public/index.html stellt
  // die Filterleiste ueber den manuellen Bereich und begruendet es dort
  // ausdruecklich damit („Der Filter wirkt auf beide Listen"), und …
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getmanualparts-filter
  let filter = '';
  if (search) {
    params.push(`%${search}%`);
    filter = ` AND ${teileSuche('t.part_number', 'pc.part_name', blNummerSql('t.part_number'), params.length)}`;
  }
  // Der Lagerortfilter steht in derselben Leiste und gehoert zum gleichen
  // Versprechen. Ueber den NAMEN aus dem Vorrat (lo), nicht ueber eine Spalte
  // an der Zeile — die traegt seit Migration 0031 die ID; dieselbe Form wie in
  // teileFilter(), wo der Grund ausgeschrieben steht.
  if (storage) {
    params.push(String(storage));
    filter += ` AND lo.name = $${params.length}`;
  }
  let limit = '';
  if (page_size) {
    const size = clampPageSize(page_size, 60);
    params.push(size, (Math.max(1, parseInt(page) || 1) - 1) * size);
    limit = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  return db.all(`
    SELECT t.id, t.user_id, t.part_number,
           -- Die BrickLink-Nummer aus der Zuordnung (Migration 0037); hier
           -- stand t.bl_part_number, eine Abschrift je Konto. Der Feldname
           -- nach aussen bleibt, damit beide Oberflaechen und die App
           -- unveraendert weiterlesen.
           ${blNummerSql('t.part_number')} AS bl_part_number,
           pc.part_name, t.color_id,
           pcc.color_name, pcc.color_hex,
           pc.category_name,
           -- Die Stückzahl aus den Erfassungen (Migration 0038); hier stand
           -- t.quantity. Diese Liste zeigt nur manuelle Teile, der
           -- Set-Zweig der Fallunterscheidung greift hier also nie.
           ${teilmengeAus('t', 'part')} AS quantity,
           pcc.image_url, pcc.image_local,
           -- ── Preis und Zustand aus der NEUESTEN Erfassung ───────────────
           --
           -- Hier standen t.unit_price, t.purchase_price und t.condition —
           -- eine Abschrift der letzten Erfassung an der Bestandszeile.
           -- Migration 0035 hat die drei Spalten geloescht; die Regel
           -- „latest wins" steht jetzt an EINER Stelle, hier, statt zusaetzlich
           -- in parentPriceSql und parentConditionSql (routes/api_v1/
           -- acquisitions.ts).
           --
           -- Die beiden Bedeutungen bleiben unterschieden, so wie
           -- src/finanzen/preisRegel.ts sie ausschreibt: unit_price ist der
           -- eingegebene Preis und darf leer sein, purchase_price ist der
           -- ANZEIGEWERT und ist nie leer (0 heisst „nichts bekannt").
           neu.unit_price,
           COALESCE(neu.unit_price, 0) AS purchase_price,
           t.source,
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
           COALESCE(neu.condition, 'N') AS condition,
           -- storage FEHLTE ebenfalls — und zwar aus demselben Grund wie
           -- die Spalte condition eine Zeile darueber: Diese Abfrage zaehlt ihre
           -- Spalten auf, die Schwesterfunktion getManualMinifigs() macht
           -- SELECT *. Marcos Befund vom 24.09. („Auf dem Detail Dialog der
           -- manuell erfassten Teile ist der Lagerort nicht ersichtlich") ist
           -- damit zur Haelfte hier begruendet: Selbst mit einer Zeile in der
           -- Oberflaeche waere sie leer geblieben.
           -- Der Name kommt seit Migration 0031 aus dem Vorrat; die Zeile
           -- traegt die ID. LEFT JOIN, damit ein Teil ohne Ort in der Liste
           -- bleibt.
           lo.name AS storage,
           -- Hier stand t.created_at. Die Spalte war das Doppel von added_at
           -- mit derselben Bedeutung; Migration 0034 hat sie geloescht und
           -- added_at daraus nachgefuellt. Der Name nach aussen bleibt, damit
           -- die Oberflaechen und die App unveraendert weiterlesen.
           t.added_at AS created_at
    FROM parts t
    ${teilmengeJoin('t', 'part')}
    ${blJoin('t.part_number', 'part')}
    -- Beschreibung aus den Katalogen (Migration 0034). Dieselben beiden
    -- Tabellen wie in getParts, nur mit dem Alias dieser Abfrage.
    LEFT JOIN part_catalog pc ON pc.part_number = t.part_number
    LEFT JOIN part_color_catalog pcc ON pcc.part_number = t.part_number
                                    AND pcc.color_id    = t.color_id
    LEFT JOIN storage_locations lo ON lo.id = t.storage_id
    -- LATERAL, weil die Unterabfrage auf die aeussere Zeile zeigt. LIMIT 1
    -- nach created_at DESC, id DESC: dieselbe Ordnung, die latestSql in
    -- routes/api_v1/acquisitions.ts benutzt — sonst haetten „neuester Preis"
    -- und „neueste Erfassung" zwei Bedeutungen.
    LEFT JOIN LATERAL (
      SELECT a.unit_price, a.condition
        FROM part_acquisitions a
       WHERE a.user_id = t.user_id AND a.part_number = t.part_number
         AND a.color_id = t.color_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 1
    ) neu ON TRUE
    WHERE t.user_id = ANY($1) AND t.source = 'manual'${filter}
    ORDER BY pc.part_name ASC, t.part_number ASC${limit}`, params)
    .then(async (rows) => {
      const mitZustand = await applyManualCondition(uids, rows, 'part');
      // Der Marktpreis gehoert dazu — dieselbe Luecke wie bei den manuellen
      // Figuren, dieselbe Begruendung: Der Detailbildschirm der App liest ihn
      // aus `avg_price`, diese Liste fuehrt nur Bestandsspalten. Nur aus dem
      // Cache, EINE Abfrage fuer die ganze Liste (src/finanzen/marketPrice.ts).
      const preise: Map<string, number> = await marktpreiseAusCacheFuerTeile(mitZustand, viewerId)
        .catch(() => new Map<string, number>());
      const mitPreis = mitZustand.map((t: any) =>
        ({ ...t, avg_price: preise.get(`${t.part_number}|${t.color_id}`) ?? null }));
      return withOwners(uids, mitPreis);
    });
}

/**
 * Wie viele der angefragten Teile im Blickfeld tatsächlich vorhanden sind.
 * Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#bestand-max-teile
 */
export const BESTAND_MAX_TEILE = 5000;

export async function getOwnedQuantities(
  blickfeld: BlickfeldEingabe,
  teile: Array<{ part_number?: string; color_id?: number | string }>,
): Promise<Record<string, { gesamt: number; lose: number }>> {
  const uids = asIds(blickfeld);
  // Doppelte Schlüssel fallen hier weg: Eine Teileliste über mehrere Sets
  // fragt dasselbe Teil sonst mehrfach, und die Abfrage würde unnötig gross.
  const gesehen = new Set<string>();
  const nums: string[] = [];
  const farben: number[] = [];
  for (const t of teile || []) {
    const num = String(t?.part_number ?? '').trim();
    if (!num) continue;
    const farbe = colorId(t?.color_id);
    const key = `${num}|${farbe}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    nums.push(num);
    farben.push(farbe);
    if (nums.length >= BESTAND_MAX_TEILE) break;
  }
  if (!nums.length) return {};

  // Ersatzteile zählen MIT: Ein Ersatzteil, das dem Set beilag, liegt in der
  // Schachtel und lässt sich verbauen. Die Bedarfsseite schliesst sie aus
  // (parts-list), die Bestandsseite nicht — das ist kein Widerspruch, sondern
  // genau der Unterschied zwischen „braucht man" und „hat man".
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getownedquantities-rows
  const rows = await db.all(
    `SELECT p.part_number,
            p.color_id,
            -- teilmengeAus() traegt die Fallunterscheidung schon in sich:
            -- manuell → Summe der Erfassungen, Set → Katalogzahl. Die
            -- CASE-Verzweigung hier bleibt trotzdem, weil sie etwas
            -- ANDERES entscheidet — ob der Set-Faktor dazukommt.
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
      GROUP BY p.part_number, p.color_id`,
    [uids, nums, farben]
  );

  const out: Record<string, { gesamt: number; lose: number }> = {};
  for (const r of rows || []) {
    out[`${r.part_number}|${r.color_id}`] =
      { gesamt: parseInt(r.gesamt) || 0, lose: parseInt(r.lose) || 0 };
  }

  //  Minifiguren zaehlen mit (Marcos „die Teile sollten in meinem Bestand
  //    liegen")
  // Ausführlich: docs/begruendungen/src/teile/abfragen.ts.md#getownedquantities-figrows
  const figRows = await db.all(
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
      GROUP BY m.fig_number`,
    [uids, nums]
  );
  for (const r of figRows || []) {
    const key = `${r.part_number}|0`;
    if (out[key]) continue;
    out[key] = { gesamt: parseInt(r.gesamt) || 0, lose: parseInt(r.lose) || 0 };
  }
  return out;
}
