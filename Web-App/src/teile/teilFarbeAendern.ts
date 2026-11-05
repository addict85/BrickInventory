import * as db from '../../db/database';
import type { DbSchnittstelle } from '../../db/database';
import { lookupPart } from '../../clients/rebrickable';
import { meldeUndWeiter, meldeUndLiefere } from '../infra/fehler';
import { merkeTeilFarbe, katalogTeil } from '../katalog/katalogPflege';
import { colorId } from '../infra/validate';
import * as repo from './repository/teilFarbe';
import { Meldung } from '../infra/fehlerTexte';

// Ausführlich: docs/begruendungen/src/teile/teilFarbeAendern.ts.md#farbwechsel
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
async function bildNachtragen(partNumber: string, farbe: number): Promise<BildQuelle> {
  const lokal = await katalogTeil(partNumber, farbe);
  if (lokal?.bildQuelle === 'farbe') return 'vorhanden';

  const info = await lookupPart(partNumber, farbe).catch(meldeUndLiefere('teilfarbe:lookupPart', null));
  if (!info?.image_url) return null;
  try {
    await merkeTeilFarbe(partNumber, farbe, null, null, info.image_url, null);
    return 'rebrickable';
  } catch (e) {
    meldeUndWeiter('farbwechsel:bild von Rebrickable', e);
    return null;
  }
}

/** @param uid        Besitzer der Zeile — NICHT der Betrachter; das Schreibrecht
 *                   prüft die Route mit resolveWriteTarget().
 * @param neueFarbe  KEINE_FARBE (9999) heisst „ohne Angabe". */
export async function aendereTeilFarbe(
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
  const katalogFarbe = await repo.rbFarbe(neu)
    .catch(meldeUndLiefere('teilfarbe:katalogFarbe', null));

  const wechsel = await db.transaction(async (tx: DbSchnittstelle): Promise<Omit<FarbWechsel, 'bild'>> => {
    const quelle = await repo.manuelleTeilzeileSperren(tx, uid, partNumber, alt);
    if (!quelle) {
      throw new Meldung('Teil nicht gefunden oder nicht manuell hinzugefügt', 404);
    }
    // Gleiche Farbe wird GESAGT statt als Erfolg gemeldet: Ein Verklicken sähe
    // sonst aus wie eine echte Änderung.
    if (alt === neu) return { zusammengelegt: false, verschoben: 0, vereint: 0 };

    // Der Katalogeintrag der ZIELFARBE muss vor dem Umzug stehen: Die Teileliste
    // liest Name und Farbcode von dort, sonst ein Farbpunkt ohne Beschriftung.
    await merkeTeilFarbe(partNumber, neu, katalogFarbe?.name, katalogFarbe?.rgb, null, null, tx);
    await merkeTeilFarbe(partNumber, neu, angaben.color_name, angaben.color_hex, null, null, tx, uid);

    const ziel = await repo.manuelleTeilzeileSperren(tx, uid, partNumber, neu);

    // Erst addieren, dann umziehen: Sonst liefe das UPDATE in
    // `idx_part_acq_erfassungstag` — nur wenn beide Farben am gleichen Tag erfasst
    // wurden, ein Fehler, der von der Uhr abhängt.
    const vereint = await repo.stockeGleicheErfassungenAuf(tx, uid, partNumber, alt, neu);
    // Die addierten Quellzeilen müssen weg, sonst stünde die Stückzahl doppelt da.
    await repo.loescheAufgestockteErfassungen(tx, uid, partNumber, alt, neu);
    const verschoben = await repo.faerbeErfassungenUm(tx, uid, partNumber, alt, neu);

    if (ziel) {
      // Die Zielzeile bleibt. Ihren Lagerort übernimmt sie nur, wenn sie keinen hat:
      // „Kiste 3" soll durch eine Farbkorrektur nicht verschwinden.
      if (quelle.storage_id && !ziel.storage_id) {
        await repo.setzeTeilLagerort(tx, quelle.storage_id, ziel.id);
      }
      await repo.loescheTeilzeile(tx, quelle.id);
    } else {
      await repo.faerbeTeilzeileUm(tx, neu, quelle.id);
    }

    return {
      zusammengelegt: !!ziel,
      verschoben: verschoben.changes ?? 0,
      vereint: vereint.changes ?? 0,
    };
  });

  // Auch bei alt === neu: Eine Ausnahme wäre ein zweiter Weg, der nur manchmal
  // ein Bild nachträgt.
  return { ...wechsel, bild: await bildNachtragen(partNumber, neu) };
}
