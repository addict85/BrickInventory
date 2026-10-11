/**
 * Was bei BrickLink wie heisst — die Zuordnung, an einer Stelle.
 *
 * ── Marcos Vorgabe ─────────────────────────────────────────────────────────
 *
 *   „ich würde mir für die bl_*_number Spalten eine Mapping-Tabelle vorstellen
 *    mit der Spalte RB_id und BL_id dort werden alle alle Minifiguren, Parts
 *    und Sets mit den Mappings abgelegt."
 *
 * Seit Migration 0037 ist das `bl_zuordnung (art, rb_id, bl_id)`. Vorher stand
 * dieselbe Aussage an vier Orten: in `rb_bl_mapping` (Teile, katalogweit) und
 * als Abschrift in `parts.bl_part_number`, `set_parts_catalog.bl_part_number`
 * und `minifigs.bl_fig_number` — die beiden ersten JE KONTO.
 *
 * Dass die Abschriften genau das waren, stand im Baum: utils/partsImport.ts
 * trug eine Funktion syncBlPartNumbers(), deren ganze Aufgabe darin bestand,
 * rb_bl_mapping in die beiden anderen zu kopieren. Sie ist mit 0037 weg.
 *
 * Die Farben sind NICHT mitgezogen: Sie sitzen als `rb_colors.bl_color_id` an
 * der Farbzeile, und das ist katalogweit und einmalig — dieselbe Stelle, nur
 * in einer anderen Tabelle. Hier umzuziehen gaebe nichts dazu.
 *
 * ── Warum das eine eigene Datei ist ────────────────────────────────────────
 * Der Schreibvorgang stand fünfmal im Baum: dreimal wortgleich für Teile
 * (jobs/backfillBlPartNumbers, jobs/partsCatalogEnrich zweimal,
 * utils/partsImport), zweimal für Farben (jobs/rebrickableCsvSync,
 * utils/handlers/parts). Ein Fehlverhalten ist dabei NICHT gemessen worden —
 * die Fassungen waren gleich. Der Grund ist ein anderer: Wer die Regel ändert
 * (eine Spalte dazu, ein anderes ON CONFLICT), soll das an einer Stelle tun
 * und nicht fünf suchen müssen.
 */
import * as db from '../db/database';

/**
 * Welche Arten es gibt. Union und kein Text: Die Art wird in den
 * SQL-Schnipseln unten EINGESETZT (ein Wert laesst sich dort nicht binden),
 * und der Typ ist das, was verhindert, dass dort je etwas anderes landet als
 * diese drei Woerter.
 *
 * 'set' ist dabei und bleibt vorerst leer: GEMESSEN hat kein Set irgendwo eine
 * eigene BrickLink-Nummer — BrickLink benutzt dieselben Setnummern wie
 * Rebrickable. Die Art kostet nichts (eine Tabelle mit Art-Unterscheidung
 * waechst um Zeilen, nicht um Spalten) und ist da, wenn sich das fuer ein
 * einzelnes Set einmal unterscheidet.
 */
export type BlArt = 'part' | 'fig' | 'set';

