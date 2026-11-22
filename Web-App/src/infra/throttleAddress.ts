import { isIPv4, isIPv6 } from 'node:net';

/** IPv6 per /64: counted per address, a new address from the own network would bypass every
 * brake. IPv4 in IPv6 counts as IPv4; everything else (`konto:7`) stays as it is. */
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
