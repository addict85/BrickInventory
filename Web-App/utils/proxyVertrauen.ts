/**
 * Wem der Server X-Forwarded-For und -Proto glaubt (Express „trust proxy").
 *
 * Ohne Einstellung nur Loopback und die Docker-Netze (172.16.0.0/12): Dort
 * sitzt ein Reverse-Proxy im selben Compose-Netz. 10/8 und 192.168/16 nicht —
 * dort stehen die Rechner im Heimnetz, und die könnten sonst ihre Adresse
 * selbst angeben und die Anmeldesperre je Adresse umgehen.
 * TRUST_PROXY überschreibt das: „false" ohne Proxy, eine Zahl für so viele
 * Hops, sonst Adressen/Netze wie „10.0.0.2, 192.168.1.0/24".
 */
export function proxyVertrauen(wert?: string): boolean | number | string {
  const v = (wert ?? '').trim();
  if (!v) return 'loopback, 172.16.0.0/12, fc00::/7';
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  if (/^(true|ja|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}
