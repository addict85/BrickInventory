/**
 * The dialogs of the routes with re-confirmation offer the second factor:
 * if the server reports zweiter_faktor_noetig, the UI asks for the code
 * (or, where the browser can and the account has passkeys, a
 * passkey) and repeats the request. Real bundle in jsdom.
 *
 * Counter-checks (measured 03.11.2026, each alone, bundle rebuilt):
 *   A  in einstellungen.js “Alles löschen" again api() directly → red: “delete
 *      everything asks for the code" and “the passkey replaces the code"
 *   B  in einstellungen.js creating an account again api() directly → red:
 *      “creating an account asks for the code"
 *   C  in passkeys.js fetchSetPasskey() not called → red: “the
 *      passkey replaces the code"
 *   D  in papierkorb.js or gutscheine.js again confirmDelete() and
 *      api() without password → red: “emptying the trash …” or “deleting a
 *      voucher …" (the password dialog does not appear)
 *   E  in toggleVoucherPin() fetchPlaintext() skipped → red: “the
 *      voucher list shows the mask …" (no password dialog)
 *   F  openVoucherPdf() again openPdfViewer() directly → red: “the
 *      voucher PDF opens only after confirmation …"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, sicht } = require('./helpers/ui');

/** Answers without code with zweiter_faktor_noetig and remembers every body. */
function withFactor(liste, passkey = false) {
  return (_url, o) => {
    const body = JSON.parse(o.body);
    liste.push(body);
    return body.code || body.passkey
      ? { success: true, sets: 0, teile: 0, figuren: 0 }
      : {
          $status: 400,
          success: false,
          code: 'zweiter_faktor_noetig',
          error: 'Code fehlt',
          ...(passkey ? { passkey: true } : {}),
        };
  };
}

/** @param {Document} d @param {{ passwort?: string, code?: string }} input */
async function confirm(d, { passwort, code }) {
  const modal = d.getElementById('confirm-modal');
  assert.ok(
    await warte(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden),
    'der Passwortdialog erscheint',
  );
  /** @type {HTMLInputElement} */ (d.getElementById('cd-pw')).value = passwort;
  d.getElementById('cd-confirm').click();
  await takt(20);
  const codeWrap = d.getElementById('cd-code-wrap');
  assert.ok(await warte(() => !codeWrap.hidden && modal.style.display === 'flex'), 'der Code-Dialog erscheint');
  if (code === undefined) return;
  /** @type {HTMLInputElement} */ (d.getElementById('cd-code')).value = code;
  d.getElementById('cd-confirm').click();
}

