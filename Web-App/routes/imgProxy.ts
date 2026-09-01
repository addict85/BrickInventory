/**
 * Bild-Proxy für fremde CDNs.
 *
 * ── Warum ein eigenes Modul ─────────────────────────────────────────────────
 * Das hier stand als rund 440-Zeilen-Block mitten in server.ts, zwischen
 * Session-Aufbau und Cluster-Orchestrierung. server.ts war damit auf über
 * 1200 Zeilen angewachsen und vermischte drei unabhängige Zuständigkeiten.
 * Der Proxy ist in sich geschlossen — eine Route, ein Plattencache, eine
 * Vorschau-Warteschlange — und gehört deshalb hierher.
 *
 * ── Was er tut ──────────────────────────────────────────────────────────────
 * Rebrickable liefert seine Bilder über Cloudflare mit Hotlink-Schutz; direkt
 * aus dem Browser geladen kommen sie teils als 404 zurück. Der Server holt sie
 * deshalb selbst (mit passenden Kopfzeilen), legt sie unter
 * data/img_proxy_cache ab und liefert sie von dort aus — jedes Bild also
 * genau einmal vom CDN.
 *
 * Zugriffsschutz: Ohne Anmeldung wäre die Route ein offener Proxy (fremde
 * Bandbreite, IP-Verschleierung). Die Ziel-Hosts sind zusätzlich auf eine
 * Allowlist beschränkt.
 */
import path from 'path';
import { APP_ROOT, DATA_DIR, PUBLIC_DIR } from '../utils/appPaths';
import fs from 'fs';
import { resolveUserId } from '../utils/auth';
import { streamFileToResponse, vorDem } from '../utils/httpError';
import { queueThumb, drainThumbQueue, mitVorschauSperre, makeProxyThumb, PROXY_THUMB_SIZE } from '../utils/proxyThumbs';
import { liefereAusCache } from '../utils/imgCacheServe';
import { imgProxyFailures } from '../utils/imgProxyStats';
import { istBekanntFehlend, merkeFehlend } from '../utils/imageMisses';
import type { Request, Response, Express } from 'express';
import type { OutgoingHttpHeaders } from 'http';
import crypto from 'crypto';
import https from 'https';
import zlib from 'zlib';
import { merkeGebraucht } from '../jobs/imageQueue';

// ── Warum diese vier jetzt oben stehen (Nachtrag 155) ────────────────────────
//
// Sie standen als require() in den Funktionsruempfen. Node haelt Module im
// Cache, die Laufzeitkosten waren also gering — der Preis war ein anderer:
// Die Abhaengigkeiten einer Datei standen nicht mehr an ihrem Kopf, und ein
// require() ohne Typdeklaration liefert `any`. Damit war jeder Aufruf darauf
// ungeprueft, in einer Datei, die Bilder von fremden Hosts holt.
//
// Geprueft, dass kein Ladezyklus entsteht: ../jobs/imageQueue importiert nicht
// (auch nicht ueber Umwege) auf routes/imgProxy zurueck.

/**
 * Wurzelverzeichnis der Anwendung.
 *
 * ACHTUNG beim Verschieben von Code: Im ursprünglichen server.ts zeigte
 * __dirname auf die Wurzel, hier zeigt es auf routes/. Ohne diese Konstante
 * landete der Plattencache in routes/data/img_proxy_cache — ausserhalb des
 * gemounteten data-Volumes, also bei jedem Container-Neustart leer und mit
 * jedem Bild erneut vom CDN geholt. Ein Fehler, der nichts kaputtmacht und
 * genau deshalb monatelang unbemerkt bliebe.
 */


/**
 * Registriert die Proxy-Route und den Aufräum-Timer an der übergebenen App.
 *
 * Bewusst eine Registrierfunktion statt eines Express-Routers: Die Route hängt
 * absolut unter /api/img-proxy, und der Aufräum-Timer soll genau einmal pro
 * Worker gestartet werden — beides ist an dieser einen Stelle sichtbar.
 *
 * @param {any} app Express-Anwendung
 */
