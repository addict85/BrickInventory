/** Jeder Abruf nach draussen prüft hier Host und Umleitung: Der Server steht
 * im internen Netz.
 * Ausführlich: docs/begruendungen/src/infra/fremdeAdressen.ts.md#abschnitt */

/** Hier statt in einer Route, weil mehrere Schichten sie brauchen. */
export const ERLAUBTE_BILD_HOSTS = [
  'cdn.rebrickable.com', 'rebrickable.com',
  'images.brickset.com',
  'www.bricklink.com', 'img.bricklink.com',
];

// Ausführlich: docs/begruendungen/src/infra/fremdeAdressen.ts.md#erlaubte-download-hosts
export const ERLAUBTE_DOWNLOAD_HOSTS = [
  ...ERLAUBTE_BILD_HOSTS, 'lego.com', 'bdpinstructions.s3.amazonaws.com',
];

/** JSON- und Seitenabrufe: Rebrickable, Anleitungsbilder, EAN-Suche. */
export const ERLAUBTE_API_HOSTS = ['rebrickable.com', 'lego.brickinstructions.com', 'api.upcitemdb.com'];

/** @returns false, wenn die Adresse nicht parsebar ist — im Zweifel NICHT holen
 * Ausführlich: docs/begruendungen/src/infra/fremdeAdressen.ts.md#hosterlaubt */
export function hostErlaubt(url: string, liste: readonly string[]): boolean {
  let host: string;
  try { host = new URL(url).hostname; } catch { return false; }
  return liste.some(h => host === h || host.endsWith('.' + h));
}

export const UMLEITUNGS_GRENZE = 5;

export interface Umleitungsziel {
  url: string;
  kopfzeilen: Record<string, string>;
}

/** @param erlaubteHosts  gesetzt: der Zielhost wird geprüft. Weggelassen: nicht.
 * @returns null, wenn nicht gefolgt werden darf
 * Ausführlich: docs/begruendungen/src/infra/fremdeAdressen.ts.md#naechsteumleitung */
export function naechsteUmleitung(
  von: string,
  location: string | undefined,
  kopfzeilen: Record<string, string>,
  erlaubteHosts?: readonly string[],
): Umleitungsziel | null {
  if (!location) return null;

  // Ein Location-Kopf DARF ein blosser Pfad sein (RFC 9110).
  let ziel: URL;
  try { ziel = new URL(location, von); } catch { return null; }

  // POSITIV auf https geprüft, nicht negativ auf http: Eine Verbotsliste vergisst
  // irgendwann ein Schema.
  if (ziel.protocol !== 'https:') return null;

  if (erlaubteHosts && !hostErlaubt(ziel.href, erlaubteHosts)) return null;

  // Bei Hostwechsel fliegt alles raus, was ein Geheimnis trägt. Der HOST zählt,
  // nicht der Ursprung: :443 → ohne Port wäre sonst ein „Wechsel".
  let vonHost = '';
  try { vonHost = new URL(von).hostname; } catch { return null; }
  if (vonHost === ziel.hostname) return { url: ziel.href, kopfzeilen };

  const gefiltert: Record<string, string> = {};
  for (const [k, v] of Object.entries(kopfzeilen))
    if (k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'cookie')
      gefiltert[k] = v;
  return { url: ziel.href, kopfzeilen: gefiltert };
}

/** Roh eingesetzt verliessen „/", „?" oder „.." den Pfad bei Rebrickable oder
 * S3; Punktsegmente bleiben auch kodiert welche, deshalb werfen sie. */
export function pfadSegment(wert: string | number): string {
  const s = String(wert);
  if (!s || /^\.+$/.test(s)) throw new Error(`Ungültiges Pfadsegment: „${s.slice(0, 40)}"`);
  return encodeURIComponent(s);
}

export function nummernListe(werte: readonly unknown[]): string {
  return werte.map(w => encodeURIComponent(String(w))).join(',');
}
