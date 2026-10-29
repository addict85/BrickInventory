import * as db from '../db/database';
import { getSetInfo } from '../clients/brickset';
import { downloadSetInstructions, anzahlAnleitungen } from '../utils/instructions';
import { getLimitForApi, getRateLimitStatus } from '../utils/financeCalc';
import { logAndContinue, meldeUndWeiter, meldeUndLiefere } from '../utils/httpError';
import * as db2 from '../db/database';
import * as lockNamespaces from '../utils/lockNamespaces';
import { LOCKS } from '../utils/lockNamespaces';

/**
 * Die Brickset-Wiederholungsschlange.
 * Ausführlich: docs/begruendungen/jobs/bricksetRetry.ts.md#abschnitt
 */

// Process retry queue — called at startup, daily at 02:00, and when limit is increased
// Uses a PostgreSQL advisory lock so only one cluster worker runs at a time
// Pass force=true to also process entries scheduled for future dates (e.g. after limit increase)
/**
 * Warteschlange abarbeiten — im Cluster immer nur ein Worker gleichzeitig.
 * Ausführlich: docs/begruendungen/jobs/bricksetRetry.ts.md#processretryqueue
 */
async function _processRetryQueue(force = false) {
  const today = new Date().toISOString().slice(0, 10);
  // force=true: process all entries regardless of retry_after (used when limit is increased)
  const due = await db.all(
    force
      ? `SELECT set_number FROM brickset_retry_queue ORDER BY retry_after`
      : `SELECT set_number FROM brickset_retry_queue WHERE retry_after <= $1`,
    force ? [] : [today]
  ).catch(meldeUndLiefere('brickset-retry:due', []));
  if (!due.length) { console.log('[brickset] Retry queue empty'); return; }
  console.log(`[brickset] Processing retry queue: ${due.length} sets${force ? ' (forced — limit increased)' : ''}`);

  let processed = 0, stopped = false;
  for (const { set_number } of due) {
    // Check remaining quota before each call — stop if exhausted
    try {
      const [limit, status] = await Promise.all([getLimitForApi('brickset'), getRateLimitStatus('brickset')]);
      const remaining = Math.max(0, limit - (status.count || 0));
      if (remaining <= 0) {
        console.log(`[brickset] Quota exhausted during retry queue — stopping (${processed}/${due.length} processed)`);
        stopped = true;
        break;
      }
    } catch (e) { meldeUndWeiter('brickset-retry:kontingent', e); }

    try {
      // Retry set info
      const info = await getSetInfo(set_number);
      if (info) {
        // Hier stand dasselbe UPDATE noch einmal auf `sets` — die Abschrift
        // der Stammdaten an jeder Bestandszeile. Mit Migration 0033 gibt es
        // nur noch den Katalog, und damit nur noch EINE Anweisung. Genau das
        // war der Grund: Zwei Schreibstellen aus derselben Antwort, und eine
        // davon konnte scheitern oder vergessen werden.
        await db.run(
          `UPDATE set_catalog SET
            name    = COALESCE(name, $1),    year     = COALESCE(year, $2),
            theme   = COALESCE(theme, $3),   pieces   = COALESCE(pieces, $4),
            minifigs = COALESCE(minifigs, $5)
           WHERE set_number = $6`,
          [info.name, info.year, info.theme, info.pieces, info.minifigs, set_number]
        // Das Protokoll gehoert jetzt HIER her. Es stand am UPDATE auf `sets`,
        // mit der Begruendung „Ohne Protokoll sieht ein erfolgloser Nachlauf
        // aus wie ein erfolgreicher" — und am Katalog, der ueberlebenden
        // Haelfte, stand ein stiller Fang. Seit Migration 0033 ist das die
        // einzige Schreibstelle: Scheitert sie, bleibt das Set namenlos.
        ).catch(logAndContinue(`brickset-nachlauf:set ${set_number}`));
        console.log(`[brickset] Retry OK: ${set_number}`);
        processed++;
      }
    } catch (e) { meldeUndWeiter('brickset-retry:eintrag', e); }

    // Retry instructions if none exist yet
    try {
      if (await anzahlAnleitungen(set_number) === 0) {
        // Echter Import statt spätem require('../routes/sets') samt
        // typeof-Prüfung: Der Kreis brickset → sets → brickset ist mit dem
        // Umzug nach utils/instructions.ts weg.
        await downloadSetInstructions(set_number).catch(logAndContinue('brickset-retry:downloadSetInstructions'));
      }
    } catch (e) { meldeUndWeiter('brickset-retry:anleitungen', e); }

    await new Promise(r => setTimeout(r, 1000));
  }

  if (!stopped) console.log(`[brickset] Retry queue processing done (${processed}/${due.length} processed)`);
}

async function processRetryQueue(force = false) {
    const client = await db2.pool.connect();
  let acquired = false;
  try {
    const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCKS.BRICKSET_RETRY]).catch(meldeUndLiefere('brickset-retry:pg_try_advisory_lock', null));
    acquired = !!r?.rows?.[0]?.ok;
    if (!acquired) { console.log('[brickset] processRetryQueue skipped — another worker is running'); return; }
    await _processRetryQueue(force);
  } finally {
    if (acquired) await client.query('SELECT pg_advisory_unlock($1)', [lockNamespaces.LOCKS.BRICKSET_RETRY]).catch(logAndContinue('brickset-retry:pg_advisory_unlock'));
    client.release();
  }
}

export { processRetryQueue };
