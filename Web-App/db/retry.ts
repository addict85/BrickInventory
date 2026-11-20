/** Retrying transient errors of a single query outside a transaction. */
import { fehlerCode } from '../src/infra/error';

const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57P03', // cannot_connect_now (PG starting up)
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);
/**
 * If the connection drops IN THE MIDDLE of the request, it is unknown whether it
 * was already committed. A read may run again, a write may
 * not — otherwise the row would exist twice.
 */
const ONLY_READING_RETRYABLE = new Set(['08006']);

/** Only a plain SELECT counts as reading; INSERT … RETURNING via get() does not. */
export function isReading(sql: string): boolean {
  const s = sql.replace(/--[^\n]*/g, '').trim();
  return /^(SELECT|WITH)\b/i.test(s) && !/\b(INSERT|UPDATE|DELETE|MERGE)\b|\bFOR\s+(UPDATE|SHARE)\b/i.test(s);
}

/** With retry on transient errors. */
export async function queryWithRetry<T>(queryFn: () => Promise<T>, lesend: boolean, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err) {
      lastErr = err;
      // An error without a code is not retryable.
      const code = fehlerCode(err) ?? '';
      const retryable = RETRYABLE_CODES.has(code) || (lesend && ONLY_READING_RETRYABLE.has(code));
      if (!retryable || attempt === maxRetries) throw err;
      const wait = 50 * 2 ** attempt; // 50 ms, 100 ms
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
