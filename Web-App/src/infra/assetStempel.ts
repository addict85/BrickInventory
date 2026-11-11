/** Aus den DATEIEN abgeleitet, nicht aus einer Zahl, die jemand setzen muss:
 * Eine vergessene Zahl liess den Browser alte Dateien zeigen. */
import fs from 'fs';
import path from 'path';

/** Ohne Frist ein Dutzend `stat` je Seitenaufruf; zu lang, und ein Deploy ohne
 * Neustart zeigt minutenlang alte Adressen. */
export const STEMPEL_TTL_MS = 30_000;

let _satz: Map<string, string> | null = null;
let _satzZeit = 0;

/** `null` statt Platzhalter: Eine fehlende Datei darf nicht die Adressen der
 * ANDEREN Assets verwackeln. */
export function dateiStempel(datei: string): string | null {
  try {
    const st = fs.statSync(datei);
    return Math.round(st.mtimeMs).toString(36) + '-' + st.size.toString(36);
  } catch {
    return null;
  }
}

/** Rein, ohne Zustand — damit sich die Regel ohne Server prüfen lässt. */
export function stempleAssets(html: string, wurzel: string): string {
  return html.replace(
    /((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g,
    (ganz, kopf: string, pfad: string, schwanz: string) => {
      // normalize gegen `..`: Eine Regel, die nur bei gutmütiger Eingabe hält, ist keine.
      const rein = path.normalize(pfad).replace(/^(\.\.(\/|\\|$))+/, '');
      const stempel = dateiStempel(path.join(wurzel, rein));
      return stempel === null ? ganz : `${kopf}${pfad}?v=${stempel}${schwanz}`;
    },
  );
}

export function stempleAssetsGecacht(html: string, wurzel: string): string {
  const jetzt = Date.now();
  if (_satz === null || jetzt - _satzZeit > STEMPEL_TTL_MS) {
    _satz = new Map();
    _satzZeit = jetzt;
  }
  const satz = _satz;
  return html.replace(
    /((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g,
    (ganz, kopf: string, pfad: string, schwanz: string) => {
      let stempel = satz.get(pfad);
      if (stempel === undefined) {
        const rein = path.normalize(pfad).replace(/^(\.\.(\/|\\|$))+/, '');
        stempel = dateiStempel(path.join(wurzel, rein)) ?? '';
        satz.set(pfad, stempel);
      }
      return stempel === '' ? ganz : `${kopf}${pfad}?v=${stempel}${schwanz}`;
    },
  );
}
