/**
 * Lagerort — wo liegt das eigentlich?
 *
 * ── Warum es diesen Helfer gibt ─────────────────────────────────────────────
 *
 * Der Lagerort hängt an ZWEI Tabellen (`sets` und `parts`), und die drei
 * Dinge, die man damit tut — setzen, auflisten, räumen — sind für beide
 * dieselben. Stünden sie in den jeweiligen Routen, gäbe es jede Regel zweimal:
 * die Längenbegrenzung, das Trimmen, die Gleichsetzung von leer und NULL. Bei
 * solchen Paaren läuft erfahrungsgemäss eine der beiden Fassungen irgendwann
 * auseinander — im Baum ist das mehrfach passiert (siehe die Begründung an
 * utils/handlers/shared.ts).
 *
 * ── Warum die Orte aus den Daten kommen und nicht aus einer Tabelle ─────────
 *
 * Ein Lagerort ist ein Name, den sich jemand ausdenkt: „Kiste 3", „Regal
 * Keller". Er hat keine Eigenschaften und keinen Lebenslauf. Eine eigene
 * Tabelle hätte eine ID, einen Fremdschlüssel und eine Verwaltungsoberfläche
 * gebraucht — Ballast um eine Zeichenkette herum, und dazu die Möglichkeit
 * eines Ortes, in dem nichts liegt und den niemand mehr wegräumt.
 *
 * Deshalb: Die Liste der Orte IST die Liste der belegten Orte.
 */
import * as db from '../db/database';
import { asIds } from './household';
import type { BlickfeldEingabe } from './household';
import { fehlerWerfen } from './fehlerTexte';

/**
 * Wie lang ein Lagerortname höchstens sein darf.
 *
 * Kein technisches Limit (die Spalte ist TEXT), sondern ein fachliches: Was
 * hier steht, muss auf eine Kachel und in eine Auswahlliste passen. Ein
 * abgeschnittener Name in der Liste wäre schlimmer als eine Absage beim
 * Eintragen.
 */
export const LAGERORT_MAX_ZEICHEN = 60;

/** Die zwei Tabellen mit einem Lagerort — Whitelist, damit nie ein
 *  Request-Wert in den Tabellennamen gerät. */
const TABELLEN = { set: 'sets', part: 'parts' } as const;
export type LagerArt = keyof typeof TABELLEN;

/**
 * Eingabe zu dem machen, was in der Spalte steht.
 *
 * Leer und NULL sind dasselbe: „nicht erfasst". Ein leerer Text wäre ein Ort
 * namens „nichts" und stünde in jeder Auswahlliste — siehe die Begründung in
 * db/migrations/0018-lagerort.sql.
 */
export function normalisiereLagerort(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > LAGERORT_MAX_ZEICHEN) fehlerWerfen('lagerort_zu_lang', 400);
  return s;
}

/**
 * Lagerort setzen — für die Zeilen EINES Kontos.
 *
 * `besitzerIds` kommt von writableIds()/resolveWriteTarget(): Wer schreiben
 * darf, entscheidet utils/household.ts, nicht diese Funktion. Sie bekommt die
 * fertige Menge und fragt nicht nach.
 *
 * @returns wie viele Zeilen betroffen waren (0 = es gibt nichts zu setzen)
 */
export async function setzeLagerort(
  art: LagerArt, besitzerIds: number[], schluessel: string[], ort: string | null,
): Promise<number> {
  const tabelle = TABELLEN[art];
  const bedingung = art === 'set'
    ? 'set_number = $3'
    : 'part_number = $3 AND COALESCE(color_id, 0) = $4';
  // Kein `as any` auf dem Ergebnis: db.run() ist typisiert ({ changes, lastID }).
  // Die Schreibweise `(r as any).changes` steht anderswo im Baum noch aus einer
  // Zeit, in der das nicht galt — sie schaltet den Typpruefer ab, ohne etwas zu
  // gewinnen (test/ratschen.test.js zaehlt sie mit).
  const r = await db.run(
    `UPDATE ${tabelle} SET storage = $2 WHERE user_id = ANY($1) AND ${bedingung}`,
    [besitzerIds, ort, ...schluessel]);
  return r.changes ?? 0;
}

/**
 * Alle belegten Lagerorte im Blickfeld, mit Anzahl.
 *
 * ── Warum EINE Abfrage über beide Tabellen ──────────────────────────────────
 *
 * Zwei getrennte Listen zu liefern hiesse, dass die Oberfläche sie zusammen-
 * führt — und zwar jede für sich, in Web und App getrennt. Ein Ort, in dem
 * sowohl ein Set als auch lose Teile liegen, stünde dann je nach Oberfläche
 * einmal oder zweimal da.
 *
 * Gezählt wird nach ZEILEN, nicht nach Stückzahl: „In Kiste 3 liegen 4 Sets
 * und 120 Teilesorten" beantwortet „lohnt sich das Nachsehen?"; die Summe der
 * Einzelstücke beantwortet gar nichts.
 */
export async function lagerorte(blickfeld: BlickfeldEingabe) {
  const uids = asIds(blickfeld);
  const rows = await db.all(
    `SELECT ort,
            SUM(sets)::int  AS sets,
            SUM(teile)::int AS teile
       FROM (
         SELECT storage AS ort, COUNT(*)::int AS sets, 0 AS teile
           FROM sets  WHERE user_id = ANY($1) AND storage IS NOT NULL
          GROUP BY storage
         UNION ALL
         SELECT storage AS ort, 0 AS sets, COUNT(*)::int AS teile
           FROM parts WHERE user_id = ANY($1) AND storage IS NOT NULL
          GROUP BY storage
       ) q
      GROUP BY ort
      ORDER BY ort`, [uids]).catch(() => []);
  // Typisiert statt `(r: any)`: db.all() liefert Zeilen ohne Form, und dieser
  // Bauplan sagt, was diese Abfrage liefert. `sets`/`teile` stehen als string,
  // weil der Postgres-Treiber SUM() als Zeichenkette zurueckgibt — genau
  // deshalb steht darunter parseInt und nicht Number().
  type Zeile = { ort: string; sets: string | number; teile: string | number };
  return (rows as Zeile[] || []).map(r => ({
    ort: r.ort,
    sets:  parseInt(String(r.sets))  || 0,
    teile: parseInt(String(r.teile)) || 0,
  }));
}