// ═══════════════════════════════════════════════════════════════════════════
// Gemeinsamer Zustand und Helfer des Bild-Proxys
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Warum das nicht mehr in registerImgProxy steht (Nachtrag 148) ───────────
// registerImgProxy() war 458 Zeilen: Zustand, Helfer und der komplette
// Anfrage-Ablauf lagen als Verschluss (Closure) IN der Anmeldefunktion. Das
// hatte zwei praktische Folgen. Erstens war die Funktion nur als Ganzes zu
// lesen — wer wissen wollte, was bei einer Anfrage passiert, scrollte an
// hundert Zeilen Aufbau vorbei. Zweitens war nichts davon von aussen
// erreichbar: Ein Test konnte den Ablauf nicht aufrufen, nur den Quelltext
// danach absuchen.
//
// Am Verhalten ändert die Verschiebung nichts. Der Zustand ist derselbe wie
// vorher pro Prozess einmal vorhanden — registerImgProxy() wird je Worker
// genau einmal aufgerufen.
// Proxy CDN images to avoid hotlink protection
/**
 * Verkleinerte Fassung eines bereits zwischengespeicherten Proxy-Bildes.
 * Gleiche Grösse und Qualität wie routes/thumbs.ts, damit lokale und
 * proxied Bilder gleich aussehen. Transparente PNGs bekommen weissen Grund.
 */
/**
 * Obergrenze für den Bild-Zwischenspeicher des Proxys.
 *
 * ── Warum 20 statt 5 MB (Nachtrag 43, Marcos Fund) ─────────────────────────
 * Marcos Kachel für Set 60445-1 blieb leer, und der direkte Aufruf der
 * Proxy-Adresse lud „endlos", ohne das Bild je vollständig zu zeigen. Sein
 * Netzwerk-Protokoll nannte die Zahl, die den Fall löst: 5'243 kB übertragen —
 * knapp ÜBER der damaligen 5-MB-Grenze.
 *
 * Die Grenze bricht nur den CACHE-Strom ab, nicht die Auslieferung. Die Folge
 * war deshalb nicht „kein Bild", sondern etwas Zäheres:
 *   • `aborted` verhindert das rename → die Datei landet NIE im Cache
 *   • queueThumb() steht hinter diesem rename → es entsteht NIE eine Vorschau
 *   • jede Kachel holt daraufhin bei JEDEM Aufruf erneut die vollen 5 MB vom
 *     CDN, mehrfach parallel, während die Kachelwand lädt
 * Für ein einzelnes Bild wiederholt sich das bis in alle Ewigkeit, und genau
 * das sah aus wie „lädt endlos".
 *
 * Rebrickable liefert für neuere Sets Bilder in hoher Auflösung; 5 MB waren zu
 * knapp bemessen. 20 MB decken diese Fälle ab und bleiben weit unter dem, was
 * dem Plattenplatz wehtut — der Aufräumlauf begrenzt den Cache ohnehin. Und
 * gerade bei grossen Bildern ist die Vorschau am wertvollsten: Sie ersetzt in
 * der Kachel mehrere Megabyte durch wenige Kilobyte.
 */
const PROXY_CACHE_MAX_BYTES = 20 * 1024 * 1024;


/** URLs, die das CDN mit 404/403 beantwortet hat → cacheKey → Zeitpunkt. */
const _imgNegCache = new Map();
/** Laufende Nummer für Temp-Dateien des Bild-Proxys (siehe tmpFile unten). */
let _tmpSeq = 0;

/**
 * Zähler für fehlgeschlagene Proxy-Abrufe, abrufbar über
 * GET /api/v1/admin/img-probe (Feld `failures`).
 *
 * Grund: „Bilder erscheinen teilweise nicht" liess sich mehrfach nicht
 * eingrenzen, weil im Log nichts stand. Jetzt ist ablesbar, OB und WOMIT der
 * Proxy scheitert — Zeitüberschreitung, Verbindungsfehler oder 404 vom CDN.
 */

// Der globale Ablageplatz entfällt: Der Zähler ist seit Nachtrag 129 ein
// eigenes Modul (utils/imgProxyStats.ts), das die Monitoring-Route direkt
// importiert.

