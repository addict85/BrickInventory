'use strict';
/**
 * Instruction download queue — persistent, survives restarts.
 * - Sets are added to instruction_queue when imported
 * - Worker processes pending entries respecting Brickset 100/day limit
 * - Pauses when daily limit reached, resumes next day automatically
 * - Backs off on Cloudflare 1015: 5min → 10min → 15min → 20min → next day
 *
 * ── Ein Prozess arbeitet, alle dürfen anstossen ─────────────────────────────
 * `_running`, `_timer` und der Cloudflare-Backoff lagen im Speicher EINES
 * Prozesses, die Warteschlange wurde aber aus drei Request-Handlern heraus
 * direkt angestossen (Set erfassen, CSV-Import, Admin-Reimport). Die laufen im
 * bearbeitenden Cluster-Worker, wo `_running` false war — dort startete also
 * eine zweite Abarbeitung derselben Warteschlange:
 *
 *   - Zwei Prozesse zogen mit `WHERE status='pending' … LIMIT 1` DIESELBE
 *     Zeile und holten die Anleitung zweimal (doppelt verbrauchtes
 *     Brickset-Tageskontingent, zwei Downloads auf denselben Dateinamen).
 *   - Der Cloudflare-Backoff galt nur im Prozess, der die 1015 gesehen hat —
 *     der andere lief weiter und holte sich die nächste Sperre.
 *   - Die 15-Sekunden-Drossel zwischen zwei Anfragen halbierte sich.
 *
 * Zwei Kommentare an den Aufrufstellen sagten „direkter processNext() falls
 * DIESER Prozess der Primary ist" — geprüft hat das nie jemand, processNext()
 * kannte den Primary gar nicht.
 *
 * Jetzt gilt:
 *   1. Request-Handler rufen `requestRun()` — das setzt nur das Flag
 *      `instr_queue_trigger`, das der Primary ohnehin schon pollt.
 *   2. `processNext()` hält für die Dauer EINES Eintrags eine
 *      prozessübergreifende Sperre (pg_try_advisory_lock). Wer sie nicht
 *      bekommt, geht wieder — ein künftiger Direktaufruf kann also nichts
 *      mehr verdoppeln. Die Regel hängt damit am Job, nicht an den
 *      Aufrufstellen.
 *   3. Die Nachfolge-Zeitgeber laufen nur im Prozess, in dem `start()` lief
 *      (also im Primary) — siehe `_driver`.
 *   4. Die Cloudflare-Pause steht in der Datenbank statt im Prozessspeicher
 *      und überlebt damit auch einen Neustart. Vorher nahm ein Neustart die
 *      Sperre nicht zur Kenntnis und lief 3 Sekunden später wieder los.
 */
const db      = require('../db/database');
import { downloadSetInstructions, letzterAbrufWarExtern } from '../utils/instructions';
const path     = require('path');
const monitor  = require('../utils/jobMonitor');
const { logAndContinue } = require('../utils/httpError');

let _running        = false;   // billiger Schutz IM eigenen Prozess
let _timer: NodeJS.Timeout | null = null;
let _driver         = false;   // true nur dort, wo start() lief (Primary)

/**
 * Namensraum der prozessübergreifenden Sperre für die Anleitungs-Warteschlange.
 *
 * Welche Zahl das ist und welche sonst belegt sind, steht seit Nachtrag 149 in
 * utils/lockNamespaces.ts. Hier stand eine Abschrift davon — die vollständigste
 * im Projekt, und trotzdem eine, die beim nächsten Zusatz veraltet wäre.
 */
const { LOCKS } = require('../utils/lockNamespaces');
const QUEUE_LOCK = LOCKS.ANLEITUNGS_QUEUE;

/** Schlüssel der Cloudflare-Pause in global_settings. */
const BLOCK_KEY = 'instr_queue_block';

