/**
 * Wem der Server X-Forwarded-For und -Proto glaubt (Express „trust proxy").
 *
 * Ohne Einstellung nur Proxys im eigenen Netz (Loopback, privat, link-local):
 * Der eigene Reverse-Proxy sitzt dort, ein Client aus dem Internet nicht — er
 * kann seine IP dann nicht selbst angeben und so die Anmeldesperre umgehen.
 * TRUST_PROXY überschreibt das: „false" ohne Proxy, eine Zahl für so viele
 * Hops, sonst Adressen/Netze wie „10.0.0.2, 192.168.1.0/24".
 */
export function proxyVertrauen(wert?: string): boolean | number | string {
  const v = (wert ?? '').trim();
  if (!v) return 'loopback, linklocal, uniquelocal';
  if (/^(false|nein|no|off)$/i.test(v)) return false;
  if (/^(true|ja|yes|on)$/i.test(v)) return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}
