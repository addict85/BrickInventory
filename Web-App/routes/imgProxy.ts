/** Bild-Proxy für fremde CDNs: Bilder kommen über den eigenen Server, damit die
 * CSP keine fremden Quellen braucht und jedes Bild nur einmal geholt wird. */
import path from 'path';
import { APP_ROOT, PUBLIC_DIR } from '../src/infra/appPaths';
import fs from 'fs';
import { resolveUserId } from '../src/konto/http/anmeldung';
import { streamFileToResponse, vorDem, ohneFehlendeDatei } from '../src/infra/httpError';
import { queueThumb } from '../src/katalog/bilder/proxyThumbs';
import { liefereAusCache } from '../src/katalog/bilder/imgCacheServe';
import { imgProxyFailures } from '../src/katalog/bilder/imgProxyStats';
import { istBekanntFehlend, merkeFehlend } from '../src/katalog/bilder/imageMisses';
import { IMG_PROXY_PFAD, IMG_PROXY_PFAD_ALT } from '../src/katalog/bilder/images';
import type { Request, Response, Express } from 'express';
import type { OutgoingHttpHeaders } from 'http';
import crypto from 'crypto';
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

// Fehlgeschlagene Abrufe zählt src/katalog/bilder/imgProxyStats.ts: Ohne
// Zähler war „Bilder erscheinen teilweise nicht" nicht einzugrenzen.

/** Die Obergrenze verhindert, dass eine Kachelwand beliebig viele TLS-Verbindungen öffnet.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#cdnagent */
const _cdnAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 30000,
  // IPv4 erzwingen: Der Server hat keine IPv6-Route; Abrufe liefen sonst
  // stumm bis zur Zeitgrenze.
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
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(404).end();
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(200).end(_platzhalter);
}


