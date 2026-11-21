/** Every fetch to the outside checks host and redirect here: the server sits
 * in the internal network. */

/** Here instead of in a route, because several layers need it. */
export const ALLOWED_IMAGE_HOSTS = [
  'cdn.rebrickable.com',
  'rebrickable.com',
  'images.brickset.com',
  'www.bricklink.com',
  'img.bricklink.com',
];

// Only these hosts may deliver files to disk. For LEGO the ones that host
// instructions: *.lego.com would include every subdomain someone sets up there.
export const ALLOWED_DOWNLOAD_HOSTS = [
  ...ALLOWED_IMAGE_HOSTS,
  'lego.com',
  'www.lego.com',
  'assets.lego.com',
  'bdpinstructions.s3.amazonaws.com',
];

/** JSON and page fetches: Rebrickable, instruction images, EAN search. */
export const ALLOWED_API_HOSTS = ['rebrickable.com', 'lego.brickinstructions.com', 'api.upcitemdb.com'];

/** The Rebrickable key only goes there: the other hosts of the list above do not need it,
 * and a response with `next` pointing to one of them would otherwise get it too. */
export const ALLOWED_REBRICKABLE_HOSTS = ['rebrickable.com'];

/** Exact host including port (`u.host` omits the default port); subdomains only
 * with an explicit "*." entry, because an S3 bucket "x.bdpinstructions" does not
 * belong to the bucket "bdpinstructions". "evil@host" and "host:22" look allowed
 * but aim elsewhere. Unparsable means: do NOT fetch. */
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

/** @param allowedHosts  set: the target host is checked. Omitted: not.
 * @returns null if the redirect must not be followed
 */
export function nextRedirect(
  von: string,
  location: string | undefined,
  kopfzeilen: Record<string, string>,
  allowedHosts?: readonly string[],
): Umleitungsziel | null {
  if (!location) return null;

  // A Location header MAY be a bare path (RFC 9110).
  let ziel: URL;
  try {
    ziel = new URL(location, von);
  } catch {
    return null;
  }

  // Checked POSITIVELY for https, not negatively for http: a deny list forgets
  // a scheme at some point.
  if (ziel.protocol !== 'https:') return null;

  if (allowedHosts && !hostAllowed(ziel.href, allowedHosts)) return null;

  // On a host change everything that carries a secret is thrown out. The HOST counts,
  // not the origin: :443 → without a port would otherwise be a "change".
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

/** Inserted raw, "/", "?" or ".." would leave the path at Rebrickable or
 * S3; dot segments stay dot segments even when encoded, that is why they throw. */
export function pathSegment(wert: string | number): string {
  const s = String(wert);
  if (!s || /^\.+$/.test(s)) throw new Error(`Ungültiges Pfadsegment: „${s.slice(0, 40)}"`);
  return encodeURIComponent(s);
}

export function numbersList(werte: readonly unknown[]): string {
  return werte.map(w => encodeURIComponent(String(w))).join(',');
}