const CF_DELAYS_MS  = [
  5  * 60 * 1000,   // 1st block: 5 min
  10 * 60 * 1000,   // 2nd block: 10 min
  15 * 60 * 1000,   // 3rd block: 15 min
  20 * 60 * 1000,   // 4th block: 20 min
  // after 4th: pause until next day
];

/**
 * Sperre für die Dauer EINES Eintrags — auf einer eigenen Verbindung, weil
 * Advisory-Locks an der Session hängen und über den Pool sonst Sperren und
 * Freigeben auf verschiedenen Verbindungen landen (siehe die ausführliche
 * Begründung in clients/brickset.ts).
 *
 * @returns Freigabefunktion, oder null wenn ein anderer Prozess gerade arbeitet
 */
async function acquireQueueLock(): Promise<(() => Promise<void>) | null> {
  let client;
  try { client = await db.pool.connect(); }
  catch (e: any) {
    // Ohne Verbindung geht ohnehin nichts — der Aufrufer bricht ab.
    console.warn('[instr-queue] Sperre nicht verfügbar:', e?.message || e);
    return null;
  }
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [QUEUE_LOCK]);
    if (!rows[0]?.ok) { client.release(); return null; }
  } catch (e: any) {
    client.release();
    console.warn('[instr-queue] Sperre nicht verfügbar:', e?.message || e);
    return null;
  }
  return async () => {
    try { await client.query('SELECT pg_advisory_unlock($1, 0)', [QUEUE_LOCK]); }
    catch (e: any) { console.warn('[instr-queue] Sperre nicht freigegeben:', e?.message || e); }
    finally { client.release(); }
  };
}

/** Cloudflare-Pause lesen: { until: ms-Zeitpunkt, retries: Anzahl } */
async function readBlock(): Promise<{ until: number; retries: number }> {
  const row = await db.get('SELECT value FROM global_settings WHERE key=$1', [BLOCK_KEY]).catch(() => null);
  if (!row?.value) return { until: 0, retries: 0 };
  try {
    const o = JSON.parse(row.value);
    return { until: parseInt(o?.until) || 0, retries: parseInt(o?.retries) || 0 };
  } catch { return { until: 0, retries: 0 }; }
}

async function writeBlock(until: number, retries: number) {
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [BLOCK_KEY, JSON.stringify({ until, retries })]
  ).catch(logAndContinue('instr-queue:block-schreiben'));
}

async function clearBlock() {
  await db.run('DELETE FROM global_settings WHERE key=$1', [BLOCK_KEY])
    .catch(logAndContinue('instr-queue:block-loeschen'));
}

async function enqueue(setNumber: string) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  await db.run(
    `INSERT INTO instruction_queue (set_number, status) VALUES ($1, 'pending')
     ON CONFLICT (set_number) DO UPDATE SET status='pending', updated_at=NOW()`,
    [n]
  ).catch(() => {});
}

/**
 * Abarbeitung ANSTOSSEN — für alles ausserhalb des Primary-Workers.
 *
 * Setzt nur das Flag, das der Primary alle 3 Sekunden abfragt (siehe start()).
 * Kein direkter processNext(): Der Zeitgeber-Faden gehört in genau einen
 * Prozess, sonst laufen zwei Ketten mit eigener Drossel nebeneinander.
 */
