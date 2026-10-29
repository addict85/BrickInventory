/**
 * Übergeht der Konfigurations-Import SMTP-Werte, nennt die Oberfläche sie:
 * Der Server schickt die Liste in smtp_uebergangen, eine Meldung zeigt sie.
 *
 * Gegenprobe (am 29.10.2026 gemessen): in importConfig() die Meldung zu
 * smtp_uebergangen entfernt → rot: „die übergangenen SMTP-Felder stehen in
 * einer Meldung“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

test('die übergangenen SMTP-Felder stehen in einer Meldung', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/settings/import': { success: true, imported: 3, note: '', smtp_uebergangen: ['smtp_host', 'smtp_insecure_tls'] },
  });
  try {
    const feld = d.getElementById('cfg-import-file');
    Object.defineProperty(feld, 'files', { value: [new w.File(['{}'], 'konfig.json')] });
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    const gefunden = await warte(() => d.body.textContent.includes('Nicht übernommen: smtp_host, smtp_insecure_tls'));
    assert.ok(gefunden, 'keine Meldung mit den übergangenen Feldern');
  } finally { w.close(); }
});
