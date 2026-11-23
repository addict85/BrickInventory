import net from 'node:net';

/** Only explicitly named addresses: every trusted sender can state its client address freely
 * and thus bypass the login lock. A network spanning more than eight addresses only with `networkConfirmed`
 * (PROXY_NETWORK_CONFIRMED=1): it usually contains clients too. */
export function proxyTrust(
  value?: string,
  networkConfirmed = false,
): false | string[] | ((address: string) => boolean) {
  const v = (value ?? '').trim();
  if (!v) return onlyLoopback;
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  const entries = v.split(/[\s,]+/).filter(Boolean);
  const wrong = entries.filter(e => !proxyEntryValid(e, networkConfirmed));
  if (wrong.length)
    throw new Error(
      proxyErrorText(
        wrong,
        wrong.every(e => proxyEntryValid(e, true)),
      ),
    );
  return entries;
}

function proxyErrorText(wrong: string[], onlyToWide: boolean): string {
  const list = wrong.map(f => `„${f}"`).join(', ');
  if (onlyToWide)
    return (
      `TRUST_PROXY enthält ${list}: ein Netz mit mehr als 8 Adressen (IPv4 weiter als /29, IPv6 weiter als /120). ` +
      'Besser nur die feste Adresse des Proxys; wer das Netz wirklich braucht, setzt PROXY_NETWORK_CONFIRMED=1 ' +
      '(UPGRADE.md#runde-24).'
    );
  return (
    `TRUST_PROXY enthält ${list}. Erlaubt sind nur die feste Adresse ` +
    'des eigenen Reverse-Proxys (z. B. 172.28.73.10) oder ein kleines Netz (IPv4 ab /29, IPv6 ab /120; ' +
    'bis /16 bzw. /64 nur mit PROXY_NETWORK_CONFIRMED=1), mehrere durch Komma getrennt, oder „false" ohne Proxy. ' +
    '„docker", „true" und Hop-Zahlen gibt es nicht mehr — siehe README.md und docs/SICHERHEIT.md.'
  );
}

/** Without confirmation at most eight addresses, with it at most /16 or /64. */
export function proxyEntryValid(entry: string, networkConfirmed = false): boolean {
  const [address, prefix, rest] = entry.split('/');
  if (rest !== undefined || !address) return false;
  const kind = net.isIP(address);
  if (!kind) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const p = Number(prefix);
  const [eng, wide, max] = kind === 4 ? [29, 16, 32] : [120, 64, 128];
  return p <= max && p >= (networkConfirmed ? wide : eng);
}

export const withoutV4Shell = (address: string) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

function onlyLoopback(address: string): boolean {
  const a = withoutV4Shell(address);
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

export function inDockerNetwork(address: string): boolean {
  const a = withoutV4Shell(address);
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (v4) return Number(v4[1]) === 172 && Number(v4[2]) >= 16 && Number(v4[2]) <= 31;
  const first = parseInt(a.toLowerCase().split(':')[0] || '0', 16);
  return a.includes(':') && first >= 0xfc00 && first <= 0xfdff;
}

export function isDockerGateway(address: string): boolean {
  const a = withoutV4Shell(address);
  if (!inDockerNetwork(a)) return false;
  if (a.includes(':')) return a.toLowerCase().split(':').pop() === '1';
  const [, , o3, o4] = a.split('.');
  return o3 === '0' && o4 === '1';
}
