/** Once per installation: refit previews from the time of the square crop. Otherwise they are
 * never recreated, because an existing preview counts as finished. */
import fs from 'node:fs';
import path from 'node:path';
import { previewFrom } from './thumbs';
import { imageSize } from './imageGuard';
import { APP_ROOT } from '../infra/appPaths';
import { attempts } from '../infra/result';
import { withoutMissingFile } from '../infra/error';
import type { ImagesContext } from './context';

export const FITTED_MARKER = 'vorschauen_eingepasst';
const OLD_EDGE = 200;

async function masse(datei: string): Promise<{ width: number; height: number } | null> {
  const fd = await fs.promises.open(datei, 'r').catch(withoutMissingFile('vorschau:masse', null));
  if (!fd) return null;
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    return imageSize(buf.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

/** Only the old crop looked like this: exactly 200 × 200 for an original that is not square. */
async function cropped(original: string, preview: string): Promise<boolean> {
  const v = await masse(preview);
  if (!v || v.width !== OLD_EDGE || v.height !== OLD_EDGE) return false;
  const o = await masse(original);
  return !!o && o.height > 0 && Math.abs(o.width / o.height - 1) > 0.02;
}

const pause = () => new Promise(r => setTimeout(r, 10));

/** Own images get their preview anew, in the proxy cache the old one is only deleted; throttled.
 * @returns how many previews were replaced, or null if it already ran once */
export async function fitTailoredPreviews(
  k: Pick<ImagesContext, 'jobQueue' | 'uhr'>,
  local: { web: string; datei: string }[],
  proxyFolder = path.join(APP_ROOT, 'data', 'img_proxy_cache'),
): Promise<number | null> {
  if (await k.jobQueue.readState(FITTED_MARKER)) return null;
  let replaced = 0,
    checked = 0;
  for (const { web, datei } of local) {
    const preview = datei.replace(path.extname(datei), '_thumb.jpg');
    if (++checked % 10 === 0) await pause();
    if (!(await cropped(datei, preview))) continue;
    await fs.promises.rm(preview, { force: true });
    if ((await attempts('vorschau:einpassen', previewFrom(web))).ok) replaced++;
  }
  const names = await fs.promises
    .readdir(proxyFolder)
    .catch(withoutMissingFile('vorschau:proxy-ordner', [] as string[]));
  for (const name of names.filter(n => n.endsWith('_thumb.jpg'))) {
    if (++checked % 10 === 0) await pause();
    const preview = path.join(proxyFolder, name);
    if (!(await cropped(preview.slice(0, -'_thumb.jpg'.length), preview))) continue;
    await fs.promises.rm(preview, { force: true });
    replaced++;
  }
  await k.jobQueue.setState(FITTED_MARKER, k.uhr.datum().toISOString());
  if (replaced) console.log(`  🖼️  ${replaced} zugeschnittene Vorschauen neu eingepasst`);
  return replaced;
}
