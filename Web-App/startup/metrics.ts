/** What the process reports beside its own counters: connection pools and the job queue, read
 * right before every scrape; and for the jobs-only process a port that serves /metrics alone. */
import http, { type Server } from 'node:http';
import type { Pool } from 'pg';
import type { Db } from '../db/database';
import type { JobsServices } from '../src/jobQueue';
import { gauge, onCollect, renderMetrics } from '../src/infra/metrics';
import { inSystemContext } from '../src/infra/accountContext';
import { metricsAllowed } from '../src/http/metrics';
import { reportError } from '../src/infra/error';

const poolConnections = gauge('db_pool_connections', 'Connections of each pool by state.');
const queue = gauge('jobs_queue', 'Jobs in the table by kind and status.');
const heartbeat = gauge('jobs_heartbeat_age_seconds', 'Age of the job process heartbeat; absent without one.');

/** @returns the unregistration (shutdown, tests). */
export function registerCollectors(db: Pick<Db, 'pool' | 'systemPool' | 'systemWebPool'>, jobs: JobsServices) {
  // Without roles of their own the system pools are the same object: counted once.
  const pools = new Map<Pool, string>();
  for (const [name, p] of [
    ['app', db.pool],
    ['system', db.systemPool],
    ['system_web', db.systemWebPool],
  ] as const)
    if (!pools.has(p)) pools.set(p, name);
  return onCollect(async () => {
    poolConnections.clear();
    for (const [p, name] of pools) {
      poolConnections.set({ pool: name, state: 'total' }, p.totalCount);
      poolConnections.set({ pool: name, state: 'idle' }, p.idleCount);
      poolConnections.set({ pool: name, state: 'waiting' }, p.waitingCount);
    }
    // A scrape while the database is away shows the pools, not an error page.
    try {
      const q = await inSystemContext('metriken', () => jobs.jobsInOverview());
      queue.clear();
      for (const c of q.summary) queue.set({ type: c.type, status: c.status }, c.count);
      heartbeat.clear();
      if (q.job_process.age_seconds !== null) heartbeat.set({}, Math.max(0, q.job_process.age_seconds));
    } catch (e) {
      reportError('metriken:warteschlange', e);
    }
  });
}

/** Only /metrics, with the same rule as in the web process (src/http/metrics.ts). */
export function startMetricsServer(port: number, token: string | undefined): Server {
  return http
    .createServer((req, res) => {
      if ((req.url ?? '').split('?')[0] !== '/metrics' || !metricsAllowed(req, token)) {
        res.writeHead(404).end();
        return;
      }
      renderMetrics().then(
        text => res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }).end(text),
        (e: unknown) => {
          reportError('metriken:ausgabe', e);
          res.writeHead(500).end();
        },
      );
    })
    .listen(port);
}