async function requestRun() {
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ('instr_queue_trigger', NOW()::TEXT)
     ON CONFLICT (key) DO UPDATE SET value = NOW()::TEXT`
  ).catch(logAndContinue('instr-queue:trigger'));
}

async function processNext() {
  if (_running) return;
  _running = true;
  let release: null | (() => Promise<void>) = null;
  try {
    release = await acquireQueueLock();
    if (!release) return;   // anderer Prozess arbeitet die Warteschlange gerade ab

    // Cloudflare-Pause gilt prozessübergreifend.
    const block = await readBlock();
    if (block.until > Date.now()) {
      scheduleNext(Math.min(block.until - Date.now() + 1000, 5 * 60 * 1000));
      return;
    }

    const row = await db.get(
      `SELECT id, set_number FROM instruction_queue
       WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
    );
    if (!row) return;

    const existing = await db.get(
      'SELECT COUNT(*) as c FROM shared_instructions WHERE set_number = $1',
      [row.set_number]
    );
    if (parseInt(existing?.c) > 0) {
      await db.run(`UPDATE instruction_queue SET status='done', updated_at=NOW() WHERE id=$1`, [row.id]);
      scheduleNext(100);
      return;
    }

    try {
      const totals = await db.get(`SELECT
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='done'    THEN 1 ELSE 0 END) as done,
        COUNT(*) as total FROM instruction_queue`).catch(()=>null);
      const done  = parseInt(totals?.done||0);
      const total = parseInt(totals?.total||0);
      monitor.update('instrQueue', {
        status: 'running', progress: done, total,
        sub: `${row.set_number} (${done+1}/${total})`
      });

      // Bis Nachtrag 127 stand hier ein require('../routes/sets') im try, dahinter
      // eine typeof-Prüfung und ein stiller Abbruch. Beides war nötig, weil
      // niemand garantieren konnte, dass der Name zur Laufzeit existiert — und
      // genau dieser Fall ist in Nachtrag 131 zweimal eingetreten. Mit dem
      // echten Import prüft tsc den Namen; der Abbruchpfad entfällt.
      // eigenerTakt: Die Pausen IN der Funktion entfallen — diese Schlange
      // wartet unten selbst 15 Sekunden. Zusammen waren es 20 (Nachtrag 142).
      const count = await downloadSetInstructions(row.set_number, null, true);
      if (block.retries || block.until) await clearBlock(); // Erfolg — Backoff zurücksetzen
      await db.run(`UPDATE instruction_queue SET status='done', updated_at=NOW() WHERE id=$1`, [row.id]);
      console.log(`[instr-queue] ${row.set_number}: ${count} instructions`);
      db.get(`SELECT COUNT(*) as c FROM instruction_queue WHERE status='pending'`)
        .then((r: any) => {
          const rem = parseInt(r?.c||0);
          monitor.update('instrQueue', {
            status: rem > 0 ? 'running' : 'done',
            progress: total - rem, total,
            sub: rem > 0 ? `${rem} ausstehend` : 'Alle erledigt'
          });
        }).catch(()=>{});
      // ── Takt nur nach einem ECHTEN Abruf (Nachtrag 142) ──────────────────
      //
      // Die 15 Sekunden schonen Brickset und brickinstructions.com. Sets, die
      // schon eine Anleitung haben, fallen in downloadSetInstructions() sofort
      // heraus, OHNE eine Verbindung zu öffnen — für die gibt es nichts zu
      // schonen.
      //
      // Vorher wartete die Schlange auch dort: Bei 800 Sets, von denen 700
      // längst versorgt sind, waren das knapp drei Stunden für nichts.
      scheduleNext(letzterAbrufWarExtern() ? 15000 : 250);

    } catch(e) {
      const msg = e.message || '';

      if (e.isCloudflare || msg.includes('1015')) {
        if (_timer) { clearTimeout(_timer); _timer = null; }

        if (block.retries < CF_DELAYS_MS.length) {
          const delayMs = CF_DELAYS_MS[block.retries];
          const delayMin = Math.round(delayMs / 60000);
          await writeBlock(Date.now() + delayMs, block.retries + 1);
          console.log(`[instr-queue] Cloudflare 1015 — pausing ${delayMin} min (attempt ${block.retries + 1}/${CF_DELAYS_MS.length})`);
          monitor.update('instrQueue', {
            status: 'idle',
            sub: `Cloudflare-Sperre: ${delayMin} min warten (Versuch ${block.retries + 1})`
          }).catch(()=>{});
          scheduleNext(delayMs + 1000);
        } else {
          console.log(`[instr-queue] Cloudflare 1015 after max retries — pausing until tomorrow`);
          monitor.update('instrQueue', { status: 'idle', sub: 'Cloudflare-Sperre: bis morgen pausiert' }).catch(()=>{});
          await writeBlock(nextMidnight().getTime(), 0);
          scheduleMidnight();
        }
        return;
      }

      if (msg.includes('Tageslimit') || msg.includes('rate limit') || msg.includes('429')) {
        console.log(`[instr-queue] Daily limit reached, pausing until tomorrow`);
        scheduleMidnight();
      } else {
        await db.run(`UPDATE instruction_queue SET status='failed', updated_at=NOW() WHERE id=$1`, [row.id]);
        console.log(`[instr-queue] ${row.set_number} failed: ${msg}`);
        scheduleNext(15000);
      }
    }
  } catch(e) {
    console.error('[instr-queue] error:', e.message);
    scheduleNext(2000);
  } finally {
    _running = false;
    if (release) await release();
  }
}

