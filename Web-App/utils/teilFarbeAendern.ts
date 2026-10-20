import * as db from '../db/database';
import type { DbSchnittstelle } from '../db/database';
import { lookupPart } from '../clients/rebrickable';
import { meldeUndWeiter } from './httpError';
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
 * ── Das Bild der neuen Farbe ────────────────────────────────────────────────
 *
 * `part_color_catalog` führt das Bild je Teil UND Farbe (ein roter 2x4 sieht
 * anders aus als ein blauer). Für eine Farbe, die noch kein Import gesehen
 * hat, steht dort keines — die Kachel zeigte nach der Änderung also den
 * Platzhalter.
 *
 * Marcos Befund vom 20.10.: „Wenn ich die Farbe der manuell erfassten Teile
 * ändere wird das Bild nicht aktualisiert." NACHGEMESSEN am laufenden Server:
 * Vor dem Wechsel trug die Kachel von 3001/Rot das Bild 300121.jpg, nach dem
 * Wechsel auf Blau keines mehr, und `part_color_catalog` hatte für (3001, 7)
 * eine Zeile ohne image_url.
 *
 * Hier stand, der Bildabgleich (jobs/imageQueue.ts) hole es nach. Das war
 * FALSCH und ist die Korrektur, die dieser Nachtrag am eigenen Kommentar
 * vornimmt: Jener Job arbeitet Notizen über ANGEFRAGTE Adressen ab
 * (`image_wanted`) und legt sie lokal ab. Wo gar keine Adresse steht, hat er
 * nichts zu holen. Die einzige Stelle im Baum, die ein fehlendes Farbbild je
 * nachgetragen hat, ist backfillPartImages() in
 * jobs/purchasePriceBackfill.ts — ein Nachlauf beim Serverstart, also nichts,
 * was eine Farbänderung begleitet.
 *
 * Deshalb trägt bildNachtragen() es jetzt nach, NACH der Transaktion und in
 * zwei Schritten: erst aus den eingespielten Set-Teilelisten (lokal, kostet
 * nichts), dann über Rebrickable (dieselbe Abfrage, die auch das Erfassen von
 * Hand macht — lookupPart liefert für eine Farbe das Farbbild). Beides
 * ausserhalb der Transaktion, weil ein Netzabruf darin der falsche Ort wäre:
 * Er dauert, er kann scheitern, und die Farbe soll sich auch ohne Netz ändern
 * lassen. Findet sich keines, bleibt es leer und das Ergebnis SAGT das
 * (`bild: null`) — die Oberfläche schreibt es in die Meldung, statt Marco ein
 * zweites Mal vor einem leeren Platz stehen zu lassen.
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
 *
 * ── Die Reihenfolge der Quellen ─────────────────────────────────────────────
 *
 * 1. `set_parts_catalog`. Dieselbe Tabelle führt das Bild ebenfalls je Teil
 *    UND Farbe, nur zusätzlich je Set. Steckt der Stein in dieser Farbe in
 *    einem eingespielten Set, ist es dasselbe Bild — lokal, ohne Abruf, und
 *    oft sogar schon als Datei (`image_local`). Zeilen mit Datei zuerst.
 * 2. `lookupPart()`. Derselbe Weg wie beim Erfassen von Hand (routes/parts.ts)
 *    und beim Nachtrag in jobs/purchasePriceBackfill.ts: Für eine angegebene
 *    Farbe fragt er den Parts/Colors-Endpunkt, der das FARBBILD liefert. Ohne
 *    Rebrickable-Schlüssel gibt er sofort null zurück — ohne Netz kostet
 *    dieser Schritt also nichts.
 *
 * Geschrieben wird über merkeTeilFarbe(), und das heisst: COALESCE. Ein
 * bereits dastehendes Bild wird NICHT überschrieben — darum fragt der Schritt
 * davor auch zuerst, ob überhaupt eines fehlt.
 *
 * ── Was dabei in Kauf genommen wird ─────────────────────────────────────────
 *
 * Scheitert in lookupPart() der Farb-Abruf, fällt es intern auf
 * `part_img_url` zurück — das ALLGEMEINE Teilebild, bei vielen Teilen die
 * weisse Fassung. Das landet dann hier, und wegen des COALESCE bleibt es auch
 * stehen. Hier KEIN zweites Urteil darüber zu fällen ist Absicht: Dieselbe
 * Antwort nimmt auch das Erfassen von Hand (routes/parts.ts, addManualPart),
 * und ein Bild, das wir anders bewerten als die Stelle daneben, wäre eine
 * zweite Regel für dieselbe Frage. Wieder herauskommt ein solches Bild über
 * backfillPartImages() in jobs/purchasePriceBackfill.ts — der Nachlauf
 * schreibt bewusst ÜBERSCHREIBEND und ist genau dafür entstanden.
 */
async function bildNachtragen(partNumber: string, farbe: number): Promise<BildQuelle> {
  const steht = await db.get(
    `SELECT COALESCE(image_local, image_url) AS bild FROM part_color_catalog
      WHERE part_number = $1 AND color_id = $2`,
    [partNumber, farbe]).catch(() => null);
  if (steht?.bild) return 'vorhanden';

  const ausSet = await db.get(
    `SELECT image_url, image_local FROM set_parts_catalog
      WHERE part_number = $1 AND color_id = $2
        AND (image_local IS NOT NULL OR image_url IS NOT NULL)
      ORDER BY (image_local IS NULL), set_number LIMIT 1`,
    [partNumber, farbe]).catch(() => null);
  if (ausSet) {
    try {
      await merkeTeilFarbe(partNumber, farbe, null, null, ausSet.image_url, ausSet.image_local);
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

  // Farbbezeichnung und Farbcode: was der Aufrufer mitbringt, sonst aus dem
  // Farbkatalog. Dieselbe Reihenfolge wie beim Anlegen von Hand
  // (`effectiveColorHex` in routes/parts.ts) — die Auswahlliste der
  // Oberfläche und rb_colors sind dieselbe Quelle, nur einmal über das Netz
  // und einmal aus dem CSV-Abgleich.
  const katalogFarbe = await db.get('SELECT name, rgb FROM rb_colors WHERE id = $1', [neu])
    .catch(() => null);
  const farbName = angaben.color_name || katalogFarbe?.name || null;
  const farbHex  = angaben.color_hex  || katalogFarbe?.rgb  || null;

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

  // Auch bei alt === neu: Die Frage „hat diese Farbe ein Bild?" ist dann
  // dieselbe, und der Dialog öffnet danach genauso neu. Eine Ausnahme hier
  // wäre ein zweiter Weg, der nur manchmal ein Bild nachträgt.
  return { ...wechsel, bild: await bildNachtragen(partNumber, neu) };
}
