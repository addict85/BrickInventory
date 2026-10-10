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
 * ── Die Zuordnung ist eine ID — und hier stand das Gegenteil ────────────────
 *
 * Bis Migration 0031 stand hier: „Die Zuordnung bleibt der freie Text in
 * `sets.storage` / `parts.storage`. Eine Fremdschlüssel-ID hätte jede
 * bestehende Zeile umschreiben müssen und jede Abfrage um einen JOIN erweitert
 * — für einen Namen, der ohnehin eindeutig ist."
 *
 * Der letzte Halbsatz war der Fehler: Eindeutig ist der Name im VORRAT, und
 * zwar ohne Rücksicht auf Gross-/Kleinschreibung (`lower(name)`). Am Bestand
 * stand dagegen die getippte Schreibweise, zeichengenau verglichen. Damit
 * konnte am Set ein Name stehen, den der Vorrat nicht führt — und dann wanderte
 * er beim Umbenennen nicht mit, und das Löschen hielt den Ort für leer.
 * Nachgestellt, nicht vermutet; der Ablauf steht in der Migration.
 *
 * Die beiden Kosten von damals sind geblieben und bezahlt: Die bestehenden
 * Zuordnungen wurden auf Marcos Ansage weggeworfen statt nachgefüllt, und die
 * Abfragen, die den Ort ANZEIGEN, tragen jetzt einen LEFT JOIN auf den Vorrat.
 *
 * [lagerorte] zählt weiter, was WIRKLICH belegt ist; [orteVon] sagt, was zur
 * Wahl steht. Beides wird gebraucht, und es ist nicht dasselbe.
 */
