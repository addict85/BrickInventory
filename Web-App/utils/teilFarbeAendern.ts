import * as db from '../db/database';
import type { DbSchnittstelle } from '../db/database';
import { lookupPart } from '../clients/rebrickable';
import { meldeUndWeiter } from './httpError';
import { merkeTeilFarbe, katalogTeil } from './katalogPflege';

/**
 * Die Farbe eines manuell erfassten Teils NACHTRÄGLICH ändern.
 * Ausführlich: docs/begruendungen/utils/teilFarbeAendern.ts.md#farbwechsel
 */
export type FarbWechsel = {
  /** Die Zeile zog um (false) oder wurde mit einer bestehenden vereint (true). */
  zusammengelegt: boolean;
  /** Erfassungen, die in die Zielfarbe umgezogen sind. */
  verschoben: number;
  /** Erfassungen, die in eine Erfassung desselben Tages addiert wurden. */
  vereint: number;
  /**
   * Woher das Bild der NEUEN Farbe kommt — siehe bildNachtragen().
   *
   * `null` heisst: Für diese Farbe kennt weder der eigene Katalog noch
   * Rebrickable ein Bild. Das ist eine Auskunft und kein Fehler; die
   * Oberfläche nennt es in der Meldung.
   */
  bild: BildQuelle;
};

/**
 * `vorhanden`    Das Farbbild stand schon da — nichts zu holen.
 * `katalog`      Aus einer eingespielten Set-Teileliste (lokal).
 * `rebrickable`  Über die Rebrickable-API geholt.
 * `null`         Nirgends eines gefunden.
 */
export type BildQuelle = 'vorhanden' | 'katalog' | 'rebrickable' | null;

/**
 * Das Bild der ZIELFARBE nachtragen — nach der Transaktion, nie darin.
 * Ausführlich: docs/begruendungen/utils/teilFarbeAendern.ts.md#bildnachtragen
 */
async function bildNachtragen(partNumber: string, farbe: number): Promise<BildQuelle> {
  // Die beiden lokalen Abfragen standen hier einzeln; sie stehen jetzt in
  // katalogTeil() (utils/katalogPflege.ts), weil addManualPartIntern()
  // dieselbe Reihenfolge braucht. Die Übersetzung der Quelle in `BildQuelle`
  // bleibt hier: 'vorhanden' und 'katalog' sind die Worte DIESES Weges.
  const lokal = await katalogTeil(partNumber, farbe);
  if (lokal?.bildQuelle === 'farbe') return 'vorhanden';

  if (lokal?.bildQuelle === 'set') {
    try {
      await merkeTeilFarbe(partNumber, farbe, null, null, lokal.bild, lokal.bildDatei);
      return 'katalog';
    } catch (e) {
      // Die Farbe IST geändert — der Aufrufer darf das nicht als Fehlschlag
      // sehen, nur weil das Bild nicht dazugekommen ist.
      meldeUndWeiter('farbwechsel:bild aus set_parts_catalog', e);
      return null;
    }
  }

  const info = await lookupPart(partNumber, farbe).catch(() => null);
  if (!info?.image_url) return null;
  try {
    await merkeTeilFarbe(partNumber, farbe, null, null, info.image_url, null);
    return 'rebrickable';
  } catch (e) {
    meldeUndWeiter('farbwechsel:bild von Rebrickable', e);
    return null;
  }
}

/**
 * @param uid        Besitzer der Zeile — NICHT der Betrachter. Wer in wessen
 *                   Bestand schreiben darf, entscheidet resolveWriteTarget()
 *                   in der Route (utils/household.ts).
 * @param neueFarbe  Rebrickable-Farbnummer. 0 ist im Baum „ohne Angabe".
 */
