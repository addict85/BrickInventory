/**
 * „Ist dieses Set schon da?" — die Regel für alle Erfassungswege.
 *
 * ── Marcos Festlegung ───────────────────────────────────────────────────────
 * Besitzt das eigene Konto ODER eines der Konten im Blickfeld das Set bereits,
 * wird die Menge NICHT erhöht. Stattdessen öffnet sich die Detailansicht.
 * Das gilt für alle drei Wege gleich: Eingabe der Setnummer, Barcode-Scanner
 * und Texterkennung. Wer wirklich ein zweites Exemplar erfassen will, tut das
 * dort, wo man sieht, was man tut — über die Menge oder eine neue
 * Kaufpreis-Zeile.
 *
 * ── Warum das hier steht und nicht in den Clients ───────────────────────────
 * Die App prüfte das seit Nachtrag 57 selbst (ein `getSetDetail`-Aufruf vor
 * dem Anlegen), die Webapp gar nicht — sie schickte unbesehen ab, der Server
 * erhöhte die Menge und meldete „aktualisiert". Dieselbe Eingabe, zwei
 * Ausgänge, und die Regel hing daran, welchen Client man benutzt.
 *
 * Jetzt entscheidet der Server. Die Oberflächen zeigen nur noch, was
 * zurückkommt: `action: 'exists'` heisst „Detailansicht öffnen".
 *
 * ── Was hier ABSICHTLICH nicht greift ───────────────────────────────────────
 * Der CSV-Import. Er ruft addSet() direkt und soll weiterhin zusammenfassen —
 * wer 500 Zeilen einliest, will keine 500 Rückfragen, und dieselbe Setnummer
 * zweimal in einer Datei ist eine Mengenangabe, keine Verwechslung. Die Regel
 * hängt deshalb an den INTERAKTIVEN Routen, nicht in addSet() selbst.
 */
import * as db from '../db/database';
import { scopeIds } from './household';

/**
 * Setnummer normalisieren — dieselbe Regel wie sanitizeSetNumber() in
 * routes/sets.ts, die addSet() vor dem Schreiben anwendet.
 *
 * Sie steht hier noch einmal, weil ein Import aus routes/sets.ts einen Kreis
 * bauen würde (sets.ts → utils/setAdd.ts → sets.ts). Ein Test hält die beiden
 * Fassungen zusammen: Weicht eine ab, prüft die Regel eine andere Nummer, als
 * später geschrieben wird — und das Set wäre trotz Prüfung doppelt.
 */
export function normalizeSetNumber(input: string): string {
  // Bewusst OHNE den vorDem()-Helfer: Diese Funktion steht in zwei Fassungen
  // nebeneinander (ein Import baute einen Kreis, siehe oben), und
  // set-add-exists-db.test.js fuehrt ihren Rumpf ISOLIERT aus, um beide zu
  // vergleichen. Ein externer Aufruf darin waere dort nicht aufloesbar — der
  // Test hat das gemeldet, als ich es zuerst anders gemacht habe.
  let s = ((String(input).trim().split(';')[0] ?? '').trim().split(' ')[0] ?? '')
    .trim().replace(/[^a-zA-Z0-9-]/g, '');
  if (!/-\d+$/.test(s)) s = s + '-1';
  return s;
}

export interface VorhandenesSet {
  set_number: string;
  owner_user_id: number;
  /** true, wenn es dem fragenden Konto selbst gehört (sonst einem anderen im Haushalt). */
  is_self: boolean;
}

/**
 * Sucht das Set im BLICKFELD des Fragenden (eigenes Konto + Haushalt).
 *
 * Bewusst scopeIds() und nicht writableIds(): Die Frage lautet „habe ich das
 * schon?", und sichtbar ist sichtbar. Ein Set, das im Haushalt bereits steht,
 * soll man nicht versehentlich ein zweites Mal anlegen — auch dann nicht, wenn
 * man selbst nicht hineinschreiben dürfte.
 *
 * @returns die gefundene Zeile oder null
 */
export async function findSetInScope(
  viewerId: number, setNumber: string
): Promise<VorhandenesSet | null> {
  const sn  = normalizeSetNumber(setNumber);
  const ids = await scopeIds(viewerId);
  const row = await db.get(
    `SELECT set_number, user_id FROM sets
      WHERE user_id = ANY($1) AND set_number = $2
      -- Das eigene Konto gewinnt, wenn mehrere Konten dasselbe Set haben:
      -- die Detailansicht soll die eigene Zeile zeigen, nicht die eines
      -- Geschwisterkontos.
      ORDER BY (user_id = $3) DESC
      LIMIT 1`,
    [ids, sn, viewerId]
  ).catch(() => null);
  if (!row) return null;
  return { set_number: row.set_number, owner_user_id: row.user_id, is_self: row.user_id === viewerId };
}