/** Zu dieser Rebrickable-Nummer gehört jene BrickLink-Nummer. */
export async function merkeBlNummer(art: BlArt, rbId: string, blId: string) {
  // NULLIF(blId, rbId): EINE Schreibweise fuer „keine abweichende Nummer".
  // Migration 0037 hat die alten Zeilen genauso vereinheitlicht; schriebe
  // diese Funktion die Gleichheit wieder aus, stuenden in der Spalte wieder
  // zwei Formen fuer dieselbe Aussage.
  await db.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULLIF($3,$2))
     ON CONFLICT (art, rb_id) DO UPDATE SET bl_id=NULLIF($3,$2), fetched_at=NOW()`,
    [art, rbId, blId]);
}

/**
 * „Nachgesehen, es gibt keine abweichende Nummer" — das Teil heisst bei
 * BrickLink genauso.
 *
 * Bewusst `DO NOTHING` statt `DO UPDATE`: Diese Notiz darf eine echte, schon
 * gefundene Zuordnung nicht überschreiben. Sie verhindert nur, dass dasselbe
 * Teil immer wieder abgefragt wird.
 *
 * Die ZEILE entsteht dabei, ihr Wert bleibt leer. Genau darin liegt der
 * Unterschied, auf den es ankommt: „Zeile da, bl_id leer" heisst nachgesehen,
 * „keine Zeile" heisst noch nicht nachgesehen. Vorher trug diese Notiz die
 * Rebrickable-Nummer als BrickLink-Nummer ein — dasselbe gesagt, nur
 * undeutlicher.
 */
export async function merkeBlNummerUnveraendert(art: BlArt, rbId: string) {
  await db.run(
    'INSERT INTO bl_zuordnung (art, rb_id, bl_id) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING',
    [art, rbId]);
}

/**
 * Die BrickLink-Nummer zu einer Rebrickable-Nummer, oder null.
 *
 * null heisst „keine abweichende Nummer bekannt" und deckt damit beide Faelle
 * zusammen: keine Zeile und Zeile ohne Wert. Wer die beiden unterscheiden
 * muss (um nicht erneut abzufragen), fragt mit [blSchonNachgesehen].
 */
export async function blNummerVon(art: BlArt, rbId: string): Promise<string | null> {
  const z = await db.get(
    'SELECT bl_id FROM bl_zuordnung WHERE art=$1 AND rb_id=$2', [art, rbId]).catch(() => null);
  return z?.bl_id || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Zwei Fragen, die nicht dasselbe sind
// ═══════════════════════════════════════════════════════════════════════════
//
//   „Welche ABWEICHENDE Nummer ist hinterlegt?"   → blNummerVon, null wenn keine
//   „Mit welcher Nummer frage ich BrickLink?"      → blAbrufNummer, die wirksame
//
// Der Unterschied ist nicht Geschmack, er ist GEMESSEN: Als es nur die erste
// Form gab, fiel das Vorladen in utils/finance/preise.ts aus. Dort merkt sich
// ein Nachschlagwerk die Antworten, und es merkt bewusst keine Fehlschlaege
// (ein Teil ohne Uebersetzung soll beim naechsten Mal wieder gefragt werden,
// damit ein Nachtrag-Job nicht zehn Minuten uebersehen wird). Eine leere bl_id
// ist aber KEIN Fehlschlag, sondern eine vollstaendige Antwort — „heisst dort
// genauso". Mit null kam sie als Fehlschlag an, wurde nicht gemerkt, und jedes
// Teil fragte wieder einzeln: 20 Einzelabfragen statt 0, gemeldet von
// test/bewertung-abfragen-db.test.js.
//
// Vor Migration 0037 gab es diese Falle nicht, weil rb_bl_mapping die Notiz
// als `bl_part_num = part_num` hielt — eine Antwort, die zufaellig in beide
// Bedeutungen passte. Jetzt sind sie getrennt, und zwar ausdruecklich.

/**
 * Die Nummer, mit der BrickLink zu fragen ist.
 *
 * @returns Die abweichende Nummer, sonst die Rebrickable-Nummer selbst —
 *          und null nur dann, wenn noch nie nachgesehen wurde.
 */
export async function blAbrufNummer(art: BlArt, rbId: string): Promise<string | null> {
  const z = await db.get(
    'SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung WHERE art=$1 AND rb_id=$2',
    [art, rbId]).catch(() => null);
  return z?.nr || null;
}

/**
 * Dasselbe fuer viele Nummern, in EINER Abfrage.
 *
 * Der Grund steht in utils/finance/preise.ts: Dort wurde gemessen, dass die
 * Einzelabfrage bei 50 Teilen 50 Mal lief.
 *
 * @returns Abbildung rb_id → wirksame Nummer, fuer JEDE vorhandene Zeile —
 *          auch fuer die ohne abweichenden Wert. Genau das ist der
 *          Unterschied zu [blNummernVon], und genau darauf beruht, dass das
 *          Nachschlagwerk nichts zweimal fragt.
 */
export async function blAbrufNummern(art: BlArt, rbIds: string[]): Promise<Map<string, string>> {
  const raus = new Map<string, string>();
  if (!rbIds.length) return raus;
  const zeilen = await db.all(
    `SELECT rb_id, COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung
      WHERE art=$1 AND rb_id = ANY($2)`,
    [art, rbIds]).catch(() => []);
  for (const z of zeilen) raus.set(String(z.rb_id), String(z.nr));
  return raus;
}

// Hier standen drei weitere Ausfuhren — blSchonNachgesehen(),
// blNummernVon() und rbNummerVon(). Sie sind weg, und zwar nicht aus
// Platzgruenden: test/dead-code.test.js hat sie gemeldet, weil sie
// NIRGENDS aufgerufen wurden. Ich hatte sie „fuer den Fall" angelegt.
//
// Was sie leisten sollten, leistet etwas anderes:
//
//   „schon nachgesehen?"   steht als LEFT JOIN in den zwei Stellen, die
//                          es brauchen (utils/partsImport.ts,
//                          jobs/backfillBlPartNumbers.ts) — dort geht es
//                          um eine Liste, nicht um eine Nummer.
//   viele Nummern          blAbrufNummern() weiter oben.
//   die Richtung zurueck   braucht derzeit niemand. Der Index
//                          idx_bl_zuordnung_bl bleibt trotzdem: Er traegt
//                          die Eindeutigkeitspruefung des Riegels in
//                          Migration 0037.

// ═══════════════════════════════════════════════════════════════════════════
// Die Zuordnung IN einer Abfrage
// ═══════════════════════════════════════════════════════════════════════════
//
// Zwei Schnipsel, dieselbe Bauart wie mengeJoin()/mengeAus() in
// utils/bestandsmenge.ts und ersatzteilSql() in utils/validate.ts — und aus
// demselben Grund: `COALESCE(p.bl_part_number, p.part_number)` stand an
// ZEHN Stellen in fuenf Dateien (gemessen), teils als Gruppierungsschluessel.
// Zehnmal dieselbe Rechnung heisst zehn Stellen, an denen sie beim naechsten
// Mal leicht anders aussieht; genau so ist `is_spare` hier schon in vier
// Lesarten zerfallen.
//
// Ein JOIN und keine Unterabfrage je Zeile: Die Teile-Zusammenfassung baut
// ueber 171'000 Zeilen auf (die Zahl steht in utils/partsSummary.ts), und die
// Gruppierung laeuft ueber genau diesen Wert.

/**
 * Die Zuordnung an eine Abfrage haengen.
 *
 * @param rbSpalte Spalte mit der Rebrickable-Nummer, z. B. `p.part_number`
 * @param art      welche Art Nummer
 * @param alias    Name der JOIN-Quelle; der Aufrufer liest `<alias>.bl_id`
 */
export function blJoin(rbSpalte: string, art: BlArt, alias = 'blz'): string {
  return `LEFT JOIN bl_zuordnung ${alias}
               ON ${alias}.art = '${art}' AND ${alias}.rb_id = ${rbSpalte}`;
}

/**
 * „Die Nummer, unter der dieses Teil bei BrickLink steht."
 *
 * COALESCE auf die Rebrickable-Nummer, weil die Zuordnung nur die ABWEICHUNG
 * festhaelt: Kein Eintrag heisst „heisst dort genauso". Ohne das COALESCE
 * waere der Wert NULL, und als Gruppierungsschluessel faellt eine Zeile mit
 * NULL in ihre eigene Gruppe — jedes Teil ohne Zuordnung stuende dann
 * einzeln.
 */
export function blNummerSql(rbSpalte: string, alias = 'blz'): string {
  return `COALESCE(${alias}.bl_id, ${rbSpalte})`;
}

/** Zu dieser Rebrickable-Farbe gehört jene BrickLink-Farbnummer. */
export async function merkeBlFarbnummer(colorId: number, blColorId: number) {
  await db.run('UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2', [blColorId, colorId]);
}

/**
 * Die BrickLink-Farbnummer aus einer Rebrickable-Farbantwort herausholen.
 *
 * Zwei Formen, weil Rebrickable beide liefert — `ext_ids` als Liste oder die
 * Liste direkt. Stand ebenfalls zweimal da, wortgleich.
 */
export function blFarbnummerAus(farbe: any): number | null {
  const id = farbe?.external_ids?.BrickLink?.ext_ids?.[0] ?? farbe?.external_ids?.BrickLink?.[0];
  return id ?? null;
}

// ── blFigNummerAus() ist WEG ──────────────────────────────────────────────
//
// Sie las `minifigs.bl_fig_number` — je Konto, mit `source='manual'` in der
// Bedingung, weil Figuren aus einem Set keine eigene Nummer trugen. Beides
// ist mit Migration 0037 gegenstandslos: Die Nummer haengt an der FIGUR, und
// die Zuordnung kennt kein Konto. An ihre Stelle tritt
// blNummerVon('fig', figNumber).
//
// Das ist auch sachlich richtiger und nicht nur kuerzer: Steckt dieselbe Figur
// in einem Set UND im eigenen Bestand, gab die alte Abfrage ihre Nummer nur
// fuer die manuelle Zeile heraus — fuer dieselbe Figur also manchmal und
// manchmal nicht.
