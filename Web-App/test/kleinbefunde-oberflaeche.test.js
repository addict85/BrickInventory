/**
 * Kleine Befunde der UI-Prüfung 17 (Abläufe N2–N6, N9, N10, N12, N16, N20,
 * N22, N26), echtes Bündel in jsdom bzw. die Serverfunktion:
 *   - Ein schon vorhandenes Set zeigt im Erfassen-Dialog genau einen Knopf
 *     „Set öffnen“ (N2).
 *   - Kennzahlen: „1.565 verschiedene“ mit Trennzeichen; en zeigt 10828 als
 *     ganze Zahl, nicht „10.8K“ (N3, N4).
 *   - Der Seitentitel hat keine weichen Trennstriche (N5).
 *   - Ein Verwalter namens „admin“ heisst in der Kopfleiste nicht „admin
 *     (Admin)“ (N6).
 *   - Protokollzeiten stehen als 05.11.2026 (N9).
 *   - Leere Zugangsdaten speichern meldet „Zugang entfernt“ (N10).
 *   - Die Wiederherstellungscodes: „Ich habe die Codes gesichert“ und „Als
 *     Datei speichern“ (N12).
 *   - Minifiguren: „Gekauft am“ an der Karte, Gesamtzahl als erste Kennzahl
 *     (N16).
 *   - Merken eines vorhandenen Sets nennt die Sammlung (N20).
 *   - Mit Unterkonto und „Alle Konten“ sagt der Untertitel der Galerie
 *     „im Haushalt“ (N22; seit UI-Prüfung 22 bleibt der Titel fest).
 *   - Die Anmeldemaske nennt die Version statt eines festen Datums (N26).
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  fmtBig wieder ab 10000 kurz → rot: „Kennzahlen mit Trennzeichen“
 *   B  in zeigeSeitenname das replace(/­/) entfernt → rot: „Titel ohne
 *      weiche Trennstriche“
 *   C  in zeigeBenutzernamen die Namensprüfung entfernt → rot: „admin ohne
 *      (Admin)“
 *   D  im Protokoll wieder toLocaleString → rot: „Protokoll mit fmtDatum“
 *   E  speichereZugang meldet immer okText → rot: „leere Zugangsdaten“
 *   F  in setUnbekannt der zweite Knopf wieder da → rot: „ein Knopf Set
 *      öffnen“
 *   G  merkMeldung ohne Abfrage der Sammlung → rot: „Merken nennt die
 *      Sammlung“
 *   H  sammlungUntertitel() in initScopeSelects nicht aufgerufen → rot:
 *      „Haushalt im Untertitel“ (13.11.2026)
 *   I  versionEinsetzen() gibt das HTML unverändert zurück → rot: „Version in
 *      der Anmeldemaske“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, warte, takt, reiter } = require('./helpers/oberflaeche');

test('Kennzahlen mit Trennzeichen, auch englisch ganz', async () => {
  const stats = {
    '/v1/stats': {
      success: true,
      stats: { total_sets: 1565, total_quantity: 3095, total_parts: 10828, total_minifigs: 19, total_instructions: 0 },
    },
  };
  const de = await oeffneOberflaeche(stats, { browserSprache: 'de-DE' });
  try {
    assert.ok(
      await warte(() => /1\.565 verschiedene/.test(de.d.getElementById('tab-gallery').textContent)),
      de.d.querySelector('#bstat-sets')?.parentElement?.textContent,
    );
  } finally {
    de.w.close();
  }
  const en = await oeffneOberflaeche(stats, { sprache: 'en', browserSprache: 'en-US' });
  try {
    assert.ok(await warte(() => en.d.getElementById('bstat-parts').textContent !== '—'));
    assert.equal(en.d.getElementById('bstat-parts').textContent, '10,828');
  } finally {
    en.w.close();
  }
  // Britisch wie „catalogue“ (Prüfung 21): Die Werte schreiben „colour“, die Schlüssel bleiben.
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.js'), 'utf8'),
    /:\s*'[^']*\bcolor/i,
  );
});

test('Titel ohne weiche Trennstriche', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/admin/job-status': { success: true, job: { running: false } },
      '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
      '/v1/admin/auftraege': {
        success: true,
        auftraege: [],
        zusammenfassung: [],
        job_prozess: { laeuft: true },
        bildbedarf: 0,
        pausen: [],
      },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    await reiter(o.w, 'monitor');
    assert.ok(await warte(() => /Hintergrund/.test(o.d.title), 2000), o.d.title);
    assert.doesNotMatch(o.d.title, /­/);
  } finally {
    o.w.close();
  }
});

test('admin ohne (Admin)', async () => {
  const o = await oeffneOberflaeche(
    { '/v1/auth/me': { loggedIn: true, user: { id: 1, username: 'admin', is_admin: true } } },
    { sprache: 'en', browserSprache: 'en-US' },
  );
  try {
    assert.ok(await warte(() => o.d.getElementById('ubadge').textContent.trim()));
    assert.equal(o.d.getElementById('ubadge').textContent, 'admin');
  } finally {
    o.w.close();
  }
});

test('Protokoll mit fmtDatum', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/admin/protokoll': {
        success: true,
        eintraege: [
          { zeit: '2026-11-05T17:29:38Z', verwalter_name: 'anna', aktion: 'konto_angelegt', konto_name: 'bert' },
        ],
      },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    await reiter(o.w, 'settings');
    assert.ok(await warte(() => o.d.querySelector('#vw-protokoll tbody td')));
    assert.match(o.d.querySelector('#vw-protokoll tbody td').textContent, /^\d{2}\.\d{2}\.\d{4}/);
  } finally {
    o.w.close();
  }
});

test('leere Zugangsdaten melden „Zugang entfernt“', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    o.d.getElementById('rb-key').value = '';
    o.d.getElementById('btn-sav-rb').click();
    // Bestätigt wird am Knopf (meldeAmFeld), nicht im Toast.
    const stand = () => o.d.querySelector('#einst-rb .feld-status')?.textContent || '';
    assert.ok(await warte(() => /Zugang entfernt/.test(stand()), 2000), stand());
    assert.doesNotMatch(stand() + o.d.getElementById('toasts').textContent, /gespeichert/i);
  } finally {
    o.w.close();
  }
});

test('Wiederherstellungscodes: gesichert und als Datei', async () => {
  const o = await oeffneOberflaeche(
    { '/v1/auth/zweiter-faktor/bestaetigen': { success: true, codes: ['aaaa-bbbb', 'cccc-dddd'] } },
    { browserSprache: 'de-DE' },
  );
  try {
    o.w.URL.createObjectURL = () => 'blob:probe';
    o.w.URL.revokeObjectURL = () => {};
    const feld = o.d.createElement('input');
    feld.id = 'zf-code';
    feld.value = '123456';
    const knopf = o.d.createElement('button');
    knopf.dataset.click = 'zfBestaetigen';
    o.d.getElementById('zf-bereich')?.append(feld, knopf) ?? o.d.body.append(feld, knopf);
    knopf.click();
    assert.ok(await warte(() => o.d.getElementById('zf-gespeichert')));
    assert.match(o.d.getElementById('zf-gespeichert').textContent, /gesichert/);
    const datei = o.d.querySelector('[data-click="zfCodesSpeichern"]');
    assert.ok(datei, 'kein Knopf „Als Datei speichern“');
    let geladen = '';
    o.w.HTMLAnchorElement.prototype.click = function () {
      geladen = this.download;
    };
    datei.click();
    assert.match(geladen, /\.txt$/);
  } finally {
    o.w.close();
  }
});

test('Minifiguren: Gekauft am und Gesamtzahl zuerst', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/minifigs': {
        success: true,
        total: 1,
        figs: [
          {
            fig_number: 'fig-000001',
            fig_name: 'Ritter',
            quantity: 2,
            source: 'set',
            set_added_at: '2026-03-04T12:00:00Z',
          },
        ],
      },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    await reiter(o.w, 'minifigs');
    const erste = o.d.querySelector('#tab-minifigs .brick-stats .bstat .bstat-l');
    assert.equal(erste.textContent.trim(), 'Figuren gesamt');
    assert.ok(await warte(() => /Gekauft am 04\.03\.2026/.test(o.d.getElementById('tab-minifigs').textContent), 2000));
  } finally {
    o.w.close();
  }
});

test('ein Knopf „Set öffnen“ bei vorhandenem Set', async () => {
  const o = await oeffneOberflaeche(
    { '/v1/sets/10305-1': { success: true, set: { set_number: '10305-1', name: 'Burg', quantity: 2 } } },
    { browserSprache: 'de-DE' },
  );
  try {
    o.d.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();
    await takt(10);
    o.d.getElementById('add-num').value = '10305-1';
    o.d.getElementById('btn-add').click();
    assert.ok(await warte(() => !o.d.getElementById('add-unbekannt').hidden));
    const knoepfe = [...o.d.querySelectorAll('#add-set-modal button')].filter(b => /Set öffnen/.test(b.textContent));
    assert.equal(knoepfe.length, 1);
  } finally {
    o.w.close();
  }
});

test('Merken nennt die Sammlung', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/wanted': (_u, opt) =>
        opt?.method === 'POST' ? { success: true, war_neu: true } : { success: true, items: [] },
      '/v1/sets/10305-1': { success: true, set: { set_number: '10305-1', name: 'Burg', quantity: 3 } },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    o.d.getElementById('mk-num').value = '10305-1';
    const knopf = o.d.createElement('button');
    knopf.dataset.click = 'merkpostenHinzufuegen';
    o.d.body.append(knopf);
    knopf.click();
    assert.ok(
      await warte(() => /Sammlung \(×3\)/.test(o.d.getElementById('toasts').textContent), 2000),
      o.d.getElementById('toasts').textContent,
    );
  } finally {
    o.w.close();
  }
});

test('Haushalt im Untertitel', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/sets/household-members': {
        success: true,
        members: [
          { id: 1, username: 'anna', is_self: true, tiefe: 0 },
          { id: 2, username: 'ben', is_self: false, tiefe: 1 },
        ],
      },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    assert.ok(await warte(() => o.d.getElementById('scope-gallery').style.display !== 'none'));
    o.w.eval('document.querySelector(\'.ntab[data-tab="gallery"]\').click()');
    assert.ok(
      await warte(() => /im Haushalt/.test(o.d.getElementById('gallery-unter').textContent), 2000),
      o.d.getElementById('gallery-unter').textContent,
    );
    const wahl = o.d.getElementById('scope-gallery');
    wahl.value = 'own';
    wahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.ok(
      await warte(() => /^Alle Sets deiner Sammlung/.test(o.d.getElementById('gallery-unter').textContent), 2000),
    );
  } finally {
    o.w.close();
  }
});

test('Version in der Anmeldemaske', () => {
  const { versionEinsetzen } = require('./helpers/sources').buildAndRequire()('src/konto/indexHtml.js');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Build 20\d\d\./, 'festes Datum in index.html');
  assert.match(versionEinsetzen(html, 'ab341de'), /<div class="start-fuss" data-version>Version ab341de<\/div>/);
  assert.match(versionEinsetzen(html, 'unbekannt'), /<div class="start-fuss" data-version><\/div>/);
  assert.doesNotMatch(versionEinsetzen(html, '<b>x'), /<b>/);
});
