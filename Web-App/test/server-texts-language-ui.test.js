/**
 * The background jobs translate the subtitle of a tile from the codes
 * of the server (`sub_teile`, UI check 17 M17); the German sentence in `sub`
 * no longer appears in the English UI. Real bundle in jsdom.
 *
 * Counter-check (measured 05.11.2026): in monitor.js again only
 * translateJobSub(j.sub) → red (the tile shows „Keine ausstehenden Einträge“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, switchTab } = require('./helpers/ui');

test('tile subtitles in the UI language', async () => {
  const tile = (sub, sub_parts) => ({ label: 'x', status: 'idle', progress: 0, total: 0, sub, sub_parts });
  const { w, d } = await openUi(
    {
      '/v2/admin/job-status': { success: true, job: { running: false } },
      '/v2/admin/jobs': {
        success: true,
        schedules: {},
        db: { csvCache: {}, blMapping: {} },
        jobs: {
          bricksetRetry: tile('Keine ausstehenden Einträge', [{ code: 'none_pending' }]),
          imgDl: tile('Bestand: 3 Bilder noch nicht gecacht · 2 Katalog-Bilder in Warteschlange', [
            { code: 'images_open', values: { n: 3 }, ago: 'holding' },
            { code: 'catalog_queue', values: { n: 2 } },
          ]),
        },
      },
      '/v2/admin/job-queue': {
        success: true,
        jobs: [],
        summary: [],
        pauses: [],
        job_process: { running: true },
        image_demand: 0,
      },
    },
    { language: 'en' },
  );
  try {
    await switchTab(w, 'monitor');
    assert.ok(await waitFor(() => d.body.textContent.includes('No pending entries'), 3000), 'Brickset tile translated');
    assert.ok(d.body.textContent.includes('Collection: 3 images not cached yet · 2 catalogue images queued'));
    assert.doesNotMatch(d.getElementById('tab-monitor').textContent, /Keine |ausstehend|Bilder/);
  } finally {
    w.close();
  }
});
