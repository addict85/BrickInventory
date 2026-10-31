import * as db from '../../db/database';
import { verschluessele, istVerschluesselt } from './geheimnis';
import { verschluesseleGlobaleAltwerte } from '../../utils/settings';

/**
 * Geheimnisse, die noch im Klartext liegen (aus der Zeit vor der Verschlüsselung),
 * einmal verschlüsseln. Ohne das läge ein alter PIN-Bestand weiter lesbar in
 * jedem Datenbank-Abzug. Läuft bei jedem Start; Verschlüsseltes bleibt, wie es ist.
 */
export async function verschluesseleAltbestand(): Promise<number> {
  let n = await verschluesseleGlobaleAltwerte();
  const zeilen = [
    ...(await db.all('SELECT id AS k, pin AS v FROM vouchers WHERE pin IS NOT NULL'))
      .map(z => ({ ...z, sql: 'UPDATE vouchers SET pin = $1 WHERE id = $2 AND pin = $3' })),
    ...(await db.all('SELECT user_id AS k, geheimnis AS v FROM zweiter_faktor'))
      .map(z => ({ ...z, sql: 'UPDATE zweiter_faktor SET geheimnis = $1 WHERE user_id = $2 AND geheimnis = $3' })),
  ];
  for (const z of zeilen) {
    if (!z.v || istVerschluesselt(z.v)) continue;
    // `AND … = $3`: Hat ein anderer Prozess die Zeile inzwischen geändert, bleibt sie.
    const r = await db.run(z.sql, [verschluessele(z.v), z.k, z.v]);
    n += r?.changes || 0;
  }
  return n;
}
