/** Die Hostlisten prüfen Namen; wohin ein Name auflöst, bestimmt das DNS. Diese
 * Prüfung sieht die Adresse, mit der wirklich verbunden wird, und die Auflösung
 * geschieht genau einmal: Ein zweites Nachschlagen könnte anders antworten. */
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';

const netz = (b: net.BlockList, cidr: string, art: 'ipv4' | 'ipv6') => {
  const [adresse = '', laenge = ''] = cidr.split('/');
  b.addSubnet(adresse, Number(laenge), art);
};
const liste = (v4: string[], v6: string[]) => {
  const b = new net.BlockList();
  for (const n of v4) netz(b, n, 'ipv4');
  for (const n of v6) netz(b, n, 'ipv6');
  return b;
};

/** Nie ein Ziel: Selbst, Link-Local (Metadatendienste der Clouds), Multicast. */
const NIE = liste(['0.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4'], ['::/128', 'fe80::/10', 'ff00::/8']);
const LOOPBACK = liste(['127.0.0.0/8'], ['::1/128']);
/** Privat, CGNAT, ULA und Dokumentation: Für einen öffentlichen Dienst gibt es dort nichts zu holen.
 * 6to4 und Teredo tragen eine IPv4-Adresse, die ein Relais beliebig ansteuert; beide sind veraltet. */
const INTERN = liste(
  ['10.0.0.0/8', '100.64.0.0/10', '172.16.0.0/12', '192.168.0.0/16', '192.0.0.0/24', '198.18.0.0/15'],
  ['fc00::/7', '64:ff9b:1::/48', '2002::/16', '2001::/32'],
);

/** Die acht 16-Bit-Gruppen einer gültigen IPv6-Adresse (Zone und IPv4-Schreibweise am Ende erlaubt). */
function gruppen(ip: string): number[] {
  let s = ip.split('%')[0]?.toLowerCase() ?? '';
  const v4 = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.slice(2).map(Number);
    s = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [kopf = '', rest] = s.split('::');
  const teil = (x: string) => (x ? x.split(':').map(g => Number.parseInt(g, 16)) : []);
  const vorn = teil(kopf),
    hinten = rest === undefined ? [] : teil(rest);
  return [...vorn, ...Array(8 - vorn.length - hinten.length).fill(0), ...hinten];
}

/** IPv4-gemappte (::ffff:a.b.c.d) und NAT64-Adressen (64:ff9b::a.b.c.d) erreichen
 * eine IPv4-Adresse; geprüft wird diese, damit jede IPv4-Regel auch hier greift.
 * NAT64 ganz zu sperren bräche Abrufe hinter DNS64 (reine IPv6-Netze). */
export function normalisiert(ip: string): string {
  if (!net.isIPv6(ip)) return ip;
  const g = gruppen(ip);
  const gemappt = g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0);
  if (!gemappt && !nat64) return ip;
  const [h = 0, l = 0] = g.slice(6);
  return [h >> 8, h & 255, l >> 8, l & 255].join('.');
}

const typ = (ip: string) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');

/** Für Abrufe öffentlicher Dienste (Rebrickable, LEGO, CDNs). */
export function oeffentlicheAdresse(roh: string): boolean {
  if (!net.isIP(roh)) return false;
  const ip = normalisiert(roh);
  return ![NIE, LOOPBACK, INTERN].some(b => b.check(ip, typ(ip)));
}

type Schnittstellen = ReturnType<typeof os.networkInterfaces>;

/** Für den Mailserver: Der Verwalter darf einen im eigenen Netz wollen. Gesperrt
 * bleiben die Netze des eigenen Containers (Datenbank, Proxy) samt Loopback;
 * ohne Container ist Loopback ein lokaler Mailserver und bleibt erlaubt. */
export function mailserverAdresse(
  roh: string,
  o: { imContainer?: boolean; schnittstellen?: Schnittstellen } = {},
): boolean {
  if (!net.isIP(roh)) return false;
  const ip = normalisiert(roh);
  if (NIE.check(ip, typ(ip))) return false;
  if (!(o.imContainer ?? imContainer())) return true;
  if (LOOPBACK.check(ip, typ(ip))) return false;
  const eigene = new net.BlockList();
  for (const a of Object.values(o.schnittstellen ?? os.networkInterfaces()).flat()) {
    if (!a || a.internal || !a.cidr) continue;
    netz(eigene, a.cidr, a.family === 'IPv6' ? 'ipv6' : 'ipv4');
  }
  return !eigene.check(ip, typ(ip));
}

function imContainer(): boolean {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

export class ZielGesperrt extends Error {
  readonly code = 'EZIELGESPERRT';
  constructor(host: string) {
    super(`${host.slice(0, 80)} löst auf keine erlaubte Adresse auf`);
  }
}

type Adresse = { address: string; family: number };
type LookupRueckruf = (err: NodeJS.ErrnoException | null, address: string | Adresse[], family?: number) => void;

/** Als `lookup` für net/tls/https: Gesperrte Adressen fallen heraus, bleibt keine, scheitert die Verbindung. */
export function pruefenderLookup(erlaubt: (ip: string) => boolean) {
  return (host: string, opt: dns.LookupOptions, rueckruf: LookupRueckruf): void => {
    dns.lookup(host, { ...opt, all: true }, (err, adressen) => {
      if (err) return rueckruf(err, '');
      const gut = adressen.filter(a => erlaubt(a.address));
      const erste = gut[0];
      if (!erste) return rueckruf(new ZielGesperrt(host), '');
      if (opt.all) return rueckruf(null, gut);
      rueckruf(null, erste.address, erste.family);
    });
  };
}

/** Für jeden Abruf nach draussen, den kein eigener Agent mit eigener Auflösung trägt. */
export const oeffentlicherLookup = pruefenderLookup(oeffentlicheAdresse);

/** Einmal auflösen und eine erlaubte Adresse nennen, IPv4 zuerst: Ohne IPv6-Route
 * liefe die Verbindung sonst bis zur Frist. Für Klienten ohne `lookup` (nodemailer). */
export function loeseAuf(host: string, erlaubt: (ip: string) => boolean): Promise<string> {
  if (net.isIP(host)) return erlaubt(host) ? Promise.resolve(host) : Promise.reject(new ZielGesperrt(host));
  return new Promise((fertig, scheitern) =>
    pruefenderLookup(erlaubt)(host, { all: true }, (err, adressen) => {
      const wahl = Array.isArray(adressen) ? (adressen.find(a => a.family === 4) ?? adressen[0]) : undefined;
      if (err || !wahl) return scheitern(err ?? new ZielGesperrt(host));
      fertig(wahl.address);
    }),
  );
}
