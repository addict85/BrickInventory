/**
 * Bild-Proxy für fremde CDNs.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#abschnitt
 */
import path from 'path';
import { APP_ROOT, PUBLIC_DIR } from '../utils/appPaths';
import fs from 'fs';
import { resolveUserId } from '../utils/auth';
import { streamFileToResponse, vorDem, ohneFehlendeDatei } from '../utils/httpError';
import { queueThumb } from '../utils/proxyThumbs';
import { liefereAusCache } from '../utils/imgCacheServe';
import { imgProxyFailures } from '../utils/imgProxyStats';
import { istBekanntFehlend, merkeFehlend } from '../utils/imageMisses';
import { IMG_PROXY_PFAD, IMG_PROXY_PFAD_ALT } from '../utils/images';
import type { Request, Response, Express } from 'express';
import type { OutgoingHttpHeaders } from 'http';
import crypto from 'crypto';
import https from 'https';
import zlib from 'zlib';
import { nacharbeit } from '../utils/nacharbeit';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../utils/fremdeAdressen';

/**
 * Obergrenze für den Bild-Zwischenspeicher des Proxys.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#proxy-cache-max-bytes
 */
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024;


/** URLs, die das CDN mit 404/403 beantwortet hat → cacheKey → Zeitpunkt. */
const _imgNegCache = new Map();
/** Laufende Nummer für Temp-Dateien des Bild-Proxys (siehe tmpFile unten). */
let _tmpSeq = 0;

// Fehlgeschlagene Abrufe zählt utils/imgProxyStats.ts (GET /api/v1/admin/img-probe):
// Ohne Zähler war „Bilder erscheinen teilweise nicht“ nicht einzugrenzen.

/**
 * Verbindungs-Pool für CDN-Abrufe.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#cdnagent
 */
const _cdnAgent = new (require('https').Agent)({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 30000,
  // IPv4 erzwingen: Der Server hat keine IPv6-Route; Abrufe liefen sonst
  // stumm bis zur Zeitgrenze.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#cdnagent-2
  family: 4,
});

// Die Vorschau-Maschinerie (Warteschlange, prozessübergreifende Sperre,
// Verkleinern) liegt in utils/proxyThumbs.ts.

/**
 * 200 mit Platzhalter statt 404: Den Platzhalter zeigen beide Oberflächen
 * ohnehin, und die Browserkonsole bleibt frei von Fehlzeilen.
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#platzhalter
 */
let _platzhalter: Buffer | null = null;

