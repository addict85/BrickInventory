import { downloadSetInstructions, anzahlAnleitungen } from './instructions';
import { logAndContinue, meldeFehler } from '../infra/fehler';
import { type Nutzlast, pruefeAbbruch, type AuftragsLauf, AuftragVerschieben } from '../auftraege';
import type { KatalogKontext } from './kontext';

/** Ist das Tageskontingent aufgebraucht, wartet die ganze Art bis zur
 * eingestellten Uhrzeit; der Versuch zählt dann nicht. */
async function bricksetNachlauf(k: KatalogKontext, n: Nutzlast<'brickset'>, lauf?: AuftragsLauf): Promise<void> {
  const sn = n.set_number;
  try {
    const [limit, status] = await Promise.all([
      k.fremdquellen.getLimitForApi('brickset'),
      k.fremdquellen.getRateLimitStatus('brickset'),
    ]);
    if (Math.max(0, limit - (status.count || 0)) <= 0) {
      const bis = await k.auftraege.bricksetFaelligAb(false);
      await k.auftraege.pausiereArt('brickset', bis, 'Brickset-Tageskontingent erschöpft');
      throw new AuftragVerschieben(bis, 'Brickset-Tageskontingent erschöpft');
    }
  } catch (e) {
    if (e instanceof AuftragVerschieben) throw e;
    meldeFehler('brickset-retry:kontingent', e);
  }

  pruefeAbbruch(lauf);
  // Ist das Kontingent mittendrin weg, merkt getSetInfo das Set selbst erneut vor.
  if (await k.bilder.fuelleAusBrickset(sn)) console.log(`[brickset] Retry OK: ${sn}`);
  pruefeAbbruch(lauf);
  if ((await anzahlAnleitungen(k, sn)) === 0) {
    await downloadSetInstructions(k, sn).catch(logAndContinue('brickset-retry:downloadSetInstructions'));
  }
  await k.auftraege.pausiereArt('brickset', new Date(Date.now() + 1000), 'Abstand zwischen zwei Abrufen');
}

export { bricksetNachlauf };