export async function bildDurchreichen(req: Request, res: Response) {
  // Ohne Login-Pflicht wäre das ein offener Proxy (Bandbreiten-Missbrauch,
  // IP-Verschleierung).
  const proxyUserId = await resolveUserId(req);
  if (!proxyUserId) return res.status(401).end();
  let url = String(req.query.url || '');
  if (!url || !url.startsWith('https://')) return res.status(400).end();
  // Rebrickable liefert manchmal vorkodierte Adressen — einmal dekodieren.
  const decoded = einmalDekodiert(url);
  if (decoded.startsWith('https://')) url = decoded;
  // Nur bekannte Bild-CDNs (src/infra/fremdeAdressen.ts); eine unlesbare
  // Adresse ist ebenfalls 403.
  if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS)) return res.status(403).end();
  // Jedes CDN-Bild wird serverseitig nur einmal geholt. Content-Type als
  // Sidecar-Datei (.ct).
  const cacheDir  = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey  = crypto.createHash('sha1').update(url).digest('hex');
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

  // Ein fehlendes Bild holte der Browser bei jedem Seitenaufruf neu; der Merker
  // antwortet sofort. Eine Stunde, damit ein nachgereichtes Bild nicht dauerhaft
  // fehlt.
  if (istBekanntFehlend(cacheKey)) return sendePlatzhalter(res);


  // Der erste Satz imitiert einen Browser; der zweite lässt Referer und
  // Accept-Language weg, weil der Hotlink-Schutz auf fremde Referer mit 404 antwortet.
  const HEADER_SETS = [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer':    'https://rebrickable.com/',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      // Unkomprimiert anfordern: Ein durchgereichter komprimierter Körper ergibt beim
      // Browser eine weisse Fläche, ohne jeden Hinweis im Log.
      'Accept-Encoding': 'identity',
    },
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Encoding': 'identity',
    },
  ] as const;

  let attempt = 0;
  // Die laufende Anfrage festhalten: Bei einem Client-Abbruch muss GENAU sie
  // beendet werden, sonst bleibt ihr Socket belegt.
  let activeReq: any = null;
  const fetchWith = (headers: OutgoingHttpHeaders) => (activeReq = https.get(url, { headers, agent: _cdnAgent }, r => {
    if (r.statusCode !== 200) {
      r.resume();
      // Einmal ohne Referer nachfassen, BEVOR die Adresse als tot gilt: Der
      // Hotlink-Schutz antwortet auf einen unpassenden Referer gern mit 404.
      if (attempt === 0 && (r.statusCode === 404 || r.statusCode === 403)) {
        attempt = 1;
        const retry = fetchWith(HEADER_SETS[1]);
        retry.on('error', () => { if (!res.headersSent) res.status(502).end(); });
        retry.setTimeout(25000, () => { retry.destroy(); if (!res.headersSent) res.status(504).end(); });
        return;
      }
      // NUR 404 merken: 403 kommt auch als Drosselung bei einer Kachelwand vor,
      // und die Bilder existieren.
      if (r.statusCode === 404) {
        merkeFehlend(cacheKey);
        _imgNegCache.set(cacheKey, Date.now());
        if (_imgNegCache.size > 5000) {
          const cutoff = Date.now() - 900_000;
          for (const [k, t] of _imgNegCache) if (t < cutoff) _imgNegCache.delete(k);
        }
      }
      if (r.statusCode === 404) imgProxyFailures.notFound++; else imgProxyFailures.other++;
      imgProxyFailures.lastError = `HTTP ${r.statusCode} — ${url}`;
      // 404 ist eine Auskunft, kein Fehler: als `error` verstopfte es das Protokoll
      // dort, wo man nach echten Störungen sucht.
      const meldung = `[img-proxy] CDN antwortete ${r.statusCode} (auch ohne Referer): ${url}`;
      if (r.statusCode === 404) console.info(meldung); else console.error(meldung);
      // Fehlt statusCode, ist 502 die ehrliche Auskunft.
      return r.statusCode === 404 ? sendePlatzhalter(res) : res.status(r.statusCode ?? 502).end();
    }
    const contentType = r.headers['content-type'] || 'image/jpeg';

    // Nur Bilder: Auf den erlaubten CDNs liegen teils Nutzer-Uploads, und ein SVG
    // oder HTML liefe sonst unter unserer Herkunft.
    // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-mime
    const mime = vorDem(contentType, ';').trim().toLowerCase();
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
      r.resume();
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Kein Bild (${mime}) — ${url}`;
      console.warn(`[img-proxy] Antwort ist kein Bild (${mime}): ${url}`);
      return res.status(415).end();
    }

    // Nur eine vollständige Datei darf in den Cache.
    const expected = parseInt(String(r.headers['content-length'] || '0'), 10) || 0;
    res.setHeader('Content-Type', contentType);
    // Content-Length weiterreichen: Eine chunked-Antwort puffert ein
    // Reverse-Proxy womöglich, und der Browser wartet minutenlang.
    if (expected > 0) res.setHeader('Content-Length', String(expected));

    // Entpacken, auch wenn identity verlangt war: Nicht jedes CDN hält sich daran.
    const enc = String(r.headers['content-encoding'] || '').toLowerCase();
    let body: any = r;
    if (enc === 'gzip' || enc === 'deflate' || enc === 'br') {
          const dec = enc === 'br' ? zlib.createBrotliDecompress()
                : enc === 'gzip' ? zlib.createGunzip()
                : zlib.createInflate();
      dec.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      body = r.pipe(dec);
      // Die angekündigte Länge gilt für den komprimierten Körper.
      res.removeHeader('Content-Length');
      console.log(`[img-proxy] entpacke ${enc}: ${url}`);
    }

    // Weicht das von der angekündigten Länge ab, wartet der Browser und zeigt nichts.
    let sentToClient = 0;
    body.on('data', (c: any) => { sentToClient += c.length; });
    res.on('finish', () => {
      if (!enc && expected > 0 && sentToClient !== expected) {
        imgProxyFailures.other++;
        imgProxyFailures.lastError = `Länge weicht ab: ${sentToClient}/${expected} — ${url}`;
        console.error(`[img-proxy] an den Client gingen ${sentToClient} von ${expected} Bytes: ${url}`);
      }
    });
    // Kurz und mit Rückfrage: Die Antwort wird ungeprüft gestreamt; ein langes
    // max-age nagelte einen Fehler im Browser fest.
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');

    // Erst in .tmp, bei Erfolg atomar umbenennen, damit nie halbe Dateien im Cache
    // landen. Durchgehend async, weil das hier der heisse Pfad ist.
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      // Je ANFRAGE eindeutig: Gleichzeitige Anfragen desselben Bildes schrieben
      // sonst in dieselbe Datei.
      const tmpFile = `${cacheFile}.tmp-${process.pid}-${_tmpSeq++}`;
      const ws = fs.createWriteStream(tmpFile);
      let bytes = 0, aborted = false;
      body.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > PROXY_CACHE_MAX_BYTES && !aborted) {
          aborted = true;
          ws.destroy();
          fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
          // Nicht still: Ein übergrosses Bild hinterliesse sonst keine Spur im Log.
          imgProxyFailures.other++;
          imgProxyFailures.lastError = `zu gross für den Cache (> ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB): ${url}`;
          console.error(`[img-proxy] Bild grösser als ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB — weder gecacht noch verkleinert: ${url}`);
        }
      });
      // Der ENTPACKTE Strom geht in den Cache — die Datei ist immer ein echtes Bild.
      body.pipe(ws);
      ws.on('finish', async () => {
          if (aborted) return;
          try {
            // Nur vollständige Dateien übernehmen: Eine abgeschnittene ginge dauerhaft mit
            // 200 hinaus und bliebe leer, ohne Fehler.
            const st = await fs.promises.stat(tmpFile);
          if (!enc && expected > 0 && st.size !== expected) {
              console.error(`[img-proxy] unvollständig (${st.size}/${expected} Bytes), nicht gecacht: ${url}`);
              await fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
              return;
            }
            await fs.promises.writeFile(cacheFile + '.ct', contentType);
            await fs.promises.rename(tmpFile, cacheFile);
            // Gleich miterzeugen, sonst entstünde sie beim zweiten Aufruf für eine ganze
            // Kachelwand auf einmal.
          if (wantThumb) { if (darfErzeugen) queueThumb(cacheFile, thumbFile); else notiere(); }
        } catch (_) { fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')); }
      });
      ws.on('error', () => fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')));
    } catch (_) { /* Cache-Schreiben ist Best-Effort */ }

    // Bricht der Browser ab (beim Scrollen der Normalfall), muss die Verbindung
    // zum CDN sofort frei werden, sonst ist der Pool bald belegt.
    res.on('close', () => {
      if (res.writableFinished || !res.destroyed) return;
      console.log(`[img-proxy] Client hat abgebrochen, Verbindung freigegeben: ${url}`);
      r.destroy();
      activeReq?.destroy();
    });

    body.pipe(res);
  }));
  const request = fetchWith(HEADER_SETS[0]);
  request.on('error', (e: any) => {
    imgProxyFailures.error++;
    imgProxyFailures.lastError = `${e.code || e.message} — ${url}`;
    console.error(`[img-proxy] Verbindungsfehler ${e.code || e.message}: ${url}`);
    if (!res.headersSent) res.status(502).end();
  });
  // 25 s: Durch den Pool stehen Anfragen an; eine kürzere Grenze schnitte genau
  // die wartenden ab.
  request.setTimeout(25000, () => {
    request.destroy();
    imgProxyFailures.timeout++;
    imgProxyFailures.lastError = `timeout — ${url}`;
    console.error(`[img-proxy] Zeitüberschreitung nach 25 s: ${url}`);
    if (!res.headersSent) res.status(504).end();
  });
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
