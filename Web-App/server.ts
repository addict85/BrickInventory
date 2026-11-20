// Zuerst: Ein ungültiger Wert beendet den Start mit Meldung, bevor ein Modul ihn liest.
import { konfig } from './startup/checkConfig';
// Protokoll zuerst: Ab hier ist jede console-Zeile eine JSON-Zeile und geht
// nach app_logs, sobald der Pool steht.
import { installLog, logInDieDatabase, emptyLog } from './src/infra/log';
installLog();

import http, { type Server } from 'node:http';
import type { Db } from './db/database';
import { fehlertext, logAndContinue } from './src/infra/error';
import { startBans, startWarnings } from './src/infra/config';
import { hintWithoutBaseUrl } from './src/infra/basisUrl';
import { prepareDatabaseBefore } from './startup/database';
import { startJobs, stopJobs, type JobsLauf } from './startup/jobsProcess';
import { wireProcess, type Dienste } from './startup/wiring';
import { baueApp } from './startup/app';
import { HTTP_DEADLINES } from './src/infra/httpDeadlines';
import { closeAllSse } from './src/http/sseRegistry';

import { closeBufferAndTicks } from './startup/shutdown';
import { holdWebLock } from './startup/singleInstance';
import { inSystemContext } from './src/infra/accountContext';

// Nur loggen: Ein abgelehntes Versprechen ist meist ein Nebenläufer ohne catch;
// Anfragen und Jobs halten ihren Zustand in der Datenbank. Ein Neustart risse
// dafür alle laufenden Anfragen und Ströme ab (anders als uncaughtException).
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', fehlertext(reason));
});
process.on('uncaughtException', err => {
  // Der Zustand ist danach ungewiss (halb offene Transaktionen); den Neustart übernimmt Docker.
  console.error('[uncaughtException] Uncaught exception:', err.stack || err.message);
  void emptyLog();
  setTimeout(() => process.exit(1), 500).unref();
});