test('delete everything asks for the code', async () => {
  const rufe = [];
  const { w, d } = await openUi({ '/v1/bestand': withFactor(rufe) });
  try {
    d.getElementById('btn-dall').click();
    await confirm(d, { passwort: 'Mein-Passwort-1', code: '654321' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.deepEqual(rufe, [{ password: 'Mein-Passwort-1' }, { password: 'Mein-Passwort-1', code: '654321' }]);
    assert.equal(d.getElementById('cd-passkey').hidden, true, 'ohne Passkey-Fähigkeit kein Passkey-Knopf');
  } finally {
    w.close();
  }
});

test('creating an account asks for the code', async () => {
  const rufe = [];
  const { w, d } = await openUi({
    '/v1/auth/users': (url, o) => (o?.method === 'POST' ? withFactor(rufe)(url, o) : { success: true, users: [] }),
  });
  try {
    d.getElementById('nu-n').value = 'bert';
    d.getElementById('nu-p').value = 'Lang-genug-Passwort-1';
    d.getElementById('btn-cu').click();
    await confirm(d, { passwort: 'Verwalter-Passwort-1', code: '111222' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.equal(rufe[1].admin_password, 'Verwalter-Passwort-1');
    assert.equal(rufe[1].code, '111222', 'die zweite Anfrage trägt den Code');
  } finally {
    w.close();
  }
});

test('the passkey replaces the code', async () => {
  const rufe = [];
  const puffer = () => new Uint8Array([1, 2, 3]).buffer;
  const { w, d } = await openUi(
    {
      '/v1/bestand': withFactor(rufe, true),
      '/v1/auth/passkey/anmelden/optionen': { success: true, optionen: { challenge: 'AAAA', allowCredentials: [] } },
    },
    {
      vorher: fenster => {
        fenster.PublicKeyCredential = function PublicKeyCredential() {};
        Object.defineProperty(fenster, 'isSecureContext', { value: true });
        Object.defineProperty(fenster.navigator, 'credentials', {
          value: {
            get: async () => ({
              id: 'pk1',
              rawId: puffer(),
              type: 'public-key',
              getClientExtensionResults: () => ({}),
              response: {
                clientDataJSON: puffer(),
                authenticatorData: puffer(),
                signature: puffer(),
                userHandle: null,
              },
            }),
          },
        });
      },
    },
  );
  try {
    d.getElementById('btn-dall').click();
    await confirm(d, { passwort: 'Mein-Passwort-1' });
    const knopf = d.getElementById('cd-passkey');
    assert.equal(knopf.hidden, false, 'der Passkey-Knopf erscheint');
    knopf.click();
    assert.ok(await warte(() => rufe.length === 2), `der Passkey ersetzt den Code: nur ${rufe.length} Anfrage(n)`);
    assert.equal(rufe[1].passkey?.id, 'pk1', 'der Passkey ersetzt den Code');
    assert.equal(rufe[1].code, undefined);
  } finally {
    w.close();
  }
});

test('emptying the trash asks for password and code', async () => {
  const rufe = [];
  const { w, d } = await openUi({
    '/v1/papierkorb': (url, o) =>
      o?.method === 'DELETE' ? withFactor(rufe)(url, o) : { success: true, eintraege: [] },
  });
  try {
    d.getElementById('trash-empty').click();
    await confirm(d, { passwort: 'Mein-Passwort-1', code: '246810' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.deepEqual(rufe, [{ password: 'Mein-Passwort-1' }, { password: 'Mein-Passwort-1', code: '246810' }]);
  } finally {
    w.close();
  }
});

test('deleting a voucher asks for password and code', async () => {
  const rufe = [];
  const { w, d } = await openUi({
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '6123456789012', pin: '4711', amount: 50, currency: 'CHF', hat_pdf: false }],
    },
    '/v1/vouchers/3': withFactor(rufe),
  });
  try {
    await sicht(w, 'vouchers');
    assert.ok(await warte(() => d.querySelector('[data-click="deleteVoucher"]')), 'Gutscheinliste');
    d.querySelector('[data-click="deleteVoucher"]').click();
    await confirm(d, { passwort: 'Mein-Passwort-1', code: '135790' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.deepEqual(rufe[1], { password: 'Mein-Passwort-1', code: '135790' });
  } finally {
    w.close();
  }
});

test('the voucher PDF only opens after confirmation, with the ticket', async () => {
  const releases = [],
    fetches = [];
  const { w, d } = await openUi({
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: true }],
    },
    '/v1/vouchers/3/pdf-freigabe': (_u, o) => {
      releases.push(JSON.parse(o.body));
      return { success: true, ticket: 'T-123', gueltig_sek: 60 };
    },
    '/v1/vouchers/3/pdf': u => {
      fetches.push(String(u));
      return { $status: 403, success: false, error: 'abgelehnt', code: 'kein_zugriff_konto' };
    },
  });
  try {
    await sicht(w, 'vouchers');
    assert.ok(await warte(() => d.querySelector('[data-click="openVoucherPdf"]')), 'Gutscheinliste');
    d.querySelector('[data-click="openVoucherPdf"]').click();
    const modal = d.getElementById('confirm-modal');
    assert.ok(
      await warte(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden),
      'der Passwortdialog erscheint',
    );
    assert.deepEqual(fetches, [], 'das PDF wird vor der Bestätigung abgerufen');
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => fetches.length === 1), 'kein Abruf des PDFs');
    assert.deepEqual(releases, [{ password: 'Mein-Passwort-1' }]);
    assert.match(fetches[0], /\/api\/v1\/vouchers\/3\/pdf\?ticket=T-123$/);
  } finally {
    w.close();
  }
});

test('the voucher list shows the mask, number and PIN only after confirmation', async () => {
  const rufe = [];
  const { w, d } = await openUi({
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: false }],
    },
    '/v1/vouchers/3/klartext': (_u, o) => {
      rufe.push(JSON.parse(o.body));
      return { success: true, id: 3, number: '6123456789012', pin: '4711' };
    },
  });
  try {
    await sicht(w, 'vouchers');
    assert.ok(await warte(() => d.querySelector('.voucher-row')), 'Gutscheinliste');
    assert.equal(d.querySelector('.voucher-num').textContent, '…9012');
    d.querySelector('[data-click="toggleVoucherPin"]').click();
    const modal = d.getElementById('confirm-modal');
    assert.ok(
      await warte(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden),
      'der Passwortdialog erscheint',
    );
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    assert.ok(
      await warte(() => d.querySelector('.voucher-pin code')?.textContent === '4711'),
      'die PIN erscheint nach der Bestätigung',
    );
    assert.equal(d.querySelector('.voucher-num').textContent, '6123 4567 8901 2');
    assert.deepEqual(rufe, [{ password: 'Mein-Passwort-1' }]);
  } finally {
    w.close();
  }
});
