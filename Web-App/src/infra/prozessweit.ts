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
  bildCacheZuwachs: 'der Bildcache ist ein Ordner auf der Platte dieses Rechners, gleich welcher Zugang ihn füllt',
  konfig: 'die Umgebung des Prozesses, einmal gelesen; konfig() steht im heissen Pfad jeder Anfrage',
  appVersion: 'version.json des Baus, aus dem dieser Prozess läuft',
  datenSchluessel: 'der Datenschlüssel kommt aus Umgebung oder Datei des Rechners, nicht aus einem Zugang',
  protokoll: 'stdout und der Puffer nach app_logs gehören dem Prozess; jede console-Zeile läuft hindurch',
  anfrageKennung: 'laufende Kennung je Anfrage dieses Prozesses, nur für das Protokoll',
  tlsStand: 'das Zertifikat liegt als Datei auf diesem Rechner; neu gelesen, wenn sie sich ändert',
  assetStempel: 'Stempel der Dateien unter public/, gleich für jeden Zugang',
  haeufigePasswoerter: 'mitgelieferte Liste neben dem Code, unveränderlich',
  basisUrlGemeldet: 'eine Warnung je Bereich und Prozess, sonst flutete sie das Protokoll',
  cspBericht: 'Drossel der CSP-Berichte: Sie schützt das Protokoll dieses Prozesses, gleich welcher Zugang',
  offeneStroeme: 'offene SSE-Antworten dieses Prozesses; das Herunterfahren beendet sie',
  zugangsHoerer: 'offene Ströme dieses Prozesses horchen auf das Ende ihres Zugangs',
  attestationWurzeln: 'Zertifikatswurzeln aus der Konfiguration, gleich für jeden Zugang',
  indexHtml: 'index.html liegt einmal auf der Platte; das Design wird kurz gemerkt, statt je Seite zu fragen',
  platzhalterBild: 'Inhalt einer Datei aus public/, für jeden Zugang derselbe und beim Blättern dutzendfach gebraucht',
} as const;

const faecher = new Faecher();

export function prozessweit<T>(name: keyof typeof GRUENDE, erzeuge: () => T): T {
  return faecher.fach(name, erzeuge);
}
