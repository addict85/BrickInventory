/** Bild-Proxy für fremde CDNs: Bilder kommen über den eigenen Server, damit die
 * CSP keine fremden Quellen braucht und jedes Bild nur einmal geholt wird.
 * Den Abruf macht clients/bildCdn.ts; hier stehen Cache, Drossel und Antwort. */
import path from 'node:path';
import { APP_ROOT, PUBLIC_DIR, SET_IMAGES_DIR } from '../../infra/appPaths';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prozessweit } from '../../infra/prozessweit';
import type { AccountServices } from '../../account';
import { userIdTheRequest } from '../../account/http/login';
import { beforeThe, withoutMissingFile, fehlertext, reportError } from '../../infra/fehler';
import { streamFileToResponse } from '../../http/httpAntwort';
import { rememberCacheGrowth, imageType } from '../imgCacheServe';
import { deliverFromCache } from './imageCacheDelivery';
import { imgProxyFailures, countProxyError } from '../imgProxyStats';
import { proxyAddress, proxyCacheKey } from '../images';
import type { Request, Response } from 'express';
import type { Readable } from 'node:stream';
import { AbrufFehler, type FetchStream } from '../../infra/abruf';
import { IMAGE_HEADERS, IMAGE_HEADERS_WITHOUT_REFERER } from '../../externalSources';
import zlib from 'node:zlib';
import { setImageComplete } from '../setImages';
import { ALLOWED_IMAGE_HOSTS, hostAllowed } from '../../infra/fremdeAdressen';

import { onceDecoded, urlOrNull } from '../../infra/validate';
import type { ImagesServices } from '../area';

/** Was der Proxy von der Anwendung braucht: Katalog (Cache, Vorschau, Vormerken) und Konto (Anmeldung, Takt). */
export interface ImageServices {
  images: ImagesServices;
  account: AccountServices;
}
/** 20 MB, weil grosse Set-Bilder sonst nie vollständig im Speicher landeten. */
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024;

// Fehlschläge zählt src/images/imgProxyStats.ts, sonst nicht einzugrenzen.

/** 200 mit Platzhalter statt 404: Den Platzhalter zeigen beide Oberflächen
 * ohnehin, und die Browserkonsole bleibt frei von Fehlzeilen. */
function sendPlaceholder(res: Response) {
  // Einmal von Platte: wenige hundert Byte, beim Blättern dutzendfach gebraucht.
  const platzhalter = prozessweit('platzhalterBild', () => {
    try {
      return fs.readFileSync(path.join(PUBLIC_DIR, 'assets', 'set-placeholder.svg'));
    } catch (e) {
      // Ausnahme: Ohne lesbaren Platzhalter antwortet der Proxy 404; das Bild fehlt ja wirklich.
      reportError('bild-proxy:platzhalter', e);
      return Buffer.alloc(0);
    }
  });
  if (!platzhalter.length) {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(404).end();
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).end(platzhalter);
}

/** Erst mit Referer, dann ohne; ein 404 wird gemerkt. `ersatz` antwortet statt
 * des Fehlers, wenn es kann (etwa mit der Vorschau aus dem Cache).
 * @returns null, wenn schon geantwortet ist */
