// First: an invalid value ends the start with a message before any module reads it.
import { konfig } from './startup/checkConfig';
// Logging first: from here on every console line is a JSON line and goes
// to app_logs as soon as the pool is up.
import { installLog, logToDatabase, emptyLog } from './src/infra/log';
installLog();

import http, { type Server } from 'node:http';
import type { Db } from './db/database';
import { errorMessage, logAndContinue } from './src/infra/error';
import { startBans, startWarnings } from './src/infra/config';
import { hintWithoutBaseUrl } from './src/infra/basisUrl';
import { prepareDatabaseBefore } from './startup/database';
import { startJobs, stopJobs, type JobsLauf } from './startup/jobsProcess';
import { wireProcess, type Services } from './startup/wiring';
import { buildApp } from './startup/app';
import { HTTP_DEADLINES } from './src/infra/httpDeadlines';
import { closeAllSse } from './src/http/sseRegistry';

import { closeBufferAndTicks } from './startup/shutdown';
import { holdWebLock } from './startup/singleInstance';
import { inSystemContext } from './src/infra/accountContext';

// Only log: a rejected promise is usually a side task without catch;
// requests and jobs keep their state in the database. A restart would tear
// down all running requests and streams for it (unlike uncaughtException).
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection] Unhandled promise rejection:', errorMessage(reason));
});
process.on('uncaughtException', err => {
  // The state is uncertain afterwards (half-open transactions); Docker takes care of the restart.
  console.error('[uncaughtException] Uncaught exception:', err.stack || err.message);
  void emptyLog();
  setTimeout(() => process.exit(1), 500).unref();
});

// The placeholders from compose.yaml/README are public: with them
// anyone could create signed sessions themselves.
const PLACEHOLDER_SECRETS = [
  'change-me-to-a-long-random-string',
  'hier-langen-zufalls-string-eintragen',
  'brickinventory-manager-dev-secret',
];

/** The development secret only with an explicit NODE_ENV=development/test;
 * without NODE_ENV the same rules as in production apply. */
function sessionSecret(): string {
  const assigned = konfig().sessionSecret?.trim();
  if (konfig().entwicklung) return assigned || 'brickinventory-manager-dev-secret';
  const grund = !assigned
    ? 'SESSION_SECRET ist nicht gesetzt — Start verweigert. Bitte in compose.yaml/ENV setzen' +
      (konfig().production ? '.' : ', oder für die Entwicklung NODE_ENV=development.')
    : PLACEHOLDER_SECRETS.includes(assigned)
      ? 'SESSION_SECRET steht noch auf dem Beispielwert aus compose.yaml — Start verweigert. Bitte einen eigenen Zufallswert eintragen, z. B. `openssl rand -base64 48`.'
      : assigned.length < 32
        ? 'SESSION_SECRET ist zu kurz (nötig sind mindestens 32 Zeichen) — Start verweigert.'
        : null;
  if (grund) {
    console.error(`❌ [session] ${grund}`);
    process.exit(1);
  }
  return konfig().sessionSecret!;
}

/** End SSE streams first: they never end by themselves and would hold up close().
 * Without an orderly end every deploy would cut running responses off. */
const SHUTDOWN_TIMEOUT_MS = 8000;

/** What the start holds and the shutdown needs; a second signal finds `endedBecomes`. */
interface Lauf {
  endedBecomes: boolean;
  jobs: JobsLauf | null;
}

