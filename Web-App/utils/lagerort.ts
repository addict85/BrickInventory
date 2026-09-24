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
 * ── Die Orte kommen jetzt aus einer TABELLE — und warum das früher anders war
 *
 * Hier stand: „Ein Lagerort ist ein Name, den sich jemand ausdenkt. Er hat
 * keine Eigenschaften und keinen Lebenslauf. Die Liste der Orte IST die Liste
 * der belegten Orte." Das war für den Anfang richtig und hat sich als zu eng
 * erwiesen. Marcos Vorgabe:
 *
 *   „Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man
 *    auch gleich neue Auswahlwerte erfassen kann. Die Werte sollen pro User
 *    verwaltet werden können und sollen in den Einstellungen bearbeitbar
 *    sein."
 *
 * Eine abgeleitete Liste kann drei Dinge nicht, die alle drei verlangt sind:
 * einen Ort ANLEGEN, bevor etwas darin liegt; ihn UMBENENNEN, ohne jedes Set
 * einzeln anzufassen; ihn LÖSCHEN. Deshalb `storage_locations` (Migration
 * 0020) — der Vorrat.
 *
 * Die Zuordnung bleibt der freie Text in `sets.storage` / `parts.storage`.
 * Eine Fremdschlüssel-ID hätte jede bestehende Zeile umschreiben müssen und
 * jede Abfrage um einen JOIN erweitert — für einen Namen, der ohnehin
 * eindeutig ist. [lagerorte] zählt deshalb weiter, was WIRKLICH belegt ist;
 * [orteVon] sagt, was zur Wahl steht. Beides wird gebraucht, und es ist nicht
 * dasselbe.
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

/** Die drei Tabellen mit einem Lagerort — Whitelist, damit nie ein
 *  Request-Wert in den Tabellennamen gerät.
 *
 *  Die Minifigur kam am 24.09. dazu (Migration 0024). 0018 hatte sie
 *  uebersehen: „Ein Set liegt in einer Schachtel, lose Teile liegen in einer
 *  Kiste. Beide Fragen sind dieselbe Frage" — die Figur ist dieselbe Frage
 *  zum dritten Mal. Alles, was ueber diese Liste laeuft (Umbenennen,
 *  Loeschen, Zaehlen), nimmt sie damit von selbst mit; genau darum steht sie
 *  hier und nicht dreimal einzeln. */
const TABELLEN = { set: 'sets', part: 'parts', fig: 'minifigs' } as const;
export type LagerArt = keyof typeof TABELLEN;

/** Woran eine Zeile je Art erkannt wird — dieselbe Reihenfolge wie die
 *  Schluessel, die [setzeLagerort] entgegennimmt. */
const BEDINGUNG: Record<LagerArt, string> = {
  set:  'set_number = $3',
  part: 'part_number = $3 AND COALESCE(color_id, 0) = $4',
  fig:  'fig_number = $3',
};

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
  const bedingung = BEDINGUNG[art];
  // Kein `as any` auf dem Ergebnis: db.run() ist typisiert ({ changes, lastID }).
  // Die Schreibweise `(r as any).changes` steht anderswo im Baum noch aus einer
  // Zeit, in der das nicht galt — sie schaltet den Typpruefer ab, ohne etwas zu
  // gewinnen (test/ratschen.test.js zaehlt sie mit).
  const r = await db.run(
    `UPDATE ${tabelle} SET storage = $2 WHERE user_id = ANY($1) AND ${bedingung}`,
    [besitzerIds, ort, ...schluessel]);
  // Ein Name, den es im Vorrat noch nicht gibt, kommt hinein — das ist
  // Marcos „man kann auch gleich neue Auswahlwerte erfassen". Ohne diese
  // Zeile stünde der gerade gesetzte Ort am Set, fehlte aber in der Liste,
  // aus der er gewählt werden soll.
  //
  // NACH dem UPDATE und nur bei Erfolg: Ein Ort, der keiner Zeile zugeordnet
  // werden konnte (falsches Set, kein Schreibrecht), soll auch keinen
  // Eintrag im Vorrat hinterlassen.
  if (ort && (r.changes ?? 0) > 0) await stelleOrteSicher(besitzerIds, ort);
  return r.changes ?? 0;
}

/**
 * Ein Lagerort — der Vorrat, aus dem gewählt wird.
 *
 * `user_id` steht mit drin, weil eine Liste über mehrere Konten spannen kann
 * (der Grossvater sieht beim Set des Enkels dessen Orte) und die Oberfläche
 * sonst nicht wüsste, wessen Eintrag sie gerade bearbeitet.
 */
