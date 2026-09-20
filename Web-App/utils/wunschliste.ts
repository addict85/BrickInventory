/**
 * Die Wunschliste — was man haben MÖCHTE, getrennt von dem, was man hat.
 *
 * ── Warum dieser Helfer und nicht Code in der Route ─────────────────────────
 *
 * Dieselbe Begründung wie bei utils/lagerort.ts: Die Wunschliste wird von
 * beiden Oberflächen und über drei Erfassungswege bedient (Katalog-Detail,
 * Setnummer, Barcode). Stünden Normalisierung, Zustandsvorgabe und die
 * Übernahme in die Galerie in den Routen, gäbe es jede Regel mehrfach — und
 * in diesem Baum ist genau das schon mehrfach auseinandergelaufen.
 *
 * ── Die Übernahme ruft addSet() und baut nichts Eigenes ─────────────────────
 *
 * „Direkt in die Galerie übernehmen" heisst: dasselbe tun wie das Erfassen
 * einer Setnummer. utils/setService.ts:addSet() ist dafür die eine Wahrheit —
 * es bestimmt den Zustand über zustandFuerPreis(), holt den Marktpreis, legt
 * die Erfassungszeile an, hält die Bestandssperre und stösst die
 * Anreicherung an. Ein eigenes INSERT INTO sets hier wäre die zweite
 * Wahrheit und hätte von alldem nichts.
 *
 * ── Der Zustand steht im Schlüssel ──────────────────────────────────────────
 *
 * Neu und gebraucht sind verschiedene Wünsche mit verschiedenen Schwellen.
 * price_alerts führt den Zustand seit 0019 genauso; beide Tabellen treffen
 * sich über (user_id, set_number, condition), ohne dass eine die andere
 * kennen muss.
 */
import * as db from '../db/database';
import { addSet, sanitizeSetNumber } from './setService';
import { findSetInScope } from './setAdd';
import { loescheAlarm } from './preisalarm';
import * as V from './validate';
import { nutzerStandardZustand } from './settings';
import { meldeUndWeiter } from './httpError';

/** Ein Eintrag, wie ihn beide Oberflächen sehen. */
export interface Wunsch {
  set_number: string;
  condition: string;
  notiz: string | null;
  created_at: string;
  /** Wem der Wunsch gehört — im Kontenbaum sieht man fremde mit. */
  user_id: number;
  /** Aus rb_sets, nicht mitgespeichert (siehe Migration 0021). */
  name: string | null;
  year: number | null;
  theme_id: number | null;
  num_parts: number | null;
  image_url: string | null;
  /** Liegt das Set schon in der Galerie eines Kontos im Blickfeld? */
  owned: boolean;
  /**
   * Der Preisalarm zu GENAU diesem Wunsch — oder null.
   *
   * Er steht in price_alerts und nicht hier (siehe 0021); beide Tabellen
   * teilen sich den Schluessel (user_id, set_number, condition). Er reist
   * trotzdem mit: Wer einen Alarm setzt und ihn danach nirgends mehr sieht,
   * hat ihn verloren. Ein eigener Aufruf je Zeile waere N+1 fuer eine Liste,
   * die auch hundert Eintraege haben kann.
   */
  alarm: { richtung: string; schwelle: number; ausgeloest: boolean } | null;
}

/**
 * Zustand auf 'N' oder 'U' bringen.
 *
 * Ohne Angabe gilt die Einstellung des Nutzers — nicht hart 'N'. Genau diese
 * Verwechslung hat in addSet() einmal dazu geführt, dass eine Erfassung den
 * Gebrauchtpreis bekam und als neu verbucht wurde (siehe der Kommentar dort).
 */
export async function zustandOder(condition: unknown, userId: number): Promise<string> {
  const c = String(condition ?? '').trim().toUpperCase();
  if (c === 'N' || c === 'U') return c;
  return await nutzerStandardZustand(userId);
}

