import os from 'os';

/**
 * Wie viele Worker der Server startet — EINE Rechnung für server.ts und den
 * Datenbank-Pool. Rechneten beide getrennt, setzte WEB_WORKERS=0 den Pool auf
 * „ein Worker" (15 Verbindungen je Worker), während der Server so viele Worker
 * startete, wie es Kerne gibt.
 */
export function workerZahl(env: NodeJS.ProcessEnv = process.env, kerne = os.cpus().length): number {
  const n = parseInt(env.WEB_WORKERS || '', 10);
  return n > 0 ? n : Math.max(2, kerne);
}

/** Verbindungen je Worker: zusammen höchstens 80, je Worker 5 bis 15. */
export function poolJeWorker(worker: number): number {
  return Math.max(5, Math.min(15, Math.floor(80 / Math.max(1, worker))));
}

/**
 * Wie lange der Primärprozess wartet, bevor er einen abgestürzten Worker neu
 * startet: 1 s, dann doppelt so lang je weiterem Absturz in der letzten
 * Minute, höchstens 30 s. Scheitert eine Migration, startete er sonst in
 * enger Schleife neu und füllte Log und Datenbank-Verbindungen.
 */
export function neustartPause(abstuerzeInLetzterMinute: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, abstuerzeInLetzterMinute - 1));
}
