#!/usr/bin/env node
'use strict';

/**
 * Deletes finished Actions runs before a new one starts, so the run list shows the current
 * state instead of thousands of old attempts. Call: GH_TOKEN=… GITHUB_REPOSITORY=owner/repo
 * node .github/scripts/old-runs.js [limit]
 */

/**
 * Runs to delete: every finished run except the newest per workflow, branch and event. The newest
 * stays because the release chain reads its artifacts (a tag's green build, the signed APK)
 * and a re-release by hand looks up the tag's last build. A skipped run never counts as the
 * newest: every build on main starts an Android-Release that skips, and it would push the
 * real release run out. Push and pull-request runs of one branch are kept apart, so a green
 * PR run cannot hide a red push run. Running or waiting runs are never touched.
 * @param {{ id: number, workflow_id: number, head_branch: string | null, event: string, status: string, conclusion: string | null, created_at: string }[]} runs
 * @returns {number[]}
 */
function deletable(runs) {
  const newest = new Map();
  for (const r of runs) {
    if (r.status !== 'completed' || r.conclusion === 'skipped') continue;
    const key = `${r.workflow_id}\u0000${r.head_branch ?? ''}\u0000${r.event}`;
    const kept = newest.get(key);
    if (!kept || r.created_at > kept.created_at || (r.created_at === kept.created_at && r.id > kept.id))
      newest.set(key, r);
  }
  const keep = new Set([...newest.values()].map(r => r.id));
  return runs.filter(r => r.status === 'completed' && !keep.has(r.id)).map(r => r.id);
}

async function api(path, method = 'GET') {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 || res.status === 404 ? null : res.json();
}

async function main() {
  // GITHUB_TOKEN allows 1000 calls an hour; a cap keeps a large backlog from using them all.
  const limit = Number(process.argv[2] ?? 300);
  const runs = [];
  for (let page = 1; ; page++) {
    const { workflow_runs: batch } = await api(`actions/runs?per_page=100&page=${page}`);
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  const ids = deletable(runs).slice(0, limit);
  for (const id of ids) await api(`actions/runs/${id}`, 'DELETE');
  console.log(`${ids.length} alte Läufe entfernt, ${runs.length - ids.length} bleiben.`);
}

if (require.main === module)
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });

module.exports = { deletable };