/** Notiz säubern — leer und NULL sind dasselbe, wie beim Lagerort. */
export function notizOder(roh: unknown): string | null {
  const t = String(roh ?? '').trim();
  if (!t) return null;
  // 500 Zeichen: dieselbe Grössenordnung wie die übrigen Freitexte im Baum.
  // Abschneiden statt ablehnen — eine zu lange Notiz ist kein Fehler, den
  // jemand beheben will, sondern ein Versehen beim Einfügen.
  return t.slice(0, 500);
}

/**
 * Einen Wunsch anlegen oder seine Notiz ändern.
 *
 * ON CONFLICT statt vorher fragen: Zwei Geräte, die denselben Wunsch
 * gleichzeitig eintragen, sollen nicht einer davon einen Fehler sehen. Das
 * Ergebnis sagt, ob es neu war — die Oberfläche meldet sonst „ist schon
 * drauf" statt „hinzugefügt".
 */
export async function legeWunschAn(
  userId: number, setNumber: string, condition: unknown, notiz: unknown,
): Promise<{ wunsch: Wunsch | null; war_neu: boolean }> {
  const sn = sanitizeSetNumber(setNumber);
  const c  = await zustandOder(condition, userId);
  const r = await db.get(
    `INSERT INTO wishlist (user_id, set_number, condition, notiz)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET notiz = COALESCE(EXCLUDED.notiz, wishlist.notiz)
     RETURNING (xmax = 0) AS war_neu`,
    [userId, sn, c, notizOder(notiz)]);
  const liste = await wuenscheVon([userId], sn);
  return { wunsch: liste.find(w => w.condition === c) ?? null, war_neu: !!r?.war_neu };
}

/** Wunsch entfernen. Kein Fehler, wenn es keinen gab — das Ziel ist erreicht. */
export async function loescheWunsch(userId: number, setNumber: string, condition: unknown): Promise<number> {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await db.run(
    'DELETE FROM wishlist WHERE user_id=$1 AND set_number=$2 AND condition=$3',
    [userId, sanitizeSetNumber(setNumber), c]);
  return r.changes ?? 0;
}

/**
 * Die Wünsche eines Blickfelds.
 *
 * `userIds` und nicht `userId`: Marcos Festlegung ist, dass die Wunschliste
 * dem Kontenbaum folgt wie alles andere — der Grossvater sieht die Wünsche
 * der Enkel. Das ist hier nicht nur konsequent, sondern der Zweck: Wer ein
 * Geschenk sucht, schaut genau dort nach.
 *
 * Der LEFT JOIN auf rb_sets liefert die Anzeige (siehe Migration 0021: keine
 * zweite Kopie der Stammdaten). Ein Set, das der Katalog nicht kennt, kommt
 * mit NULL-Namen zurück und zeigt in der Oberfläche seine Nummer.
 *
 * `owned` beantwortet die Frage, die in der Liste sofort aufkommt: „Habe ich
 * das inzwischen?" — es prüft dasselbe Blickfeld, nicht nur das eigene Konto.
 */
