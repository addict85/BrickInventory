/**
 * Der `?v=`-Stempel an den Assets — abgeleitet aus den DATEIEN, nicht aus
 * einer Zahl, die jemand gesetzt haben muss.
 * Ausführlich: docs/begruendungen/utils/assetStempel.ts.md#abschnitt
 */
import fs from 'fs';
import path from 'path';

/**
 * Wie lange ein berechneter Satz Stempel gilt.
 * Ausführlich: docs/begruendungen/utils/assetStempel.ts.md#stempel-ttl-ms
 */
export const STEMPEL_TTL_MS = 30_000;

/** Zuletzt berechnete Stempel, Pfad → Stempel. */
let _satz: Map<string, string> | null = null;
let _satzZeit = 0;

/**
 * Der Stempel EINER Datei — oder `null`, wenn es sie nicht gibt.
 *
 * `null` und kein Platzhalter: Der Aufrufer laesst den vorhandenen Wert dann
 * stehen. Eine fehlende Datei ist ein anderes Problem (und faellt in
 * test/eigenbruecken auf); sie darf nicht zusaetzlich die Adresse der
 * ANDEREN Assets verwackeln.
 */
export function dateiStempel(datei: string): string | null {
  try {
    const st = fs.statSync(datei);
    return Math.round(st.mtimeMs).toString(36) + '-' + st.size.toString(36);
  } catch {
    return null;
  }
}

/**
 * Alle `?v=` in `html` durch den Stempel der jeweiligen Datei ersetzen.
 * Ausführlich: docs/begruendungen/utils/assetStempel.ts.md#stempleassets
 * @param html   Der Seitenquelltext.
 * @param wurzel Das Verzeichnis, gegen das die absoluten Pfade aufloesen.
 */
export function stempleAssets(html: string, wurzel: string): string {
  return html.replace(
    /((?:href|src)=")(\/[^"?]+)\?v=[^"]*(")/g,
    (ganz, kopf: string, pfad: string, schwanz: string) => {
      // `path.normalize` gegen `..` im Pfad: Der Quelltext kommt zwar aus dem
      // eigenen Baum, aber eine Regel, die nur bei gutmuetiger Eingabe haelt,
      // ist keine.
      const rein = path.normalize(pfad).replace(/^(\.\.(\/|\\|$))+/, '');
      const stempel = dateiStempel(path.join(wurzel, rein));
      return stempel === null ? ganz : `${kopf}${pfad}?v=${stempel}${schwanz}`;
    },
  );
}

/** Dasselbe, aber mit der Frist aus [STEMPEL_TTL_MS]. */
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

// Ein `vergisStempel()` stand hier und ist RAUS: Niemand rief es auf
// (test/dead-code.test.js hat es gemeldet). Gebraucht wird es auch nicht —
// die Frist oben raeumt den Satz von allein weg, und ein Deploy ohne Neustart
// ist nach dreissig Sekunden durch. Ein Ausgang „fuer spaeter" altert
// unbemerkt mit.
