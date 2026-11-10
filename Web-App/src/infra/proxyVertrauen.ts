import net from 'node:net';

/** Nur ausdrücklich genannte Adressen: Jeder vertraute Absender kann seine
 * Client-Adresse frei angeben und so die Anmeldesperre umgehen. Hop-Zahlen,
 * „true" und ganze Netze werden abgelehnt. */
export function proxyVertrauen(wert?: string): false | string[] | ((adresse: string) => boolean) {
  const v = (wert ?? '').trim();
  if (!v) return nurLoopback;
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  const eintraege = v.split(/[\s,]+/).filter(Boolean);
  const falsch = eintraege.filter(e => !proxyEintragGueltig(e));
  if (falsch.length) throw new Error(proxyFehlertext(falsch));
  return eintraege;
}

function proxyFehlertext(falsch: string[]): string {
  return `TRUST_PROXY enthält ${falsch.map(f => `„${f}"`).join(', ')}. Erlaubt sind nur die feste Adresse `
    + 'des eigenen Reverse-Proxys (z. B. 172.28.73.10) oder ein kleines Netz (IPv4 ab /16, IPv6 ab /64), '
    + 'mehrere durch Komma getrennt, oder „false" ohne Proxy. „docker", „true" und Hop-Zahlen gibt es nicht mehr — '
    + 'siehe README.md und docs/SICHERHEIT.md.';
}

/** Höchstens ein kleiner Bereich. */
export function proxyEintragGueltig(eintrag: string): boolean {
  const [adresse, praefix, rest] = eintrag.split('/');
  if (rest !== undefined || !adresse) return false;
  const art = net.isIP(adresse);
  if (!art) return false;
  if (praefix === undefined) return true;
  if (!/^\d{1,3}$/.test(praefix)) return false;
  const p = Number(praefix);
  return art === 4 ? p >= 16 && p <= 32 : p >= 64 && p <= 128;
}

export const ohneV4Huelle = (adresse: string) => adresse.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

function nurLoopback(adresse: string): boolean {
  const a = ohneV4Huelle(adresse);
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

export function imDockerNetz(adresse: string): boolean {
  const a = ohneV4Huelle(adresse);
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (v4) return Number(v4[1]) === 172 && Number(v4[2]) >= 16 && Number(v4[2]) <= 31;
  const erste = parseInt(a.toLowerCase().split(':')[0] || '0', 16);
  return a.includes(':') && erste >= 0xfc00 && erste <= 0xfdff;
}

export function istDockerGateway(adresse: string): boolean {
  const a = ohneV4Huelle(adresse);
  if (!imDockerNetz(a)) return false;
  if (a.includes(':')) return a.toLowerCase().split(':').pop() === '1';
  const [, , o3, o4] = a.split('.');
  return o3 === '0' && o4 === '1';
}
