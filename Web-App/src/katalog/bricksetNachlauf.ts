import { setAnleitungenLaden, anzahlAnleitungen } from './instructions';
import { logAndContinue, meldeFehler } from '../infra/fehler';
import { type Nutzlast, pruefeAbbruch, type AuftragsLauf, AuftragVerschieben } from '../auftraege';
import * as bildlage from './bildlage';
import type { KatalogKontext } from './kontext';

/** Ist das Tageskontingent aufgebraucht, wartet die ganze Art bis zur
 * eingestellten Uhrzeit; der Versuch zählt dann nicht. */
async function bricksetNachlauf(k: KatalogKontext, n: Nutzlast<'brickset'>, lauf?: AuftragsLauf): Promise<void> {
  const sn = n.set_number;
  try {
    const [limit, status] = await Promise.all([
      k.fremdquellen.kontingentGrenze('brickset'),
      k.fremdquellen.kontingentStand('brickset'),
    ]);
    if (Math.max(0, limit - (status.count || 0)) <= 0) {
      const bis = await k.fremdquellen.brickset.faelligAb(false);
      await k.auftraege.pausiereArt('brickset', bis, 'Brickset-Tageskontingent erschöpft');
      throw new AuftragVerschieben(bis, 'Brickset-Tageskontingent erschöpft');
    }
  } catch (e) {
    if (e instanceof AuftragVerschieben) throw e;
    meldeFehler('brickset-retry:kontingent', e);
  }

  pruefeAbbruch(lauf);
  // Ist das Kontingent mittendrin weg, merkt setAngaben das Set selbst erneut vor.
  if (await bildlage.fuelleAusBrickset(k, sn)) console.log(`[brickset] Retry OK: ${sn}`);
  pruefeAbbruch(lauf);
  if ((await anzahlAnleitungen(k, sn)) === 0) {
    await setAnleitungenLaden(k, sn).catch(logAndContinue('brickset-retry:setAnleitungenLaden'));
  }
  await k.auftraege.pausiereArt('brickset', new Date(k.uhr.jetzt() + 1000), 'Abstand zwischen zwei Abrufen');
}

const tag = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Im Format der früheren Tabelle, damit die Oberfläche gleich bleibt; die Namen aus dem Katalog. */
async function bricksetListe(k: KatalogKontext) {
  const wartend = await k.fremdquellen.brickset.wartende();
  const namen = new Map(
    (await k.bildlage.setNamen([...new Set(wartend.map(w => w.set_number))])).map(z => [z.set_num, z.name]),
  );
  return wartend.map(w => ({
    set_number: w.set_number,
    name: namen.get(w.set_number) ?? null,
    attempts: w.versuch,
    retry_after: tag(new Date(w.faellig_ab)),
    last_error: w.fehler,
    created_at: w.erstellt,
  }));
}

export { bricksetListe, bricksetNachlauf };
