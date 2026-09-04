/**
 * Wie eine Set-Nummer geschrieben wird — die eine Stelle dafür.
 *
 * Rebrickable und BrickLink führen Sets MIT Versionsanhang: „10179-1". Wer
 * eine Nummer ohne ihn bekommt (Eingabe, Barcode, alter Bestand), muss sie
 * ergänzen, bevor er damit in eine Tabelle greift — sonst findet er nichts.
 *
 * ── Warum das eine eigene Datei ist ─────────────────────────────────────────
 * Die Zeile
 *
 *     setNumber.includes('-') ? setNumber : `${setNumber}-1`
 *
 * stand VIERUNDZWANZIGMAL im Baum, in zwölf Dateien. Solange alle
 * Fundstellen sie gleich schreiben, fällt das nicht auf — aber es reicht
 * eine, die es nicht tut, und dann suchen zwei Stellen unter verschiedenen
 * Namen nach derselben Sache.
 *
 * NACHGEMESSEN an genau so einem Fall: Ein Set, das clients/bricklink.ts im
 * Katalog als „kein BrickLink-Preis" markiert hatte (abgelegt unter der
 * Nummer MIT Anhang), wurde von der Vorprüfung im Preis-Job und im
 * Anfrageweg unter der ROHEN Nummer gesucht:
 *
 *     Eingabe                Job                    Anfrageweg
 *     ohne Versionsanhang    error, 1 Abruf         wirft, 2 Abrufe
 *     mit  Versionsanhang    skipped_gear, 0        still,  0
 *
 * Drei BrickLink-Abrufe für ein Set, von dem im Katalog steht, dass es
 * keinen Preis hat — je Lauf, auf Kosten des Tageskontingents. Und der Job
 * zählte es als Fehler statt als übersprungen.
 */

/**
 * Die Schreibweise, unter der Kataloge und Zwischenspeicher ein Set führen.
 *
 * Geprüft wird auf einen VERSIONSANHANG (`-` und Ziffern), nicht auf
 * irgendeinen Bindestrich. Die 24 zusammengeführten Fundstellen schrieben
 * `includes('-')`, drei weitere (utils/setAdd, utils/setService,
 * routes/api_v1/catalog) und utils/bricklinkLink schrieben `/-\d+$/`. Die
 * beiden stimmen auf jeder echten Nummer überein und gehen erst bei einem
 * Bindestrich OHNE Ziffernanhang auseinander:
 *
 *     Eingabe     includes('-')   /-\d+$/
 *     10179       10179-1         10179-1
 *     fig-000123  fig-000123      fig-000123
 *     10179-a     10179-a         10179-a-1   <- verschieden
 *
 * NACHGESEHEN im gemeinsamen Prüfkorpus (shared/setnummer-korpus.json): keine
 * einzige Nummer dieser Art. Genommen wird die genauere Fassung — dann sagen
 * auch die beiden bewusst doppelten Normalisierer in setAdd/setService (die
 * ihren eigenen Vergleichstest haben und deshalb nichts importieren dürfen)
 * dasselbe wie diese Stelle, statt nur beinahe.
 */
export function mitVersion(setNumber: string | number): string {
  const s = String(setNumber);
  return /-\d+$/.test(s) ? s : `${s}-1`;
}

/** Dieselbe Nummer ohne Versionsanhang — „10179" aus „10179-1". */
export function ohneVersion(setNumber: string | number): string {
  return mitVersion(setNumber).replace(/-\d+$/, '');
}

/**
 * Beide Schreibweisen, mit der versionierten zuerst.
 *
 * Wer in einem Bestand sucht, der beide Formen enthalten kann, braucht
 * beide — und sie müssen VERSCHIEDEN sein, sonst fragt die Abfrage zweimal
 * dasselbe. Genau das ist in utils/handlers/parts.ts passiert.
 */
export function beideSchreibweisen(setNumber: string | number): [string, string] {
  const n = mitVersion(setNumber);
  return [n, ohneVersion(n)];
}

// ── Der Katalog-Eintrag zu einem Set ────────────────────────────────────────
//
// Hier steht der LESER, nicht nur die Schreibweise: Die drei Stellen, die
// „kennt BrickLink dafuer gar keinen Preis?" fragten, taten es mit
// verschiedenen Schluesseln. Die Markierung schreibt clients/bricklink.ts
// unter der Nummer MIT Anhang; zwei der drei suchten unter der rohen.
import * as db from '../db/database';

export interface KatalogEintrag { is_gear?: number | null; bl_type?: string | null; }

/** Der Katalog-Eintrag zu einem Set — unter der Schreibweise, unter der er abgelegt wird. */
export async function katalogEintrag(setNumber: string): Promise<KatalogEintrag | null> {
  return db.get('SELECT is_gear, bl_type FROM catalog_cache WHERE set_number = $1',
                [mitVersion(setNumber)]);
}

/**
 * Sagt der Katalog, dass es fuer dieses Set bei BrickLink gar keinen Preis
 * gibt? Dann braucht es den Abruf nicht — er kostet nur das Tageskontingent
 * und endet ohnehin im Fehler.
 */
export function ohneBricklinkPreis(eintrag: KatalogEintrag | null | undefined): boolean {
  return eintrag?.is_gear === 1 && eintrag?.bl_type === 'NONE';
}
