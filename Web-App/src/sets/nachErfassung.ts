/** Als Auftrag im Job-Prozess: Ein Neustart verliert nichts, und ein
 * gescheiterter Import von Teilen oder Figuren wird wiederholt. Die
 * Anreicherungen danach melden ihren Fehler, ohne den Auftrag scheitern zu lassen. */
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import { versuche } from '../infra/ergebnis';
import { setErgaenzen, type NacharbeitArt } from './erfassen';
import { importiereFiguren, importiereTeile } from './setInhaltImport';
import type { SetsKontext } from './kontext';

async function zieheNach(
  sk: SetsKontext,
  setNumber: string,
  userId: number,
  artWunsch: NacharbeitArt,
  lauf?: AuftragsLauf,
): Promise<void> {
  // Jede Art: setErfassen() holt nichts aus dem Netz, Katalog und geschätzter Preis kommen von hier.
  // Scheitert der Katalog, versucht es der Auftrag noch einmal.
  await setErgaenzen(sk, setNumber, userId, null, artWunsch !== 'csv');
  pruefeAbbruch(lauf);
  const art = artWunsch === 'ergaenzen' ? 'neu' : artWunsch;
  // Ein gescheiterter Schritt hält die übrigen nicht auf, steht aber im Stand des Auftrags.
  const ohne: string[] = [];
  const schritt = async (name: string, arbeit: () => Promise<unknown>) => {
    if (!(await versuche(`nacharbeit:${name} ${setNumber}`, arbeit)).ok) ohne.push(name);
  };
  // Die Figuren in jedem Zweig: Der Import behält den Lagerort vorhandener
  // Figuren, und so holt ein Zweiterfassen nach, was beim ersten Mal scheiterte.
  await importiereFiguren(sk, setNumber, userId);
  await importiereTeile(sk, setNumber, userId);
  pruefeAbbruch(lauf);

  if (art === 'zweit') await schritt('bl-nummern', () => sk.katalog.blNummernNachladen(lauf));
  if (art === 'neu') {
    await schritt('preis', () => sk.finanzen.preisFuerSetHolen(setNumber, userId));
    await schritt('anleitung', () => sk.katalog.ladeSetAnleitungen(setNumber));
  } else {
    await schritt('anleitung-einreihen', () => sk.auftraege.anleitungEinreihen(setNumber));
  }
  pruefeAbbruch(lauf);
  await schritt('teile-anreichern', () => sk.katalog.reichereSetTeileAn(setNumber));
  await schritt('figuren-anreichern', () => sk.katalog.reichereSetFigurenAn(setNumber));
  // Brickset füllt nur Lücken; der CSV-Import fragt es beim Anlegen nicht.
  if (art === 'csv') await schritt('brickset', () => sk.katalog.fuelleAusBrickset(setNumber));
  pruefeAbbruch(lauf);
  await schritt('bilder', () => sk.katalog.ladeSetBilder(setNumber));
  if (ohne.length) await lauf?.fortschritt?.({ text: `ohne ${ohne.join(', ')}`, ohne });
}

async function ladeSetBilder(k: SetsKontext, setNumber: string, lauf?: AuftragsLauf): Promise<void> {
  await k.katalog.ladeSetBilder(setNumber);
  pruefeAbbruch(lauf);
  await k.katalog.reichereSetFigurenAn(setNumber);
}

export { zieheNach, ladeSetBilder };