// Die Platzhalter aus compose.yaml/README sind öffentlich: Mit ihnen
// signierte Sitzungen könnte jeder selbst erzeugen.
const PLACEHOLDER_SECRETS = [
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
      (konfig().production ? '.' : ', oder für die Entwicklung NODE_ENV=development.')
    : PLACEHOLDER_SECRETS.includes(gesetzt)
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

/** Was der Start hält und das Beenden braucht; ein zweites Signal findet `endedBecomes`. */
interface Lauf {
  endedBecomes: boolean;
  jobs: JobsLauf | null;
}

async function shutdown(
  lauf: Lauf,
  signal: string,
  httpServer: Server | null,
  jobs: boolean,
  zugang: Db,
  dienste: Dienste,
  webLockFree: (() => Promise<void>) | null,
): Promise<void> {
  if (lauf.endedBecomes) return;
  lauf.endedBecomes = true;
  console.log(`[shutdown] ${signal} empfangen — Server wird geordnet beendet`);
  // Notbremse für eine hängende Verbindung; Exit-Code 0, denn sie ist kein Fehler.
  const emergencyBrake = setTimeout(() => {
    console.warn('[shutdown] Frist abgelaufen — Beenden wird erzwungen');
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  emergencyBrake.unref();
  try {
    if (httpServer) {
      const beendet = closeAllSse();
      if (beendet) console.log(`[shutdown] ${beendet} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
    }
    // Laufende Aufträge halten sicher an und gehen zurück in die Tabelle.
    if (jobs && lauf.jobs) await stopJobs(dienste, lauf.jobs);
    await closeBufferAndTicks(zugang, dienste);
    await webLockFree?.();
    await zugang.pool.end().catch(logAndContinue('server:end'));
    console.log('[shutdown] Datenbankverbindungen geschlossen');
    clearTimeout(emergencyBrake);
    process.exit(0);
  } catch (e) {
    console.error('[shutdown] Fehler beim Beenden:', fehlertext(e));
    process.exit(1);
  }
}

/** Ein Prozess je Rolle (ROLLE=web|jobs|beides); initSchemaOnce lässt nur einen migrieren. */
async function starte(): Promise<void> {
  const k = konfig();
  if (k.operation) {
    const bans = startBans();
    if (bans.length) {
      for (const v of bans) console.error(`❌ ${v}`);
      process.exit(1);
    }
    for (const w of startWarnings()) console.warn(`⚠️ ${w}`);
  }
  for (const v of k.veraltet)
    console.warn(`⚠️ [start] ${v} wird nicht mehr ausgewertet und kann weg (siehe UPGRADE.md).`);
  if (!k.appBaseUrl)
    hintWithoutBaseUrl(
      'start',
      'Mails enthalten keine Links (Bestätigung, Passwort vergessen), Passkeys und QR-Code der App sind aus.',
    );
  const web = k.rolle !== 'jobs',
    jobs = k.rolle !== 'web';
  if (!k.appBaseUrl && k.operation && web)
    console.error(
      '❌ [start] APP_BASE_URL fehlt im Betrieb (APP_BASE_URL_FEHLT_OK=1): ' +
        'Der Host-Filter gegen DNS-Rebinding nimmt nur Loopback und IP-Adressen an, jeder Name bekommt 421.',
    );
  const geheimnis = web ? sitzungsGeheimnis() : ''; // vor der Datenbank: Ein Startverbot soll nicht auf sie warten
  console.log(`[start] Prozess ${process.pid}, Rolle ${k.rolle}`);
  // Datenbankzugang und Verdrahtung entstehen hier, nicht beim Import eines Moduls;
  // Erfassungen und Einstellungen stossen ihre Nacharbeit in jedem Prozess an.
  const { db: zugang, dienste } = wireProcess();

  try {
    // Migrationen, Erststart und Umschlüsselung gehen über alle Konten.
    await inSystemContext('start', () => prepareDatabaseBefore(zugang, dienste, { jobs }));
  } catch (e) {
    console.error('❌ Database initialisation failed:', fehlertext(e));
    console.error('   Check PostgreSQL connection settings (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
    process.exit(1);
  }
  logInDieDatabase(zugang.pool);
  const webLockFree = web
    ? await holdWebLock(zugang).catch((e: unknown) => {
        console.error(`❌ [start] ${fehlertext(e)}`);
        process.exit(1);
      })
    : null;
  // Hinweise ins Protokoll: Einer, der scheitert, hält weder den Start noch die übrigen auf.
  const hinweise: [string, () => Promise<unknown>][] = [
    ['start:smtp-altlast', () => dienste.mail.reportSmtpLegacySetting()],
    ...dienste.account.adressHints(),
  ];
  if (web) for (const [wo, hinweis] of hinweise) await hinweis().catch(logAndContinue(wo));
  if (web) dienste.account.listenOnRevocation();
  // Web und Jobs (auch getrennte Prozesse) leeren ihr Haushaltsgedächtnis auf jede Änderung.
  dienste.household.listenOnChanges();
  // Ein globaler Wert aus einem anderen Prozess (Nachlauf, zweiter Web-Prozess) leert den Einrichtungsstand.
  if (web) dienste.settings.listenForGlobalChanges();

  // Erst nach dem Schema Anfragen annehmen: Der Sitzungsspeicher braucht user_sessions.
  const httpServer = web
    ? http
        .createServer(
          { ...HTTP_DEADLINES },
          baueApp({ pool: zugang.systemWebPool, konfig: k, sitzungsGeheimnis: geheimnis, dienste }),
        )
        .listen(k.port, () => {
          console.log(`🧱 BrickInventory Manager — http://localhost:${k.port}`);
        })
    : null;
  const lauf: Lauf = { endedBecomes: false, jobs: null };
  process.on('SIGTERM', () => {
    void shutdown(lauf, 'SIGTERM', httpServer, jobs, zugang, dienste, webLockFree);
  });
  process.on('SIGINT', () => {
    void shutdown(lauf, 'SIGINT', httpServer, jobs, zugang, dienste, webLockFree);
  });
  // Ohne Rahmen: Warteschlange und Aufträge betreten ihn selbst (src/jobQueue/context.ts, dienst.ts).
  if (jobs) lauf.jobs = await startJobs(dienste);
}

// Ohne Worker weiterzulaufen täuschte einen Dienst vor.
starte().catch((e: unknown) => {
  console.error('❌ [start] Start gescheitert:', fehlertext(e));
  process.exit(1);
});