/**
 * Verbindungs-Pool für CDN-Abrufe.
 *
 * Die Obergrenze schützt den Server davor, bei einer Kachelwand beliebig viele
 * gleichzeitige TLS-Verbindungen zu öffnen.
 *
 * ── Zur Wahl von 32 ────────────────────────────────────────────────────────
 * Mit 8 war die Grenze zu eng: Ein einzeln geöffnetes Bild reihte sich hinter
 * die laufenden Kachel-Anfragen und wartete messbar mit — nachgestellt 1199 ms
 * gegenüber 152 ms ohne Begrenzung. Eine Kachelwand fordert rund 60 Bilder an;
 * mit 32 laufen sie in zwei Wellen statt in acht, und eine einzelne Anfrage
 * wartet höchstens eine Antwortzeit.
 *
 * Wichtig dazu: `res.on('close')` weiter unten gibt die Verbindung frei, sobald
 * der Browser abbricht. Ohne das belegten abgebrochene Anfragen ihren Platz und
 * die Warteschlange verhungerte — das war der eigentliche Schaden der ersten
 * Fassung, nicht die Grenze selbst.
 */
const _cdnAgent = new (require('https').Agent)({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 30000,
  // IPv4 erzwingen. Mehrere VÖLLIG unterschiedliche Set-Nummern liefen alle
  // exakt bis zur eingestellten 25-Sekunden-Grenze, ohne je eine Antwort zu
  // bekommen — kein TCP-Reset, kein Fehler, einfach nichts. Das ist das
  // typische Bild einer kaputten oder nicht gerouteten IPv6-Verbindung des
  // Hosters: Node versucht zuerst eine IPv6-Adresse von Cloudflares Edge,
  // der Verbindungsaufbau dorthin hängt lautlos, und ohne funktionierendes
  // Happy-Eyeballs-Verhalten (RFC 8305) wird nie auf IPv4 zurückgewichen,
  // bevor der EIGENE Timeout zuschlägt. Rebrickable/Cloudflare unterstützen
  // IPv4 zuverlässig; das Erzwingen kostet nichts, wenn IPv6 ohnehin nicht
  // funktioniert, und ändert nichts, wenn es funktioniert.
  family: 4,
});

// Die Vorschau-Maschinerie (Warteschlange, prozessübergreifende Sperre,
// Verkleinern) liegt seit Nachtrag 129 in utils/proxyThumbs.ts.

/**
 * „Dieses Bild gibt es nicht" — und der Browser darf sich das merken.
 *
 * ── Marcos Konsole ────────────────────────────────────────────────────────
 * Dieselbe Adresse mehrfach hintereinander mit 404, etwa
 * `9780241838570-1.jpg` gleich zweimal.
 *
 * Ein 404 OHNE Cache-Control ist für den Browser nicht zwischenspeicherbar:
 * Er fragt bei jedem Rendern der Kachel erneut. Beim Blättern durch alte
 * Jahrgänge, wo fast jedes Bild fehlt, ist das ein voller Satz Anfragen je
 * Bildschirm — bis zum Server, dort in den Merker und wieder zurück.
 *
 * Eine Stunde ist bewusst kurz gewählt: Wird ein Bild nachgereicht, soll es
 * nicht einen Tag lang unsichtbar bleiben. Der SERVER merkt sich die
 * Fehlanzeige länger (utils/imageMisses, sieben Tage) — dort kostet ein
 * erneuter Versuch ja auch mehr.
 */
function sende404(res: Response) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.status(404).end();
}


