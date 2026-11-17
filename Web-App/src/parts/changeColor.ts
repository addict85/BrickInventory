import { meldeFehler } from '../infra/fehler';
import { colorId } from '../infra/validate';
import * as repo from './repository/partColor';
import { fachfehler } from '../infra/fehlerTexte';
import { versuche } from '../infra/ergebnis';
import type { PartsContext } from './context';

// Fix a wrong color without re-entering the row.
export type ColorChange = {
  /** The row moved (false) or was merged with an existing one (true). */
  zusammengelegt: boolean;
  verschoben: number;
  /** Added into an acquisition from the same day. */
  vereint: number;
  /** `null` is information, not an error; the UI names it. */
  bild: ImageSource;
};

/** `vorhanden`: already there (even from a set list); `rebrickable`: fetched;
 * `null`: found nowhere. */
export type ImageSource = 'vorhanden' | 'rebrickable' | null;

/** After the transaction, never inside it: the fetch may take time and fail without
 * taking the change down with it. */
async function fetchImageLater(k: PartsContext, partNumber: string, farbe: number): Promise<ImageSource> {
  const lokal = await k.katalog.katalogTeil(partNumber, farbe);
  if (lokal?.bildQuelle === 'farbe') return 'vorhanden';

  // The change already stands; a failed fetch only drops the image.
  const info = await versuche('partColor:lookupPart', () => k.fremdquellen.quellen.lookupPart(partNumber, farbe));
  if (!info.ok || !info.wert?.image_url) return null;
  try {
    await k.katalog.merkeTeilFarbe(partNumber, farbe, null, null, info.wert.image_url, null);
    return 'rebrickable';
  } catch (e) {
    meldeFehler('colorChange:image from Rebrickable', e);
    return null;
  }
}

/** @param uid        Owner of the row — NOT the viewer; the write permission
 *                   check is the route's job, via schreibzielOderNull().
 * @param neueFarbe  KEINE_FARBE (9999) means "unspecified". */
export async function changePartColor(
  k: PartsContext,
  uid: number,
  partNumber: string,
  alteFarbe: number,
  neueFarbe: number,
  angaben: { color_name?: string | null; color_hex?: string | null } = {},
): Promise<ColorChange> {
  const alt = colorId(alteFarbe);
  const neu = colorId(neueFarbe);

  // rb_colors first, because the catalog applies to all accounts; the caller's
  // own values only fill in what's missing there.
  const katalogFarbe = await k.partColor.rbColor(neu);

  const wechsel = await k.transaktion(async (t): Promise<Omit<ColorChange, 'bild'>> => {
    const quelle = await repo.lockManualPartRow(t.db, uid, partNumber, alt);
    if (!quelle) {
      fachfehler('nicht_gefunden', 'teil_nicht_manuell');
    }
    // Same color is REPORTED rather than treated as success: otherwise a misclick
    // would look like a real change.
    if (alt === neu) return { zusammengelegt: false, verschoben: 0, vereint: 0 };

    // The TARGET color's catalog entry must exist before the move: the parts list
    // reads name and color code from there, otherwise a color dot with no label.
    await t.katalog.merkeTeilFarbe(partNumber, neu, katalogFarbe?.name, katalogFarbe?.rgb, null, null, t.db);
    await t.katalog.merkeTeilFarbe(partNumber, neu, angaben.color_name, angaben.color_hex, null, null, t.db, uid);

    const ziel = await repo.lockManualPartRow(t.db, uid, partNumber, neu);

    const { vereint, verschoben } = await t.bestand.manuell.teilzeileUmfaerben(
      uid,
      partNumber,
      { ...quelle, farbe: alt },
      ziel ?? null,
      neu,
    );
    return { zusammengelegt: !!ziel, verschoben, vereint };
  });

  // Even when alt === neu: an exception here would be a second path that only
  // adds the image some of the time.
  return { ...wechsel, bild: await fetchImageLater(k, partNumber, neu) };
}
