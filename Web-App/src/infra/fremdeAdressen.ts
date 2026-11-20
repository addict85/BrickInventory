/** Jeder Abruf nach draussen prüft hier Host und Umleitung: Der Server steht
 * im internen Netz. */

/** Hier statt in einer Route, weil mehrere Schichten sie brauchen. */
export const ALLOWED_IMAGE_HOSTS = [
  'cdn.rebrickable.com',
  'rebrickable.com',
  'images.brickset.com',
  'www.bricklink.com',
  'img.bricklink.com',
];

// Nur diese Hosts dürfen Dateien auf die Platte liefern. Bei LEGO die, auf denen
// Anleitungen liegen: Unter *.lego.com stünde jede Unterdomäne, die jemand dort einrichtet.
export const ALLOWED_DOWNLOAD_HOSTS = [
  ...ALLOWED_IMAGE_HOSTS,
  'lego.com',
  'www.lego.com',
  'assets.lego.com',
  'bdpinstructions.s3.amazonaws.com',
];

/** JSON- und Seitenabrufe: Rebrickable, Anleitungsbilder, EAN-Suche. */
export const ALLOWED_API_HOSTS = ['rebrickable.com', 'lego.brickinstructions.com', 'api.upcitemdb.com'];

/** Nur dorthin geht der Rebrickable-Schlüssel: Die anderen Hosts der Liste oben brauchen ihn nicht,
 * und eine Antwort mit `next` auf einen davon bekäme ihn sonst mit. */
export const ALLOWED_REBRICKABLE_HOSTS = ['rebrickable.com'];

/** Exakter Host samt Port (`u.host` lässt den Standardport weg); Subdomains nur
 * bei ausdrücklichem „*."-Eintrag, denn ein S3-Eimer „x.bdpinstructions" gehört
 * nicht dem Eimer „bdpinstructions". „evil@host" und „host:22" sehen erlaubt
 * aus, zielen aber woandershin. Unparsebar heisst: NICHT holen. */
export function hostAllowed(url: string, liste: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== '' || u.password !== '') return false;
  return liste.some(h => (h.startsWith('*.') ? u.port === '' && u.hostname.endsWith(h.slice(1)) : u.host === h));
}

export const REDIRECT_LIMIT = 5;

export interface Umleitungsziel {
  url: string;
  kopfzeilen: Record<string, string>;
}

/** @param allowedHosts  gesetzt: der Zielhost wird geprüft. Weggelassen: nicht.
 * @returns null, wenn nicht gefolgt werden darf
 */
export function nextRedirect(
  von: string,
  location: string | undefined,
  kopfzeilen: Record<string, string>,
  allowedHosts?: readonly string[],
): Umleitungsziel | null {
  if (!location) return null;

  // Ein Location-Kopf DARF ein blosser Pfad sein (RFC 9110).
  let ziel: URL;
  try {
    ziel = new URL(location, von);
  } catch {
    return null;
  }

  // POSITIV auf https geprüft, nicht negativ auf http: Eine Verbotsliste vergisst
  // irgendwann ein Schema.
  if (ziel.protocol !== 'https:') return null;

  if (allowedHosts && !hostAllowed(ziel.href, allowedHosts)) return null;

  // Bei Hostwechsel fliegt alles raus, was ein Geheimnis trägt. Der HOST zählt,
  // nicht der Ursprung: :443 → ohne Port wäre sonst ein „Wechsel".
  let ofHost = '';
  try {
    ofHost = new URL(von).hostname;
  } catch {
    return null;
  }
  if (ofHost === ziel.hostname) return { url: ziel.href, kopfzeilen };

  const gefiltert: Record<string, string> = {};
  for (const [k, v] of Object.entries(kopfzeilen))
    if (k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'cookie') gefiltert[k] = v;
  return { url: ziel.href, kopfzeilen: gefiltert };
}

/** Roh eingesetzt verliessen „/", „?" oder „.." den Pfad bei Rebrickable oder
 * S3; Punktsegmente bleiben auch kodiert welche, deshalb werfen sie. */
export function pathSegment(wert: string | number): string {
  const s = String(wert);
  if (!s || /^\.+$/.test(s)) throw new Error(`Ungültiges Pfadsegment: „${s.slice(0, 40)}"`);
  return encodeURIComponent(s);
}

export function numbersList(werte: readonly unknown[]): string {
  return werte.map(w => encodeURIComponent(String(w))).join(',');
}
