/**
 * Der Aktions-Dispatcher (public/js/actions.js) ist kein Skript-Gadget:
 * Eingeschleustes Markup ohne Skript löst keine gefährliche Aktion aus, kein
 * Überfahren mit der Maus löst überhaupt etwas aus, und globale Funktionen
 * sind über data-click nicht erreichbar. Echte Knöpfe aus Vorlagen und aus
 * index.html wirken weiter. Geprüft am echten Bündel in jsdom.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  GEFAEHRLICH-Prüfung in handle() entfernt → rot: „eingeschleuster Knopf
 *      öffnet den Passwort-Dialog"
 *   B  mouseenter wieder in DELEGATED → rot: „Überfahren löst aus"
 *   C  NUR-Prüfung für change entfernt → rot: „change mit fremdem Handler"
 *   D  Rückfall auf window in resolveAction() zurück → rot: „window.open"
 *   E  echt() aus nutzerKnopf() in settings.js entfernt → rot: „echter
 *      Knopf der Benutzerliste wirkt"
 *   F  ein Name aus NUR.change gestrichen → rot: „jeder Handler im Markup
 *      steht in der Liste seines Ereignisses"
 *   G  echt() an papierkorbEndgueltig (papierkorb.js) entfernt → rot:
 *      „jede Vorlage mit gefährlicher Aktion trägt echt()"
 */
const { istAppModul } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

const ROOT = path.join(__dirname, '..');
const NUTZER = { success: true, users: [
  { id: 1, username: 'anna', is_admin: true, created_at: '2026-10-01T00:00:00Z' },
  { id: 2, username: 'bert', is_admin: false, created_at: '2026-10-02T00:00:00Z' },
] };

async function oberflaeche() {
  const o = await oeffneOberflaeche({ '/v1/auth/users': NUTZER,
    '/v1/settings/tokens': { success: true, tokens: [{ token_id: 't1', label: 'Telefon', aktuell: false }] } });
  o.einschleusen = (html) => {
    const div = o.d.createElement('div');
    div.innerHTML = html;
    o.d.body.appendChild(div);
    return div;
  };
  o.pwDialogOffen = () => o.d.getElementById('pw-modal').classList.contains('open');
  return o;
}

test('eingeschleustes Markup löst keine gefährliche Aktion aus', async () => {
  const { w, d, aufrufe, einschleusen, pwDialogOffen } = await oberflaeche();
  try {
    einschleusen('<button id="x1" data-click="openRpw" data-arg="2">x</button>');
    d.getElementById('x1').click();
    await takt(20);
    assert.equal(pwDialogOffen(), false, 'eingeschleuster Knopf öffnet den Passwort-Dialog');

    const vorher = aufrufe.length;
    einschleusen('<button id="x2" data-click="revokeOtherTokens">x</button>');
    d.getElementById('x2').click();
    await takt(50);
    assert.deepEqual(aufrufe.slice(vorher).filter(a => a.url.includes('/tokens')), [],
      'eingeschleuster Knopf ruft die Token-Liste ab');

    // loadGallery ist harmlos und angemeldet: Hier zählt allein das Ereignis.
    const galerieAbrufe = (ab) => aufrufe.slice(ab).filter(a => /\/v1\/sets(\?|$)/.test(a.url.replace(/^.*\/api/, '')));
    let ab = aufrufe.length;
    einschleusen('<div id="x3" data-mouseenter="loadGallery">x</div>');
    d.getElementById('x3').dispatchEvent(new w.MouseEvent('mouseenter'));
    await takt(50);
    assert.deepEqual(galerieAbrufe(ab), [], 'Überfahren löst aus');

    ab = aufrufe.length;
    einschleusen('<input id="x4" data-change="loadGallery">');
    d.getElementById('x4').dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(50);
    assert.deepEqual(galerieAbrufe(ab), [], 'change mit fremdem Handler');

    // Kontrolle: derselbe Handler per Klick läuft — sonst bewiesen die zwei oben nichts.
    ab = aufrufe.length;
    einschleusen('<button id="x6" data-click="loadGallery">x</button>');
    d.getElementById('x6').click();
    await takt(50);
    assert.ok(galerieAbrufe(ab).length > 0, 'Kontrolle: loadGallery per Klick ruft /v1/sets ab');

    let geoeffnet = 0;
    w.open = () => { geoeffnet++; return null; };
    einschleusen('<button id="x5" data-click="open" data-arg="https://example.org/">x</button>');
    d.getElementById('x5').click();
    await takt(20);
    assert.equal(geoeffnet, 0, 'window.open über data-click erreichbar');
  } finally { w.close(); }
});