async function fromCdn(
  d: ImageServices,
  url: string,
  cacheKey: string,
  res: Response,
  ersatz: () => Promise<boolean> = async () => false,
): Promise<FetchStream | null> {
  // Unkomprimiert: Ein komprimierter Körper ergäbe still eine weisse Fläche.
  const HEADER_SETS = [
    { ...IMAGE_HEADERS, 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity' },
    { ...IMAGE_HEADERS_WITHOUT_REFERER, 'Accept-Encoding': 'identity' },
  ] as const;

  const holen = (kopfzeilen: Record<string, string>) =>
    d.images.openImage(url, { maxBytes: PROXY_CACHE_MAX_BYTES, zeitlimitMs: 25_000, kopfzeilen, pool: true });
  let r: FetchStream;
  try {
    r = await holen(HEADER_SETS[0]);
    // Einmal ohne Referer nachfassen, BEVOR die Adresse als tot gilt: Der
    // Hotlink-Schutz antwortet auf einen unpassenden Referer gern mit 404.
    if (r.status === 404 || r.status === 403) {
      r.verwerfen();
      r = await holen(HEADER_SETS[1]);
    }
  } catch (e) {
    const zeit = e instanceof AbrufFehler && e.grund === 'zeitlimit';
    if (zeit) imgProxyFailures.timeout++;
    else imgProxyFailures.error++;
    imgProxyFailures.lastError = fehlertext(e);
    console.error(
      `[img-proxy] ${zeit ? 'Zeitüberschreitung nach 25 s' : 'Verbindungsfehler'}: ${fehlertext(e)}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    if (await ersatz()) return null;
    if (!res.headersSent) res.status(zeit ? 504 : 502).end();
    return null;
  }
  if (r.status !== 200) {
    r.verwerfen();
    // NUR 404 merken: 403 ist bei einer Kachelwand oft nur Drosselung.
    if (r.status === 404) {
      d.images.rememberMissing(cacheKey);
    }
    if (r.status === 404) imgProxyFailures.notFound++;
    else imgProxyFailures.other++;
    imgProxyFailures.lastError = `HTTP ${r.status} — ${url}`;
    // 404 ist eine Auskunft, kein Fehler: als `error` verstopfte es das Protokoll.
    const meldung = `[img-proxy] CDN antwortete ${r.status} (auch ohne Referer): ${url}`;
    if (r.status === 404) console.info(meldung.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    else console.error(meldung.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    if (await ersatz()) return null;
    void (r.status === 404 ? sendPlaceholder(res) : res.status(r.status || 502).end());
    return null;
  }
  return r;
}

/** Was der Proxy vollständig hat, wird das Set-Bild: Ein zweiter Abruf beim CDN
 * scheiterte, wo der erste ging. Die Vorschau erzeugt der Auftrag bildbedarf. */
async function storeAsSetImage(d: ImageServices, cacheFile: string, setNummer: string): Promise<void> {
  const ziel = path.join(SET_IMAGES_DIR, `${setNummer.replace(/[^a-z0-9-]/gi, '_')}.jpg`);
  const teil = `${ziel}.${process.pid}-${randomUUID()}.teil`;
  await fs.promises.mkdir(SET_IMAGES_DIR, { recursive: true });
  await fs.promises.copyFile(cacheFile, teil);
  await fs.promises.rename(teil, ziel);
  rememberCacheGrowth((await fs.promises.stat(ziel)).size, d.images.imageLimits().cacheMaxBytes);
}

/** Der entpackte Strom geht nebenher in den Cache — erst in .tmp, dann atomar. */
function inDenCache(
  d: ImageServices,
  body: Readable,
  res: Response,
  o: {
    url: string;
    cacheDir: string;
    cacheFile: string;
    thumbFile: string;
    contentType: string;
    enc: string;
    expected: number;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
    setNummer: string | null;
  },
): void {
  const { url, cacheDir, cacheFile, thumbFile, contentType, enc, expected, wantThumb, createMay, note } = o;
  fs.mkdirSync(cacheDir, { recursive: true });
  // Je ANFRAGE eindeutig: Sonst schrieben gleichzeitige in dieselbe Datei.
  const tmpFile = `${cacheFile}.tmp-${process.pid}-${randomUUID()}`;
  const ws = fs.createWriteStream(tmpFile);
  let bytes = 0,
    aborted = false;
  const discard = (grund: string) => {
    if (aborted) return;
    aborted = true;
    ws.destroy();
    fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink'));
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `${grund}: ${url}`;
    console.error(
      `[img-proxy] ${grund} — weder gecacht noch verkleinert: ${url}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
    );
  };
  // Der entpackte Strom zählt: Auch Komprimiertes darf nicht beliebig wachsen.
  body.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > PROXY_CACHE_MAX_BYTES) {
      discard(`grösser als ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB`);
      body.destroy();
      res.destroy();
    }
  });
  body.on('error', (e: Error) => {
    discard(`Abruf abgebrochen (${e.message})`);
    res.destroy();
  });
  // Der ENTPACKTE Strom geht in den Cache — die Datei ist immer ein echtes Bild.
  body.pipe(ws);
  ws.on('finish', async () => {
    if (aborted) return;
    try {
      // Nur vollständig: Eine abgeschnittene ginge dauerhaft mit 200 hinaus.
      const st = await fs.promises.stat(tmpFile);
      if (!enc && expected > 0 && st.size !== expected) {
        console.error(
          `[img-proxy] unvollständig (${st.size}/${expected} Bytes), nicht gecacht: ${url}`
            .replace(/\r?\n/g, ' ⏎ ')
            .replace(/\n|\r/g, ''),
        );
        await fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink'));
        return;
      }
      await fs.promises.writeFile(cacheFile + '.ct', contentType);
      await fs.promises.rename(tmpFile, cacheFile);
      rememberCacheGrowth(st.size, d.images.imageLimits().cacheMaxBytes);
      if (o.setNummer)
        await setImageFromCache(d, url, o.setNummer, cacheFile).catch(e => countProxyError('img-proxy:setbild', e));
      // Gleich miterzeugen, sonst später für eine ganze Kachelwand auf einmal.
      if (wantThumb) {
        if (createMay) d.images.queueThumb(cacheFile, thumbFile);
        else note();
      }
    } catch (_) {
      fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink'));
    }
  });
  ws.on('error', () => fs.promises.unlink(tmpFile).catch(withoutMissingFile('bild-proxy:unlink')));
}