export interface Lagerort { id: number; user_id: number; name: string }

function nameOderFehler(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) fehlerWerfen('lagerort_leer', 400);
  if (s.length > LAGERORT_MAX_ZEICHEN) fehlerWerfen('lagerort_zu_lang', 400);
  return s;
}

/**
 * Der Vorrat EINES oder MEHRERER Konten.
 *
 * ── Warum die Aufrufer die IDs mitbringen ──────────────────────────────────
 *
 * Dieselbe Trennung wie bei [setzeLagerort]: Wer wessen Liste sehen darf,
 * entscheidet utils/household.ts, nicht diese Datei. Hier steht nur, wie man
 * sie liest.
 *
 * Sortiert wird ohne Rücksicht auf Gross-/Kleinschreibung — sonst stünde
 * „regal" hinter „Zimmer", und niemand fände es.
 */
export async function orteVon(userIds: number[]): Promise<Lagerort[]> {
  const rows = await db.all(
    `SELECT id, user_id, name FROM storage_locations
      WHERE user_id = ANY($1) ORDER BY lower(name)`, [userIds]).catch(() => []);
  type Zeile = { id: string | number; user_id: string | number; name: string };
  return (rows as Zeile[] || []).map(r => ({
    id: parseInt(String(r.id)), user_id: parseInt(String(r.user_id)), name: r.name,
  }));
}

/**
 * Einen Ort in den Vorrat legen — oder den vorhandenen zurückgeben.
 *
 * Kein Fehler, wenn es ihn schon gibt: Das Anlegen wird aus zwei Richtungen
 * gerufen — aus den Einstellungen (dort WILL man die Absage sehen) und
 * nebenbei beim Setzen eines Lagerorts (dort wäre sie Unfug). Die Absage
 * `lagerort_doppelt` gehört deshalb in die Route der Einstellungen, nicht
 * hierher; sie entscheidet sich an [war_neu].
 */
export async function legeOrtAn(userId: number, name: unknown):
  Promise<{ ort: Lagerort; war_neu: boolean }> {
  const n = nameOderFehler(name);
  const neu = await db.get(
    `INSERT INTO storage_locations (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, lower(name)) DO NOTHING
     RETURNING id, user_id, name`, [userId, n]);
  if (neu) return { ort: { id: parseInt(String(neu.id)), user_id: userId, name: neu.name },
                    war_neu: true };
  const alt = await db.get(
    'SELECT id, user_id, name FROM storage_locations WHERE user_id = $1 AND lower(name) = lower($2)',
    [userId, n]);
  // Ohne Treffer ist etwas anderes schiefgegangen als ein Duplikat — dann
  // lieber eine Absage als ein stilles „schon da".
  if (!alt) fehlerWerfen('lagerort_unbekannt', 500);
  return { ort: { id: parseInt(String(alt.id)), user_id: userId, name: alt.name },
           war_neu: false };
}

/** Mehrere Konten auf einmal — für [setzeLagerort]. */
async function stelleOrteSicher(userIds: number[], name: string) {
  await db.run(
    `INSERT INTO storage_locations (user_id, name)
     SELECT id, $2 FROM users WHERE id = ANY($1)
     ON CONFLICT (user_id, lower(name)) DO NOTHING`, [userIds, name])
    .catch(e => { require('./httpError').meldeUndWeiter('lagerort:vorrat', e); });
}

/**
 * Einen Ort umbenennen — samt allem, was darin liegt.
 *
 * ── Warum die Zuordnungen mitwandern ────────────────────────────────────────
 *
 * Die Zuordnung ist der NAME, nicht eine ID. Bliebe sie beim Umbenennen
 * stehen, stünden die Sets danach in einem Ort, den die Auswahlliste nicht
 * mehr kennt — ein Umbenennen wäre in Wahrheit ein Verlieren. Beides in EINER
 * Transaktion, weil ein halber Durchlauf genau diesen Zustand hinterliesse.
 */