async function shutdown(
  lauf: Lauf,
  signal: string,
  httpServer: Server | null,
  jobs: boolean,
  access: Db,
  dienste: Services,
  webLockFree: (() => Promise<void>) | null,
): Promise<void> {
  if (lauf.endedBecomes) return;
  lauf.endedBecomes = true;
  console.log(`[shutdown] ${signal} empfangen — Server wird geordnet beendet`);
  // Emergency brake for a hanging connection; exit code 0, because it is not an error.
  const emergencyBrake = setTimeout(() => {
    console.warn('[shutdown] Frist abgelaufen — Beenden wird erzwungen');
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  emergencyBrake.unref();
  try {
    if (httpServer) {
      const ended = closeAllSse();
      if (ended) console.log(`[shutdown] ${ended} offene Ereignis-Ströme beendet`);
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
      console.log('[shutdown] keine offenen HTTP-Verbindungen mehr');
    }
    // Running jobs stop safely and go back into the table.
    if (jobs && lauf.jobs) await stopJobs(dienste, lauf.jobs);
    await closeBufferAndTicks(access, dienste);
    await webLockFree?.();
    await access.pool.end().catch(logAndContinue('server:end'));
    console.log('[shutdown] Datenbankverbindungen geschlossen');
    clearTimeout(emergencyBrake);
    process.exit(0);
  } catch (e) {
    console.error('[shutdown] Fehler beim Beenden:', errorMessage(e));
    process.exit(1);
  }
}

/** One process per role (ROLLE=web|jobs|beides); initSchemaOnce lets only one migrate. */
async function start(): Promise<void> {
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
  const secret = web ? sessionSecret() : ''; // before the database: a start ban should not wait for it
  console.log(`[start] Prozess ${process.pid}, Rolle ${k.rolle}`);
  // Database access and wiring are created here, not on import of a module;
  // acquisitions and settings trigger their follow-up work in every process.
  const { db: access, dienste } = wireProcess();

  try {
    // Migrations, first start and re-keying go across all accounts.
    await inSystemContext('start', () => prepareDatabaseBefore(access, dienste, { jobs }));
  } catch (e) {
    console.error('❌ Database initialisation failed:', errorMessage(e));
    console.error('   Check PostgreSQL connection settings (PGHOST, PGUSER, PGPASSWORD, PGDATABASE)');
    process.exit(1);
  }
  logToDatabase(access.pool);
  const webLockFree = web
    ? await holdWebLock(access).catch((e: unknown) => {
        console.error(`❌ [start] ${errorMessage(e)}`);
        process.exit(1);
      })
    : null;
  // Hints into the log: one that fails holds up neither the start nor the others.
  const hints: [string, () => Promise<unknown>][] = [
    ['start:smtp-altlast', () => dienste.mail.reportSmtpLegacySetting()],
    ...dienste.account.addressHints(),
  ];
  if (web) for (const [wo, hint] of hints) await hint().catch(logAndContinue(wo));
  if (web) dienste.account.listenOnRevocation();
  // Web and jobs (also separate processes) clear their household memory on every change.
  dienste.household.listenOnChanges();
  // A global value from another process (follow-up run, second web process) clears the setup state.
  if (web) dienste.settings.listenForGlobalChanges();

  // Accept requests only after the schema: the session store needs user_sessions.
  const httpServer = web
    ? http
        .createServer(
          { ...HTTP_DEADLINES },
          buildApp({ pool: access.systemWebPool, konfig: k, sitzungsGeheimnis: secret, dienste }),
        )
        .listen(k.port, () => {
          console.log(`🧱 BrickInventory Manager — http://localhost:${k.port}`);
        })
    : null;
  const lauf: Lauf = { endedBecomes: false, jobs: null };
  process.on('SIGTERM', () => {
    void shutdown(lauf, 'SIGTERM', httpServer, jobs, access, dienste, webLockFree);
  });
  process.on('SIGINT', () => {
    void shutdown(lauf, 'SIGINT', httpServer, jobs, access, dienste, webLockFree);
  });
  // Without frame: queue and jobs enter it themselves (src/jobQueue/context.ts, service.ts).
  if (jobs) lauf.jobs = await startJobs(dienste);
}

// Continuing without a worker would fake a service.
start().catch((e: unknown) => {
  console.error('❌ [start] Start gescheitert:', errorMessage(e));
  process.exit(1);
});
