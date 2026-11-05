/** Bild-Proxy für fremde CDNs: Bilder kommen über den eigenen Server, damit die
 * CSP keine fremden Quellen braucht und jedes Bild nur einmal geholt wird. */
import path from 'path';
import { APP_ROOT, PUBLIC_DIR } from '../src/infra/appPaths';
import fs from 'fs';
import { resolveUserId } from '../src/konto/http/anmeldung';
import { streamFileToResponse, vorDem, ohneFehlendeDatei, fehlertext } from '../src/infra/httpError';
import { queueThumb } from '../src/katalog/bilder/proxyThumbs';
import { liefereAusCache, merkeCacheZuwachs, bildTyp } from '../src/katalog/bilder/imgCacheServe';
import { imgProxyFailures } from '../src/katalog/bilder/imgProxyStats';
import { istBekanntFehlend, merkeFehlend } from '../src/katalog/bilder/imageMisses';
import { IMG_PROXY_PFAD, IMG_PROXY_PFAD_ALT, proxyAdresse, proxyCacheSchluessel } from '../src/katalog/bilder/images';
import { zaehleAnfrage } from '../src/konto/loginLimiter';
import { konfig } from '../src/infra/konfig';
import type { Request, Response, Express } from 'express';
import type { Readable } from 'stream';
import { oeffneHttps, AbrufFehler, type AbrufStrom } from '../src/infra/abruf';
import https from 'https';
import zlib from 'zlib';
import { nacharbeit } from '../src/auftraege/nacharbeit';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../src/infra/fremdeAdressen';

import { einmalDekodiert, urlOderNull } from '../src/infra/validate';
/** 20 MB, weil grosse Set-Bilder sonst nie vollständig im Speicher landeten.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#proxy-cache-max-bytes */
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024;


/** URLs, die das CDN mit 404 beantwortet hat → cacheKey → Zeitpunkt. */
const _imgNegCache = new Map();
let _tmpSeq = 0;

// Fehlschläge zählt src/katalog/bilder/imgProxyStats.ts, sonst nicht einzugrenzen.

/** Die Obergrenze verhindert, dass eine Kachelwand beliebig viele TLS-Verbindungen öffnet.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#cdnagent */
const _cdnAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 30000,
  // IPv4: Ohne IPv6-Route liefen Abrufe sonst stumm bis zur Zeitgrenze.
  family: 4,
});

/** 200 mit Platzhalter statt 404: Den Platzhalter zeigen beide Oberflächen
 * ohnehin, und die Browserkonsole bleibt frei von Fehlzeilen. */
let _platzhalter: Buffer | null = null;

