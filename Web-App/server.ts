// Zuerst: Ein ungültiger Wert beendet den Start mit Meldung, bevor ein Modul ihn liest.
import { konfig } from './startup/konfigPruefen';
// Protokoll zuerst: Ab hier ist jede console-Zeile eine JSON-Zeile und geht
// nach app_logs, sobald der Pool steht.
import { installiereProtokoll, protokollInDieDatenbank, leereProtokoll } from './src/infra/protokoll';
installiereProtokoll();

import http, { type Server } from 'node:http';
import type { Db } from './db/database';
import { fehlertext, logAndContinue } from './src/infra/fehler';
import { startVerbote, startWarnungen } from './src/infra/konfig';
import { hinweisOhneBasisUrl } from './src/infra/basisUrl';
import { bereiteDatenbankVor } from './startup/datenbank';
import { starteJobs, stoppeJobs } from './startup/jobsProzess';
import { verdrahteProzess, type Dienste } from './startup/verdrahtung';
import { baueApp } from './startup/app';
import { HTTP_FRISTEN } from './src/infra/httpFristen';
import { closeAllSse } from './src/http/sseRegistry';

import { schliessePufferUndTakte } from './startup/abschluss';
import { halteWebSperre } from './startup/einzelinstanz';
import { imSystemkontext } from './src/infra/kontoKontext';

// Nur loggen: Ein abgelehntes Versprechen ist meist ein Nebenläufer ohne catch;
// Anfragen und Jobs halten ihren Zustand in der Datenbank. Ein Neustart risse
// dafür alle laufenden Anfragen und Ströme ab (anders als uncaughtException).
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', fehlertext(reason));
});
process.on('uncaughtException', err => {
  // Der Zustand ist danach ungewiss (halb offene Transaktionen); den Neustart übernimmt Docker.
  console.error('[uncaughtException] Uncaught exception:', err.stack || err.message);
  void leereProtokoll();
  setTimeout(() => process.exit(1), 500).unref();
});

// Die Platzhalter aus compose.yaml/README sind öffentlich: Mit ihnen
// signierte Sitzungen könnte jeder selbst erzeugen.
const PLATZHALTER_GEHEIMNISSE = [
  'change-me-to-a-long-random-string',
  'hier-langen-zufalls-string-eintragen',
  'brickinventory-manager-dev-secret',
];

/** Das Entwicklungsgeheimnis nur bei ausdrücklichem NODE_ENV=development/test;
 * ohne NODE_ENV gelten dieselben Regeln wie in Produktion. */
function sitzungsGeheimnis(): string {
  const gesetzt = konfig().sessionSecret?.trim();
  if (konfig().entwicklung) return gesetzt || 'brickinventory-manager-dev-secret';
  const grund = !gesetzt
    ? 'SESSION_SECRET ist nicht gesetzt — Start verweigert. Bitte in compose.yaml/ENV setzen' +
      (konfig().produktion ? '.' : ', oder für die Entwicklung NODE_ENV=development.')
    : PLATZHALTER_GEHEIMNISSE.includes(gesetzt)
      ? 'SESSION_SECRET steht noch auf dem Beispielwert aus compose.yaml — Start verweigert. Bitte einen eigenen Zufallswert eintragen, z. B. `openssl rand -base64 48`.'
      : gesetzt.length < 32
        ? 'SESSION_SECRET ist zu kurz (nötig sind mindestens 32 Zeichen) — Start verweigert.'
        : null;
  if (grund) {
    console.error(`❌ [session] ${grund}`);
    process.exit(1);
  }
  return konfig().sessionSecret!;
}

/** SSE-Ströme zuerst beenden: Sie enden nie von selbst und hielten close() auf.
 * Ohne geordnetes Ende bräche jedes Deploy laufende Antworten ab. */
const SHUTDOWN_TIMEOUT_MS = 8000;
let _beendetWird = false;

