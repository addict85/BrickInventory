/**
 * Die Hintergrundarbeiten übersetzen den Untertitel einer Kachel aus den Codes
 * des Servers (`sub_teile`, UI-Prüfung 17 M17); der deutsche Satz in `sub`
 * erscheint in der englischen Oberfläche nicht mehr. Echtes Bündel in jsdom.
 *
 * Gegenprobe (05.11.2026 gemessen): in monitor.js wieder nur
 * translateJobSub(j.sub) → rot (die Kachel zeigt „Keine ausstehenden Einträge“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, reiter } = require('./helpers/oberflaeche');

test('Untertitel der Kacheln in der Sprache der Oberfläche', async () => {
  const kachel = (sub, sub_teile) => ({ label: 'x', status: 'idle', progress: 0, total: 0, sub, sub_teile });
  const { w, d } = await oeffneOberflaeche(
    {
      '/v1/admin/job-status': { success: true, job: { running: false } },
      '/v1/admin/jobs': {
        success: true,
        schedules: {},
        db: { csvCache: {}, blMapping: {} },
        jobs: {
          bricksetRetry: kachel('Keine ausstehenden Einträge', [{ code: 'keine_ausstehenden' }]),
          imgDl: kachel('Bestand: 3 Bilder noch nicht gecacht · 2 Katalog-Bilder in Warteschlange', [
            { code: 'bilder_offen', werte: { n: 3 }, vor: 'bestand' },
            { code: 'katalog_warteschlange', werte: { n: 2 } },
          ]),
        },
      },
      '/v1/admin/auftraege': {
        success: true,
        auftraege: [],
        zusammenfassung: [],
        pausen: [],
        job_prozess: { laeuft: true },
        bildbedarf: 0,
      },
    },
    { sprache: 'en' },
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
