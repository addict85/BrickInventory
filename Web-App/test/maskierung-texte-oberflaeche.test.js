/**
 * t() liefert fertiges Markup (SicheresHtml), tRaw() reinen Text. Wer Text in
 * textContent oder einen Dialog schreibt, muss tRaw() nehmen, und eine
 * Variable von t() wird nicht vorher schon maskiert. Geprüft wird, was im
 * echten Bündel (jsdom) sichtbar ankommt: Ein Name mit „&“ und „<“ steht
 * wörtlich da, nicht als „&amp;“.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in 02-gallery.js delSet() wieder t('gallery.delete.name_parts') →
 *      typecheck:frontend rot (SicheresHtml ist kein string); mit
 *      String(t(…)) erzwungen → rot: „Löschdialog nennt den Set-Namen
 *      wörtlich“ (stand „A &amp; B &lt;C&gt;“)
 *   B  in 05-haushalt.js wieder { via: esc(a.via) } → rot: „frühere
 *      Verknüpfung nennt den Weg wörtlich“ („Tom &amp;amp; Jerry“ im Quelltext)
 *   C  in 01-monitor.js die Pause wieder mit esc(p.art) → rot: „Pause nennt
 *      eine unbekannte Auftragsart wörtlich“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, sicht, reiter } = require('./helpers/oberflaeche');

const NAME = 'A & B <C>';

test('Löschdialog nennt den Set-Namen wörtlich', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets': { success: true, total: 1, themes: [], sets: [
      { set_number: '10294-1', name: NAME, quantity: 1, conditions: ['N'], instructions: [], owners: [] }] },
  });
  try {
    assert.ok(await warte(() => d.querySelector('#gallery .delbtn[data-click="delSetStop"]')), 'Kachel mit Papierkorb');
    d.querySelector('#gallery .delbtn[data-click="delSetStop"]').click();
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'), 'Rückfrage offen');
    const text = d.getElementById('cd-msg').textContent;
    assert.ok(text.includes(NAME), `Rückfrage: ${text}`);
    assert.ok(!text.includes('&amp;'), `Rückfrage maskiert doppelt: ${text}`);
  } finally { w.close(); }
});

test('frühere Verknüpfung nennt den Weg wörtlich', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/settings/household': { success: true, currency: 'EUR', parent: null, children: [], invites: [],
      former_links: [{ id: 7, username: 'tom', via: 'Tom & Jerry' }] },
  });
  try {
    await sicht(w, 'haushalt');
    assert.ok(await warte(() => d.body.textContent.includes('Jerry')), 'Haushalt geladen');
    const stelle = [...d.querySelectorAll('span')].find(s => s.textContent.includes('Jerry'));
    assert.ok(stelle.textContent.includes('Tom & Jerry'), `Text: ${stelle.textContent}`);
    assert.ok(!stelle.innerHTML.includes('&amp;amp;'), `doppelt maskiert: ${stelle.innerHTML}`);
  } finally { w.close(); }
});

test('Pause nennt eine unbekannte Auftragsart wörtlich', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v1/admin/auftraege': { success: true, auftraege: [], zusammenfassung: [], job_prozess: { laeuft: true }, bildbedarf: 0,
      pausen: [{ art: 'x&y', bis: '2026-11-05T12:00:00Z', grund: 'Wartung' }] },
  });
  try {
    await reiter(w, 'monitor');
    await takt(100);
    assert.ok(await warte(() => d.body.textContent.includes('x&y') || d.body.innerHTML.includes('x&amp;amp;y')), 'Pause sichtbar');
    assert.ok(d.body.textContent.includes('x&y'), 'Auftragsart steht wörtlich da');
    assert.ok(!d.body.innerHTML.includes('x&amp;amp;y'), 'Auftragsart doppelt maskiert');
  } finally { w.close(); }
});