test('echte Knöpfe aus Vorlage und Markup wirken weiter', async () => {
  const { w, d, aufrufe, pwDialogOffen } = await oberflaeche();
  try {
    d.querySelector('.umenu-item[data-arg="settings"]').click();
    const knopf = () => d.querySelector('#users-tbl [data-click="openRpw"][data-arg="2"]');
    assert.ok(await warte(() => knopf()), 'Benutzerliste nicht gezeichnet');
    knopf().click();
    await takt(20);
    assert.equal(pwDialogOffen(), true, 'echter Knopf der Benutzerliste wirkt');
    assert.equal(d.getElementById('rpw-uid').value, '2');

    const vorher = aufrufe.length;
    d.querySelector('[data-click="revokeOtherTokens"]').click();
    await takt(50);
    assert.ok(aufrufe.slice(vorher).some(a => a.url.includes('/tokens')),
      'statischer Knopf aus index.html wirkt');
  } finally { w.close(); }
});

test('jeder Handler im Markup steht in der Liste seines Ereignisses', () => {
  // Struktur: Die Listen in actions.js müssen das Markup abdecken, sonst
  // wäre ein echtes Feld tot. Die Gegenrichtung prüft der Test darüber.
  const quelle = fs.readFileSync(path.join(ROOT, 'public', 'js', 'actions.js'), 'utf8');
  const liste = (typ) => {
    const m = quelle.match(new RegExp(`\\b${typ}: new Set\\(\\[([^\\]]*)\\]`));
    assert.ok(m, `Liste für ${typ} nicht gefunden`);
    return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  };
  const dateien = [path.join(ROOT, 'public', 'index.html'),
    ...fs.readdirSync(path.join(ROOT, 'public', 'js')).filter(f => istAppModul(f))
      .map(f => path.join(ROOT, 'public', 'js', f))];
  // Das Log-Fenster (monitor.js) ist ein eigenes Popup mit eigener Auflösung.
  const LOGFENSTER = new Set(['loadLogs', 'renderLogs']);
  const fehlt = [];
  let gesehen = 0;
  for (const typ of ['change', 'input', 'blur', 'keydown']) {
    const erlaubt = liste(typ);
    for (const f of dateien)
      for (const m of fs.readFileSync(f, 'utf8').matchAll(new RegExp(`data-${typ}="([^"$]+)"`, 'g'))) {
        gesehen++;
        if (!erlaubt.has(m[1]) && !LOGFENSTER.has(m[1])) fehlt.push(`${path.basename(f)}: data-${typ}="${m[1]}"`);
      }
  }
  assert.ok(gesehen > 40, `nur ${gesehen} Treffer — greift die Suche noch?`);
  assert.deepEqual(fehlt, []);
});

test('jede Vorlage mit gefährlicher Aktion trägt echt()', () => {
  // Sonst wäre der Knopf tot: Der Dispatcher weist ihn ab.
  const quelle = fs.readFileSync(path.join(ROOT, 'public', 'js', 'actions.js'), 'utf8');
  const gefaehrlich = new Set([...quelle.match(/GEFAEHRLICH = new Set\(\[([^\]]*)\]/)[1]
    .matchAll(/'([^']+)'/g)].map(x => x[1]));
  const ohne = [];
  let gesehen = 0;
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js')).filter(f => istAppModul(f)))
    for (const m of fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8').matchAll(/data-click="([^"$]+)"(\$\{echt\(\)\})?/g))
      if (gefaehrlich.has(m[1])) { gesehen++; if (!m[2]) ohne.push(`${f}: ${m[1]}`); }
  assert.ok(gesehen > 15, `nur ${gesehen} Treffer — greift die Suche noch?`);
  assert.deepEqual(ohne, []);
});
