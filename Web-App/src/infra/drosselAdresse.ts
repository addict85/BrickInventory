import { isIPv4, isIPv6 } from 'node:net';

/** IPv6 je /64: Je Adresse gezählt, umginge eine neue Adresse aus dem eigenen Netz jede
 * Bremse. IPv4 in IPv6 zählt als IPv4; alles andere (`konto:7`) bleibt, wie es ist. */
export function drosselAdresse(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4 && isIPv4(v4[1]!)) return v4[1]!;
  if (!isIPv6(ip)) return ip;
  const [links = '', rechts = ''] = ip.toLowerCase().split('::');
  const l = links ? links.split(':') : [],
    r = rechts ? rechts.split(':') : [];
  const gruppen = ip.includes('::') ? [...l, ...Array(8 - l.length - r.length).fill('0'), ...r] : l;
  return (
    gruppen
      .slice(0, 4)
      .map(g => g.replace(/^0+(?=.)/, ''))
      .join(':') + '::/64'
  );
}
