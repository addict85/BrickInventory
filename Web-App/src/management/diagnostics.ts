/** Probes for admins: image and price fetch and the questions about an empty tile. */
import { proxyCacheKey, proxyCachePathFor, imgProxyFailures } from '../images';
import { ALLOWED_IMAGE_HOSTS, hostAllowed } from '../infra/foreignAddresses';
import { urlOrNull } from '../infra/validate';
import type { AccountImageRow } from './repository/management';
import fs from 'node:fs';
import { FetchError, type FetchStream } from '../infra/fetch';
import path from 'node:path';
import { DATA_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { errorMessage, withoutMissingFile } from '../infra/error';
import { Degradations } from '../infra/result';
import { withoutBricklinkPrice } from '../infra/setNumber';
import { failDomain } from '../infra/errorTexts';
import type { ManagementContext } from './context';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VARIANTS = [
  {
    name: 'mit Referer',
    headers: { 'User-Agent': UA, Referer: 'https://rebrickable.com/', Accept: 'image/*,*/*;q=0.8' },
  },
  { name: 'ohne Referer', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } },
  { name: 'nackt', headers: {} },
];

/** Reports what the proxy would deliver of it — with and without referer. */
export async function imageProbe(k: ManagementContext, url: string) {
  if (!/^https:\/\//.test(url)) failDomain('ungueltig', 'url_fehlt_https');
  const address = urlOrNull(url);
  if (!address) failDomain('ungueltig', 'url_ungueltig');
  // The same hosts as the image proxy: the fetch runs from the internal network;
  // allowing every address would be server-side request forgery.
  if (!hostAllowed(url, ALLOWED_IMAGE_HOSTS)) failDomain('verboten', 'host_nicht_erlaubt', { host: address.hostname });

  const results: Awaited<ReturnType<typeof probeVariant>>[] = [];
  for (const v of VARIANTS) results.push(await probeVariant(k, url, v));

  const key = proxyCacheKey(url);
  const dir = path.join(DATA_DIR, 'img_proxy_cache');
  const cached = await fileSize(path.join(dir, key));
  const thumb = await fileSize(path.join(dir, key + '_thumb.jpg'));

  // Shows at a glance why fetches fail, without searching the log.
  const failures = imgProxyFailures;
  const head = await firstBytes(k, url);
  return { url, cache: { original: cached, thumb }, probes: results, proxy_failures: failures, body_check: head };
}

/** Without redirects: the probe should show the CDN's raw status. */
const fetchWithoutRedirect = (k: ManagementContext, url: string, kopfzeilen: Record<string, string>) =>
  k.externalSources.quellen.oeffneBild(url, { maxBytes: 65536, zeitlimitMs: 10_000, redirects: 0, kopfzeilen });

function readStream(a: FetchStream, enough = Infinity) {
  return new Promise<{ teile: Buffer[]; bytes: number; truncated: boolean }>(finished => {
    const teile: Buffer[] = [];
    let bytes = 0;
    const s = a.strom();
    s.on('data', (c: Buffer) => {
      teile.push(c);
      bytes += c.length;
      if (bytes >= enough) {
        s.destroy();
        finished({ teile, bytes, truncated: false });
      }
    });
    s.on('end', () => finished({ teile, bytes, truncated: false }));
    s.on('error', () => finished({ teile, bytes, truncated: true }));
  });
}

async function probeVariant(kx: ManagementContext, url: string, v: { name: string; headers: Record<string, string> }) {
  const t0 = performance.now();
  try {
    const a = await fetchWithoutRedirect(kx, url, v.headers);
    const { bytes, truncated } = await readStream(a);
    const k = a.kopf;
    return {
      variant: v.name,
      ms: Math.round(performance.now() - t0),
      status: a.status,
      content_type: k['content-type'] || null,
      content_length: k['content-length'] || null,
      // When delivered compressed the proxy must pass the header on, otherwise
      // the browser takes the bytes for a JPEG.
      content_encoding: k['content-encoding'] || null,
      transfer_encoding: k['transfer-encoding'] || null,
      bytes,
      server: k.server || null,
      cf_ray: k['cf-ray'] || null,
      ...(truncated ? { truncated } : {}),
    };
  } catch (e) {
    return {
      variant: v.name,
      ms: Math.round(performance.now() - t0),
      error: errorMessage(e),
      code: e instanceof FetchError ? e.grund : undefined,
    };
  }
}

const fileSize = (file: string) =>
  fs.promises
    .stat(file)
    .then(st => ({ bytes: st.size }))
    .catch(withoutMissingFile('management:stat', null));

/** Through the same chain as the proxy, but the first bytes come here as hex. */
function firstBytes(k: ManagementContext, url: string) {
  return fetchWithoutRedirect(k, url, {
    'User-Agent': UA,
    Accept: 'image/*,*/*;q=0.8',
    'Accept-Encoding': 'identity',
  }).then(
    async a => {
      const b = Buffer.concat((await readStream(a, 32)).teile);
      return {
        status: a.status,
        content_encoding: a.kopf['content-encoding'] || null,
        first_bytes_hex: b.slice(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim(),
        looks_like: imageKind(b),
      };
    },
    (e: unknown) => ({ error: errorMessage(e) }),
  );
}

function imageKind(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'JPEG';
  if (b[0] === 0x89 && b[1] === 0x50) return 'PNG';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip (komprimiert!)';
  return b.slice(0, 5).toString().toLowerCase().startsWith('<') ? 'HTML/XML statt Bild' : 'unbekannt';
}

/** With `live` also BrickLink's response. */
export async function priceProbe(k: ManagementContext, uid: number, setNumber: string, live: boolean) {
  const ab = new Degradations();
  const [setRow, acqs, cacheRows, histRows, currRow, ttlRow] = await Promise.all([
    k.management.sampleSet(uid, setNumber),
    k.management.sampleAcquisitions(uid, setNumber),
    k.management.samplePriceCache(setNumber),
    k.management.samplePriceHistory(setNumber),
    ab.orElse(
      'waehrung',
      k.settings.foreignUserValue(uid, 'currency').then(value => (value === null ? undefined : { value })),
      null,
    ),
    k.settings.globalValue('price_cache_ttl'),
  ]);

  // The same rule as conditionFromAcquisitions(): one used acquisition is enough.
  const anyUsed = acqs.some(a => a.condition === 'U');
  const chosen = anyUsed ? 'U' : 'N';

  const out: Record<string, unknown> & { currency: string; ttl_hours: number } = {
    ...ab.detail(),
    set: setRow || null,
    acquisitions: acqs,
    condition_logic: {
      any_acquisition_used: anyUsed,
      chosen_for_price: chosen,
      hinweis:
        'Eine gebrauchte Erfassung macht das Set gebraucht, sonst ist es neu. ' +
        'Der Zustand steht seit Migration 0032 nur in den Erfassungen; das Feld ' +
        'mit dem gespeicherten Wert, das hier vorher stand, ist weggefallen. ' +
        'Weicht "chosen_for_price" von der Anzeige ab, liegt der Fehler dort.',
    },
    currency: currRow?.value || 'EUR',
    ttl_hours: parseInt(ttlRow || '24', 10),
    price_cache: cacheRows,
    price_history_last5: histRows,
  };

  // The same currency as the valuation, otherwise the probe would show other cache rows.
  out.currency = await k.settings.userValue(uid, 'currency', 'EUR');
  // "BrickLink does not know the set": if it is set, fetchPrice silently delivers 0.
  const catalog = await k.catalog.catalogEntry(setNumber);
  out.katalog = catalog ? { ...catalog, applies_as_unknown: withoutBricklinkPrice(catalog) } : null;
  // Exactly the call that finances makes.
  try {
    out.finances_price = await k.finances.fetchPrice(setNumber, chosen, 'sold', out.currency, out.ttl_hours);
  } catch (e) {
    out.finances_price = { error: errorMessage(e) };
  }

  if (live) {
    const cur = out.currency;
    const liveValues: Record<string, unknown> = {};
    out.live = liveValues;
    for (const cond of ['N', 'U']) {
      try {
        const g = await k.catalog.priceGuide(setNumber, cond, 'sold', cur);
        liveValues[cond] = {
          avg_price: g?.avg_price,
          qty_avg_price: g?.qty_avg_price,
          guide_used: g?.guide_used,
          guide_fallback: g?.guide_fallback || false,
        };
      } catch (e) {
        liveValues[cond] = { error: errorMessage(e) };
      }
    }
  }

  return out;
}

/** The recurring questions about an empty tile in one response: database, disk, proxy, negative result. */
export async function imageDiagnostics(kx: ManagementContext, sn: string) {
  const ab = new Degradations();
  const konten: AccountImageRow = await ab.orElse('konten', kx.management.accountImageRows(sn), {
    anzahl_konten: 0,
    image_local: null,
    image_url: null,
  });
  const catalog = await ab.orElse('katalog', kx.management.catalogImage(sn), null);

  const safe = sn.replace(/[^a-z0-9-]/gi, '_');
  const file = async (p: string) => {
    const st = await fs.promises.stat(p).catch(withoutMissingFile('management:bilddatei', null));
    return st
      ? { vorhanden: true, bytes: st.size, geaendert: st.mtime }
      : { vorhanden: false, bytes: 0, geaendert: null };
  };
  const original = await file(path.join(SET_IMAGES_DIR, `${safe}.jpg`));
  const vorschau = await file(path.join(SET_IMAGES_DIR, `${safe}_thumb.jpg`));

  const cdnUrl = konten.image_url || catalog?.image_url || null;
  let proxy: { gecacht: boolean; [k: string]: unknown } = { adresse: cdnUrl, gecacht: false };
  if (cdnUrl) {
    const cf = proxyCachePathFor ? proxyCachePathFor(cdnUrl) : null;
    if (cf) {
      const cache = await file(cf);
      proxy = { adresse: cdnUrl, gecacht: cache.vorhanden, cache, vorschau: await file(cf + '_thumb.jpg') };
    }
  }

  const merker = await ab.orElse('fehlanzeige', kx.management.setImageMiss(sn), null);
  const previewMarker = await ab.orElse('fehlanzeige', kx.management.thumbnailImageMiss(safe), null);

  // A diagnosis from substitute values would mislead: say first what was not readable.
  const hinweise: string[] = ab.teile.length ? [`Nicht lesbar, dort stehen Ersatzwerte: ${ab.teile.join(', ')}.`] : [];
  if (!konten.anzahl_konten) hinweise.push('Kein Konto führt dieses Set.');
  if (konten.anzahl_konten && !konten.image_local && !cdnUrl)
    hinweise.push('Weder lokale Datei noch CDN-Adresse bekannt — die Clients können nichts anzeigen.');
  if (konten.image_local && !original.vorhanden)
    hinweise.push('image_local ist gesetzt, die Datei fehlt aber — die Bildroute weicht auf den Proxy aus.');
  if (original.vorhanden && !vorschau.vorhanden)
    hinweise.push('Original da, Vorschau fehlt — sie entsteht beim nächsten Abruf oder über den Bilder-Nachlauf.');
  if (vorschau.vorhanden && vorschau.bytes < 200)
    hinweise.push('Die Vorschau ist unbrauchbar klein und wird beim Ausliefern verworfen.');
  if (merker)
    hinweise.push(
      `Gilt seit ${new Date(merker.checked_at).toLocaleString()} als fehlend` +
        (merker.reason ? ` (${merker.reason})` : ' (Grund nicht vermerkt — Altbestand)') +
        '. Solange der Eintrag steht, wird das Bild NICHT geholt. ' +
        'Zurücknehmen: POST /api/v1/admin/forget-image-misses',
    );
  if (previewMarker) hinweise.push('Für die Vorschau ist ein Fehlschlag vermerkt — sie wird nicht erneut versucht.');
  if (!hinweise.length) hinweise.push('Alles vorhanden: Original und Vorschau liegen bereit.');

  return {
    set_number: sn,
    datenbank: { ...konten, katalog_bild: catalog?.image_url || null },
    lokal: { original, vorschau },
    merker: merker ? { seit: merker.checked_at, grund: merker.reason || null } : null,
    proxy,
    hinweise,
  };
}
