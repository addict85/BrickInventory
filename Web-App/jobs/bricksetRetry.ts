import { fuelleAusBrickset } from '../src/katalog/bildlage';
import { downloadSetInstructions, anzahlAnleitungen } from '../src/katalog/instructions';
import { getLimitForApi, getRateLimitStatus } from '../src/finanzen/financeCalc';
import { logAndContinue, meldeUndWeiter } from '../src/infra/fehler';
import { pausiereArt } from '../src/auftraege/dienst';
import { bricksetFaelligAb } from '../src/auftraege/bricksetAuftrag';
import { AuftragVerschieben } from './auftragsWorker';
import type { Nutzlast } from '../src/auftraege/nutzlasten';
import { pruefeAbbruch, type AuftragsLauf } from '../src/auftraege/auftraege';

/** Ist das Tageskontingent aufgebraucht, wartet die ganze Art bis zur
 * eingestellten Uhrzeit; der Versuch zählt dann nicht. */
async function bricksetNachlauf(n: Nutzlast<'brickset'>, lauf?: AuftragsLauf): Promise<void> {
  const sn = n.set_number;
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

  pruefeAbbruch(lauf);
  // Ist das Kontingent mittendrin weg, merkt getSetInfo das Set selbst erneut vor.
  if (await fuelleAusBrickset(sn)) console.log(`[brickset] Retry OK: ${sn}`);
  pruefeAbbruch(lauf);
  if (await anzahlAnleitungen(sn) === 0) {
    await downloadSetInstructions(sn).catch(logAndContinue('brickset-retry:downloadSetInstructions'));
  }
  await pausiereArt('brickset', new Date(Date.now() + 1000), 'Abstand zwischen zwei Abrufen');
}

export { bricksetNachlauf };
