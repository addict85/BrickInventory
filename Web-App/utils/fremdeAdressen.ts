/**
 * Welche fremden Adressen darf der Server abrufen — und was gilt bei einer
 * Umleitung?
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 *
 * Der Baum hatte die Regel schon, nur nicht überall:
 *
 *   • routes/imgProxy.ts prüft die Zieladresse gegen eine Allowlist und holt
 *     sie mit `https.get` — und das folgt von sich aus KEINER Umleitung.
 *   • Die Android-App baut ihren Update-Client mit `followSslRedirects(false)`.
 *   • clients/rebrickable.ts folgt Umleitungen dagegen von Hand, an ZWEI
 *     Stellen, und prüfte dabei nichts.
 *
 * Das ist die Bauart von Fehler, gegen die dieses Projekt sonst überall
 * angeht: eine Regel in mehreren Schreibweisen, von denen nur eine bekannt
 * ist. Deshalb steht sie jetzt hier — einmal, für beide Seiten.
 *
 * ── Was an einer ungeprüften Umleitung gefährlich ist ───────────────────────
 *
 * 1. DER SCHLÜSSEL WANDERT MIT. Neun der zwölf Aufrufer von httpsGetRobust
 *    schicken `Authorization: key <REBRICKABLE_API_KEY>`. Beim Folgen wurde
 *    der Kopf unverändert weitergereicht — eine Umleitung auf einen fremden
 *    Host bekam damit den Schlüssel. Browser und curl werfen ihn bei einem
 *    Hostwechsel ab; genau das tut [naechsteUmleitung] jetzt auch.
 *
 * 2. HTTPS → HTTP. Beide Stellen wählten die Bibliothek nach dem Schema
 *    `protocol === 'https:' ? https : http`. Eine Umleitung von https auf http
 *    gab denselben Schlüssel im Klartext preis. Ein Downgrade wird nicht mehr
 *    befolgt.
 *
 * 3. KEIN ENDE. httpsGetRobust hatte gar keinen Umleitungszähler (`attempts`
 *    wird zwar hochgezählt, aber nur bei 429, Timeout und ECONNRESET
 *    geprüft). Eine Schleife A→B→A lief unbegrenzt — auslösbar allein vom
 *    fremden Server.
 *
 * 4. DAS ZIEL IST BELIEBIG. downloadFile legt die geholte Datei unter
 *    data/instructions/ ab, wo sie jeder angemeldete Nutzer abrufen kann. Ein
 *    Umleitungsziel wie http://127.0.0.1:… wurde also geholt UND
 *    zurückgegeben. Deshalb prüft dieser Weg zusätzlich den HOST — nicht nur
 *    am Anfang, sondern bei jedem Sprung.
 */

/**
 * Hosts, von denen der Server BILDER holen darf.
 *
 * Stand bis hierher in routes/imgProxy.ts. Verschoben, weil sie inzwischen
 * drei Nutzer hat (Bild-Proxy, die Diagnoseroute in routes/api_v1/admin.ts und
 * der Dateidownload in clients/rebrickable.ts) — und eine Liste, die aus einer
 * ROUTE importiert wird, zieht Abhängigkeiten in die falsche Richtung.
 */
export const ERLAUBTE_BILD_HOSTS = [
  'cdn.rebrickable.com', 'rebrickable.com',
  'images.brickset.com',
  'www.bricklink.com', 'img.bricklink.com',
];

/**
 * Hosts, von denen der Server DATEIEN auf die Platte holen darf.
 *
 * Die Bild-Hosts plus lego.com — dort liegen die Anleitungs-PDFs.
 *
 * `assets.lego.com` steht NICHT eigens dabei: [hostErlaubt] lässt echte
 * Subdomains ohnehin durch, und derselbe Host zweimal wäre genau die Sorte
 * Doppelung, die später an einer der beiden Stellen nachgezogen wird.
 *
 * ── Was diese Liste nebenbei mitrepariert ───────────────────────────────────
 * scrapeInstructions() sammelt Adressen mit
 * `/href="(https?:\/\/[^"]*lego\.com[^"]*\.pdf[^"]*)"/`. Dieses Muster trifft
 * auch `https://lego.com.angreifer.tld/x.pdf` und `https://evil-lego.com/x.pdf`
 * — es prüft eine Teilzeichenkette, keinen Host. Die Prüfung am HOLENDEN Ende
 * fängt das mit ab, und zwar unabhängig davon, wie die Adresse dorthin kam.
 */
