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
const { openUi, warte, reiter } = require('./helpers/ui');

test('tile subtitles in the UI language', async () => {
  const kachel = (sub, sub_parts) => ({ label: 'x', status: 'idle', progress: 0, total: 0, sub, sub_parts });
  const { w, d } = await openUi(
    {
      '/v2/admin/job-status': { success: true, job: { running: false } },
      '/v2/admin/jobs': {
        success: true,
        schedules: {},
        db: { csvCache: {}, blMapping: {} },
        jobs: {
          bricksetRetry: kachel('Keine ausstehenden Einträge', [{ code: 'keine_ausstehenden' }]),
          imgDl: kachel('Bestand: 3 Bilder noch nicht gecacht · 2 Katalog-Bilder in Warteschlange', [
            { code: 'bilder_offen', values: { n: 3 }, ago: 'bestand' },
            { code: 'katalog_warteschlange', values: { n: 2 } },
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
    await reiter(w, 'monitor');
    assert.ok(await warte(() => d.body.textContent.includes('No pending entries'), 3000), 'Brickset-Kachel übersetzt');
    assert.ok(d.body.textContent.includes('Collection: 3 images not cached yet · 2 catalogue images queued'));
    assert.doesNotMatch(d.getElementById('tab-monitor').textContent, /Keine |ausstehend|Bilder/);
  } finally {
    w.close();
  }
});
