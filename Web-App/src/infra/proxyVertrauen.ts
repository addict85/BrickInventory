import net from 'node:net';

/** Nur ausdrücklich genannte Adressen: Jeder vertraute Absender kann seine Client-Adresse frei
 * angeben und so die Anmeldesperre umgehen. Ein Netz über acht Adressen nur mit `netzBestaetigt`
 * (PROXY_NETZ_BESTAETIGT=1): Darin stehen meist auch Clients. */
export function proxyVertrauen(
  wert?: string,
  netzBestaetigt = false,
): false | string[] | ((adresse: string) => boolean) {
  const v = (wert ?? '').trim();
  if (!v) return nurLoopback;
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  const eintraege = v.split(/[\s,]+/).filter(Boolean);
  const falsch = eintraege.filter(e => !proxyEintragGueltig(e, netzBestaetigt));
  if (falsch.length)
    throw new Error(
      proxyFehlertext(
        falsch,
        falsch.every(e => proxyEintragGueltig(e, true)),
      ),
    );
  return eintraege;
}

function proxyFehlertext(falsch: string[], nurZuWeit: boolean): string {
  const liste = falsch.map(f => `„${f}"`).join(', ');
  if (nurZuWeit)
    return (
      `TRUST_PROXY enthält ${liste}: ein Netz mit mehr als 8 Adressen (IPv4 weiter als /29, IPv6 weiter als /120). ` +
      'Besser nur die feste Adresse des Proxys; wer das Netz wirklich braucht, setzt PROXY_NETZ_BESTAETIGT=1 ' +
      '(UPGRADE.md, Abschnitt 60).'
    );
  return (
    `TRUST_PROXY enthält ${liste}. Erlaubt sind nur die feste Adresse ` +
    'des eigenen Reverse-Proxys (z. B. 172.28.73.10) oder ein kleines Netz (IPv4 ab /29, IPv6 ab /120; ' +
    'bis /16 bzw. /64 nur mit PROXY_NETZ_BESTAETIGT=1), mehrere durch Komma getrennt, oder „false" ohne Proxy. ' +
    '„docker", „true" und Hop-Zahlen gibt es nicht mehr — siehe README.md und docs/SICHERHEIT.md.'
  );
}

/** Ohne Bestätigung höchstens acht Adressen, mit ihr höchstens /16 bzw. /64. */
export function proxyEintragGueltig(eintrag: string, netzBestaetigt = false): boolean {
  const [adresse, praefix, rest] = eintrag.split('/');
  if (rest !== undefined || !adresse) return false;
  const art = net.isIP(adresse);
  if (!art) return false;
  if (praefix === undefined) return true;
  if (!/^\d{1,3}$/.test(praefix)) return false;
  const p = Number(praefix);
  const [eng, weit, max] = art === 4 ? [29, 16, 32] : [120, 64, 128];
  return p <= max && p >= (netzBestaetigt ? weit : eng);
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