export async function wuenscheVon(userIds: number[], nurSet?: string): Promise<Wunsch[]> {
  if (!userIds?.length) return [];
  const params: unknown[] = [userIds];
  let filter = '';
  if (nurSet) { params.push(sanitizeSetNumber(nurSet)); filter = ' AND w.set_number = $2'; }
  const rows = await db.all(
    `SELECT w.set_number, w.condition, w.notiz, w.created_at, w.user_id,
            rb.name, rb.year, rb.theme_id, rb.num_parts,
            rb.set_img_url AS image_url,
            pa.richtung AS alarm_richtung, pa.schwelle AS alarm_schwelle,
            pa.ausgeloest AS alarm_ausgeloest,
            EXISTS (SELECT 1 FROM sets s
                     WHERE s.user_id = ANY($1) AND s.set_number = w.set_number) AS owned
       FROM wishlist w
       LEFT JOIN rb_sets rb ON rb.set_num = w.set_number
       LEFT JOIN price_alerts pa ON pa.user_id = w.user_id
                                AND pa.set_number = w.set_number
                                AND pa.condition = w.condition
      WHERE w.user_id = ANY($1)${filter}
      ORDER BY w.created_at DESC, w.set_number, w.condition`,
    params)
    // Wie beim Preisalarm: Ein Aufbau, der nur initSchema() gelaufen ist, hat
    // die Tabelle nicht (siehe die Begruendung in db/schema.sql). Eine leere
    // Liste ist dort die richtige Antwort, kein Fehler.
    .catch((e: unknown) => { meldeUndWeiter('wunschliste:lesen', e); return []; });
  // Die Zahlenspalten kommen als Zeichenkette aus dem Treiber — dieselbe
  // Stelle, an der in diesem Baum schon einmal ein Vergleich still falsch
  // wurde (siehe utils/preisalarm.ts).
  type Zeile = Omit<Wunsch, 'year' | 'num_parts' | 'owned' | 'alarm'> &
               { year: string | number | null; num_parts: string | number | null; owned: unknown;
                 alarm_richtung: string | null; alarm_schwelle: string | number | null;
                 alarm_ausgeloest: unknown };
  return ((rows ?? []) as Zeile[]).map(({ alarm_richtung, alarm_schwelle, alarm_ausgeloest, ...r }) => ({
    ...r,
    year:      r.year      == null ? null : Number(r.year),
    num_parts: r.num_parts == null ? null : Number(r.num_parts),
    owned:     !!r.owned,
    alarm: alarm_richtung == null ? null : {
      richtung:   alarm_richtung,
      schwelle:   parseFloat(String(alarm_schwelle)),
      ausgeloest: !!alarm_ausgeloest,
    },
  }));
}

/**
 * Einen Wunsch in die Galerie uebernehmen.
 *
 * ── Warum addSet() und kein eigenes INSERT ─────────────────────────────────
 *
 * „Direkt in die Galerie uebernehmen" ist dasselbe wie eine Setnummer
 * erfassen. addSet() ist dafuer die eine Wahrheit: Zustand ueber
 * zustandFuerPreis(), Marktpreis, Erfassungszeile, Bestandssperre,
 * Anreicherung. Ein eigenes INSERT INTO sets haette von alldem nichts.
 *
 * ── Warum das hier steht und nicht in der Route ────────────────────────────
 *
 * Weil es eine Regel ist und keine Vermittlung. In der Route liesse sie sich
 * nur ueber HTTP pruefen, und die App braucht sie genauso wie die Webapp.
 *
 * ── Was danach verschwindet ────────────────────────────────────────────────
 *
 * Eintrag UND Preisalarm, nach Marcos Festlegung: Wer das Set hat, will in
 * der Regel nicht weiter auf einen Preis warten — und die Set-Detailansicht
 * hat ein Alarmfeld, der Weg zurueck ist einen Griff weit.
 *
 * Geloescht wird ERST NACH dem erfolgreichen addSet(). Andersherum waere der
 * Wunsch bei einem Fehler im Erfassen weg und das Set nicht da.
 */
export async function uebernimm(
  leserId: number, besitzerId: number, setNumber: string, condition: unknown,
  eingabe: { quantity?: unknown; purchase_price?: unknown } = {},
): Promise<{ action: string; set_number: string }> {
  const sn = sanitizeSetNumber(setNumber);
  const zustand = await zustandOder(condition, besitzerId);

  // Schon im Blickfeld? Dann NICHT die Menge erhoehen — dieselbe Regel wie
  // beim Erfassen (utils/setAdd.ts), damit sie nicht davon abhaengt, ueber
  // welchen der vier Wege jemand kommt. Der Wunsch ist trotzdem erfuellt und
  // verschwindet; sonst bliebe er fuer ein Set stehen, das man hat.
  const vorhanden = await findSetInScope(leserId, sn);
  const ergebnis = vorhanden
    ? { action: 'exists', set_number: sn }
    : await addSet(sn, V.acquisitionQuantity(eingabe.quantity ?? 1), besitzerId, null,
                   V.optionalPrice(eingabe.purchase_price, 'Kaufpreis'), zustand);

  await loescheWunsch(besitzerId, sn, zustand);
  await loescheAlarm(besitzerId, sn, zustand);
  return ergebnis as { action: string; set_number: string };
}
