import * as db from '../db/database';
import { getSetInfo } from '../clients/brickset';
import { downloadSetInstructions } from '../utils/instructions';
import { getLimitForApi, getRateLimitStatus } from '../utils/financeCalc';
import { meldeUndWeiter } from '../utils/httpError';

/**
 * Die Brickset-Wiederholungsschlange.
 *
 * ── Warum sie nicht mehr im Client steht (Nachtrag 127) ─────────────────────
 *
 * Sie ist keine API-Anfrage, sondern Ablaufsteuerung: Sie liest eine Tabelle,
 * ruft den Client, und holt anschliessend Bauanleitungen nach. Genau dieses
 * letzte Stück machte den Client von utils/instructions.ts abhängig — und
 * utils/instructions.ts braucht den Client. Ein Kreis.
 *
 * Beim Umzug der Anleitungs-Kette habe ich ihn selbst erzeugt und ihn erst
 * bemerkt, als die Prüfung auf Zyklen anschlug: `import` löst so etwas nicht
 * wie ein spätes `require()` auf, sondern liefert zur Ladezeit `undefined` —
 * ein Fehler, der erst im Betrieb auffällt.
 *
 * Als eigener Job hängt sie an beiden, und beide hängen nicht an ihr.
 */

// Process retry queue — called at startup, daily at 02:00, and when limit is increased
// Uses a PostgreSQL advisory lock so only one cluster worker runs at a time
// Pass force=true to also process entries scheduled for future dates (e.g. after limit increase)
/**
 * Warteschlange abarbeiten — im Cluster immer nur ein Worker gleichzeitig.
 *
 * ── Warum eine EIGENE Verbindung ────────────────────────────────────────────
 * Advisory-Locks hängen an der SESSION, nicht an der Datenbank. Vorher liefen
 * pg_try_advisory_lock und pg_advisory_unlock über db.get()/db.run(), also
 * über den Verbindungspool — und der gibt für zwei Aufrufe in aller Regel
 * zwei verschiedene Verbindungen heraus.
 *
 * Die Freigabe griff damit nicht: Sie wurde auf einer Session ausgeführt, die
 * den Lock nie gehalten hatte (Postgres meldet dann nur eine Warnung, die
 * .catch() verschluckt hat). Der Lock blieb auf der ursprünglichen Verbindung
 * bestehen — solange die im Pool lebt, also praktisch dauerhaft. Ab dem ersten
 * Lauf hiess es deshalb bei JEDEM weiteren Aufruf "skipped — another worker is
 * running", obwohl gar keiner lief.
 *
 * Genau davor warnt der Kommentar in db/database.ts (initSchemaOnce) schon:
 * Lock und Unlock MÜSSEN auf derselben Session laufen. Hier fehlte die
 * Umsetzung.
 *
 * Mit pool.connect() ist die Verbindung für die Dauer des Laufs reserviert und
 * wird in finally freigegeben. Stürzt der Prozess dazwischen ab, beendet
 * Postgres die Session und gibt den Lock automatisch frei — es kann also auch
 * dann nichts hängenbleiben.
 */
async function _processRetryQueue(force = false) {
  const today = new Date().toISOString().slice(0, 10);
  // force=true: process all entries regardless of retry_after (used when limit is increased)
  const due = await db.all(
    force
      ? `SELECT set_number FROM brickset_retry_queue ORDER BY retry_after`
      : `SELECT set_number FROM brickset_retry_queue WHERE retry_after <= $1`,
    force ? [] : [today]
  ).catch(() => []);
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
        await db.run(
          `UPDATE sets SET
            name    = COALESCE(name, $1),    year     = COALESCE(year, $2),
            theme   = COALESCE(theme, $3),   pieces   = COALESCE(pieces, $4),
            minifigs = COALESCE(minifigs, $5)
           WHERE set_number = $6`,
          [info.name, info.year, info.theme, info.pieces, info.minifigs, set_number]
        ).catch(() => {});
        await db.run(
          `UPDATE set_catalog SET
            name    = COALESCE(name, $1),    year     = COALESCE(year, $2),
            theme   = COALESCE(theme, $3),   pieces   = COALESCE(pieces, $4),
            minifigs = COALESCE(minifigs, $5)
           WHERE set_number = $6`,
          [info.name, info.year, info.theme, info.pieces, info.minifigs, set_number]
        ).catch(() => {});
        console.log(`[brickset] Retry OK: ${set_number}`);
        processed++;
      }
    } catch (e) { meldeUndWeiter('brickset-retry:eintrag', e); }

    // Retry instructions if none exist yet
    try {
      const existing = await db.get(
        `SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1`, [set_number]
      ).catch(() => ({ c: 0 }));
      if (parseInt(existing?.c || 0) === 0) {
        // Echter Import statt spätem require('../routes/sets') samt
        // typeof-Prüfung: Der Kreis brickset → sets → brickset ist mit dem
        // Umzug nach utils/instructions.ts weg (Nachtrag 127).
        await downloadSetInstructions(set_number, null).catch(() => {});
      }
    } catch (e) { meldeUndWeiter('brickset-retry:anleitungen', e); }

    await new Promise(r => setTimeout(r, 1000));
  }

  if (!stopped) console.log(`[brickset] Retry queue processing done (${processed}/${due.length} processed)`);
}

async function processRetryQueue(force = false) {
  const db2 = require('../db/database');
  const client = await db2.pool.connect();
  let acquired = false;
  try {
    const { LOCKS } = require('../utils/lockNamespaces');
    const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCKS.BRICKSET_RETRY]).catch(() => null);
    acquired = !!r?.rows?.[0]?.ok;
    if (!acquired) { console.log('[brickset] processRetryQueue skipped — another worker is running'); return; }
    await _processRetryQueue(force);
  } finally {
    if (acquired) await client.query('SELECT pg_advisory_unlock($1)', [require('../utils/lockNamespaces').LOCKS.BRICKSET_RETRY]).catch(() => {});
    client.release();
  }
}

export { processRetryQueue };
