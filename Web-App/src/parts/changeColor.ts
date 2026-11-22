import { reportError } from '../infra/error';
import { colorId } from '../infra/validate';
import * as repo from './repository/partColor';
import { failDomain } from '../infra/errorTexts';
import { attempts } from '../infra/result';
import type { PartsContext } from './context';

// Fix a wrong color without re-entering the row.
export type ColorChange = {
  /** The row moved (false) or was merged with an existing one (true). */
  combined: boolean;
  moved: number;
  /** Added into an acquisition from the same day. */
  united: number;
  /** `null` is information, not an error; the UI names it. */
  image: ImageSource;
};

/** `vorhanden`: already there (even from a set list); `rebrickable`: fetched;
 * `null`: found nowhere. */
export type ImageSource = 'vorhanden' | 'rebrickable' | null;

/** After the transaction, never inside it: the fetch may take time and fail without
 * taking the change down with it. */
async function fetchImageLater(k: PartsContext, partNumber: string, color: number): Promise<ImageSource> {
  const local = await k.catalog.catalogPart(partNumber, color);
  if (local?.imageSource === 'farbe') return 'vorhanden';

  // The change already stands; a failed fetch only drops the image.
  const info = await attempts('partColor:lookupPart', () => k.externalSources.sources.lookupPart(partNumber, color));
  if (!info.ok || !info.value?.image_url) return null;
  try {
    await k.catalog.rememberPartColor(partNumber, color, null, null, info.value.image_url, null);
    return 'rebrickable';
  } catch (e) {
    reportError('colorChange:image from Rebrickable', e);
    return null;
  }
}

/** @param uid        Owner of the row — NOT the viewer; the write permission
 *                   check is the route's job, via writeTargetOrNull().
 * @param newColor  KEINE_FARBE (9999) means "unspecified". */
export async function changePartColor(
  k: PartsContext,
  uid: number,
  partNumber: string,
  oldColor: number,
  newColor: number,
  details: { color_name?: string | null; color_hex?: string | null } = {},
): Promise<ColorChange> {
  const alt = colorId(oldColor);
  const fresh = colorId(newColor);

  // rb_colors first, because the catalog applies to all accounts; the caller's
  // own values only fill in what's missing there.
  const catalogColor = await k.partColor.rbColor(fresh);

  const change = await k.transact(async (t): Promise<Omit<ColorChange, 'image'>> => {
    const source = await repo.lockManualPartRow(t.db, uid, partNumber, alt);
    if (!source) {
      failDomain('not_found', 'part_not_manual');
    }
    // Same color is REPORTED rather than treated as success: otherwise a misclick
    // would look like a real change.
    if (alt === fresh) return { combined: false, moved: 0, united: 0 };

    // The TARGET color's catalog entry must exist before the move: the parts list
    // reads name and color code from there, otherwise a color dot with no label.
    await t.catalog.rememberPartColor(partNumber, fresh, catalogColor?.name, catalogColor?.rgb, null, null, t.db);
    await t.catalog.rememberPartColor(partNumber, fresh, details.color_name, details.color_hex, null, null, t.db, uid);

    const target = await repo.lockManualPartRow(t.db, uid, partNumber, fresh);

    const { united, moved } = await t.inventory.manual.recolorPartRow(
      uid,
      partNumber,
      { ...source, color: alt },
      target ?? null,
      fresh,
    );
    return { combined: !!target, moved, united };
  });

  // Even when alt === neu: an exception here would be a second path that only
  // adds the image some of the time.
  return { ...change, image: await fetchImageLater(k, partNumber, fresh) };
}