function sendePlatzhalter(res: Response) {
  // Einmal von Platte: wenige hundert Byte, beim Blättern dutzendfach gebraucht.
  if (_platzhalter === null) {
    try { _platzhalter = fs.readFileSync(path.join(PUBLIC_DIR, 'assets', 'set-placeholder.svg')); }
    catch (e: any) {
      console.error(`[img-proxy] Platzhalter nicht lesbar: ${e?.message || e}`);
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
  const cacheDir  = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey  = proxyCacheSchluessel(url);
  const cacheFile = path.join(cacheDir, cacheKey);
  // ?thumb=1: Teilebilder gibt es auf dem CDN nicht verkleinert.
  const wantThumb = req.query.thumb === '1';
  // gen=0: Die Anfrage rechnet nichts, sie hinterlässt eine Notiz für den
  // Auftrag 'bildbedarf' — gedrosselt und nur im Job-Prozess.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-darferzeugen
  const darfErzeugen = req.query.gen !== '0';
  const setAusUrl = () => setNummerAusBildAdresse(String(url || ''));
  const notiere = () => {
    const sn = setAusUrl();
    if (sn) nacharbeit().bildVormerken(String(url), sn);
  };
  const thumbFile = cacheFile + '_thumb.jpg';

  if (await liefereAusCache({
    res, req, cacheFile, thumbFile, wantThumb, darfErzeugen, notiere, streamFileToResponse,
  })) return;

  // Der Merker (eine Stunde) erspart dem CDN die Frage bei jedem Seitenaufruf.
  if (istBekanntFehlend(cacheKey)) return sendePlatzhalter(res);

  // Nur Abrufe beim CDN zählen: Jeder füllt Platte und Bandbreite, Treffer nicht.
  const takt = await zaehleAnfrage('bild-abruf', `konto:${proxyUserId}`, 60_000);
  if (takt.count > konfig().bildAbrufeJeMinute) {
    res.setHeader('Retry-After', String(takt.waitMin * 60));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).end();
  }


  // Der zweite Satz ohne Referer: Der Hotlink-Schutz antwortet darauf mit 404.
  const HEADER_SETS: [Record<string, string>, Record<string, string>] = [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer':    'https://rebrickable.com/',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      // Unkomprimiert: Ein komprimierter Körper ergäbe still eine weisse Fläche.
      'Accept-Encoding': 'identity',
    },
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Encoding': 'identity',
    },
  ];

  const holen = (kopfzeilen: Record<string, string>) => oeffneHttps(url,
    { hosts: ERLAUBTE_BILD_HOSTS, maxBytes: PROXY_CACHE_MAX_BYTES, zeitlimitMs: 25_000, kopfzeilen, agent: _cdnAgent });
  let r: AbrufStrom;
  try {
    r = await holen(HEADER_SETS[0]);
    // Einmal ohne Referer nachfassen, BEVOR die Adresse als tot gilt: Der
    // Hotlink-Schutz antwortet auf einen unpassenden Referer gern mit 404.
    if (r.status === 404 || r.status === 403) { r.verwerfen(); r = await holen(HEADER_SETS[1]); }
  } catch (e) {
    const zeit = e instanceof AbrufFehler && e.grund === 'zeitlimit';
    if (zeit) imgProxyFailures.timeout++; else imgProxyFailures.error++;
    imgProxyFailures.lastError = fehlertext(e);
    console.error(`[img-proxy] ${zeit ? 'Zeitüberschreitung nach 25 s' : 'Verbindungsfehler'}: ${fehlertext(e)}`);
    if (!res.headersSent) res.status(zeit ? 504 : 502).end();
    return;
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
    if (r.status === 404) imgProxyFailures.notFound++; else imgProxyFailures.other++;
    imgProxyFailures.lastError = `HTTP ${r.status} — ${url}`;
    // 404 ist eine Auskunft, kein Fehler: als `error` verstopfte es das Protokoll.
    const meldung = `[img-proxy] CDN antwortete ${r.status} (auch ohne Referer): ${url}`;
    if (r.status === 404) console.info(meldung); else console.error(meldung);
    return r.status === 404 ? sendePlatzhalter(res) : res.status(r.status || 502).end();
  }
  const rohTyp = String(r.kopf['content-type'] || 'image/jpeg');

  // Nur Bilder: Auf den erlaubten CDNs liegen teils Nutzer-Uploads, und ein SVG
  // oder HTML liefe sonst unter unserer Herkunft.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-mime
  const mime = vorDem(rohTyp, ';').trim().toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
    r.verwerfen();
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `Kein Bild (${mime}) — ${url}`;
    console.warn(`[img-proxy] Antwort ist kein Bild (${mime}): ${url}`);
    return res.status(415).end();
  }

  // Nur eine vollständige Datei darf in den Cache.
  const expected = parseInt(String(r.kopf['content-length'] || '0'), 10) || 0;
  const contentType = bildTyp(rohTyp);
  res.setHeader('Content-Type', contentType);
  // Mit Länge: Eine chunked-Antwort puffert ein Reverse-Proxy womöglich lange.
  if (expected > 0) res.setHeader('Content-Length', String(expected));

  // Entpacken, auch wenn identity verlangt war: Nicht jedes CDN hält sich daran.
  const enc = String(r.kopf['content-encoding'] || '').toLowerCase();
  const roh = r.strom();
  let body: Readable = roh;
  if (enc === 'gzip' || enc === 'deflate' || enc === 'br') {
    const dec = enc === 'br' ? zlib.createBrotliDecompress()
              : enc === 'gzip' ? zlib.createGunzip()
              : zlib.createInflate();
    dec.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
    body = roh.pipe(dec);
    // Die angekündigte Länge gilt für den komprimierten Körper.
    res.removeHeader('Content-Length');
    console.log(`[img-proxy] entpacke ${enc}: ${url}`);
  }

  // Weicht das von der angekündigten Länge ab, wartet der Browser und zeigt nichts.
  let sentToClient = 0;
  body.on('data', (c: Buffer) => { sentToClient += c.length; });
  res.on('finish', () => {
    if (!enc && expected > 0 && sentToClient !== expected) {
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Länge weicht ab: ${sentToClient}/${expected} — ${url}`;
      console.error(`[img-proxy] an den Client gingen ${sentToClient} von ${expected} Bytes: ${url}`);
    }
  });
  // Kurz: Ungeprüft gestreamt nagelte ein langes max-age Fehler im Browser fest.
  res.setHeader('Cache-Control', 'private, max-age=3600, must-revalidate');

  // Erst in .tmp, dann atomar umbenennen: nie halbe Dateien im Cache.
  fs.mkdirSync(cacheDir, { recursive: true });
  // Je ANFRAGE eindeutig: Sonst schrieben gleichzeitige in dieselbe Datei.
  const tmpFile = `${cacheFile}.tmp-${process.pid}-${_tmpSeq++}`;
  const ws = fs.createWriteStream(tmpFile);
  let bytes = 0, aborted = false;
  const verwirf = (grund: string) => {
    if (aborted) return;
    aborted = true;
    ws.destroy();
    fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
    imgProxyFailures.other++;
    imgProxyFailures.lastError = `${grund}: ${url}`;
    console.error(`[img-proxy] ${grund} — weder gecacht noch verkleinert: ${url}`);
  };
  // Der entpackte Strom zählt: Auch Komprimiertes darf nicht beliebig wachsen.
  body.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > PROXY_CACHE_MAX_BYTES) { verwirf(`grösser als ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB`); body.destroy(); res.destroy(); }
  });
  body.on('error', (e: Error) => { verwirf(`Abruf abgebrochen (${e.message})`); res.destroy(); });
  // Der ENTPACKTE Strom geht in den Cache — die Datei ist immer ein echtes Bild.
  body.pipe(ws);
  ws.on('finish', async () => {
    if (aborted) return;
    try {
      // Nur vollständig: Eine abgeschnittene ginge dauerhaft mit 200 hinaus.
      const st = await fs.promises.stat(tmpFile);
      if (!enc && expected > 0 && st.size !== expected) {
        console.error(`[img-proxy] unvollständig (${st.size}/${expected} Bytes), nicht gecacht: ${url}`);
        await fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
        return;
      }
      await fs.promises.writeFile(cacheFile + '.ct', contentType);
      await fs.promises.rename(tmpFile, cacheFile);
      merkeCacheZuwachs(st.size);
      // Gleich miterzeugen, sonst später für eine ganze Kachelwand auf einmal.
      if (wantThumb) { if (darfErzeugen) queueThumb(cacheFile, thumbFile); else notiere(); }
    } catch (_) { fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')); }
  });
  ws.on('error', () => fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')));

  // Abbruch beim Scrollen: Die CDN-Verbindung muss sofort zurück in den Pool.
  res.on('close', () => {
    if (res.writableFinished || !res.destroyed) return;
    console.log(`[img-proxy] Client hat abgebrochen, Verbindung freigegeben: ${url}`);
    roh.destroy();
  });

  body.pipe(res);
}

/** Unter BEIDEN Adressen: Die alte steht in Datenbankzeilen und installierten Apps.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#registerimgproxy */
function registerImgProxy(app: Express) {
  app.get(IMG_PROXY_PFAD, bildDurchreichen);
  app.get(IMG_PROXY_PFAD_ALT, bildDurchreichen);
}

export { registerImgProxy };

/** Das Bild wird unter dieser Nummer für alle Konten abgelegt; deshalb zählt
 * nur der ganze Pfad ohne Anfrageteil, sonst legte `…/parts/x.png?/media/sets/10294-1.jpg`
 * ein fremdes Bild als Set ab. */
export function setNummerAusBildAdresse(adresse: string): string | null {
  const u = urlOderNull(adresse);
  if (!u || u.protocol !== 'https:' || u.hostname !== 'cdn.rebrickable.com' || u.search || u.hash) return null;
  const m = /^\/media\/sets\/([A-Za-z0-9-]{1,40})\.(?:jpg|jpeg|png|webp)$/i.exec(u.pathname);
  return m?.[1] ?? null;
}
