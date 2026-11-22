/** State that deliberately belongs to the process and not to an access. Everything else is kept
 * by an area in its compartments (cache.ts), so that two accesses in one
 * process (tests, tools) do not deceive each other. Whoever stores something here
 * names the reason in REASONS; the ratchet in test/ratschen.test.js counts the rest. */
import { Compartments } from './cache';

export const REASONS = {
  accountLimit: 'gleichzeitige Uploads und Ströme je Konto belegen Speicher dieses Prozesses',
  loginFallback: 'Rückfall der Anmeldebremse, wenn die Datenbank klemmt: zählt gerade ohne sie',
  tokenSperre: 'Abkürzung der Fehlversuchssperre je Adresse; gezählt wird in der Datenbank',
  imageCacheGrowth: 'der Bildcache ist ein Ordner auf der Platte dieses Rechners, gleich welcher Zugang ihn füllt',
  config: 'die Umgebung des Prozesses, einmal gelesen; konfig() steht im heissen Pfad jeder Anfrage',
  appVersion: 'version.json des Baus, aus dem dieser Prozess läuft',
  dataKey: 'der Datenschlüssel kommt aus Umgebung oder Datei des Rechners, nicht aus einem Zugang',
  log: 'stdout und der Puffer nach app_logs gehören dem Prozess; jede console-Zeile läuft hindurch',
  requestId: 'laufende Kennung je Anfrage dieses Prozesses, nur für das Protokoll',
  tlsStand: 'das Zertifikat liegt als Datei auf diesem Rechner; neu gelesen, wenn sie sich ändert',
  assetStempel: 'Stempel der Dateien unter public/, gleich für jeden Zugang',
  commonPasswords: 'mitgelieferte Liste neben dem Code, unveränderlich',
  baseUrlReported: 'eine Warnung je Bereich und Prozess, sonst flutete sie das Protokoll',
  cspReport: 'Drossel der CSP-Berichte: Sie schützt das Protokoll dieses Prozesses, gleich welcher Zugang',
  openStreams: 'offene SSE-Antworten dieses Prozesses; das Herunterfahren beendet sie',
  accessListeners: 'offene Ströme dieses Prozesses horchen auf das Ende ihres Zugangs',
  attestationRoots: 'Zertifikatswurzeln aus der Konfiguration, gleich für jeden Zugang',
  indexHtml: 'index.html liegt einmal auf der Platte; das Design wird kurz gemerkt, statt je Seite zu fragen',
  metrics: 'counters and series of this process: every process is scraped on its own (/metrics)',
  placeholderImage: 'Inhalt einer Datei aus public/, für jeden Zugang derselbe und beim Blättern dutzendfach gebraucht',
  v1Names: 'die v1-Namen hängen an den Schemas des Vertrags, die es je Prozess einmal gibt',
} as const;

const compartments = new Compartments();

export function processWide<T>(name: keyof typeof REASONS, create: () => T): T {
  return compartments.slot(name, create);
}
