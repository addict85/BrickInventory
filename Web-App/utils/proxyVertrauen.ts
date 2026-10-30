import net from 'node:net';

/**
 * Wem der Server X-Forwarded-For und -Proto glaubt (Express „trust proxy").
 *
 * Nur Adressen, die ausdrücklich genannt sind: Jeder vertraute Absender kann
 * seine Client-Adresse frei angeben und damit die Anmeldesperre je Adresse
 * umgehen. Ohne Angabe gilt Loopback, „false" schaltet es ganz ab. Hop-Zahlen,
 * „true" und ganze Netze wie das alte „docker" (172.16.0.0/12) werden abgelehnt.
 */
export function proxyVertrauen(wert?: string): false | string[] | ((adresse: string) => boolean) {
  const v = (wert ?? '').trim();
  if (!v) return nurLoopback;
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  const eintraege = v.split(/[\s,]+/).filter(Boolean);
  const falsch = eintraege.filter(e => !proxyEintragGueltig(e));
  if (falsch.length) throw new Error(proxyFehlertext(falsch));
  return eintraege;
}

/** Die Meldung für einen Start mit unbrauchbarem TRUST_PROXY. */
function proxyFehlertext(falsch: string[]): string {
  return `TRUST_PROXY enthält ${falsch.map(f => `„${f}"`).join(', ')}. Erlaubt sind nur die feste Adresse `
    + 'des eigenen Reverse-Proxys (z. B. 172.28.73.10) oder ein kleines Netz (IPv4 ab /16, IPv6 ab /64), '
    + 'mehrere durch Komma getrennt, oder „false" ohne Proxy. „docker", „true" und Hop-Zahlen gibt es nicht mehr — '
    + 'siehe README.md und docs/SICHERHEIT.md.';
}

/** Eine IP-Adresse oder ein CIDR-Netz, das höchstens einen kleinen Bereich umfasst. */
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

const ohneV4Huelle = (adresse: string) => adresse.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

function nurLoopback(adresse: string): boolean {
  const a = ohneV4Huelle(adresse);
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

/** 172.16.0.0/12 oder fc00::/7 — dort vergibt Docker seine Netze. */
function imDockerNetz(adresse: string): boolean {
  const a = ohneV4Huelle(adresse);
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(a);
  if (v4) return Number(v4[1]) === 172 && Number(v4[2]) >= 16 && Number(v4[2]) <= 31;
  const erste = parseInt(a.toLowerCase().split(':')[0] || '0', 16);
  return a.includes(':') && erste >= 0xfc00 && erste <= 0xfdff;
}

/** Das Gateway eines Docker-Netzes (x.y.0.1 in 172.16/12, …:1 in fc00::/7). */
export function istDockerGateway(adresse: string): boolean {
  const a = ohneV4Huelle(adresse);
  if (!imDockerNetz(a)) return false;
  if (a.includes(':')) return a.toLowerCase().split(':').pop() === '1';
  const [, , o3, o4] = a.split('.');
  return o3 === '0' && o4 === '1';
}

/**
 * Einmal warnen, wenn ein Proxy aus dem Docker-Netz kommt und TRUST_PROXY ihm
 * nicht glaubt: Dann teilen sich alle Clients eine Adresse (Anmeldesperre,
 * Drosseln). Über das Gateway kommen auch Clients selbst herein, deshalb wird
 * ihm nie zu vertrauen geraten, sondern zu einer festen Proxy-Adresse.
 */
export function proxyHinweis(trustProxy: string | undefined, warne: (text: string) => void = console.warn) {
  let vertrauen: ReturnType<typeof proxyVertrauen>;
  try { vertrauen = proxyVertrauen(trustProxy); } catch { vertrauen = false; }
  // Dieselbe Auswertung wie im Server, damit Hinweis und Wirkung übereinstimmen.
  const pruefer = require('express')();
  pruefer.set('trust proxy', vertrauen);
  const vertraut = pruefer.get('trust proxy fn') as (adresse: string, hop: number) => boolean;
  let gewarnt = vertrauen === false;
  return (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    const von = req.socket?.remoteAddress || '';
    if (!gewarnt && req.headers['x-forwarded-for'] && imDockerNetz(von) && !vertraut(von, 0)) {
      gewarnt = true;
      const ip = ohneV4Huelle(von);
      warne(istDockerGateway(von)
        ? `⚠️ [sicherheit] X-Forwarded-For kommt über das Docker-Gateway ${ip} und wird verworfen. Über das Gateway `
          + 'erreichen auch Clients selbst den Server; ihm zu vertrauen hiesse, ihnen ihre Adresse zu glauben. Den '
          + 'Reverse-Proxy mit fester Adresse ins Netz brickinventory-net stellen und genau diese in TRUST_PROXY '
          + 'eintragen — siehe compose.yaml und README.md.'
        : `⚠️ [sicherheit] Ein Reverse-Proxy erreicht den Server aus dem Docker-Netz unter ${ip}. Sein X-Forwarded-For `
          + 'wird verworfen, und alle Clients teilen sich eine Adresse (Anmeldesperre, Drosseln). Ist das der eigene '
          + `Proxy, ihm eine feste Adresse geben und TRUST_PROXY=${ip} setzen — siehe README.md.`);
    }
    next();
  };
}
