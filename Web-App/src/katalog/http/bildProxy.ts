/** Bild-Proxy für fremde CDNs: Bilder kommen über den eigenen Server, damit die
 * CSP keine fremden Quellen braucht und jedes Bild nur einmal geholt wird.
 * Den Abruf macht clients/bildCdn.ts; hier stehen Cache, Drossel und Antwort. */
import path from 'path';
import { APP_ROOT, PUBLIC_DIR, SET_IMAGES_DIR } from '../../infra/appPaths';
import fs from 'fs';
import { resolveUserId } from '../../konto/http/anmeldung';
import { vorDem, ohneFehlendeDatei, fehlertext, logAndContinue } from '../../infra/fehler';
import { streamFileToResponse } from '../../http/httpAntwort';
import { queueThumb } from '../bilder/proxyThumbs';
import { liefereAusCache, merkeCacheZuwachs, bildTyp } from '../bilder/imgCacheServe';
import { imgProxyFailures } from '../bilder/imgProxyStats';
import { istBekanntFehlend, merkeFehlend } from '../bilder/imageMisses';
import { proxyAdresse, proxyCacheSchluessel } from '../bilder/images';
import { zaehleAnfrage } from '../../konto/loginLimiter';
import { konfig } from '../../infra/konfig';
import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import { AbrufFehler, type AbrufStrom } from '../../infra/abruf';
import { oeffneBild, BILD_KOPFZEILEN, BILD_KOPFZEILEN_OHNE_REFERER } from '../quellen';
import zlib from 'zlib';
import { nacharbeit } from '../../auftraege/nacharbeit';
import { setBildVollstaendig } from '../bilder/setImages';
import { setBildLokalEintragen } from '../bildlage';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../../infra/fremdeAdressen';

import { einmalDekodiert, urlOderNull } from '../../infra/validate';
/** 20 MB, weil grosse Set-Bilder sonst nie vollständig im Speicher landeten.
 * Ausführlich: docs/begruendungen/src/katalog/http/bildProxy.ts.md#proxy-cache-max-bytes */
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024;

/** URLs, die das CDN mit 404 beantwortet hat → cacheKey → Zeitpunkt. */
const _imgNegCache = new Map();
let _tmpSeq = 0;

// Fehlschläge zählt src/katalog/bilder/imgProxyStats.ts, sonst nicht einzugrenzen.

/** 200 mit Platzhalter statt 404: Den Platzhalter zeigen beide Oberflächen
 * ohnehin, und die Browserkonsole bleibt frei von Fehlzeilen. */
let _platzhalter: Buffer | null = null;

