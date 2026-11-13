import { lookupPart } from '../katalog';
import { meldeFehler } from '../infra/fehler';
import { colorId } from '../infra/validate';
import * as repo from './repository/teilFarbe';
import { fachfehler } from '../infra/fehlerTexte';
import { versuche } from '../infra/ergebnis';
import type { TeileKontext } from './kontext';

// Falsche Farben ohne Neuerfassen ändern.
export type FarbWechsel = {
  /** Die Zeile zog um (false) oder wurde mit einer bestehenden vereint (true). */
  zusammengelegt: boolean;
  verschoben: number;
  /** In eine Erfassung desselben Tages addiert. */
  vereint: number;
  /** `null` ist eine Auskunft, kein Fehler; die Oberfläche nennt es. */
  bild: BildQuelle;
};

/** `vorhanden`: schon da (auch aus einer Setliste); `rebrickable`: geholt;
 * `null`: nirgends gefunden. */
export type BildQuelle = 'vorhanden' | 'rebrickable' | null;

/** Nach der Transaktion, nie darin: Der Abruf darf dauern und scheitern, ohne
 * die Änderung mitzunehmen. */
async function bildNachtragen(k: TeileKontext, partNumber: string, farbe: number): Promise<BildQuelle> {
  const lokal = await k.katalog.katalogTeil(partNumber, farbe);
  if (lokal?.bildQuelle === 'farbe') return 'vorhanden';

  // Die Änderung steht schon; ein gescheiterter Abruf lässt nur das Bild weg.
  const info = await versuche('teilfarbe:lookupPart', () => lookupPart(partNumber, farbe));
  if (!info.ok || !info.wert?.image_url) return null;
  try {
    await k.katalog.merkeTeilFarbe(partNumber, farbe, null, null, info.wert.image_url, null);
    return 'rebrickable';
  } catch (e) {
    meldeFehler('farbwechsel:bild von Rebrickable', e);
    return null;
  }
}

/** @param uid        Besitzer der Zeile — NICHT der Betrachter; das Schreibrecht
 *                   prüft die Route mit schreibzielOderNull().
 * @param neueFarbe  KEINE_FARBE (9999) heisst „ohne Angabe". */
export async function aendereTeilFarbe(
  k: TeileKontext,
  uid: number,
  partNumber: string,
  alteFarbe: number,
  neueFarbe: number,
  angaben: { color_name?: string | null; color_hex?: string | null } = {},
): Promise<FarbWechsel> {
  const alt = colorId(alteFarbe);
  const neu = colorId(neueFarbe);

  // rb_colors zuerst, weil der Katalog für alle Konten gilt; die Angaben des
  // Aufrufers füllen nur, was dort fehlt.
  const katalogFarbe = await k.teilFarbe.rbFarbe(neu);

  const wechsel = await k.transaktion(async (t): Promise<Omit<FarbWechsel, 'bild'>> => {
    const quelle = await repo.manuelleTeilzeileSperren(t.db, uid, partNumber, alt);
    if (!quelle) {
      fachfehler('nicht_gefunden', 'teil_nicht_manuell');
    }
    // Gleiche Farbe wird GESAGT statt als Erfolg gemeldet: Ein Verklicken sähe
    // sonst aus wie eine echte Änderung.
    if (alt === neu) return { zusammengelegt: false, verschoben: 0, vereint: 0 };

    // Der Katalogeintrag der ZIELFARBE muss vor dem Umzug stehen: Die Teileliste
    // liest Name und Farbcode von dort, sonst ein Farbpunkt ohne Beschriftung.
    await t.katalog.merkeTeilFarbe(partNumber, neu, katalogFarbe?.name, katalogFarbe?.rgb, null, null, t.db);
    await t.katalog.merkeTeilFarbe(partNumber, neu, angaben.color_name, angaben.color_hex, null, null, t.db, uid);

    const ziel = await repo.manuelleTeilzeileSperren(t.db, uid, partNumber, neu);

    // Erst addieren, dann umziehen: Sonst liefe das UPDATE in
    // `idx_part_acq_erfassungstag` — nur wenn beide Farben am gleichen Tag erfasst
    // wurden, ein Fehler, der von der Uhr abhängt.
    const vereint = await repo.stockeGleicheErfassungenAuf(t.db, uid, partNumber, alt, neu);
    // Die addierten Quellzeilen müssen weg, sonst stünde die Stückzahl doppelt da.
    await repo.loescheAufgestockteErfassungen(t.db, uid, partNumber, alt, neu);
    const verschoben = await repo.faerbeErfassungenUm(t.db, uid, partNumber, alt, neu);

    if (ziel) {
      // Die Zielzeile bleibt. Ihren Lagerort übernimmt sie nur, wenn sie keinen hat:
      // „Kiste 3" soll durch eine Farbkorrektur nicht verschwinden.
      if (quelle.storage_id && !ziel.storage_id) {
        await repo.setzeTeilLagerort(t.db, quelle.storage_id, ziel.id);
      }
      await repo.loescheTeilzeile(t.db, quelle.id);
    } else {
      await repo.faerbeTeilzeileUm(t.db, neu, quelle.id);
    }

    return {
      zusammengelegt: !!ziel,
      verschoben: verschoben.changes ?? 0,
      vereint: vereint.changes ?? 0,
    };
  });

  // Auch bei alt === neu: Eine Ausnahme wäre ein zweiter Weg, der nur manchmal
  // ein Bild nachträgt.
  return { ...wechsel, bild: await bildNachtragen(k, partNumber, neu) };
}
