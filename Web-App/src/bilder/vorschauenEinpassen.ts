/** Einmal je Installation: Vorschauen aus der Zeit des quadratischen Zuschnitts neu einpassen. Sie entstehen
 * sonst nie neu, weil eine vorhandene Vorschau als fertig gilt. */
import fs from 'node:fs';
import path from 'node:path';
import { vorschauErzeugenAus } from './thumbs';
import { bildmasse } from './imageGuard';
import { APP_ROOT } from '../infra/appPaths';
import { versuche } from '../infra/ergebnis';
import { ohneFehlendeDatei } from '../infra/fehler';
import type { BilderKontext } from './kontext';

export const EINGEPASST_MERKER = 'vorschauen_eingepasst';
const ALTE_KANTE = 200;

async function masse(datei: string): Promise<{ width: number; height: number } | null> {
  const fd = await fs.promises.open(datei, 'r').catch(ohneFehlendeDatei('vorschau:masse', null));
  if (!fd) return null;
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    return bildmasse(buf.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

/** So sah nur der alte Zuschnitt aus: genau 200 × 200 zu einem Original, das nicht quadratisch ist. */
async function zugeschnitten(original: string, vorschau: string): Promise<boolean> {
  const v = await masse(vorschau);
  if (!v || v.width !== ALTE_KANTE || v.height !== ALTE_KANTE) return false;
  const o = await masse(original);
  return !!o && o.height > 0 && Math.abs(o.width / o.height - 1) > 0.02;
}

const pause = () => new Promise(r => setTimeout(r, 10));

/** Eigene Bilder bekommen ihre Vorschau neu, im Proxy-Cache wird die alte nur gelöscht; gedrosselt.
 * @returns wie viele Vorschauen ersetzt wurden, oder null, wenn es schon einmal lief */
export async function zugeschnitteneVorschauenEinpassen(
  k: Pick<BilderKontext, 'auftraege' | 'uhr'>,
  lokale: { web: string; datei: string }[],
  proxyOrdner = path.join(APP_ROOT, 'data', 'img_proxy_cache'),
): Promise<number | null> {
  if (await k.auftraege.liesZustand(EINGEPASST_MERKER)) return null;
  let ersetzt = 0,
    geprueft = 0;
  for (const { web, datei } of lokale) {
    const vorschau = datei.replace(path.extname(datei), '_thumb.jpg');
    if (++geprueft % 10 === 0) await pause();
    if (!(await zugeschnitten(datei, vorschau))) continue;
    await fs.promises.rm(vorschau, { force: true });
    if ((await versuche('vorschau:einpassen', vorschauErzeugenAus(web))).ok) ersetzt++;
  }
  const namen = await fs.promises
    .readdir(proxyOrdner)
    .catch(ohneFehlendeDatei('vorschau:proxy-ordner', [] as string[]));
  for (const name of namen.filter(n => n.endsWith('_thumb.jpg'))) {
    if (++geprueft % 10 === 0) await pause();
    const vorschau = path.join(proxyOrdner, name);
    if (!(await zugeschnitten(vorschau.slice(0, -'_thumb.jpg'.length), vorschau))) continue;
    await fs.promises.rm(vorschau, { force: true });
    ersetzt++;
  }
  await k.auftraege.setzeZustand(EINGEPASST_MERKER, k.uhr.datum().toISOString());
  if (ersetzt) console.log(`  🖼️  ${ersetzt} zugeschnittene Vorschauen neu eingepasst`);
  return ersetzt;
}
