/** Zustand, der bewusst dem Prozess gehört und nicht einem Zugang. Alles andere hält
 * ein Bereich in seinen Fächern (zwischenspeicher.ts), damit zwei Zugänge in einem
 * Prozess (Tests, Werkzeuge) einander nichts vorspiegeln. Wer hier etwas ablegt,
 * nennt den Grund in GRUENDE; die Ratsche in test/ratschen.test.js zählt den Rest. */
import { Faecher } from './zwischenspeicher';

export const GRUENDE = {
  apiDrossel: 'Anfragebudget je Konto: schützt Rechenzeit und Speicher dieses Prozesses, gleich welcher Zugang',
  kontoSchranke: 'gleichzeitige Uploads und Ströme je Konto belegen Speicher dieses Prozesses',
  anmeldeRueckfall: 'Rückfall der Anmeldebremse, wenn die Datenbank klemmt: zählt gerade ohne sie',
  tokenSperre: 'Abkürzung der Fehlversuchssperre je Adresse; gezählt wird in der Datenbank',
  haushaltGedaechtnis:
    'je Zugang über den Schlüssel (das db-Objekt, auch einer Transaktion): Die Haushaltsdienste nehmen db, nicht k',
  bildCacheZuwachs: 'der Bildcache ist ein Ordner auf der Platte dieses Rechners, gleich welcher Zugang ihn füllt',
  importProzess: 'Pfad des Import-Skripts, das dieser Prozess als Kind startet; gesetzt vom Einstieg (jobs/)',
  platzhalterBild: 'Inhalt einer Datei aus public/, für jeden Zugang derselbe und beim Blättern dutzendfach gebraucht',
} as const;

const faecher = new Faecher();

export function prozessweit<T>(name: keyof typeof GRUENDE, erzeuge: () => T): T {
  return faecher.fach(name, erzeuge);
}