async function herunterfahren(
  signal: string,
  httpServer: Server | null,
  jobs: boolean,
  zugang: Db,
  dienste: Dienste,
  webSperreFrei: (() => Promise<void>) | null,
): Promise<void> {
  if (_beendetWird) return;
  _beendetWird = true;
  console.log(`[shutdown] ${signal} empfangen — Server wird geordnet beendet`);
  // Notbremse für eine hängende Verbindung; Exit-Code 0, denn sie ist kein Fehler.
  const notbremse = setTimeout(() => {
    console.warn('[shutdown] Frist abgelaufen — Beenden wird erzwungen');
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  notbremse.unref();
  try {
    if (httpServer) {
      const beendet = closeAllSse();
      if (beendet) console.log(`[shutdown] ${beendet} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
    }
    // Laufende Aufträge halten sicher an und gehen zurück in die Tabelle.
    if (jobs) await stoppeJobs(dienste);
    await schliessePufferUndTakte(zugang, dienste);
    await webSperreFrei?.();
    await zugang.pool.end().catch(logAndContinue('server:end'));
    console.log('[shutdown] Datenbankverbindungen geschlossen');
    clearTimeout(notbremse);
    process.exit(0);
  } catch (e) {
    console.error('[shutdown] Fehler beim Beenden:', fehlertext(e));
    process.exit(1);
  }
}

/** Ein Prozess je Rolle (ROLLE=web|jobs|beides); initSchemaOnce lässt nur einen migrieren. */
async function starte(): Promise<void> {
  const k = konfig();
  if (k.betrieb) {
    const verbote = startVerbote();
    if (verbote.length) {
      for (const v of verbote) console.error(`❌ ${v}`);
      process.exit(1);
    }
    for (const w of startWarnungen()) console.warn(`⚠️ ${w}`);
  }
  for (const v of k.veraltet)
    console.warn(`⚠️ [start] ${v} wird nicht mehr ausgewertet und kann weg (siehe UPGRADE.md).`);
  if (!k.appBaseUrl)
    hinweisOhneBasisUrl(
      'start',
      'Mails enthalten keine Links (Bestätigung, Passwort vergessen), Passkeys und QR-Code der App sind aus.',
    );
  const web = k.rolle !== 'jobs',
    jobs = k.rolle !== 'web';
  if (!k.appBaseUrl && k.betrieb && web)
    console.error(
      '❌ [start] APP_BASE_URL fehlt im Betrieb (APP_BASE_URL_FEHLT_OK=1): ' +
        'Der Host-Filter gegen DNS-Rebinding ist aus, jede Webseite im Heimnetz erreicht die Anmeldung.',
    );
  const geheimnis = web ? sitzungsGeheimnis() : ''; // vor der Datenbank: Ein Startverbot soll nicht auf sie warten
  console.log(`[start] Prozess ${process.pid}, Rolle ${k.rolle}`);
  // Datenbankzugang und Verdrahtung entstehen hier, nicht beim Import eines Moduls;
  // Erfassungen und Einstellungen stossen ihre Nacharbeit in jedem Prozess an.
  const { db: zugang, dienste } = verdrahteProzess();

  try {
    // Migrationen, Erststart und Umschlüsselung gehen über alle Konten.
    await imSystemkontext('start', () => bereiteDatenbankVor(zugang, dienste));
  } catch (e) {
    console.error('❌ Database initialisation failed:', fehlertext(e));
    console.error('   Check PostgreSQL connection settings (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
    process.exit(1);
  }
  protokollInDieDatenbank(zugang.pool);
  const webSperreFrei = web
    ? await halteWebSperre(zugang).catch((e: unknown) => {
        console.error(`❌ [start] ${fehlertext(e)}`);
        process.exit(1);
      })
    : null;
  // Hinweise ins Protokoll: Einer, der scheitert, hält weder den Start noch die übrigen auf.
  const hinweise: [string, () => Promise<unknown>][] = [
    ['start:smtp-altlast', () => dienste.mail.meldeSmtpAltlast()],
    ['start:adressen', () => dienste.konto.meldeUngueltigeAdressen()],
    ['start:ausstehende-adressen', () => dienste.konto.meldeAusstehendeAdressen()],
  ];
  if (web) for (const [wo, hinweis] of hinweise) await hinweis().catch(logAndContinue(wo));
  if (web) dienste.konto.horcheAufTokenWiderruf();

  // Erst nach dem Schema Anfragen annehmen: Der Sitzungsspeicher braucht user_sessions.
  const httpServer = web
    ? http
        .createServer(
          { ...HTTP_FRISTEN },
          baueApp({ pool: zugang.pool, konfig: k, sitzungsGeheimnis: geheimnis, dienste }),
        )
        .listen(k.port, () => {
          console.log(`🧱 BrickInventory Manager — http://localhost:${k.port}`);
        })
    : null;
  process.on('SIGTERM', () => {
    void herunterfahren('SIGTERM', httpServer, jobs, zugang, dienste, webSperreFrei);
  });
  process.on('SIGINT', () => {
    void herunterfahren('SIGINT', httpServer, jobs, zugang, dienste, webSperreFrei);
  });
  // Aufträge arbeiten über Kontogrenzen; HTTP-Anfragen erben diesen Rahmen nicht.
  if (jobs) await imSystemkontext('auftraege', () => starteJobs(dienste, web));
}

// Ohne Worker weiterzulaufen täuschte einen Dienst vor.
starte().catch((e: unknown) => {
  console.error('❌ [start] Start gescheitert:', fehlertext(e));
  process.exit(1);
});