function sendePlatzhalter(res: Response) {
  // Einmal von Platte, dann aus dem Speicher: Die Datei ist ein paar hundert
  // Byte und wird beim Blaettern durch alte Jahrgaenge dutzendfach gebraucht.
  if (_platzhalter === null) {
    try { _platzhalter = fs.readFileSync(path.join(PUBLIC_DIR, 'assets', 'set-placeholder.svg')); }
    catch (e: any) {
      // Ohne Datei bleibt nur die alte Antwort — aber nicht stillschweigend.
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


/**
 * Ein CDN-Bild ausliefern: aus dem Plattencache, sonst vom CDN geholt und
 * dabei abgelegt. Antwortet selbst über res.
 */
export async function bildDurchreichen(req: Request, res: Response) {
  // Auth: der Proxy holt fremde Inhalte über unseren Server — ohne Login-Pflicht
  // wäre er ein offener Proxy (Bandbreiten-Missbrauch, IP-Verschleierung).
  const proxyUserId = await resolveUserId(req);
  if (!proxyUserId) return res.status(401).end();
  let url = String(req.query.url || '');
  if (!url || !url.startsWith('https://')) return res.status(400).end();
  // Rebrickable API sometimes returns pre-encoded URLs — decode once to fix double-encoding
  try { const decoded = decodeURIComponent(url); if (decoded.startsWith('https://')) url = decoded; } catch(_) {}
  // Nur bekannte Bild-CDNs (utils/fremdeAdressen.ts, wie der Dateidownload).
  // Eine unlesbare Adresse ist ebenfalls 403: „holt der Server nicht“.
  if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS)) return res.status(403).end();
  // Disk-Cache: jedes CDN-Bild wird serverseitig nur einmal geholt.
  // Schlüssel = SHA1 der URL; Content-Type als Sidecar-Datei (.ct).
  const cacheDir  = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey  = crypto.createHash('sha1').update(url).digest('hex');
  const cacheFile = path.join(cacheDir, cacheKey);
  // ?thumb=1 — verkleinerte Fassung ausliefern.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-wantthumb
  const wantThumb = req.query.thumb === '1';
  // gen=0: Die ANFRAGE rechnet nichts. Statt die Verkleinerung sofort
  // anzustossen, hinterlässt sie eine Notiz — abgearbeitet wird sie vom
  // Hintergrund-Job (jobs/imageQueue.ts), gedrosselt und nur auf dem
  // Primärprozess.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-darferzeugen
  const darfErzeugen = req.query.gen !== '0';
  const setAusUrl = () => setNummerAusBildAdresse(String(url || ''));
  const notiere = () => {
    const sn = setAusUrl();
    if (sn) nacharbeit().bildVormerken(String(url), sn);
  };
  const thumbFile = cacheFile + '_thumb.jpg';

  // Cache-Treffer (Original oder Verkleinerung) — in
  // utils/imgCacheServe.ts. `true` heisst: beantwortet, hier ist Schluss.
  if (await liefereAusCache({
    res, req, cacheFile, thumbFile, wantThumb, darfErzeugen, notiere, streamFileToResponse,
  })) return;

  // Negativ-Cache: Fehlt ein Bild beim CDN (404), holt der Browser es bei jedem
  // Seitenaufruf erneut — und jedes Mal geht ein Roundtrip zum CDN raus. Der
  // Merker beantwortet den zweiten und jeden weiteren Versuch sofort.
  // Eine Stunde, damit ein nachgereichtes Bild nicht dauerhaft ausgesperrt wird.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen
  if (istBekanntFehlend(cacheKey)) return sendePlatzhalter(res);


  // Zwei Kopfzeilen-Sätze. Der erste imitiert einen Browser auf rebrickable.com;
  // der zweite lässt Referer und Accept-Language weg.
  // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-header-sets
  const HEADER_SETS = [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer':    'https://rebrickable.com/',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      // Unkomprimiert anfordern. Node entpackt nichts von selbst, und ein
      // durchgereichter komprimierter Körper mit Content-Type: image/jpeg
      // ergibt beim Browser eine weisse Fläche — bei Status 200 und passender
      // Länge, also ohne jeden Hinweis im Log.
      'Accept-Encoding': 'identity',
    },
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Encoding': 'identity',
    },
  ] as const;

  let attempt = 0;
  // Die jeweils laufende Anfrage festhalten — beim Rückfall ohne Referer ist
  // das nicht mehr die erste. Wird der Client-Abbruch behandelt, muss GENAU
  // diese beendet werden, sonst bleibt ihr Socket belegt.
  let activeReq: any = null;
  const fetchWith = (headers: OutgoingHttpHeaders) => (activeReq = https.get(url, { headers, agent: _cdnAgent }, r => {
    if (r.statusCode !== 200) {
      r.resume();
      // Erster Versuch fehlgeschlagen → einmal ohne Referer nachfassen, BEVOR
      // die Adresse als tot gilt. Cloudflare-Hotlink-Schutz antwortet auf einen
      // unpassenden Referer gern mit 404 statt 403.
      if (attempt === 0 && (r.statusCode === 404 || r.statusCode === 403)) {
        attempt = 1;
        const retry = fetchWith(HEADER_SETS[1]);
        retry.on('error', () => { if (!res.headersSent) res.status(502).end(); });
        retry.setTimeout(25000, () => { retry.destroy(); if (!res.headersSent) res.status(504).end(); });
        return;
      }
      // NUR 404 merken. 403 kommt beim CDN auch als Drosselung vor, wenn eine
      // Kachelwand viele Bilder gleichzeitig anfordert — die eine Stunde
      // auszusperren hiesse, dass Bilder "teilweise" fehlen, obwohl sie
      // existieren. Ein 403 wird deshalb beim nächsten Versuch neu geholt.
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
      // 404 ist kein Fehler, sondern eine Auskunft
      // Als `error` gemeldet, verstopft es das Protokoll genau dort, wo man
      // nach echten Stoerungen sucht — und gewoehnt einen daran, rote Zeilen
      // zu ueberblaettern. Alles ANDERE (403, 5xx, Zeitueberschreitung) bleibt …
      // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-meldung
      const meldung = `[img-proxy] CDN antwortete ${r.statusCode} (auch ohne Referer): ${url}`;
      if (r.statusCode === 404) console.info(meldung); else console.error(meldung);
      // statusCode ist laut Typ optional; fehlt er, ist 502 die ehrliche Auskunft.
      return r.statusCode === 404 ? sendePlatzhalter(res) : res.status(r.statusCode ?? 502).end();
    }
    const contentType = r.headers['content-type'] || 'image/jpeg';

    // Nur Bilder
    // Der Content-Type kam ungeprüft vom CDN und wurde so gesetzt UND im
    // Cache abgelegt. Die Host-Liste ist eng, aber auf den erlaubten CDNs
    // liegen teils von Nutzern hochgeladene Dateien: Käme dort ein SVG oder …
    // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-mime
    const mime = vorDem(contentType, ';').trim().toLowerCase();
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') {
      r.resume();
      imgProxyFailures.other++;
      imgProxyFailures.lastError = `Kein Bild (${mime}) — ${url}`;
      console.warn(`[img-proxy] Antwort ist kein Bild (${mime}): ${url}`);
      return res.status(415).end();
    }

    // Erwartete Länge merken: Nur eine vollständige Datei darf in den Cache.
    const expected = parseInt(String(r.headers['content-length'] || '0'), 10) || 0;
    res.setHeader('Content-Type', contentType);
    // Content-Length weiterreichen: Eine chunked-Antwort puffert ein
    // Reverse-Proxy davor womöglich, und der Browser wartet minutenlang.
    if (expected > 0) res.setHeader('Content-Length', String(expected));

    // Komprimierte Antworten werden ENTPACKT, nicht weitergereicht.
    // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-enc
    const enc = String(r.headers['content-encoding'] || '').toLowerCase();
    let body: any = r;
    if (enc === 'gzip' || enc === 'deflate' || enc === 'br') {
          const dec = enc === 'br' ? zlib.createBrotliDecompress()
                : enc === 'gzip' ? zlib.createGunzip()
                : zlib.createInflate();
      dec.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      body = r.pipe(dec);
      // Die angekündigte Länge gilt für den komprimierten Körper und stimmt
      // nach dem Entpacken nicht mehr.
      res.removeHeader('Content-Length');
      console.log(`[img-proxy] entpacke ${enc}: ${url}`);
    }

    // Wie viele Bytes gehen tatsächlich zum Client? Weicht das von der
    // angekündigten Länge ab, wartet der Browser auf den Rest und zeigt nichts.
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

    // Parallel auf Disk schreiben: erst in .tmp, bei Erfolg atomar umbenennen,
    // damit nie halbe Dateien im Cache landen. Max. 5 MB pro Bild.
    // Durchgehend async: mkdirSync/writeFileSync/renameSync haben hier den
    // Event-Loop blockiert, und zwar genau im heissen Pfad — ein frisch …
    // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-2
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      // Eindeutiger Name JE ANFRAGE, nicht nur je Prozess.
      // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-tmpfile
      const tmpFile = `${cacheFile}.tmp-${process.pid}-${_tmpSeq++}`;
      const ws = fs.createWriteStream(tmpFile);
      let bytes = 0, aborted = false;
      body.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > PROXY_CACHE_MAX_BYTES && !aborted) {
          aborted = true;
          ws.destroy();
          fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
          // Bisher geschah das STILL. Ein übergrosses Bild fiel damit in ein
          // schwarzes Loch: kein Cache, keine Vorschau, keine Spur im Log.
          imgProxyFailures.other++;
          imgProxyFailures.lastError = `zu gross für den Cache (> ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB): ${url}`;
          console.error(`[img-proxy] Bild grösser als ${Math.round(PROXY_CACHE_MAX_BYTES / 1024 / 1024)} MB — weder gecacht noch verkleinert: ${url}`);
        }
      });
      // Der ENTPACKTE Strom geht in den Cache — die Datei ist damit immer ein
      // echtes Bild, unabhängig davon, wie das CDN geliefert hat.
      body.pipe(ws);
      ws.on('finish', async () => {
          if (aborted) return;
          try {
            // Nur vollständige Dateien übernehmen. Eine abgeschnittene würde
            // dauerhaft ausgeliefert: Der Browser bekommt 200, kann das Bild
            // aber nicht dekodieren — die Kachel bleibt leer, ohne Fehler.
            const st = await fs.promises.stat(tmpFile);
            // Nach dem Entpacken passt die angekündigte Länge nicht mehr —
          // dann entfällt die Prüfung.
          if (!enc && expected > 0 && st.size !== expected) {
              console.error(`[img-proxy] unvollständig (${st.size}/${expected} Bytes), nicht gecacht: ${url}`);
              await fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink'));
              return;
            }
            await fs.promises.writeFile(cacheFile + '.ct', contentType);
            await fs.promises.rename(tmpFile, cacheFile);
            // Vorschau gleich miterzeugen: Sonst entstünde sie erst beim
            // zweiten Aufruf, dann für eine ganze Kachelwand auf einmal.
          if (wantThumb) { if (darfErzeugen) queueThumb(cacheFile, thumbFile); else notiere(); }
        } catch (_) { fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')); }
      });
      ws.on('error', () => fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('bild-proxy:unlink')));
    } catch (_) { /* Cache-Schreiben ist Best-Effort */ }

    // Bricht der Browser ab — beim Scrollen über verzögert geladene Bilder der
    // Normalfall —, muss die Verbindung zum CDN sofort freigegeben werden.
    // Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#bilddurchreichen-3
    res.on('close', () => {
      if (res.writableFinished || !res.destroyed) return;
      console.log(`[img-proxy] Client hat abgebrochen, Verbindung freigegeben: ${url}`);
      r.destroy();
      activeReq?.destroy();
    });

    body.pipe(res);
  }));
  // Erster Versuch mit vollem Kopfzeilen-Satz; der Rückfall ohne Referer
  // passiert oben im Antwort-Handler.
  const request = fetchWith(HEADER_SETS[0]);
  request.on('error', (e: any) => {
    imgProxyFailures.error++;
    imgProxyFailures.lastError = `${e.code || e.message} — ${url}`;
    console.error(`[img-proxy] Verbindungsfehler ${e.code || e.message}: ${url}`);
    if (!res.headersSent) res.status(502).end();
  });
  // 25 s statt 10 s: Durch den Pool stehen Anfragen jetzt an, statt sofort
  // eine eigene Verbindung zu bekommen. Die alte Grenze hätte genau die
  // wartenden abgeschnitten.
  request.setTimeout(25000, () => {
    request.destroy();
    imgProxyFailures.timeout++;
    imgProxyFailures.lastError = `timeout — ${url}`;
    console.error(`[img-proxy] Zeitüberschreitung nach 25 s: ${url}`);
    if (!res.headersSent) res.status(504).end();
  });
}

/**
 * Die Route anmelden — unter BEIDEN Adressen. Der Ablauf steht in
 * bildDurchreichen().
 * Ausführlich: docs/begruendungen/routes/imgProxy.ts.md#registerimgproxy
 */
function registerImgProxy(app: Express) {
  app.get(IMG_PROXY_PFAD, bildDurchreichen);
  app.get(IMG_PROXY_PFAD_ALT, bildDurchreichen);
}

export { registerImgProxy };

/**
 * Setnummer aus einer Rebrickable-Set-Adresse, sonst null. Das geladene Bild
 * wird unter dieser Nummer für alle Konten abgelegt; deshalb zählt nur der
 * ganze Pfad ohne Anfrageteil, sonst legte `…/parts/x.png?/media/sets/10294-1.jpg`
 * ein fremdes Bild als Set ab.
 */
export function setNummerAusBildAdresse(adresse: string): string | null {
  let u: URL;
  try { u = new URL(adresse); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'cdn.rebrickable.com' || u.search || u.hash) return null;
  const m = /^\/media\/sets\/([A-Za-z0-9-]{1,40})\.(?:jpg|jpeg|png|webp)$/i.exec(u.pathname);
  return m?.[1] ?? null;
}