export async function aendereTeilFarbe(
  uid: number,
  partNumber: string,
  alteFarbe: number,
  neueFarbe: number,
  angaben: { color_name?: string | null; color_hex?: string | null } = {},
): Promise<FarbWechsel> {
  const alt = Number(alteFarbe) || 0;
  const neu = Number(neueFarbe) || 0;

  // Farbbezeichnung und Farbcode: rb_colors zuerst, weil der Katalog für alle
  // Konten gilt; die Angaben des Aufrufers füllen nur, was dort fehlt.
  const katalogFarbe = await db.get('SELECT name, rgb FROM rb_colors WHERE id = $1', [neu])
    .catch(() => null);

  // Die Transaktion liefert alles AUSSER dem Bild: Das wird danach geholt,
  // weil der Abruf dauern und scheitern darf, ohne die Änderung mitzunehmen.
  const wechsel = await db.transaction(async (tx: DbSchnittstelle): Promise<Omit<FarbWechsel, 'bild'>> => {
    const quelle = await tx.get(
      `SELECT id, storage_id FROM parts
        WHERE user_id = $1 AND part_number = $2 AND COALESCE(color_id, 0) = $3
          AND source = 'manual'`,
      [uid, partNumber, alt]);
    if (!quelle) {
      throw Object.assign(new Error('Teil nicht gefunden oder nicht manuell hinzugefügt'),
        { status: 404 });
    }
    // Gleiche Farbe: nichts zu tun, und das wird GESAGT statt stillschweigend
    // „erfolgreich" gemeldet. Sonst sieht ein Aufrufer, der sich verklickt
    // hat, dasselbe Ergebnis wie bei einer echten Änderung.
    if (alt === neu) return { zusammengelegt: false, verschoben: 0, vereint: 0 };

    // Der Katalogeintrag für die ZIELFARBE muss stehen, bevor die Zeile
    // umzieht: Die Teileliste liest Farbbezeichnung und Farbcode von dort
    // (LEFT JOIN part_color_catalog in getManualParts). Ohne ihn hätte das
    // Teil nach der Änderung einen Farbpunkt ohne Beschriftung — genau der
    // Zustand, über den Marco sich beim Import beschwert hat.
    // rb_colors geprüft, die Angaben des Aufrufers als Eingabe dieses Kontos.
    await merkeTeilFarbe(partNumber, neu, katalogFarbe?.name, katalogFarbe?.rgb, null, null, tx);
    await merkeTeilFarbe(partNumber, neu, angaben.color_name, angaben.color_hex, null, null, tx, uid);

    const ziel = await tx.get(
      `SELECT id, storage_id FROM parts
        WHERE user_id = $1 AND part_number = $2 AND COALESCE(color_id, 0) = $3
          AND source = 'manual'`,
      [uid, partNumber, neu]);

    // ── Erfassungen: erst addieren, was den gleichen Indexschlüssel hätte ──
    //
    // Die Reihenfolge ist zwingend. Zöge das UPDATE unten zuerst um, liefe es
    // in `idx_part_acq_tag_merkmale` — und zwar nur manchmal, nämlich wenn beide Farben
    // am gleichen Tag erfasst wurden. Ein Fehler, der von der Uhr abhängt.
    const vereint = await tx.run(
      `UPDATE part_acquisitions z
          SET quantity = z.quantity + a.quantity
         FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
          AND (z.created_at AT TIME ZONE 'UTC')::date
            = (a.created_at AT TIME ZONE 'UTC')::date
          AND z.condition = a.condition AND z.price_estimated = a.price_estimated
          AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1)`,
      [uid, partNumber, alt, neu]);
    // Die eben addierten Quellzeilen müssen weg, sonst zöge das UPDATE sie
    // gleich darunter um und die Stückzahl stünde doppelt da.
    await tx.run(
      `DELETE FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND EXISTS (SELECT 1 FROM part_acquisitions z
                       WHERE z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
                         AND (z.created_at AT TIME ZONE 'UTC')::date
                           = (a.created_at AT TIME ZONE 'UTC')::date
                         AND z.condition = a.condition AND z.price_estimated = a.price_estimated
                         AND z.currency = a.currency AND COALESCE(z.unit_price, -1) = COALESCE(a.unit_price, -1))`,
      [uid, partNumber, alt, neu]);
    const verschoben = await tx.run(
      `UPDATE part_acquisitions SET color_id = $4
        WHERE user_id = $1 AND part_number = $2 AND color_id = $3`,
      [uid, partNumber, alt, neu]);

    if (ziel) {
      // Zusammenlegen: Die Zielzeile bleibt, die falsche geht. Einen Lagerort
      // nimmt sie mit, wenn die Zielzeile keinen hat — er ist eine Angabe des
      // Menschen („Kiste 3") und soll durch eine Farbkorrektur nicht
      // verschwinden. Hat die Zielzeile einen, gewinnt der: Sie ist die
      // Zeile, die bleibt.
      if (quelle.storage_id && !ziel.storage_id) {
        await tx.run('UPDATE parts SET storage_id = $1 WHERE id = $2',
          [quelle.storage_id, ziel.id]);
      }
      await tx.run('DELETE FROM parts WHERE id = $1', [quelle.id]);
    } else {
      await tx.run('UPDATE parts SET color_id = $1 WHERE id = $2', [neu, quelle.id]);
    }

    return {
      zusammengelegt: !!ziel,
      verschoben: verschoben.changes ?? 0,
      vereint: vereint.changes ?? 0,
    };
  });

  // Auch bei alt === neu: Die Frage „hat diese Farbe ein Bild?" ist dann
  // dieselbe, und der Dialog öffnet danach genauso neu. Eine Ausnahme hier
  // wäre ein zweiter Weg, der nur manchmal ein Bild nachträgt.
  return { ...wechsel, bild: await bildNachtragen(partNumber, neu) };
}
