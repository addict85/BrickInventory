/** The host lists check names; where a name resolves to is decided by DNS. This
 * check sees the address that is really connected to, and the resolution
 * happens exactly once: a second lookup could answer differently. */
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';

const network = (b: net.BlockList, cidr: string, art: 'ipv4' | 'ipv6') => {
  const [address = '', length = ''] = cidr.split('/');
  b.addSubnet(address, Number(length), art);
};
const list = (v4: string[], v6: string[]) => {
  const b = new net.BlockList();
  for (const n of v4) network(b, n, 'ipv4');
  for (const n of v6) network(b, n, 'ipv6');
  return b;
};

/** Never a target: self, link-local (cloud metadata services), multicast. */
const NIE = list(['0.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4'], ['::/128', 'fe80::/10', 'ff00::/8']);
const LOOPBACK = list(['127.0.0.0/8'], ['::1/128']);
/** Private, CGNAT, ULA, site-local and documentation: for a public service there is nothing
 * to fetch there, but an operator can assign them internally. 6to4 (including relay anycast 192.88.99.0/24) and
 * Teredo carry an IPv4 address that a relay can target arbitrarily; both are deprecated. */
const INTERN = list(
  [
    '10.0.0.0/8',
    '100.64.0.0/10',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '192.0.0.0/24',
    '198.18.0.0/15',
    '192.0.2.0/24',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '192.88.99.0/24',
  ],
  ['fc00::/7', 'fec0::/10', '64:ff9b:1::/48', '2002::/16', '2001::/32', '2001:db8::/32'],
);

/** The eight 16-bit groups of a valid IPv6 address (zone and IPv4 notation at the end allowed). */
function groups(ip: string): number[] {
  let s = ip.split('%')[0]?.toLowerCase() ?? '';
  const v4 = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4.slice(2).map(Number);
    s = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [header = '', rest] = s.split('::');
  const teil = (x: string) => (x ? x.split(':').map(g => Number.parseInt(g, 16)) : []);
  const front = teil(header),
    back = rest === undefined ? [] : teil(rest);
  return [...front, ...Array(8 - front.length - back.length).fill(0), ...back];
}

/** ::ffff:a.b.c.d, ::a.b.c.d and 64:ff9b::a.b.c.d reach an IPv4 address: that one
 * is checked (blocking NAT64 entirely would break DNS64). :: and ::1 are real IPv6 addresses. */
export function normalized(ip: string): string {
  if (!net.isIPv6(ip)) return ip;
  const g = groups(ip);
  const mapped = g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0);
  const compatible = g.slice(0, 6).every(x => x === 0) && (g[6] !== 0 || (g[7] ?? 0) > 1);
  if (!mapped && !nat64 && !compatible) return ip;
  const [h = 0, l = 0] = g.slice(6);
  return [h >> 8, h & 255, l >> 8, l & 255].join('.');
}

const type = (ip: string) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');

/** For fetches from public services (Rebrickable, LEGO, CDNs). */
export function publicAddress(raw: string): boolean {
  if (!net.isIP(raw)) return false;
  const ip = normalized(raw);
  return ![NIE, LOOPBACK, INTERN].some(b => b.check(ip, type(ip)));
}

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/** For the mail server: the admin may want one in the own network. Blocked
 * stay the networks of the own container (database, proxy) including loopback;
 * without a container loopback is a local mail server and stays allowed. */
export function mailServerAddress(raw: string, o: { imContainer?: boolean; interfaces?: Interfaces } = {}): boolean {
  if (!net.isIP(raw)) return false;
  const ip = normalized(raw);
  if (NIE.check(ip, type(ip))) return false;
  if (!(o.imContainer ?? imContainer())) return true;
  if (LOOPBACK.check(ip, type(ip))) return false;
  const own = new net.BlockList();
  for (const a of Object.values(o.interfaces ?? os.networkInterfaces()).flat()) {
    if (!a || a.internal || !a.cidr) continue;
    network(own, a.cidr, a.family === 'IPv6' ? 'ipv6' : 'ipv4');
  }
  return !own.check(ip, type(ip));
}

function imContainer(): boolean {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

export class TargetLocked extends Error {
  readonly code = 'EZIELGESPERRT';
  constructor(host: string) {
    super(`${host.slice(0, 80)} löst auf keine erlaubte Adresse auf`);
  }
}

type Address = { address: string; family: number };
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | Address[], family?: number) => void;

/** As `lookup` for net/tls/https: blocked addresses drop out; if none remains, the connection fails. */
export function checkingLookup(allowed: (ip: string) => boolean) {
  return (host: string, opt: dns.LookupOptions, callback: LookupCallback): void => {
    dns.lookup(host, { ...opt, all: true }, (err, addresses) => {
      if (err) return callback(err, '');
      const gut = addresses.filter(a => allowed(a.address));
      const first = gut[0];
      if (!first) return callback(new TargetLocked(host), '');
      if (opt.all) return callback(null, gut);
      callback(null, first.address, first.family);
    });
  };
}

/** For every fetch to the outside that no own agent with its own resolution carries. */
export const publicLookup = checkingLookup(publicAddress);

/** Resolve once and name an allowed address, IPv4 first: without an IPv6 route
 * the connection would otherwise run until the deadline. For clients without `lookup` (nodemailer). */
export function resolveOn(host: string, allowed: (ip: string) => boolean): Promise<string> {
  if (net.isIP(host)) return allowed(host) ? Promise.resolve(host) : Promise.reject(new TargetLocked(host));
  return new Promise((finished, fail) =>
    checkingLookup(allowed)(host, { all: true }, (err, addresses) => {
      const choice = Array.isArray(addresses) ? (addresses.find(a => a.family === 4) ?? addresses[0]) : undefined;
      if (err || !choice) return fail(err ?? new TargetLocked(host));
      finished(choice.address);
    }),
  );
}