/**
 * Ein CDN-Bild ausliefern: aus dem Plattencache, sonst vom CDN geholt und
 * dabei abgelegt.
 *
 * Der eigentliche Ablauf, herausgelöst aus registerImgProxy(). Die Funktion
 * antwortet selbst (res) und gibt nichts zurück.
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
  // Nur bekannte Bild-CDNs — Liste und Prüfung siehe unten (isAllowedImageHost).
  try { if (!isAllowedImageHost(url)) return res.status(403).end(); } catch(_) { return res.status(400).end(); }
  // Disk-Cache: jedes CDN-Bild wird serverseitig nur einmal geholt.
  // Schlüssel = SHA1 der URL; Content-Type als Sidecar-Datei (.ct).
  const cacheDir  = path.join(APP_ROOT, 'data', 'img_proxy_cache');
  const cacheKey  = crypto.createHash('sha1').update(url).digest('hex');
  const cacheFile = path.join(cacheDir, cacheKey);
  // ?thumb=1 — verkleinerte Fassung ausliefern.
  //
  // Teilebilder kommen ausschliesslich vom Rebrickable-CDN und laufen deshalb
  // über diesen Proxy. thumbUrl() im Client konnte für sie bisher nichts tun
  // ("_thumb"-Varianten gibt es auf dem CDN nicht), also bekam eine Kachelwand
  // von 100 Teilen 100 Bilder in voller Auflösung — bei 40–100 px Anzeigegrösse.
  // Das ist der Grund, warum die Teile sichtbar nachtröpfeln.
  //
  // Der Proxy hält das Original ohnehin auf Platte; die Verkleinerung entsteht
  // einmalig daraus und liegt daneben. Beim ersten Aufruf eines noch nie
  // geholten Bildes kostet es weiterhin den CDN-Roundtrip — danach nicht mehr.
  const wantThumb = req.query.thumb === '1';
  // gen=0: Die ANFRAGE rechnet nichts. Statt die Verkleinerung sofort
  // anzustossen, hinterlässt sie eine Notiz — abgearbeitet wird sie vom
  // Hintergrund-Job (jobs/imageQueue.ts), gedrosselt und nur auf dem
  // Primärprozess.
  //
  // Marcos Vorgabe: „Bitte die Bilder im Hintergrund mit dem
  // Bilder-Download-Job herunterladen und das Thumb erstellen, sobald sie
  // einmal via Proxy geladen wurden."
  //
  // Ausgeliefert wird trotzdem sofort: die Vorschau, wenn es sie schon gibt,
  // sonst das Original.
  const darfErzeugen = req.query.gen !== '0';
  /** Setnummer aus einer Rebrickable-Set-Adresse, sonst null. */
  const setAusUrl = () => {
    const m = /\/media\/sets\/([^/?#]+?)\.(?:jpg|jpeg|png|webp)/i.exec(String(url || ''));
    return m ? m[1] : null;
  };
  const notiere = () => {
    const sn = setAusUrl();
    if (sn) merkeGebraucht(String(url), sn);
  };
  const thumbFile = cacheFile + '_thumb.jpg';

  // Cache-Treffer (Original oder Verkleinerung) — seit Nachtrag 135 in
  // utils/imgCacheServe.ts. `true` heisst: beantwortet, hier ist Schluss.
  if (await liefereAusCache({
    res, req, cacheFile, thumbFile, wantThumb, darfErzeugen, notiere, streamFileToResponse,
  })) return;

  // Negativ-Cache: Fehlt ein Bild beim CDN (404), holt der Browser es bei jedem
  // Seitenaufruf erneut — und jedes Mal geht ein Roundtrip zum CDN raus. Der
  // Merker beantwortet den zweiten und jeden weiteren Versuch sofort.
  // Eine Stunde, damit ein nachgereichtes Bild nicht dauerhaft ausgesperrt wird.
  // 15 Minuten statt einer Stunde: lang genug, um wiederholte Roundtrips beim
  // Durchblättern zu sparen, kurz genug, dass ein nachgereichtes Bild bald
  // wieder erscheint.
  // Der Merker liegt seit Nachtrag 98 in der DATENBANK: Der Server läuft im
  // Cluster, und ein Gedächtnis je Prozess liess dasselbe fehlende Bild
  // einmal PRO PROZESS holen — nach einem Neustart erneut, und nach fünfzehn
  // Minuten wieder. In den alten Jahrgängen, wo fast jedes Bild fehlt, war
  // das der Grossteil der Last.
  // Synchron und ohne Datenbank (Nachtrag 103): Bildanfragen sind der
  // häufigste Vorgang der Anwendung; eine Abfrage je Bild leerte den
  // Verbindungspool und liess ANDERE Routen in den Zeitfehler laufen.
  if (istBekanntFehlend(cacheKey)) return sende404(res);


  // Zwei Kopfzeilen-Sätze. Der erste imitiert einen Browser auf rebrickable.com;
  // der zweite lässt Referer und Accept-Language weg.
  //
  // Grund: Bilder, die im Browser direkt laden, kamen über den Proxy als 404
  // zurück. Vor dem CDN steht Cloudflare, und Hotlink-Schutz antwortet auf
  // einen Referer, der nicht zur anfragenden IP passt, gern mit 404 statt 403 —
  // die Regel soll sich nicht verraten. Ein zweiter Versuch ohne Referer
  // klärt das: Klappt er, war es der Hotlink-Schutz; bleibt es bei 404, fehlt
  // das Bild wirklich.
  // `as const` macht daraus ein Tupel fester Laenge: `HEADER_SETS[0]` ist
  // dann ein echtes Element, keine Index-Signatur, die leer sein koennte.
  // Dieselbe Ursache wie bei PFADE in scripts/loadtest.js — an EINER
  // Stelle behoben statt an zwei Zugriffen abgesichert.
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
      console.error(`[img-proxy] CDN antwortete ${r.statusCode} (auch ohne Referer): ${url}`);
      // ?? 502: r.statusCode ist auf Nodes IncomingMessage `number | undefined`
      // — dieselbe Schnittstelle dient auch eingehenden Anfragen, wo es fehlt.
      // Bei einer Client-Antwort ist es in der Praxis immer gesetzt; faellt es
      // doch aus, ist "Bad Gateway" die ehrliche Auskunft. Vorher waere hier
      // res.status(undefined) gelaufen — das wirft.
      return r.statusCode === 404 ? sende404(res) : res.status(r.statusCode ?? 502).end();
    }
    const contentType = r.headers['content-type'] || 'image/jpeg';

    // ── Nur Bilder ──────────────────────────────────────────────────────
    //
    // Der Content-Type kam ungeprüft vom CDN und wurde so gesetzt UND im
    // Cache abgelegt. Die Host-Liste ist eng, aber auf den erlaubten CDNs
    // liegen teils von Nutzern hochgeladene Dateien: Käme dort ein SVG oder
    // HTML zurück, läge es anschliessend unter der EIGENEN Herkunft — und
    // ein SVG ist ein Dokument, das Skript enthalten kann. nosniff und die
    // CSP fangen den Ernstfall ab; eine Route namens img-proxy sollte
    // trotzdem nichts anderes als ein Bild ausliefern.
    //
    // SVG ist bewusst NICHT erlaubt: Es ist das einzige Bildformat, das als
    // Dokument geöffnet aktiv wird, und keines der angebundenen CDNs liefert
    // Teile- oder Setbilder als SVG.
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
    // Content-Length weiterreichen, wenn das CDN sie kennt.
    //
    // Ohne sie geht die Antwort als chunked raus. Ein Reverse-Proxy davor kann
    // eine solche Antwort puffern, statt sie durchzureichen — der Browser sieht
    // dann minutenlang eine weisse Seite, obwohl der Inhalt längst da ist.
    // Beim zweiten Aufruf kommt das Bild sofort, weil es dann aus dem
    // Plattencache mit bekannter Länge geliefert wird. Genau dieses Muster war
    // zu beobachten.
    if (expected > 0) res.setHeader('Content-Length', String(expected));

    // Komprimierte Antworten werden ENTPACKT, nicht weitergereicht.
    //
    // Wir fordern zwar `Accept-Encoding: identity` an, aber nicht jedes CDN
    // hält sich daran. Ein durchgereichter komprimierter Körper mit
    // Content-Type: image/jpeg ergibt beim Browser eine weisse Fläche — bei
    // Status 200 und passender Länge, also ohne Hinweis im Log.
    //
    // Weitergabe der Kopfzeile wäre die andere Möglichkeit, ist aber
    // zerbrechlicher: Ein Reverse-Proxy dazwischen kann sie entfernen oder den
    // Körper anfassen, und im Plattencache läge dann komprimierter Inhalt, der
    // beim nächsten Ausliefern erneut Kopfzeilen bräuchte. Entpacken macht die
    // gespeicherte Datei zu einem echten Bild — unabhängig von allem davor.
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
    // Kürzer und mit Pflicht zur Rückfrage: Diese Antwort wird gestreamt, ihr
    // Inhalt ist also noch nicht überprüft. Wäre etwas daran faul, nagelte ein
    // langes max-age den Fehler für einen Tag im Browser fest — und die
    // Anfrage erreicht den Server dann gar nicht mehr („200 from disk cache").
    // Genau so überlebten kaputte Antworten aus behobenen Fehlern.
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');

    // Parallel auf Disk schreiben: erst in .tmp, bei Erfolg atomar umbenennen,
    // damit nie halbe Dateien im Cache landen. Max. 5 MB pro Bild.
    // Durchgehend async: mkdirSync/writeFileSync/renameSync haben hier den
    // Event-Loop blockiert, und zwar genau im heissen Pfad — ein frisch
    // geöffneter Katalog-Screen lädt bis zu 60 Bilder hintereinander, alle
    // davon Cache-Miss.
    // WICHTIG: Der Cache-Stream muss VOR r.pipe(res) hängen. Vorher stand
    // r.pipe(ws) hinter einem `await mkdir` — die Antwort lief da bereits zum
    // Client, und die Datei auf Platte konnte die ersten Bytes verlieren.
    // mkdir daher synchron (einmalig, danach ist das Verzeichnis da).
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      // Eindeutiger Name JE ANFRAGE, nicht nur je Prozess.
      //
      // Vorher hiess die Datei nur `.tmp-<pid>`. Fordert eine Kachelwand
      // dasselbe Bild mehrfach gleichzeitig an — was bei Minifiguren
      // regelmässig passiert —, schrieben alle Anfragen desselben Workers in
      // DIESELBE Datei. Das Ergebnis war das Bild mehrfach hintereinander:
      // gemessen 418'603 statt 81'920 Bytes, also gut fünf Kopien. Solche
      // Dateien beginnen korrekt mit FFD8 und enden auf FFD9 — sie fallen
      // weder beim Streamen noch bei einer reinen Endmarken-Prüfung auf, der
      // Browser kann sie aber nicht dekodieren.
      const tmpFile = `${cacheFile}.tmp-${process.pid}-${_tmpSeq++}`;
      const ws = fs.createWriteStream(tmpFile);
      let bytes = 0, aborted = false;
      body.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > PROXY_CACHE_MAX_BYTES && !aborted) {
          aborted = true;
          ws.destroy();
          fs.promises.unlink(tmpFile).catch(() => {});
          // Bisher geschah das STILL. Ein übergrosses Bild fiel damit in ein
          // schwarzes Loch: kein Cache, keine Vorschau, keine Spur im Log
          // (Nachtrag 43).
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
              await fs.promises.unlink(tmpFile).catch(() => {});
              return;
            }
            await fs.promises.writeFile(cacheFile + '.ct', contentType);
            await fs.promises.rename(tmpFile, cacheFile);
            // Vorschau GLEICH miterzeugen, nicht erst beim nächsten Aufruf.
            //
            // Vorher entstand sie ausschliesslich im Cache-Hit-Zweig — also
            // frühestens beim zweiten Seitenaufruf, und dann für alle Bilder
            // einer Kachelwand gleichzeitig. Die erste Ansicht hatte damit
            // gar keinen Nutzen von der Verkleinerung, die zweite bezahlte
            // sie in einem Rutsch.
          if (wantThumb) { if (darfErzeugen) queueThumb(cacheFile, thumbFile); else notiere(); }
        } catch (_) { fs.promises.unlink(tmpFile).catch(() => {}); }
      });
      ws.on('error', () => fs.promises.unlink(tmpFile).catch(() => {}));
    } catch (_) { /* Cache-Schreiben ist Best-Effort */ }

    // Bricht der Browser ab — beim Scrollen über verzögert geladene Bilder der
    // Normalfall —, muss die Verbindung zum CDN sofort freigegeben werden.
    //
    // Ohne das blieb der Socket belegt: Der Antwort-Stream lief in ein totes
    // res, die Gegendruck-Steuerung hielt ihn an, und mit maxSockets: 8 waren
    // nach wenigen Abbrüchen alle Plätze blockiert. Nachfolgende Anfragen
    // standen dann bis zur 25-Sekunden-Grenze in der Warteschlange — genau die
    // `timeout`-Zähler aus der Diagnose.
    // Abbruch durch den Client: Verbindung freigeben — aber NUR bei einem
    // echten Abbruch.
    //
    // Vorher stand hier `if (!res.writableFinished)`. Das ist zu scharf: Je
    // nachdem, was zwischen Server und Browser sitzt, kann `close` feuern,
    // bevor Node `writableFinished` gesetzt hat. Dann wurde eine völlig
    // gesunde Übertragung mittendrin abgeschossen — der Client bekam die
    // Kopfzeilen mit Status 200 und danach nichts mehr, der Cache-Stream lief
    // nie zu Ende, und protokolliert wurde nichts. Genau dieses Bild:
    // 200, weisse Seite, leerer Cache, stilles Log.
    //
    // `res.destroyed` ist der belastbare Hinweis auf einen Abbruch: Bei einer
    // regulär beendeten Antwort ist es false.
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