export async function benenneOrtUm(userId: number, id: number, name: unknown): Promise<Lagerort> {
  const neu = nameOderFehler(name);
  const alt = await db.get(
    'SELECT name FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!alt) fehlerWerfen('lagerort_unbekannt', 404);
  // Ein anderer Eintrag mit demselben Namen (Gross-/Kleinschreibung egal)
  // würde am Index scheitern — die Absage vorher ist die verständlichere.
  const kollision = await db.get(
    `SELECT id FROM storage_locations
      WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3`, [userId, neu, id]);
  if (kollision) fehlerWerfen('lagerort_doppelt', 409);
  await db.transaction(async (tx) => {
    await tx.run('UPDATE storage_locations SET name = $3 WHERE id = $1 AND user_id = $2',
      [id, userId, neu]);
    for (const tabelle of Object.values(TABELLEN)) {
      await tx.run(`UPDATE ${tabelle} SET storage = $3 WHERE user_id = $1 AND storage = $2`,
        [userId, alt.name, neu]);
    }
  });
  return { id, user_id: userId, name: neu };
}

/**
 * Einen Ort aus dem Vorrat nehmen.
 *
 * Absage, solange noch etwas darin liegt. Die Alternative — stilles Leeren —
 * verlöre die Zuordnung von Sets, die der Löschende gar nicht im Blick hatte,
 * und zwar ohne Weg zurück.
 */
export async function loescheOrt(userId: number, id: number): Promise<void> {
  const ort = await db.get(
    'SELECT name FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!ort) fehlerWerfen('lagerort_unbekannt', 404);
  // Alle drei Tabellen: Ein Ort, in dem NUR Figuren liegen, liesse sich sonst
  // loeschen, und ihre Zuordnung zeigte danach auf einen Namen, den der
  // Vorrat nicht mehr kennt.
  const belegt = await db.get(
    `SELECT (SELECT COUNT(*) FROM sets     WHERE user_id = $1 AND storage = $2)
          + (SELECT COUNT(*) FROM parts    WHERE user_id = $1 AND storage = $2)
          + (SELECT COUNT(*) FROM minifigs WHERE user_id = $1 AND storage = $2) AS n`,
    [userId, ort.name]);
  if (parseInt(String(belegt?.n ?? 0)) > 0) fehlerWerfen('lagerort_in_benutzung', 409);
  await db.run('DELETE FROM storage_locations WHERE id = $1 AND user_id = $2', [id, userId]);
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
 *
 * ── Warum die Figuren EIGEN gezählt werden ──────────────────────────────────
 *
 * Seit Migration 0024 trägt auch eine Minifigur einen Lagerort. Sie zu den
 * Teilesorten zu addieren wäre die bequeme Lösung und die falsche: „18
 * Teilesorten" hiesse dann mal 18 Teilesorten und mal 12 Teilesorten und 6
 * Figuren, und niemand könnte der Zahl ansehen, welches davon gemeint ist.
 */
export async function lagerorte(blickfeld: BlickfeldEingabe) {
  const uids = asIds(blickfeld);
  const rows = await db.all(
    `SELECT ort,
            SUM(sets)::int    AS sets,
            SUM(teile)::int   AS teile,
            SUM(figuren)::int AS figuren
       FROM (
         SELECT storage AS ort, COUNT(*)::int AS sets, 0 AS teile, 0 AS figuren
           FROM sets  WHERE user_id = ANY($1) AND storage IS NOT NULL
          GROUP BY storage
         UNION ALL
         SELECT storage AS ort, 0 AS sets, COUNT(*)::int AS teile, 0 AS figuren
           FROM parts WHERE user_id = ANY($1) AND storage IS NOT NULL
          GROUP BY storage
         UNION ALL
         SELECT storage AS ort, 0 AS sets, 0 AS teile, COUNT(*)::int AS figuren
           FROM minifigs WHERE user_id = ANY($1) AND storage IS NOT NULL
          GROUP BY storage
       ) q
      GROUP BY ort
      ORDER BY ort`, [uids]).catch(() => []);
  // Typisiert statt `(r: any)`: db.all() liefert Zeilen ohne Form, und dieser
  // Bauplan sagt, was diese Abfrage liefert. Die Summen stehen als string,
  // weil der Postgres-Treiber SUM() als Zeichenkette zurueckgibt — genau
  // deshalb steht darunter parseInt und nicht Number().
  type Zeile = { ort: string; sets: string | number; teile: string | number;
                 figuren: string | number };
  return (rows as Zeile[] || []).map(r => ({
    ort: r.ort,
    sets:    parseInt(String(r.sets))    || 0,
    teile:   parseInt(String(r.teile))   || 0,
    figuren: parseInt(String(r.figuren)) || 0,
  }));
}
