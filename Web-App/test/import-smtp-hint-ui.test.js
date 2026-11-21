/**
 * If the configuration import skips SMTP values, the UI names them:
 * the server sends the list in smtp_uebergangen, a message shows it.
 *
 * Counter-check (measured on 29.10.2026): in importConfig() the message about
 * smtp_uebergangen removed → red: “the skipped SMTP fields stand in
 * a message”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

test('the skipped SMTP fields stand in one message', async () => {
  const { w, d } = await openUi({
    '/v1/settings/import': {
      success: true,
      imported: 3,
      note: '',
      smtp_uebergangen: ['smtp_host', 'smtp_insecure_tls'],
    },
  });
  try {
    const feld = d.getElementById('cfg-import-file');
    Object.defineProperty(feld, 'files', { value: [new w.File(['{}'], 'konfig.json')] });
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    const gefunden = await warte(() => d.body.textContent.includes('Nicht übernommen: smtp_host, smtp_insecure_tls'));
    assert.ok(gefunden, 'keine Meldung mit den übergangenen Feldern');
  } finally {
    w.close();
  }
});
