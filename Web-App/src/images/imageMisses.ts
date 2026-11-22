import { reportError } from '../infra/error';
import { attempts } from '../infra/result';
import type { ImagesContext } from './context';

/** Remembered ONCE, for all processes; after a week the question is asked again. */
const AGAIN_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** No database query per image: a burst of image requests would otherwise take the connections
 * from other routes. The memory is refreshed on a tick. */
const REFRESH_MS = 5 * 60 * 1000;

/** Per set of services. `reasons` separate, because isKnownMissing() is the hottest path;
 * `writeTo` buffers the table, otherwise a burst of 404s would be a burst of INSERTs. */
const state = (k: ImagesContext) =>
  k.compartments.slot('fehlanzeige', () => ({
    front: new Map<string, number>(),
    reasons: new Map<string, string>(),
    writeTo: new Map<string, string>(),
    ticks: [] as NodeJS.Timeout[],
  }));

export async function setUpImageGaps(k: ImagesContext): Promise<void> {
  const _ticks = state(k).ticks;
  if (_ticks.length) return;
  // Process-local: must therefore run in EVERY worker process.
  _ticks.push(
    setInterval(() => {
      refresh(k).catch(e => reportError('bild-fehlanzeige:auffrischen', e));
    }, REFRESH_MS),
    setInterval(() => {
      writeBuffer(k).catch(e => reportError('bild-fehlanzeige:schreibePuffer', e));
    }, 10_000),
  );
  for (const t of _ticks) t.unref();
  await refresh(k);
}

/** Before closing the pool: stop ticks, still write the remembered failures. */
export async function stopNone(k: ImagesContext): Promise<void> {
  for (const t of state(k).ticks.splice(0)) clearInterval(t);
  await writeBuffer(k);
}

/** Synchronous and without database; at most one refresh interval old. */
export function isKnownMissing(k: ImagesContext, key: string): boolean {
  const _front = state(k).front;
  const front = _front.get(key);
  if (front === undefined) return false;
  if (k.clock.now() - front < AGAIN_CHECK_MS) return true;
  _front.delete(key);
  return false;
}

async function refresh(k: ImagesContext): Promise<void> {
  // Not readable: the previous state in memory stays until the next reconciliation succeeds.
  const r = await attempts('bild-fehlanzeige:rows', k.imageFailures.freshFailures(String(AGAIN_CHECK_MS)));
  if (!r.ok) return;
  const rows = r.wert;
  const { front: _front, reasons: _reasons } = state(k);
  _front.clear();
  _reasons.clear();
  for (const r of rows) {
    _front.set(r.cache_key, new Date(r.checked_at).getTime());
    if (r.reason) _reasons.set(r.cache_key, r.reason);
  }
}

/** Immediately in memory, buffered into the table (stand().writeTo). */
export function rememberMissing(k: ImagesContext, key: string, reason = ''): void {
  const { front: _front, reasons: _reasons, writeTo: _writeTo } = state(k);
  _front.set(key, k.clock.now());
  if (reason) _reasons.set(key, reason);
  _writeTo.set(key, reason);
}

export function reasonFor(k: ImagesContext, key: string): string {
  return state(k).reasons.get(key) || '';
}

// The way back out of the block.
export async function forgetMissing(kx: ImagesContext, keys?: string[]): Promise<number> {
  const r = keys?.length ? await kx.imageFailures.forgetFailures(keys) : await kx.imageFailures.forgetAllFailures();
  const { front: _front, reasons: _reasons, writeTo: _writeTo } = state(kx);
  if (keys?.length)
    for (const k of keys) {
      _front.delete(k);
      _reasons.delete(k);
      _writeTo.delete(k);
    }
  else {
    _front.clear();
    _reasons.clear();
    _writeTo.clear();
  }
  return r?.changes || 0;
}

async function writeBuffer(kx: ImagesContext): Promise<void> {
  const _writeTo = state(kx).writeTo;
  if (!_writeTo.size) return;
  const keys = [..._writeTo.keys()];
  const reasons = keys.map(k => _writeTo.get(k) || '');
  _writeTo.clear();
  await kx.imageFailures.rememberFailures(keys, reasons).catch(() => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k) _writeTo.set(k, reasons[i] ?? '');
    }
  });
}

export function _emptyForeground(k: ImagesContext): void {
  state(k).front.clear();
  state(k).reasons.clear();
}
export { writeBuffer as _writeBuffer, refresh as _refresh };
