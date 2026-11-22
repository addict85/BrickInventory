/** Counters, gauges and histograms of this process in the Prometheus text format (0.0.4).
 * Each process is scraped on its own, so the values are process state (processWide). */
import { processWide } from './processWide';

type Labels = Readonly<Record<string, string | number>>;
type Kind = 'counter' | 'gauge' | 'histogram';
interface Series {
  labels: Labels;
  value: number;
  buckets: number[];
  sum: number;
}
interface Family {
  help: string;
  kind: Kind;
  bounds: readonly number[];
  series: Map<string, Series>;
}

/** Seconds, from a fast request to a slow job. */
export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300] as const;
/** A label from outside (route, host) must not grow a family without bound. */
const MAX_SERIES = 2000;

const R = processWide('metrics', () => ({
  families: new Map<string, Family>(),
  collectors: [] as (() => Promise<void> | void)[],
}));

function family(name: string, help: string, kind: Kind, bounds: readonly number[] = []): Family {
  let f = R.families.get(name);
  if (!f) {
    f = { help, kind, bounds, series: new Map() };
    R.families.set(name, f);
  }
  return f;
}

const keyOf = (l: Labels) =>
  Object.keys(l)
    .sort()
    .map(k => `${k}=${l[k]}`)
    .join('\u0000');

function seriesOf(f: Family, labels: Labels): Series | null {
  const key = keyOf(labels);
  let s = f.series.get(key);
  if (!s) {
    if (f.series.size >= MAX_SERIES) return null;
    s = { labels, value: 0, buckets: f.bounds.map(() => 0), sum: 0 };
    f.series.set(key, s);
  }
  return s;
}

export function counter(name: string, help: string) {
  const f = family(name, help, 'counter');
  return {
    inc(labels: Labels = {}, n = 1): void {
      const s = seriesOf(f, labels);
      if (s) s.value += n;
    },
  };
}

export function gauge(name: string, help: string) {
  const f = family(name, help, 'gauge');
  return {
    set(labels: Labels, value: number): void {
      const s = seriesOf(f, labels);
      if (s) s.value = value;
    },
    /** Before a new reading: a label that vanished (no queued jobs of a kind) must not stay. */
    clear(): void {
      f.series.clear();
    },
  };
}

export function histogram(name: string, help: string, bounds: readonly number[] = DEFAULT_BUCKETS) {
  const f = family(name, help, 'histogram', bounds);
  return {
    observe(labels: Labels, seconds: number): void {
      const s = seriesOf(f, labels);
      if (!s) return;
      s.value++;
      s.sum += seconds;
      f.bounds.forEach((b, i) => {
        if (seconds <= b) s.buckets[i] = (s.buckets[i] ?? 0) + 1;
      });
    },
  };
}

/** Refreshes gauges right before a scrape (pool, queue); returns the unregistration. */
export function onCollect(fn: () => Promise<void> | void): () => void {
  R.collectors.push(fn);
  return () => {
    const i = R.collectors.indexOf(fn);
    if (i >= 0) R.collectors.splice(i, 1);
  };
}

/** Label values come from requests and foreign hosts: escaped as the format requires. */
const escapeLabel = (v: string | number) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labelText = (l: Labels, extra: Record<string, string> = {}) => {
  const all = { ...l, ...extra };
  const parts = Object.keys(all).map(k => `${k}="${escapeLabel(all[k] ?? '')}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};
const num = (n: number) => (Number.isFinite(n) ? String(n) : n > 0 ? '+Inf' : '-Inf');

export async function renderMetrics(): Promise<string> {
  for (const c of R.collectors) await c();
  const lines: string[] = [];
  for (const [name, f] of [...R.families].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`# HELP ${name} ${f.help.replace(/\n/g, ' ')}`, `# TYPE ${name} ${f.kind}`);
    for (const s of f.series.values()) {
      if (f.kind !== 'histogram') {
        lines.push(`${name}${labelText(s.labels)} ${num(s.value)}`);
        continue;
      }
      f.bounds.forEach((b, i) => {
        lines.push(`${name}_bucket${labelText(s.labels, { le: String(b) })} ${s.buckets[i] ?? 0}`);
      });
      lines.push(`${name}_bucket${labelText(s.labels, { le: '+Inf' })} ${s.value}`);
      lines.push(`${name}_sum${labelText(s.labels)} ${num(s.sum)}`, `${name}_count${labelText(s.labels)} ${s.value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Only for tests: every family empty again. */
export function resetMetrics(): void {
  for (const f of R.families.values()) f.series.clear();
}