/** Entpacken, auch wenn identity verlangt war: Nicht jedes CDN hält sich daran.
 * Eine falsche Länge lässt den Browser warten; sie wird gezählt. */
function entpackt(roh: Readable, enc: string, res: Response, url: string, expected: number): Readable {
  let body: Readable = roh;
  if (enc === 'gzip' || enc === 'deflate' || enc === 'br') {
    const dec =
      enc === 'br' ? zlib.createBrotliDecompress() : enc === 'gzip' ? zlib.createGunzip() : zlib.createInflate();
    dec.on('error', () => {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    body = roh.pipe(dec);
    // Die angekündigte Länge gilt für den komprimierten Körper.
    res.removeHeader('Content-Length');
    console.log(`[img-proxy] entpacke ${enc}: ${url}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
  }
  let sentToClient = 0;
  body.on('data', (c: Buffer) => {
    sentToClient += c.length;
  });
  res.on('finish', () => {
    if (!enc && expected > 0 && sentToClient !== expected) {
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Länge weicht ab: ${sentToClient}/${expected} — ${url}`;
      console.error(
        `[img-proxy] an den Client gingen ${sentToClient} von ${expected} Bytes: ${url}`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
    }
  });
  return body;
}

const liesDa = (datei: string) =>
  fs.promises.access(datei).then(
    () => true,
    () => false,
  );

/** @returns true, wenn Bild oder Vorschau unter images/sets noch fehlen */
async function setImageMissing(d: ImageServices, setNummer: string, quelle: string): Promise<boolean> {
  if (!(await setImageComplete(setNummer))) return true;
  // Liegen beide schon da, fehlt oft nur der Eintrag: Danach fragt die Oberfläche nicht
  // mehr hier. Ohne Warten — ein Schreibfehler darf die Auslieferung nicht aufhalten.
  void d.images.reportSetImageLoaded(setNummer, quelle).then(ok => {
    if (!ok) countProxyError('img-proxy:setBildLokal', new Error('Eintrag des Set-Bilds gescheitert'));
  });
  return false;
}

/** Vorgemerkt wird nur, was der Proxy als Bild hat (Cache oder gedrosselter Abruf),
 * und je Set einmal in einer Frist (imageOnceReserve): Sonst füllte ein Konto mit
 * erfundenen Set-Nummern die Notizen des Bild-Auftrags. */
function reserveOnce(d: ImageServices, url: string, setNummer: string): void {
  d.images.imageOnceReserve(url, setNummer);
}

function fromSetImages(
  d: ImageServices,
  req: Request,
  res: Response,
  setNummer: string,
  wantThumb: boolean,
): Promise<boolean> {
  const stamm = path.join(SET_IMAGES_DIR, setNummer.replace(/[^a-z0-9-]/gi, '_'));
  return deliverFromCache(d.images, {
    res,
    req,
    cacheFile: `${stamm}.jpg`,
    thumbFile: `${stamm}_thumb.jpg`,
    wantThumb,
    createMay: false,
    note: () => {},
    streamFileToResponse,
  });
}

/** Aus dem Cache des Proxys nach images/sets, dann vormerken; ohne Cache-Datei nichts. */
async function setImageFromCache(d: ImageServices, url: string, setNummer: string, cacheFile: string): Promise<void> {
  try {
    await storeAsSetImage(d, cacheFile, setNummer);
  } catch (e) {
    return withoutMissingFile('img-proxy:setbild')(e);
  }
  reserveOnce(d, url, setNummer);
}

export async function passThroughImage(d: ImageServices, req: Request, res: Response) {
  // Ohne Login-Pflicht ein offener Proxy (Bandbreite, IP-Verschleierung).
  const proxyUserId = await userIdTheRequest(d.account, req);
  if (!proxyUserId) return res.status(401).end();
  const ziel = proxyTarget(String(req.query.url || ''));
  if (typeof ziel === 'number') return res.status(ziel).end();
  const url = ziel;
  // Jedes Bild nur einmal holen; Content-Type liegt daneben (.ct).
  const cacheDir = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey = proxyCacheKey(url);
  const cacheFile = path.join(cacheDir, cacheKey);
  // ?thumb=1: Teilebilder gibt es auf dem CDN nicht verkleinert.
  const wantThumb = req.query.thumb === '1';
  // gen=0: Die Anfrage rechnet nichts, sie hinterlässt eine Notiz für den
  // Auftrag 'bildbedarf' — gedrosselt und nur im Job-Prozess.
  const createMay = req.query.gen !== '0';
  const setNummer = setNumberFromImageAddress(String(url || ''));
  const thumbFile = cacheFile + '_thumb.jpg';
  // Ein Set-Bild gehört samt Vorschau nach images/sets; der Bild-Job holt es,
  // sobald es einmal über den Proxy gefragt war.
  const setMissing = setNummer ? await setImageMissing(d, setNummer, url) : false;
  // images/sets gilt für alle Konten und hat keinen Deckel: Ablegen und vormerken nur für ein Set
  // im Blickfeld des Kontos, sonst füllte ein Konto die Platte mit erfundenen Nummern.
  const ablegen = setMissing && !!setNummer && (await d.images.setNumberInScope(proxyUserId, setNummer));
  const note = () => {
    if (ablegen && setNummer) d.images.rememberUsed(String(url), setNummer);
  };
  // Liegt nur noch die Vorschau im Cache (die Pflege löscht das unbenutzte Original
  // nach 30 Tagen), holt der Proxy das Original neu: Den Abruf des Bild-Jobs mit
  // eigener Kennung weist das CDN ab, ohne diesen Weg bekäme das Set nie eine Datei.
  const originalMissing = ablegen && !(await liesDa(cacheFile));
  if (ablegen && setNummer && !originalMissing) await setImageFromCache(d, url, setNummer, cacheFile);

  // Liegt das Set-Bild samt Vorschau in images/sets, kommt es von dort statt aus
  // Cache oder CDN: Den Proxy-Cache räumt die Pflege nach 30 Tagen, images/sets nicht.
  if (setNummer && !setMissing && (await fromSetImages(d, req, res, setNummer, wantThumb))) return;
  const fromCache = () =>
    deliverFromCache(d.images, {
      res,
      req,
      cacheFile,
      thumbFile,
      wantThumb,
      createMay,
      note,
      streamFileToResponse,
    });
  // Scheitert der neue Abruf, bleibt es bei der Vorschau aus dem Cache.
  const ersatz = async () => originalMissing && (await fromCache());
  if (!originalMissing && (await fromCache())) return;

  // Der Merker (eine Stunde) erspart dem CDN die Frage bei jedem Seitenaufruf.
  if (d.images.isKnownMissing(cacheKey) && (await ersatz())) return;
  if (d.images.isKnownMissing(cacheKey)) return sendPlaceholder(res);

  // Nur Abrufe beim CDN zählen: Jeder füllt Platte und Bandbreite, Treffer nicht.
  const takt = await d.account.countRequest('bild-abruf', `konto:${proxyUserId}`, 60_000);
  if (takt.count > d.images.imageLimits().fetchesJeMinute) {
    if (await ersatz()) return;
    res.setHeader('Retry-After', String(takt.waitMin * 60));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).end();
  }

  const r = await fromCdn(d, url, cacheKey, res, ersatz);
  if (!r) return;
  const setTarget = ablegen ? setNummer : null;
  return forward(d, r, res, { url, cacheDir, cacheFile, thumbFile, wantThumb, createMay, note, setTarget });
}

/** Die Adresse aus ?url=, oder der Status, mit dem abgewiesen wird. */
function proxyTarget(roh: string): string | number {
  let url = roh;
  if (!url?.startsWith('https://')) return 400;
  // Rebrickable liefert manchmal vorkodierte Adressen — einmal dekodieren.
  const decoded = onceDecoded(url);
  if (decoded.startsWith('https://')) url = decoded;
  // Nur bekannte Bild-CDNs; eine unlesbare Adresse ist ebenfalls 403.
  if (!hostAllowed(url, ALLOWED_IMAGE_HOSTS)) return 403;
  return proxyAddress(url) ?? url;
}

/** Die Antwort des CDN an den Client und zugleich in den Cache. */
function forward(
  d: ImageServices,
  r: FetchStream,
  res: Response,
  o: {
    url: string;
    cacheDir: string;
    cacheFile: string;
    thumbFile: string;
    wantThumb: boolean;
    createMay: boolean;
    note: () => void;
    setTarget: string | null;
  },
) {
  const { url, cacheDir, cacheFile, thumbFile, wantThumb, createMay, note, setTarget } = o;
  const rawType = String(r.kopf['content-type'] || 'image/jpeg');

  // Nur Bilder: Auf den erlaubten CDNs liegen teils Nutzer-Uploads, und ein SVG
  // oder HTML liefe sonst unter unserer Herkunft.
  const mime = beforeThe(rawType, ';').trim().toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
    r.verwerfen();
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `Kein Bild (${mime}) — ${url}`;
    console.warn(`[img-proxy] Antwort ist kein Bild (${mime}): ${url}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    return res.status(415).end();
  }

  // Nur eine vollständige Datei darf in den Cache.
  const expected = parseInt(String(r.kopf['content-length'] || '0'), 10) || 0;
  const contentType = imageType(rawType);
  res.setHeader('Content-Type', contentType);
  // Mit Länge: Eine chunked-Antwort puffert ein Reverse-Proxy womöglich lange.
  if (expected > 0) res.setHeader('Content-Length', String(expected));

  const enc = String(r.kopf['content-encoding'] || '').toLowerCase();
  const roh = r.strom();
  const body = entpackt(roh, enc, res, url, expected);
  // Kurz: Ungeprüft gestreamt nagelte ein langes max-age Fehler im Browser fest.
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');

  inDenCache(d, body, res, {
    url,
    cacheDir,
    cacheFile,
    thumbFile,
    contentType,
    enc,
    expected,
    wantThumb,
    createMay,
    note,
    setNummer: setTarget,
  });

  // Abbruch beim Scrollen: Die CDN-Verbindung muss sofort zurück in den Pool.
  res.on('close', () => {
    if (res.writableFinished || !res.destroyed) return;
    console.log(
      `[img-proxy] Client hat abgebrochen, Verbindung freigegeben: ${url}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    roh.destroy();
  });

  body.pipe(res);
}

/** Das Bild wird unter dieser Nummer für alle Konten abgelegt; deshalb zählt
 * nur der ganze Pfad ohne Anfrageteil, sonst legte `…/parts/x.png?/media/sets/10294-1.jpg`
 * ein fremdes Bild als Set ab. */
export function setNumberFromImageAddress(adresse: string): string | null {
  const u = urlOrNull(adresse);
  if (u?.protocol !== 'https:' || u.hostname !== 'cdn.rebrickable.com' || u.search || u.hash) return null;
  // Nur das Hauptbild: Unter /media/sets/<set>/<n>.jpg liegen Zusatzbilder, das erste gefragte
  // würde sonst für alle Konten das Set-Bild.
  const m = /^\/media\/sets\/([A-Za-z0-9-]{1,40})\.jpg$/.exec(u.pathname);
  return m?.[1] ?? null;
}