/** Die Route anmelden. Der Ablauf steht in bildDurchreichen(). */
function registerImgProxy(app: Express) {
  app.get('/api/img-proxy', bildDurchreichen);
}

/**
 * Img-Proxy-Cache aufräumen: Dateien, die 30 Tage nicht angefasst wurden,
 * löschen — sonst wächst data/img_proxy_cache unbegrenzt.
 *
 * ── Warum das nicht mehr in registerImgProxy steht ──────────────────────────
 * Dort lief es in JEDEM Cluster-Worker: registerImgProxy(app) wird von jedem
 * Prozess aufgerufen, und jeder legte sein eigenes tägliches Intervall an. Bei
 * acht Workern hiess das acht vollständige Durchläufe über das
 * Cache-Verzeichnis (readdir plus stat je Datei) und acht Prozesse, die sich
 * beim unlink gegenseitig ins Gehege kamen — unbemerkt, weil die Fehler
 * ohnehin verworfen werden.
 *
 * Alle übrigen wiederkehrenden Arbeiten (Preis-Job, Token-Aufräumen,
 * Log-Bereinigung) hängen längst hinter isPrimaryWorker. Diese gehört dazu.
 *
 * Bewusst KEIN Aufräumen beim Start: Ein Neustart soll schnell antworten
 * können, und einen Tag länger im Cache schadet nichts.
 */
