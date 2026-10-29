/**
 * Wem der Server X-Forwarded-For und -Proto glaubt (Express „trust proxy").
 *
 * Ohne Einstellung nur Loopback: Ausserhalb von Docker kann 172.16.0.0/12 ein
 * gewöhnliches Firmen- oder Heimnetz sein, und jeder Rechner darin gäbe seine
 * Absenderadresse sonst selbst an. TRUST_PROXY: „docker" für einen Proxy im
 * Docker-Netz (compose.yaml gibt das vor), „false" ohne Proxy, eine Zahl für
 * so viele Hops, sonst Adressen/Netze wie „10.0.0.2, 192.168.1.0/24".
 */
export function proxyVertrauen(wert?: string): boolean | number | string | ((adresse: string) => boolean) {
  const v = (wert ?? '').trim();
  if (!v) return nurLoopback;
  if (/^docker$/i.test(v)) return dockerProxyOhneGateway;
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  if (/^(true|ja|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
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

/**
 * Loopback und Docker-Netz, aber nicht dessen Gateway (x.y.0.1): Über das
 * Gateway kommen per docker-proxy die Clients selbst herein (IPv6, rootless,
 * Docker Desktop); ihnen zu glauben machte die Sperre je Adresse umgehbar.
 */
function dockerProxyOhneGateway(adresse: string): boolean {
  return nurLoopback(adresse) || (imDockerNetz(adresse) && !istDockerGateway(adresse));
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
 * Einmal warnen, wenn ein Proxy aus dem Docker-Netz oder über dessen Gateway
 * kommt und TRUST_PROXY ihm nicht glaubt. Dann gilt jede Anfrage als dieselbe
 * Adresse: Fünf Fehlversuche eines Fremden sperren den Inhaber aus, und die
 * Drosseln für Rücksetzen und Registrieren gelten für alle zusammen.
 */
export function proxyHinweis(trustProxy: string | undefined, warne: (text: string) => void = console.warn) {
  // Dieselbe Auswertung wie im Server, damit Hinweis und Wirkung übereinstimmen.
  const pruefer = require('express')();
  pruefer.set('trust proxy', proxyVertrauen(trustProxy));
  const vertraut = pruefer.get('trust proxy fn') as (adresse: string, hop: number) => boolean;
  let gewarnt = proxyVertrauen(trustProxy) === false;
  return (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    const von = req.socket?.remoteAddress || '';
    if (!gewarnt && req.headers['x-forwarded-for'] && imDockerNetz(von) && !vertraut(von, 0)) {
      gewarnt = true;
      const ip = ohneV4Huelle(von);
      const gateway = istDockerGateway(von);
      warne(`⚠️ [sicherheit] Ein Reverse-Proxy erreicht den Server über ${gateway ? 'das Docker-Gateway' : 'das Docker-Netz'} ${ip}. `
        + 'Sein X-Forwarded-For wird verworfen, und alle Clients teilen sich eine Adresse '
        + `(Anmeldesperre, Drosseln). TRUST_PROXY=${gateway ? ip : 'docker'} setzen — siehe README.md.`);
    }
    next();
  };
}
