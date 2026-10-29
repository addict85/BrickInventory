/**
 * Was bei BrickLink wie heisst — die Zuordnung, an einer Stelle.
 * Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#abschnitt
 */
import { meldeUndLiefere } from './httpError';
import * as db from '../db/database';

/**
 * Welche Arten es gibt. Union und kein Text: Die Art wird in den
 * SQL-Schnipseln unten EINGESETZT (ein Wert laesst sich dort nicht binden),
 * und der Typ ist das, was verhindert, dass dort je etwas anderes landet als
 * diese drei Woerter.
 * Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#blart
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

/** merkeBlNummer() für viele Nummern in einer Anweisung (Teile-Import eines Sets). */
export async function merkeBlNummern(art: BlArt, paare: { rbId: string; blId: string }[],
                                     dbh: { run: (sql: string, p?: unknown[]) => Promise<unknown> } = db) {
  const eindeutig = [...new Map(paare.filter(p => p.rbId && p.blId).map(p => [p.rbId, p])).values()];
  if (!eindeutig.length) return;
  await dbh.run(
    `INSERT INTO bl_zuordnung (art, rb_id, bl_id)
     SELECT $1, r, NULLIF(b, r) FROM unnest($2::text[], $3::text[]) AS x(r, b)
     ON CONFLICT (art, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id, fetched_at = NOW()`,
    [art, eindeutig.map(p => p.rbId), eindeutig.map(p => p.blId)]);
}

/**
 * Bewusst `DO NOTHING` statt `DO UPDATE`: Diese Notiz darf eine echte, schon
 * gefundene Zuordnung nicht überschreiben. Sie verhindert nur, dass dasselbe
 * Teil immer wieder abgefragt wird.
 * Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#merkeblnummerunveraendert
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
    'SELECT bl_id FROM bl_zuordnung WHERE art=$1 AND rb_id=$2', [art, rbId]).catch(meldeUndLiefere('bl-zuordnung:nummer lesen', null));
  return z?.bl_id || null;
}

// Zwei Fragen, die nicht dasselbe sind
// Der Unterschied ist nicht Geschmack, er ist GEMESSEN: Als es nur die erste
// Form gab, fiel das Vorladen in utils/finance/preise.ts aus. Dort merkt sich
// ein Nachschlagwerk die Antworten, und es merkt bewusst keine Fehlschlaege …
// Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#abschnitt-2

/**
 * Die Nummer, mit der BrickLink zu fragen ist.
 *
 * @returns Die abweichende Nummer, sonst die Rebrickable-Nummer selbst —
 *          und null nur dann, wenn noch nie nachgesehen wurde.
 */
export async function blAbrufNummer(art: BlArt, rbId: string): Promise<string | null> {
  const z = await db.get(
    'SELECT COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung WHERE art=$1 AND rb_id=$2',
    [art, rbId]).catch(meldeUndLiefere('bl-zuordnung:abrufnummer lesen', null));
  return z?.nr || null;
}

/**
 * Dasselbe fuer viele Nummern, in EINER Abfrage.
 * Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#blabrufnummern
 * @returns Abbildung rb_id → wirksame Nummer, fuer JEDE vorhandene Zeile —
 */
export async function blAbrufNummern(art: BlArt, rbIds: string[]): Promise<Map<string, string>> {
  const raus = new Map<string, string>();
  if (!rbIds.length) return raus;
  const zeilen = await db.all(
    `SELECT rb_id, COALESCE(bl_id, rb_id) AS nr FROM bl_zuordnung
      WHERE art=$1 AND rb_id = ANY($2)`,
    [art, rbIds]).catch(meldeUndLiefere('bl-zuordnung:zeilen', []));
  for (const z of zeilen) raus.set(String(z.rb_id), String(z.nr));
  return raus;
}

// Was sie leisten sollten, leistet etwas anderes:
// Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#abschnitt-3

// Die Zuordnung IN einer Abfrage
// Zwei Schnipsel, dieselbe Bauart wie mengeJoin()/mengeAus() in
// utils/bestandsmenge.ts und ersatzteilSql() in utils/validate.ts — und aus
// demselben Grund: `COALESCE(p.bl_part_number, p.part_number)` stand an …
// Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#abschnitt-4

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
 * COALESCE auf die Rebrickable-Nummer, weil die Zuordnung nur die ABWEICHUNG
 * festhaelt: Kein Eintrag heisst „heisst dort genauso". Ohne das COALESCE
 * waere der Wert NULL, und als Gruppierungsschluessel faellt eine Zeile mit
 * NULL in ihre eigene Gruppe — jedes Teil ohne Zuordnung stuende dann …
 * Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#blnummersql
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

// blFigNummerAus() ist WEG
// Sie las `minifigs.bl_fig_number` — je Konto, mit `source='manual'` in der
// Bedingung, weil Figuren aus einem Set keine eigene Nummer trugen. Beides
// ist mit Migration 0037 gegenstandslos: Die Nummer haengt an der FIGUR, und …
// Ausführlich: docs/begruendungen/utils/blZuordnung.ts.md#abschnitt-5
