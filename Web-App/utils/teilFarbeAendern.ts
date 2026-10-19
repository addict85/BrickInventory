import * as db from '../db/database';
import type { DbSchnittstelle } from '../db/database';
import { merkeTeilFarbe } from './katalogPflege';

/**
 * Die Farbe eines manuell erfassten Teils NACHTRÄGLICH ändern.
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 *
 * Marcos Befund vom 19.10., nach dem Import mehrerer BrickLink-Wanted-Listen:
 * „Die Farbe wurde nicht immer übernommen und die Teile sind nun mehrfach
 *  vorhanden (bsp 3001). … Weiter möchte ich die Farbe nachträglich anpassen
 *  können für den Fall dass diese nicht korrekt geladen wurde."
 *
 * Der Import legt die Farbe seit dem Fix nicht mehr falsch an (siehe
 * utils/wantedListe.ts) — aber Marcos BESTEHENDER Bestand trägt die falschen
 * Farben schon. Ohne diesen Weg bliebe ihm nur Löschen und neu Erfassen, und
 * damit wäre die Erfassungshistorie weg (Kaufpreise, Daten).
 *
 * ── Warum es kein einfaches UPDATE ist ──────────────────────────────────────
 *
 * Dieselbe Teilenummer kann in der ZIELFARBE schon im Bestand stehen — bei
 * Marco ist das der Normalfall, denn genau daneben steht das Teil ja richtig.
 * Ein `UPDATE parts SET color_id` läuft dann in den eindeutigen Index
 * `idx_parts_eindeutig` (user_id, set_number, part_number, color_id) und
 * scheitert. Zwei Zeilen desselben Teils in derselben Farbe wären auch keine
 * Lösung — das ist das Doppelte, das Marco gerade loswerden will.
 *
 * Also: Gibt es die Zielfarbe schon, werden die beiden ZUSAMMENGELEGT, sonst
 * zieht die Zeile um.
 *
 * Dasselbe gilt für die Erfassungen, nur eine Ebene feiner: `idx_part_acq_tag`
 * ist eindeutig über (user_id, part_number, color_id, Tag). Zwei Erfassungen
 * vom gleichen Tag — eine in der falschen, eine in der richtigen Farbe —
 * müssen zu einer addiert werden, nicht nebeneinander stehen.
 *
 * ── Was NICHT passiert ──────────────────────────────────────────────────────
 *
 * Das BILD wird hier nicht geholt. `part_color_catalog` führt es je Teil UND
 * Farbe (ein roter 2x4 sieht anders aus als ein blauer), und für eine Farbe,
 * die noch kein Import gesehen hat, steht dort keines. Ein Rebrickable-Abruf
 * mitten in einer Transaktion wäre der falsche Ort dafür: Er dauert, er kann
 * scheitern, und die Farbe soll sich auch ohne Netz ändern lassen. Der
 * Bildabgleich (jobs/imageQueue.ts) holt es nach.
 *
 * Teile AUS SETS (`source='set'`) sind ausgenommen. Ihre Farbe kommt aus der
 * Set-Teileliste von Rebrickable; sie dort zu ändern hiesse, die Teileliste
 * des Sets zu bestreiten, und der nächste Set-Import setzte sie zurück.
 */
export type FarbWechsel = {
  /** Die Zeile zog um (false) oder wurde mit einer bestehenden vereint (true). */
  zusammengelegt: boolean;
  /** Erfassungen, die in die Zielfarbe umgezogen sind. */
  verschoben: number;
  /** Erfassungen, die in eine Erfassung desselben Tages addiert wurden. */
  vereint: number;
};

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

  // Farbbezeichnung und Farbcode: was der Aufrufer mitbringt, sonst aus dem
  // Farbkatalog. Dieselbe Reihenfolge wie beim Anlegen von Hand
  // (`effectiveColorHex` in routes/parts.ts) — die Auswahlliste der
  // Oberfläche und rb_colors sind dieselbe Quelle, nur einmal über das Netz
  // und einmal aus dem CSV-Abgleich.
  const katalogFarbe = await db.get('SELECT name, rgb FROM rb_colors WHERE id = $1', [neu])
    .catch(() => null);
  const farbName = angaben.color_name || katalogFarbe?.name || null;
  const farbHex  = angaben.color_hex  || katalogFarbe?.rgb  || null;

  return db.transaction(async (tx: DbSchnittstelle) => {
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
    await merkeTeilFarbe(partNumber, neu, farbName, farbHex, null, null, tx);

    const ziel = await tx.get(
      `SELECT id, storage_id FROM parts
        WHERE user_id = $1 AND part_number = $2 AND COALESCE(color_id, 0) = $3
          AND source = 'manual'`,
      [uid, partNumber, neu]);

    // ── Erfassungen: erst addieren, was auf denselben Tag fällt ────────────
    //
    // Die Reihenfolge ist zwingend. Zöge das UPDATE unten zuerst um, liefe es
    // in `idx_part_acq_tag` — und zwar nur manchmal, nämlich wenn beide Farben
    // am gleichen Tag erfasst wurden. Ein Fehler, der von der Uhr abhängt.
    const vereint = await tx.run(
      `UPDATE part_acquisitions z
          SET quantity = z.quantity + a.quantity
         FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
          AND (z.created_at AT TIME ZONE 'UTC')::date
            = (a.created_at AT TIME ZONE 'UTC')::date`,
      [uid, partNumber, alt, neu]);
    // Die eben addierten Quellzeilen müssen weg, sonst zöge das UPDATE sie
    // gleich darunter um und die Stückzahl stünde doppelt da.
    await tx.run(
      `DELETE FROM part_acquisitions a
        WHERE a.user_id = $1 AND a.part_number = $2 AND a.color_id = $3
          AND EXISTS (SELECT 1 FROM part_acquisitions z
                       WHERE z.user_id = $1 AND z.part_number = $2 AND z.color_id = $4
                         AND (z.created_at AT TIME ZONE 'UTC')::date
                           = (a.created_at AT TIME ZONE 'UTC')::date)`,
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
}
