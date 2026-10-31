import * as db from '../db/database';
import { getSetInfo } from '../clients/brickset';
import { downloadSetInstructions, anzahlAnleitungen } from '../src/katalog/instructions';
import { getLimitForApi, getRateLimitStatus } from '../src/finanzen/financeCalc';
import { logAndContinue, meldeUndWeiter } from '../src/infra/httpError';
import { pausiereArt } from '../src/auftraege/dienst';
import { bricksetFaelligAb } from '../src/auftraege/bricksetAuftrag';
import { AuftragVerschieben } from './auftragsWorker';

/**
 * Ein Set der Brickset-Wiedervorlage (Auftrag 'brickset'). Ist das
 * Tageskontingent aufgebraucht, wartet die ganze Art bis zur eingestellten
 * Uhrzeit; der Versuch zählt dann nicht. Zwischen zwei Sets eine Sekunde Abstand.
 * Ausführlich: docs/begruendungen/jobs/bricksetRetry.ts.md#abschnitt
 */
async function bricksetNachlauf(n: Record<string, unknown>): Promise<void> {
  const sn = String(n.set_number);
  try {
    const [limit, status] = await Promise.all([getLimitForApi('brickset'), getRateLimitStatus('brickset')]);
    if (Math.max(0, limit - (status.count || 0)) <= 0) {
      const bis = await bricksetFaelligAb(false);
      await pausiereArt('brickset', bis, 'Brickset-Tageskontingent erschöpft');
      throw new AuftragVerschieben(bis, 'Brickset-Tageskontingent erschöpft');
    }
  } catch (e) {
    if (e instanceof AuftragVerschieben) throw e;
    meldeUndWeiter('brickset-retry:kontingent', e);
  }

  // Ist das Kontingent mittendrin weg, merkt getSetInfo das Set selbst erneut vor.
  const info = await getSetInfo(sn);
  if (info) {
    // Nur Lücken im Katalog füllen; scheitert es, bleibt das Set namenlos — darum mit Protokoll.
    await db.run(
      `UPDATE set_catalog SET
        name    = COALESCE(name, $1),    year     = COALESCE(year, $2),
        theme   = COALESCE(theme, $3),   pieces   = COALESCE(pieces, $4),
        minifigs = COALESCE(minifigs, $5)
       WHERE set_number = $6`,
      [info.name, info.year, info.theme, info.pieces, info.minifigs, sn]
    ).catch(logAndContinue(`brickset-nachlauf:set ${sn}`));
    console.log(`[brickset] Retry OK: ${sn}`);
  }
  if (await anzahlAnleitungen(sn) === 0) {
    await downloadSetInstructions(sn).catch(logAndContinue('brickset-retry:downloadSetInstructions'));
  }
  await pausiereArt('brickset', new Date(Date.now() + 1000), 'Abstand zwischen zwei Abrufen');
}

export { bricksetNachlauf };
