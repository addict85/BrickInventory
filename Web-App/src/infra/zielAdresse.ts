/** Die Hostlisten prüfen Namen; wohin ein Name auflöst, bestimmt das DNS. Diese
 * Prüfung sieht die Adresse, mit der wirklich verbunden wird, und die Auflösung
 * geschieht genau einmal: Ein zweites Nachschlagen könnte anders antworten. */
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';

const liste = (v4: string[], v6: string[]) => {
  const b = new net.BlockList();
  for (const n of v4) b.addSubnet(n.split('/')[0]!, Number(n.split('/')[1]), 'ipv4');
  for (const n of v6) b.addSubnet(n.split('/')[0]!, Number(n.split('/')[1]), 'ipv6');
  return b;
};

/** Nie ein Ziel: Selbst, Link-Local (Metadatendienste der Clouds), Multicast. */
const NIE = liste(['0.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4'], ['::/128', 'fe80::/10', 'ff00::/8']);
const LOOPBACK = liste(['127.0.0.0/8'], ['::1/128']);
/** Privat, CGNAT, ULA und Dokumentation: Für einen öffentlichen Dienst gibt es dort nichts zu holen. */
const INTERN = liste(
  ['10.0.0.0/8', '100.64.0.0/10', '172.16.0.0/12', '192.168.0.0/16', '192.0.0.0/24', '198.18.0.0/15'],
  ['fc00::/7', '64:ff9b:1::/48'],
);

const typ = (ip: string) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');

/** Für Abrufe öffentlicher Dienste (Rebrickable, LEGO, CDNs). */
export function oeffentlicheAdresse(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  return ![NIE, LOOPBACK, INTERN].some(b => b.check(ip, typ(ip)));
}

type Schnittstellen = ReturnType<typeof os.networkInterfaces>;

/** Für den Mailserver: Der Verwalter darf einen im eigenen Netz wollen. Gesperrt
 * bleiben die Netze des eigenen Containers (Datenbank, Proxy) samt Loopback;
 * ohne Container ist Loopback ein lokaler Mailserver und bleibt erlaubt. */
export function mailserverAdresse(
  ip: string,
  o: { imContainer?: boolean; schnittstellen?: Schnittstellen } = {},
): boolean {
  if (!net.isIP(ip) || NIE.check(ip, typ(ip))) return false;
  if (!(o.imContainer ?? imContainer())) return true;
  if (LOOPBACK.check(ip, typ(ip))) return false;
  const eigene = new net.BlockList();
  for (const a of Object.values(o.schnittstellen ?? os.networkInterfaces()).flat()) {
    if (!a || a.internal || !a.cidr) continue;
    const [netz, laenge] = a.cidr.split('/');
    eigene.addSubnet(netz!, Number(laenge), a.family === 'IPv6' ? 'ipv6' : 'ipv4');
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
      if (!gut.length) return rueckruf(new ZielGesperrt(host), '');
      if (opt.all) return rueckruf(null, gut);
      rueckruf(null, gut[0]!.address, gut[0]!.family);
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
      if (err || !Array.isArray(adressen)) return scheitern(err ?? new ZielGesperrt(host));
      fertig((adressen.find(a => a.family === 4) ?? adressen[0]!).address);
    }),
  );
}