import * as db from '../db/database';
import { asIds } from './household';
import type { BlickfeldEingabe } from './household';
import { fehlerWerfen } from './fehlerTexte';
// Statisch und nicht als dynamischer Import: Einen Kreis gibt es nicht
// (settings.ts kennt nur db und httpError), und `await import('./settings')`
// verlangt unter moduleResolution node16 die Dateiendung — eine Schreibweise,
// die im Baum sonst nirgends steht.
import { setUserSetting } from './settings';

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
  // ── Die Zuordnung ist seit Migration 0031 eine ID ────────────────────────
  //
  // Aufgelöst wird sie in einer Unterabfrage je ZEILE und nicht einmal
  // vorher. Das hat einen Grund, der im Haushalt sichtbar wird: Derselbe
  // Name kann in zwei Konten liegen, und jedes hat seine eigene Zeile im
  // Vorrat (ein Regal ist ein Regal in EINER Wohnung, Migration 0020). Die
  // Unterabfrage greift über `l.user_id = t.user_id` genau die des
  // Besitzers — eine vorher aufgelöste ID träfe für das zweite Konto die
  // falsche Wohnung.
  //
  // `lower(...)`: Der Vorrat ist ohne Rücksicht auf Gross-/Kleinschreibung
  // eindeutig. Genau hier lag der Fehler des alten Entwurfs — er schrieb die
  // GETIPPTE Schreibweise an den Bestand, und die musste nicht die des
  // Vorrats sein (nachgestellt in der Migration).
  //
  // Dieselbe Anweisung leert auch: Mit `ort = null` ist `lower($2)` NULL, die
  // Unterabfrage findet nichts und setzt NULL. Eine zweite Anweisung dafür
  // wäre eine zweite Stelle, die stimmen muss.
  const setzen =
    `UPDATE ${tabelle} t
        SET storage_id = (SELECT l.id FROM storage_locations l
                           WHERE l.user_id = t.user_id
                             AND lower(l.name) = lower($2))
      WHERE t.user_id = ANY($1) AND ${bedingung}`;

  // Kein `as any` auf dem Ergebnis: db.run() ist typisiert ({ changes, lastID }).
  // Die Schreibweise `(r as any).changes` steht anderswo im Baum noch aus einer
  // Zeit, in der das nicht galt — sie schaltet den Typpruefer ab, ohne etwas zu
  // gewinnen (test/ratschen.test.js zaehlt sie mit).
  if (ort === null) {
    const r = await db.run(setzen, [besitzerIds, null, ...schluessel]);
    return r.changes ?? 0;
  }

  // ── Anlegen und Zuordnen gehören zusammen ────────────────────────────────
  //
  // Ein Name, den es im Vorrat noch nicht gibt, kommt hinein — das ist Marcos
  // „man kann auch gleich neue Auswahlwerte erfassen". Mit dem Namen als
  // Zuordnung ging das NACH dem UPDATE, mit der ID muss es davor stehen: Ohne
  // Zeile im Vorrat gibt es keine ID, und die Unterabfrage setzte NULL.
  //
  // Die Reihenfolge kostet eine Eigenschaft, die der alte Weg nebenbei hatte —
  // „ein Ort, der keiner Zeile zugeordnet werden konnte, hinterlässt keinen
  // Eintrag im Vorrat". Deshalb beides in EINER Transaktion mit Rücknahme,
  // wenn keine Zeile getroffen wurde. Sonst legte jedes Setzen auf ein
  // fremdes Set einen Ort an, den niemand bestellt hat.
  const nichtsGetroffen = {};
  return await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO storage_locations (user_id, name)
       SELECT id, $2 FROM users WHERE id = ANY($1)
       ON CONFLICT (user_id, lower(name)) DO NOTHING`, [besitzerIds, ort]);
    const r = await tx.run(setzen, [besitzerIds, ort, ...schluessel]);
    if ((r.changes ?? 0) === 0) throw nichtsGetroffen;
    return r.changes ?? 0;
  }).catch((e) => {
    if (e === nichtsGetroffen) return 0;
    throw e;
  });
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

/**
 * Einen Ort umbenennen.
 *
 * ── Hier stand die Schleife, die den Namen in drei Tabellen nachschrieb ─────
 *
 * Mit dem NAMEN als Zuordnung musste sie da sein: „Bliebe sie beim Umbenennen
 * stehen, stünden die Sets danach in einem Ort, den die Auswahlliste nicht
 * mehr kennt — ein Umbenennen wäre in Wahrheit ein Verlieren." Dazu eine
 * Transaktion, weil ein halber Durchlauf genau diesen Zustand hinterliesse.
 *
 * Seit Migration 0031 ist die Zuordnung eine ID, und damit ist dieser ganze
 * Absatz gegenstandslos: Es gibt nichts nachzuschreiben, also auch keinen
 * halben Durchlauf. Eine Anweisung, eine Zeile, fertig — und der Fall, in dem
 * die Schleife eine Schreibweise NICHT traf (sie verglich zeichengenau), kann
 * nicht mehr entstehen. Nachgewiesen in test/lagerort-id-db.test.js.
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
  await db.run('UPDATE storage_locations SET name = $3 WHERE id = $1 AND user_id = $2',
    [id, userId, neu]);
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
  // Gezaehlt wird ueber die ID und nicht ueber den Namen. Mit dem Namen war
  // diese Pruefung umgehbar, ohne dass jemand etwas falsch machte: Lag am Set
  // „estrich" und im Vorrat „Estrich", zaehlte der zeichengenaue Vergleich
  // null — der Ort liess sich loeschen, und das Set behielt einen Namen, den
  // die Auswahlliste nicht mehr kannte (nachgestellt in Migration 0031).
  const belegt = await db.get(
    `SELECT (SELECT COUNT(*) FROM sets     WHERE user_id = $1 AND storage_id = $2)
          + (SELECT COUNT(*) FROM parts    WHERE user_id = $1 AND storage_id = $2)
          + (SELECT COUNT(*) FROM minifigs WHERE user_id = $1 AND storage_id = $2) AS n`,
    [userId, id]);
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
  // Gruppiert wird ueber den NAMEN und nicht ueber die ID — auch jetzt, wo die
  // Zuordnung eine ID ist. Das ist Absicht: Ein Blickfeld kann mehrere Konten
  // umfassen, und „Keller" des Grossvaters und „Keller" des Enkels sind zwei
  // Zeilen im Vorrat. In der Uebersicht gehoeren sie zusammen, sonst stuende
  // „Keller" zweimal da und niemand koennte den Unterschied sehen.
  const rows = await db.all(
    `SELECT ort,
            SUM(sets)::int    AS sets,
            SUM(teile)::int   AS teile,
            SUM(figuren)::int AS figuren
       FROM (
         SELECT l.name AS ort, COUNT(*)::int AS sets, 0 AS teile, 0 AS figuren
           FROM sets s JOIN storage_locations l ON l.id = s.storage_id
          WHERE s.user_id = ANY($1)
          GROUP BY l.name
         UNION ALL
         SELECT l.name AS ort, 0 AS sets, COUNT(*)::int AS teile, 0 AS figuren
           FROM parts p JOIN storage_locations l ON l.id = p.storage_id
          WHERE p.user_id = ANY($1)
          GROUP BY l.name
         UNION ALL
         SELECT l.name AS ort, 0 AS sets, 0 AS teile, COUNT(*)::int AS figuren
           FROM minifigs m JOIN storage_locations l ON l.id = m.storage_id
          WHERE m.user_id = ANY($1)
          GROUP BY l.name
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Die VORGABE — welcher Ort beim Erfassen schon dasteht
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Marcos Vorgabe: „Weiter möchte ich ein Lagerort in den Einstellungen als
 * Default setzen können. Der soll dann bei einer Neuerfassung bereits
 * vorausgewählt sein. Ich stelle mir das mit einem Sternicon vor."
 *
 * ── Warum die ID gespeichert wird und nicht der Name ────────────────────────
 *
 * Überall sonst in dieser Datei ist der NAME die Zuordnung (siehe die
 * Begründung oben: eine Fremdschlüssel-ID hätte jede bestehende Zeile
 * umschreiben müssen). Für die Vorgabe ist es umgekehrt, und zwar aus einem
 * nachprüfbaren Grund: Sie ist genau EIN Verweis, und sie muss zwei Ereignisse
 * überleben, die der Name nicht übersteht.
 *
 *   Umbenennen  Mit dem Namen müsste [benenneOrtUm] die Vorgabe mitziehen —
 *               eine dritte Stelle, die beim Umbenennen stimmen muss. Mit der
 *               ID passiert nichts, weil sich nichts ändert.
 *   Löschen     Mit dem Namen bliebe eine Vorgabe stehen, die auf einen Ort
 *               zeigt, den es nicht mehr gibt. Beim Erfassen stünde dann ein
 *               Ort da, den die Auswahlliste nicht kennt — genau die Falle,
 *               die Migration 0020 beschreibt. Mit der ID findet [vorgabeVon]
 *               keine Zeile mehr und liefert null: die Vorgabe heilt sich
 *               selbst.
 *
 * Deshalb braucht weder [benenneOrtUm] noch [loescheOrt] eine Zeile für die
 * Vorgabe. Das ist der ganze Gewinn — nachgewiesen in
 * test/lagerort-vorgabe-db.test.js, das beide Ereignisse durchspielt.
 *
 * ── Warum user_settings und keine eigene Spalte ─────────────────────────────
 *
 * `user_settings` ist die Schlüssel-Wert-Tabelle für genau solche
 * Einzelwerte — Währung, Erfassungs-Zustand und Sprache stehen dort. Eine
 * Spalte `is_default` an storage_locations bräuchte eine Migration UND einen
 * partiellen Eindeutigkeitsindex, damit nicht zwei Orte gleichzeitig Vorgabe
 * sind. Ein einzelner Wert in einer Tabelle, die es schon gibt, kann nicht
 * zweimal dastehen.
 */
export const VORGABE_SCHLUESSEL = 'default_storage_id';

/**
 * Die Vorgabe EINES Kontos — oder null.
 *
 * Gelesen wird über einen JOIN auf den Vorrat, nicht nur die Zahl aus den
 * Einstellungen: Eine Vorgabe, deren Ort gelöscht wurde, ist keine Vorgabe.
 * Und `user_id = $1` stellt sicher, dass eine fremde ID in den Einstellungen
 * (durch einen Import, durch einen Fehler) nicht den Ort eines anderen Kontos
 * zurückgibt.
 */
export async function vorgabeVon(userId: number): Promise<Lagerort | null> {
  const row = await db.get(
    `SELECT l.id, l.user_id, l.name
       FROM user_settings e
       JOIN storage_locations l
         ON l.id = NULLIF(btrim(e.value), '')::int AND l.user_id = e.user_id
      WHERE e.user_id = $1 AND e.key = $2`, [userId, VORGABE_SCHLUESSEL])
    .catch(() => null);
  if (!row) return null;
  return { id: parseInt(String(row.id)), user_id: parseInt(String(row.user_id)),
           name: row.name };
}

/**
 * Die Vorgabe setzen oder abschalten.
 *
 * `null` löscht sie — das ist der zweite Druck auf denselben Stern. Ein Ort,
 * der dem Konto nicht gehört, wird abgelehnt und nicht stillschweigend
 * ignoriert: Der Stern stünde danach am falschen Eintrag, und niemand käme auf
 * den Grund.
 */
export async function setzeVorgabe(userId: number, id: number | null): Promise<Lagerort | null> {
  if (id === null) {
    await db.run('DELETE FROM user_settings WHERE user_id = $1 AND key = $2',
                 [userId, VORGABE_SCHLUESSEL]);
    return null;
  }
  const ort = await db.get(
    'SELECT id, user_id, name FROM storage_locations WHERE id = $1 AND user_id = $2',
    [id, userId]);
  if (!ort) fehlerWerfen('lagerort_unbekannt', 404);
  // Geschrieben wird ueber setUserSetting() und NICHT mit einer eigenen
  // Anweisung: Die erste Fassung hatte das INSERT … ON CONFLICT hier stehen,
  // mit der Begruendung, ein Import von settings.ts koenne einen Kreis
  // schaffen. Beides war falsch — einen Kreis gibt es nicht (settings.ts
  // kennt diese Datei nicht), und test/sql-kerne.test.js hat die Kopie
  // gemeldet: „keine SQL-Anweisung steht in mehr als einer Datei". Zu Recht,
  // denn der Zugriff auf user_settings gehoert dorthin, wo er schon steht.
  await setUserSetting(userId, VORGABE_SCHLUESSEL, String(id));
  return { id: parseInt(String(ort.id)), user_id: userId, name: ort.name };
}
