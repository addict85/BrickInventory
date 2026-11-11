/** Als Auftrag im Job-Prozess: Ein Neustart verliert nichts, und ein
 * gescheiterter Import von Teilen oder Figuren wird wiederholt. Die
 * Anreicherungen danach melden ihren Fehler, ohne den Auftrag scheitern zu lassen. */
import {
  importiereTeile,
  fetchMissingBlIds,
  importiereFiguren,
  downloadSetInstructions,
  fuelleAusBrickset,
  enrichSetParts,
  enrichSetMinifigs,
  downloadSetImages,
} from '../katalog';
import { anleitungEinreihen, pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import { refreshPriceForSet } from '../finanzen';
import { versuche } from '../infra/ergebnis';
import { setErgaenzen } from './erfassen';
import type { SetsKontext } from './kontext';

/** zweit: ein vorhandenes Set noch einmal erfasst; neu: angelegt; csv: aus dem CSV-Import;
 * ergaenzen: ohne Netz angelegt (setErfassen), Katalog, Bild und Kaufpreis fehlen noch. */
export type NacharbeitArt = 'zweit' | 'neu' | 'csv' | 'ergaenzen';

async function zieheNach(
  sk: SetsKontext,
  setNumber: string,
  userId: number,
  artWunsch: NacharbeitArt,
  lauf?: AuftragsLauf,
): Promise<void> {
  // Ohne Katalog fehlt dem Set der Name; scheitert er, versucht es der Auftrag noch einmal.
  if (artWunsch === 'ergaenzen') {
    await setErgaenzen(sk, setNumber, userId);
    pruefeAbbruch(lauf);
  }
  const art = artWunsch === 'ergaenzen' ? 'neu' : artWunsch;
  // Ein gescheiterter Schritt hält die übrigen nicht auf, steht aber im Stand des Auftrags.
  const ohne: string[] = [];
  const schritt = async (name: string, arbeit: () => Promise<unknown>) => {
    if (!(await versuche(`nacharbeit:${name} ${setNumber}`, arbeit)).ok) ohne.push(name);
  };
  // Die Figuren in jedem Zweig: Der Import behält den Lagerort vorhandener
  // Figuren, und so holt ein Zweiterfassen nach, was beim ersten Mal scheiterte.
  await importiereFiguren(setNumber, userId);
  await importiereTeile(setNumber, userId);
  pruefeAbbruch(lauf);

  if (art === 'zweit') await schritt('bl-nummern', () => fetchMissingBlIds(lauf));
  if (art === 'neu') {
    await schritt('preis', () => refreshPriceForSet(setNumber, userId));
    await schritt('anleitung', () => downloadSetInstructions(setNumber));
  } else {
    await schritt('anleitung-einreihen', () => anleitungEinreihen(setNumber));
  }
  pruefeAbbruch(lauf);
  await schritt('teile-anreichern', () => enrichSetParts(setNumber));
  await schritt('figuren-anreichern', () => enrichSetMinifigs(setNumber));
  // Brickset füllt nur Lücken; der CSV-Import fragt es beim Anlegen nicht.
  if (art === 'csv') await schritt('brickset', () => fuelleAusBrickset(setNumber));
  pruefeAbbruch(lauf);
  await schritt('bilder', () => downloadSetImages(setNumber));
  if (ohne.length) await lauf?.fortschritt?.({ text: `ohne ${ohne.join(', ')}`, ohne });
}

async function ladeSetBilder(setNumber: string, lauf?: AuftragsLauf): Promise<void> {
  await downloadSetImages(setNumber);
  pruefeAbbruch(lauf);
  await enrichSetMinifigs(setNumber);
}

export { zieheNach, ladeSetBilder };