export function startImgCacheCleanup() {
  const lauf = () => {
    const cacheDir = path.join(APP_ROOT, 'data', 'img_proxy_cache');
    fs.readdir(cacheDir, (err, files) => {
      if (err) return;
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const f of files) {
        const p = path.join(cacheDir, f);
        fs.stat(p, (e, st) => {
          // atime UND mtime: Wird das Dateisystem mit noatime eingehängt (in
          // Containern verbreitet), bleibt atime auf dem Erstellungszeitpunkt
          // stehen — dann entscheidet mtime, und beides muss alt sein.
          if (!e && st.isFile() && st.atimeMs < cutoff && st.mtimeMs < cutoff) fs.unlink(p, () => {});
        });
      }
    });
  };
  return setInterval(lauf, 24 * 60 * 60 * 1000).unref();
}

/**
 * Hosts, von denen der Server Bilder holen darf.
 *
 * Wird an ZWEI Stellen gebraucht: vom Bild-Proxy selbst und von der
 * Diagnoseroute GET /api/v1/admin/img-probe. Dort stand bisher eine Kopie
 * derselben Liste — die Sorte Duplikat, die beim nächsten hinzugefügten CDN
 * genau an einer der beiden Stellen nachgezogen wird. Deshalb hier einmal,
 * exportiert.
 */