/**
 * Nachfolge-Zeitgeber — nur im Prozess, in dem start() lief.
 *
 * Ohne diese Bedingung würde ein Direktaufruf aus einem Request-Worker dort
 * eine zweite Zeitgeber-Kette starten: erlaubt zwar durch die Sperre keine
 * gleichzeitige Arbeit, halbiert aber die 15-Sekunden-Drossel, weil zwei
 * Ketten unabhängig voneinander takten.
 */
function scheduleNext(delayMs = 500) {
  if (!_driver) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(processNext, delayMs);
}

function nextMidnight() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(0, 5, 0, 0); // 00:05 next day
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function scheduleMidnight() {
  if (!_driver) return;
  if (_timer) clearTimeout(_timer);
  const next = nextMidnight();
  const ms = next.getTime() - Date.now();
  console.log(`[instr-queue] Resuming at ${next.toLocaleTimeString('de-CH')} (in ${Math.round(ms/3600000*10)/10}h)`);
  _timer = setTimeout(() => { processNext(); }, ms);
}

function start() {
  _driver = true;   // ab hier laufen die Nachfolge-Zeitgeber in DIESEM Prozess
  // Resume any pending items from before restart
  db.get(`SELECT COUNT(*) as c FROM instruction_queue WHERE status='pending'`)
    .then((row: any) => {
      const pending = parseInt(row?.c || 0);
      if (pending > 0) {
        console.log(`[instr-queue] ${pending} pending instructions — resuming`);
        db.get(`SELECT COUNT(*) as c FROM instruction_queue`).then((t2: any) => {
          const totalAll = parseInt(t2?.c||0);
          monitor.update('instrQueue', {
            status: 'running',
            progress: totalAll - pending,
            total: totalAll,
            sub: `${pending} ausstehend`
          });
        }).catch(()=>{});
        scheduleNext(3000); // wait 3s after startup
      } else {
        db.get(`SELECT COUNT(*) as c FROM instruction_queue`).then((t: any) => {
          const tot = parseInt(t?.c||0);
          if (tot > 0) monitor.update('instrQueue', { status: 'done', progress: tot, total: tot, sub: 'Alle erledigt' });
        }).catch(()=>{});
      }
    })
    .catch(() => {});

  // Poll every 3s for trigger signals from other workers (e.g. admin reimport)
  setInterval(async () => {
    try {
      const row = await db.get(`SELECT value FROM global_settings WHERE key='instr_queue_trigger'`).catch(() => null);
      if (row?.value) {
        await db.run(`DELETE FROM global_settings WHERE key='instr_queue_trigger'`).catch(() => {});
        console.log('[instr-queue] Trigger received — starting queue processing');
        if (!_running) processNext().catch(() => {});
      }
    } catch(_) {}
  }, 3000);
}

export { enqueue, start, processNext, requestRun };
