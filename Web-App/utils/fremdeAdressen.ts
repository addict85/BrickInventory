/**
 * Welche fremden Adressen darf der Server abrufen — und was gilt bei einer
 * Umleitung?
 * Ausführlich: docs/begruendungen/utils/fremdeAdressen.ts.md#abschnitt
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
 * Ausführlich: docs/begruendungen/utils/fremdeAdressen.ts.md#erlaubte-download-hosts
 */
export const ERLAUBTE_DOWNLOAD_HOSTS = [
  ...ERLAUBTE_BILD_HOSTS, 'lego.com', 'bdpinstructions.s3.amazonaws.com',
];

/**
 * Darf diese Adresse abgerufen werden?
 * Ausführlich: docs/begruendungen/utils/fremdeAdressen.ts.md#hosterlaubt
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
 * Ausführlich: docs/begruendungen/utils/fremdeAdressen.ts.md#naechsteumleitung
 * @param von         die Adresse, die umgeleitet hat (für relative Ziele)
 * @param location    der Location-Kopf der Antwort
 * @param kopfzeilen  die bisher geschickten Kopfzeilen
 * @param erlaubteHosts  gesetzt: der Zielhost wird geprüft. Weggelassen: nicht.
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