const ALLOWED_IMAGE_HOSTS = [
  'cdn.rebrickable.com', 'rebrickable.com',
  'images.brickset.com',
  'www.bricklink.com', 'img.bricklink.com',
];

/**
 * Darf diese URL vom Server abgerufen werden?
 *
 * Exakter Host-Treffer oder echte Subdomain. Ein blosses host.endsWith(h)
 * würde auch "evil-rebrickable.com" durchlassen — daher der Punkt davor.
 *
 * @param {string} url
 * @returns {boolean}
 * @throws wenn die URL nicht parsebar ist (Aufrufer entscheidet: 400)
 */
function isAllowedImageHost(url: string): boolean {
  const host = new URL(url).hostname;
  return ALLOWED_IMAGE_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

/**
 * Wo läge das Bild dieser CDN-Adresse im Proxy-Cache?
 *
 * Die Regel (SHA1 der Adresse, Ablage unter data/img_proxy_cache) stand bisher
 * NUR mitten in der Route. Für die Bild-Diagnose (Nachtrag 50) wird sie von
 * aussen gebraucht — und eine zweite, abgeschriebene Fassung anderswo wäre
 * genau die Sorte Duplikat, die irgendwann auseinanderläuft und dann falsche
 * Auskunft gibt.
 */
function proxyCachePathFor(url: string): string | null {
  if (!url) return null;
  return path.join(APP_ROOT, 'data', 'img_proxy_cache',
    crypto.createHash('sha1').update(url).digest('hex'));
}

export { registerImgProxy, isAllowedImageHost, ALLOWED_IMAGE_HOSTS, proxyCachePathFor };