export const ERLAUBTE_DOWNLOAD_HOSTS = [...ERLAUBTE_BILD_HOSTS, 'lego.com'];

/**
 * Darf diese Adresse abgerufen werden?
 *
 * Exakter Host-Treffer oder echte Subdomain. Ein blosses `host.endsWith(h)`
 * liesse auch "evil-rebrickable.com" durch — daher der Punkt davor. Dieselbe
 * Falle wie beim Bearer-Token der App (util/NetworkPolicy.kt) und bei der
 * Update-Adresse (util/AppUpdate.kt); sie ist in diesem Baum schon dreimal
 * aufgetreten.
 *
 * @param url  vollständige Adresse
 * @param liste  eine der beiden Listen oben
 * @returns false, wenn die Adresse nicht parsebar ist — im Zweifel NICHT holen
 */
export function hostErlaubt(url: string, liste: readonly string[]): boolean {
  let host: string;
  try { host = new URL(url).hostname; } catch { return false; }
  return liste.some(h => host === h || host.endsWith('.' + h));
}

/**
 * Wie viele Umleitungen höchstens befolgt werden.
 *
 * Fünf ist der Wert, den downloadFile schon hatte; httpsGetRobust hatte gar
 * keinen. Übernommen statt neu erfunden — eine Zahl, die aus dem Baum kommt,
 * muss niemand rechtfertigen.
 */
export const UMLEITUNGS_GRENZE = 5;

/** Was [naechsteUmleitung] zurückgibt, wenn der Sprung erlaubt ist. */
export interface Umleitungsziel {
  url: string;
  kopfzeilen: Record<string, string>;
}

/**
 * Den nächsten Sprung prüfen und vorbereiten — oder ablehnen.
 *
 * @param von         die Adresse, die umgeleitet hat (für relative Ziele)
 * @param location    der Location-Kopf der Antwort
 * @param kopfzeilen  die bisher geschickten Kopfzeilen
 * @param erlaubteHosts  gesetzt: der Zielhost wird geprüft. Weggelassen: nicht.
 *                    Der Dateidownload prüft (die Datei wird ausgeliefert), die
 *                    API-Abrufe nicht — deren Ausgangsadressen sind fest, und
 *                    eine Liste mit geratenen Hosts wäre schlechter als keine.
 * @returns null, wenn nicht gefolgt werden darf
 */
export function naechsteUmleitung(
  von: string,
  location: string | undefined,
  kopfzeilen: Record<string, string>,
  erlaubteHosts?: readonly string[],
): Umleitungsziel | null {
  if (!location) return null;

  // Relativ auflösen: Ein Location-Kopf DARF ein blosser Pfad sein (RFC 9110).
  // Vorher lief ein relatives Ziel in `new URL(location)` und damit in ein
  // "Invalid URL" — richtig abgewiesen, aber aus dem falschen Grund und mit
  // dem Ergebnis, dass eine gültige Umleitung nicht ankam.
  let ziel: URL;
  try { ziel = new URL(location, von); } catch { return null; }

  // Kein Downgrade. Auch nicht auf einen anderen Nicht-https-Ausgang
  // (file:, ftp:, data:) — geprüft wird POSITIV auf https, nicht negativ auf
  // http. Eine Verbotsliste vergisst irgendwann ein Schema.
  if (ziel.protocol !== 'https:') return null;

  if (erlaubteHosts && !hostErlaubt(ziel.href, erlaubteHosts)) return null;

  // Bei einem Hostwechsel fliegt alles raus, was ein Geheimnis trägt.
  // Verglichen wird der HOST, nicht der Ursprung: Ein Wechsel des Ports auf
  // demselben Rechner ist hier keiner — https ist ohnehin erzwungen, und
  // rebrickable.com:443 → rebrickable.com wäre sonst ein „Wechsel".
  let vonHost = '';
  try { vonHost = new URL(von).hostname; } catch { return null; }
  if (vonHost === ziel.hostname) return { url: ziel.href, kopfzeilen };

  const gefiltert: Record<string, string> = {};
  for (const [k, v] of Object.entries(kopfzeilen))
    if (k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'cookie')
      gefiltert[k] = v;
  return { url: ziel.href, kopfzeilen: gefiltert };
}
