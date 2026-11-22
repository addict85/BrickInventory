/** At Rebrickable 0 is black; a missing color is therefore KEINE_FARBE
 * (9999), never 0, otherwise "not specified" turns into a black part. */

import { NO_COLOR } from '../infra/validate';
import { versuche } from '../infra/result';
import type { CatalogContext } from './context';

export { NO_COLOR as KEINE_FARBE };

export interface Color {
  id: number;
  name: string;
  hex: string | null;
}

/** Only colors with a fixed Rebrickable ID: a wrong ID would end up in the
 * inventory and in the price lookup. */
const FALLBACK_LIST: Color[] = [
  { id: NO_COLOR, name: '[No Color/Any Color]', hex: null },
  { id: 0, name: 'Black', hex: '05131D' },
  { id: 1, name: 'Blue', hex: '0055BF' },
  { id: 2, name: 'Green', hex: '237841' },
  { id: 4, name: 'Red', hex: 'C91A09' },
  { id: 14, name: 'Yellow', hex: 'F2CD37' },
  { id: 15, name: 'White', hex: 'FFFFFF' },
  { id: 19, name: 'Tan', hex: 'E4CD9E' },
  { id: 25, name: 'Orange', hex: 'FE8A18' },
  { id: 70, name: 'Reddish Brown', hex: '582A12' },
  { id: 71, name: 'Light Bluish Gray', hex: 'A0A5A9' },
  { id: 72, name: 'Dark Bluish Gray', hex: '6C6E68' },
];

export async function colorList(k: CatalogContext): Promise<Color[]> {
  const loaded = await k.katalogStamm.loadedColors();
  if (loaded.length) return loaded;
  // Without Rebrickable the built-in emergency list remains; as such it is short.
  const fetched = await versuche('farben:rebrickable', k.externalSources.quellen.getBrickColors());
  if (fetched.ok && fetched.wert.length) return fetched.wert;
  return FALLBACK_LIST;
}
