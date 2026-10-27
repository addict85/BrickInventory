/**
 * Wem der Server X-Forwarded-For und -Proto glaubt (Express „trust proxy").
 *
 * Ohne Einstellung: Loopback und Rechner im Docker-Netz (dort sitzt ein
 * Reverse-Proxy im selben Compose-Netz) — aber nicht das Gateway des
 * Docker-Netzes (x.y.0.1). Über das Gateway kommen per docker-proxy die
 * Clients selbst herein (IPv6, rootless, Docker Desktop); ihnen zu glauben
 * hiesse, die Anmeldesperre je Adresse umgehbar zu machen. 10/8 und 192.168/16
 * nicht: dort stehen die Rechner im Heimnetz.
 * TRUST_PROXY überschreibt das: „false" ohne Proxy, eine Zahl für so viele
 * Hops, sonst Adressen/Netze wie „10.0.0.2, 192.168.1.0/24".
 */
export function proxyVertrauen(wert?: string): boolean | number | string | ((adresse: string) => boolean) {
  const v = (wert ?? '').trim();
  if (!v) return dockerProxyOhneGateway;
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  if (/^(true|ja|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

function dockerProxyOhneGateway(adresse: string): boolean {
  const a = adresse.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [o1, o2, o3, o4] = v4.slice(1).map(Number);
    if (o1 === 127) return true;
    return o1 === 172 && o2! >= 16 && o2! <= 31 && !(o3 === 0 && o4 === 1);
  }
  if (a === '::1') return true;
  const gruppen = a.toLowerCase().split(':');
  const erste = parseInt(gruppen[0] || '0', 16);
  // fc00::/7, ohne das Gateway (letzte Gruppe 1).
  return erste >= 0xfc00 && erste <= 0xfdff && gruppen[gruppen.length - 1] !== '1';
}