function sendePlatzhalter(res: Response) {
  // Einmal von Platte: wenige hundert Byte, beim Blättern dutzendfach gebraucht.
  if (_platzhalter === null) {
    try {
      _platzhalter = fs.readFileSync(path.join(PUBLIC_DIR, 'assets', 'set-placeholder.svg'));
    } catch (e) {
      console.error(
        `[img-proxy] Platzhalter nicht lesbar: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
      );
      _platzhalter = Buffer.alloc(0);
    }
  }
  if (!_platzhalter.length) {
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(404).end();
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).end(_platzhalter);
}

/** Erst mit Referer, dann ohne; ein 404 wird gemerkt. `ersatz` antwortet statt
 * des Fehlers, wenn es kann (etwa mit der Vorschau aus dem Cache).
 * @returns null, wenn schon geantwortet ist */
async function vomCdn(
  url: string,
  cacheKey: string,
  res: Response,
  ersatz: () => Promise<boolean> = async () => false,
): Promise<AbrufStrom | null> {
  // Unkomprimiert: Ein komprimierter Körper ergäbe still eine weisse Fläche.
  const HEADER_SETS = [
    { ...BILD_KOPFZEILEN, 'Accept-Language': 'en-US,en;q=0.9', 'Accept-Encoding': 'identity' },
    { ...BILD_KOPFZEILEN_OHNE_REFERER, 'Accept-Encoding': 'identity' },
  ] as const;

  const holen = (kopfzeilen: Record<string, string>) =>
    oeffneBild(url, { maxBytes: PROXY_CACHE_MAX_BYTES, zeitlimitMs: 25_000, kopfzeilen, pool: true });
  let r: AbrufStrom;
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
      merkeFehlend(cacheKey);
      _imgNegCache.set(cacheKey, Date.now());
      if (_imgNegCache.size > 5000) {
        const cutoff = Date.now() - 900_000;
        for (const [k, t] of _imgNegCache) if (t < cutoff) _imgNegCache.delete(k);
      }
    }
    if (r.status === 404) imgProxyFailures.notFound++;
    else imgProxyFailures.other++;
    imgProxyFailures.lastError = `HTTP ${r.status} — ${url}`;
    // 404 ist eine Auskunft, kein Fehler: als `error` verstopfte es das Protokoll.
    const meldung = `[img-proxy] CDN antwortete ${r.status} (auch ohne Referer): ${url}`;
    if (r.status === 404) console.info(meldung.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    else console.error(meldung.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    if (await ersatz()) return null;
    void (r.status === 404 ? sendePlatzhalter(res) : res.status(r.status || 502).end());
    return null;
  }
  return r;
}

/** Was der Proxy vollständig hat, wird das Set-Bild: Ein zweiter Abruf beim CDN
 * scheiterte, wo der erste ging. Die Vorschau erzeugt der Auftrag bildbedarf. */
async function alsSetBildAblegen(cacheFile: string, setNummer: string): Promise<void> {
  const ziel = path.join(SET_IMAGES_DIR, `${setNummer.replace(/[^a-z0-9-]/gi, '_')}.jpg`);
  const teil = `${ziel}.${process.pid}-${_tmpSeq++}.teil`;
  await fs.promises.mkdir(SET_IMAGES_DIR, { recursive: true });
  await fs.promises.copyFile(cacheFile, teil);
  await fs.promises.rename(teil, ziel);
}

/** Der entpackte Strom geht nebenher in den Cache — erst in .tmp, dann atomar. */
function inDenCache(
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
    darfErzeugen: boolean;
    notiere: () => void;
    setNummer: string | null;
  },
): void {
  const { url, cacheDir, cacheFile, thumbFile, contentType, enc, expected, wantThumb, darfErzeugen, notiere } = o;
  fs.mkdirSync(cacheDir, { recursive: true });
  // Je ANFRAGE eindeutig: Sonst schrieben gleichzeitige in dieselbe Datei.
  const tmpFile = `${cacheFile}.tmp-${process.pid}-${_tmpSeq++}`;
  const ws = fs.createWriteStream(tmpFile);
  let bytes = 0,
    aborted = false;
  const verwirf = (grund: string) => {
    if (aborted) return;
    aborted = true;
    ws.destroy();
    fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
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
      verwirf(`grösser als ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB`);
      body.destroy();
      res.destroy();
    }
  });
  body.on('error', (e: Error) => {
    verwirf(`Abruf abgebrochen (${e.message})`);
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
        await fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
        return;
      }
      await fs.promises.writeFile(cacheFile + '.ct', contentType);
      await fs.promises.rename(tmpFile, cacheFile);
      merkeCacheZuwachs(st.size);
      if (o.setNummer) await setBildAusCache(url, o.setNummer, cacheFile).catch(logAndContinue('img-proxy:setbild'));
      // Gleich miterzeugen, sonst später für eine ganze Kachelwand auf einmal.
      if (wantThumb) {
        if (darfErzeugen) queueThumb(cacheFile, thumbFile);
        else notiere();
      }
    } catch (_) {
      fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
    }
  });
  ws.on('error', () => fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')));
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

const liegtDa = (datei: string) =>
  fs.promises.access(datei).then(
    () => true,
    () => false,
  );

/** @returns true, wenn Bild oder Vorschau unter images/sets noch fehlen */
async function setBildFehlt(setNummer: string): Promise<boolean> {
  if (!(await setBildVollstaendig(setNummer))) return true;
  // Liegen beide schon da, fehlt oft nur der Eintrag: Danach fragt die Oberfläche nicht mehr hier.
  await setBildLokalEintragen(setNummer).catch(logAndContinue('img-proxy:setBildLokal'));
  return false;
}

/** Vorgemerkt wird nur, was der Proxy als Bild hat (Cache oder gedrosselter Abruf),
 * und je Set einmal in VORMERKEN_FRIST_MS: Sonst füllte ein Konto mit erfundenen
 * Set-Nummern die Notizen des Bild-Auftrags. */
const VORMERKEN_FRIST_MS = 15 * 60_000;
const _vorgemerkt = new Map<string, number>();
function vormerkenEinmal(url: string, setNummer: string): void {
  const jetzt = Date.now();
  if (jetzt - (_vorgemerkt.get(setNummer) ?? -Infinity) < VORMERKEN_FRIST_MS) return;
  if (_vorgemerkt.size >= 5000)
    for (const [sn, t] of _vorgemerkt) if (jetzt - t >= VORMERKEN_FRIST_MS) _vorgemerkt.delete(sn);
  _vorgemerkt.set(setNummer, jetzt);
  nacharbeit().bildVormerken(url, setNummer);
}

function ausSetBildern(req: Request, res: Response, setNummer: string, wantThumb: boolean): Promise<boolean> {
  const stamm = path.join(SET_IMAGES_DIR, setNummer.replace(/[^a-z0-9-]/gi, '_'));
  return liefereAusCache({
    res,
    req,
    cacheFile: `${stamm}.jpg`,
    thumbFile: `${stamm}_thumb.jpg`,
    wantThumb,
    darfErzeugen: false,
    notiere: () => {},
    streamFileToResponse,
  });
}

/** Aus dem Cache des Proxys nach images/sets, dann vormerken; ohne Cache-Datei nichts. */
async function setBildAusCache(url: string, setNummer: string, cacheFile: string): Promise<void> {
  try {
    await alsSetBildAblegen(cacheFile, setNummer);
  } catch (e) {
    return ohneFehlendeDatei('img-proxy:setbild')(e);
  }
  vormerkenEinmal(url, setNummer);
}

export async function bildDurchreichen(req: Request, res: Response) {
  // Ohne Login-Pflicht ein offener Proxy (Bandbreite, IP-Verschleierung).
  const proxyUserId = await resolveUserId(req);
  if (!proxyUserId) return res.status(401).end();
  let url = String(req.query.url || '');
  if (!url || !url.startsWith('https://')) return res.status(400).end();
  // Rebrickable liefert manchmal vorkodierte Adressen — einmal dekodieren.
  const decoded = einmalDekodiert(url);
  if (decoded.startsWith('https://')) url = decoded;
  // Nur bekannte Bild-CDNs; eine unlesbare Adresse ist ebenfalls 403.
  if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS)) return res.status(403).end();
  url = proxyAdresse(url) ?? url;
  // Jedes Bild nur einmal holen; Content-Type liegt daneben (.ct).
  const cacheDir = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey = proxyCacheSchluessel(url);
  const cacheFile = path.join(cacheDir, cacheKey);
  // ?thumb=1: Teilebilder gibt es auf dem CDN nicht verkleinert.
  const wantThumb = req.query.thumb === '1';
  // gen=0: Die Anfrage rechnet nichts, sie hinterlässt eine Notiz für den
  // Auftrag 'bildbedarf' — gedrosselt und nur im Job-Prozess.
  // Ausführlich: docs/begruendungen/src/katalog/http/bildProxy.ts.md#bilddurchreichen-darferzeugen
  const darfErzeugen = req.query.gen !== '0';
  const setAusUrl = () => setNummerAusBildAdresse(String(url || ''));
  const notiere = () => {
    const sn = setAusUrl();
    if (sn) nacharbeit().bildVormerken(String(url), sn);
  };
  const thumbFile = cacheFile + '_thumb.jpg';
  // Ein Set-Bild gehört samt Vorschau nach images/sets; der Bild-Job holt es,
  // sobald es einmal über den Proxy gefragt war.
  const setNummer = setAusUrl();
  const setFehlt = setNummer ? await setBildFehlt(setNummer) : false;
  // Liegt nur noch die Vorschau im Cache (die Pflege löscht das unbenutzte Original
  // nach 30 Tagen), holt der Proxy das Original neu: Den Abruf des Bild-Jobs mit
  // eigener Kennung weist das CDN ab, ohne diesen Weg bekäme das Set nie eine Datei.
  const originalFehlt = setFehlt && !(await liegtDa(cacheFile));
  if (setFehlt && setNummer && !originalFehlt) await setBildAusCache(url, setNummer, cacheFile);

  // Liegt das Set-Bild samt Vorschau in images/sets, kommt es von dort statt aus
  // Cache oder CDN: Die Katalogsuche fragt Sets ausserhalb des Blickfelds bewusst
  // hier und nicht unter /images/sets (bildBlickfeld.ts), und den Proxy-Cache
  // räumt die Pflege nach 30 Tagen, images/sets nicht.
  if (setNummer && !setFehlt && (await ausSetBildern(req, res, setNummer, wantThumb))) return;
  const ausCache = () =>
    liefereAusCache({ res, req, cacheFile, thumbFile, wantThumb, darfErzeugen, notiere, streamFileToResponse });
  // Scheitert der neue Abruf, bleibt es bei der Vorschau aus dem Cache.
  const ersatz = async () => originalFehlt && (await ausCache());
  if (!originalFehlt && (await ausCache())) return;

  // Der Merker (eine Stunde) erspart dem CDN die Frage bei jedem Seitenaufruf.
  if (istBekanntFehlend(cacheKey) && (await ersatz())) return;
  if (istBekanntFehlend(cacheKey)) return sendePlatzhalter(res);

  // Nur Abrufe beim CDN zählen: Jeder füllt Platte und Bandbreite, Treffer nicht.
  const takt = await zaehleAnfrage('bild-abruf', `konto:${proxyUserId}`, 60_000);
  if (takt.count > konfig().bildAbrufeJeMinute) {
    if (await ersatz()) return;
    res.setHeader('Retry-After', String(takt.waitMin * 60));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).end();
  }

  const r = await vomCdn(url, cacheKey, res, ersatz);
  if (!r) return;
  const rohTyp = String(r.kopf['content-type'] || 'image/jpeg');

  // Nur Bilder: Auf den erlaubten CDNs liegen teils Nutzer-Uploads, und ein SVG
  // oder HTML liefe sonst unter unserer Herkunft.
  // Ausführlich: docs/begruendungen/src/katalog/http/bildProxy.ts.md#bilddurchreichen-mime
  const mime = vorDem(rohTyp, ';').trim().toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
    r.verwerfen();
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `Kein Bild (${mime}) — ${url}`;
    console.warn(`[img-proxy] Antwort ist kein Bild (${mime}): ${url}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    return res.status(415).end();
  }

  // Nur eine vollständige Datei darf in den Cache.
  const expected = parseInt(String(r.kopf['content-length'] || '0'), 10) || 0;
  const contentType = bildTyp(rohTyp);
  res.setHeader('Content-Type', contentType);
  // Mit Länge: Eine chunked-Antwort puffert ein Reverse-Proxy womöglich lange.
  if (expected > 0) res.setHeader('Content-Length', String(expected));

  const enc = String(r.kopf['content-encoding'] || '').toLowerCase();
  const roh = r.strom();
  const body = entpackt(roh, enc, res, url, expected);
  // Kurz: Ungeprüft gestreamt nagelte ein langes max-age Fehler im Browser fest.
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');

  inDenCache(body, res, {
    url,
    cacheDir,
    cacheFile,
    thumbFile,
    contentType,
    enc,
    expected,
    wantThumb,
    darfErzeugen,
    notiere,
    setNummer: setFehlt ? setNummer : null,
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
export function setNummerAusBildAdresse(adresse: string): string | null {
  const u = urlOderNull(adresse);
  if (!u || u.protocol !== 'https:' || u.hostname !== 'cdn.rebrickable.com' || u.search || u.hash) return null;
  const m = /^\/media\/sets\/([A-Za-z0-9-]{1,40})(?:\/\d{1,12})?\.(?:jpg|jpeg|png|webp)$/i.exec(u.pathname);
  return m?.[1] ?? null;
}
