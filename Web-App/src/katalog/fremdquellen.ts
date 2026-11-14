/** Die Fremdquellen eines Katalog-Kontexts: die echten Klienten, darüber was die
 * Verdrahtung ersetzt (baueDienste). So stellt ein Test Rebrickable, BrickLink
 * oder Brickset an der Verdrahtung, statt Module beim Laden umzubiegen. */
import * as echt from './quellen';

export type Quellen = typeof echt;

/** Gelesen wird beim Aufruf, damit ein Test einen Teil auch nachträglich ersetzt. */
export function quellen(k: { quellen?: Partial<Quellen> | undefined }): Quellen {
  const ersatz = k.quellen;
  if (!ersatz) return echt;
  return new Proxy(echt, { get: (z, n: string) => (n in ersatz ? ersatz[n as keyof Quellen] : z[n as keyof Quellen]) });
}
