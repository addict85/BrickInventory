/**
 * Ein Workflow, der nicht im Wurzelverzeichnis liegt, läuft NIE.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * `Web-App/.github/workflows/ci.yml` war ein vollständiger, sorgfältig
 * geschriebener CI-Lauf: echtes PostgreSQL in der Hauptversion aus dem
 * Betrieb, REQUIRE_DB=1, `npm ci` aus dem Lockfile, Typprüfung, Bau, Tests,
 * `npm audit`. Sein Kopfkommentar beschreibt genau den Fehler, gegen den er
 * gebaut wurde: „die zehn Prüfungen darunter liefen monatelang nicht".
 *
 * Er ist nie gelaufen. Kein einziges Mal.
 *
 * GitHub liest Workflows AUSSCHLIESSLICH aus `.github/workflows/` im
 * Wurzelverzeichnis des Repositories. In einem Unterordner ist so eine Datei
 * nichts als Text. NACHGEMESSEN über die Actions-API — das Repository kannte
 * drei Workflows:
 *
 *     .github/workflows/android.yml
 *     .github/workflows/android-playstore.yml
 *     .github/workflows/docker-publish.yml
 *
 * Und `test/build-tooling.test.js` bewachte den INHALT dieser Datei die ganze
 * Zeit zuverlässig — es zeigte nur auf etwas, das niemand ausführt. Dass eine
 * Prüfung grün ist, sagt eben nur etwas über das, worauf sie zeigt.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 *
 * Gesucht wird im GANZEN Baum nach `.github/workflows/`. Ein neuer Ordner an
 * einer neuen Stelle ist damit von selbst mitgeprüft — eine Liste erlaubter
 * Orte hätte genau den einen Fall nicht gefunden, um den es hier geht.
 *
 * Selbstbeweis über eine Mindestzahl: Fände der Durchlauf gar nichts, wäre die
 * Prüfung leer und trotzdem grün — dieselbe Falle wie oben, eine Ebene höher.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WURZEL = path.join(__dirname, '..', '..');
const ECHTER_ORT = path.join(WURZEL, '.github', 'workflows');

/** Alle `.github/workflows`-Ordner im Baum, ohne node_modules und .git. */
function workflowOrdner(start) {
  const gefunden = [];
  const uebersprungen = new Set(['node_modules', '.git', 'dist', 'build', '.gradle']);
  (function lauf(dir) {
    let eintraege;
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (!e.isDirectory() || uebersprungen.has(e.name)) continue;
      const voll = path.join(dir, e.name);
      if (e.name === 'workflows' && path.basename(dir) === '.github') gefunden.push(voll);
      else lauf(voll);
    }
  })(start);
  return gefunden;
}

test('jeder Workflow liegt dort, wo GitHub ihn liest', () => {
  const ordner = workflowOrdner(WURZEL);

  // Selbstbeweis 1: Der Durchlauf hat wirklich gesucht und den echten Ort
  // gefunden. Ohne das könnte ein kaputtes Muster alles durchwinken.
  assert.ok(ordner.includes(ECHTER_ORT),
    `Der Durchlauf hat ${ECHTER_ORT} nicht gefunden — dann prüft er nichts. ` +
    `Gefunden: ${JSON.stringify(ordner)}`);

  const daneben = ordner.filter(o => o !== ECHTER_ORT);
  assert.deepEqual(daneben, [],
    'Diese Workflow-Ordner liegen NICHT im Wurzelverzeichnis und werden von ' +
    'GitHub nie gelesen:\n  ' + daneben.join('\n  ') +
    '\nGenau so lag ci.yml monatelang in Web-App/.github/workflows und ist ' +
    'kein einziges Mal gelaufen.');
});

test('im Wurzelverzeichnis stehen die Workflows, die es geben soll', () => {
  const dateien = fs.readdirSync(ECHTER_ORT).filter(f => /\.ya?ml$/.test(f)).sort();

  // Selbstbeweis 2: Eine Mindestzahl statt einer Aufzählung. Verschwände der
  // Ordner oder griffe das Muster nicht, wäre die Liste leer — und die
  // Prüfung darunter hätte nichts zu sagen.
  assert.ok(dateien.length >= 4,
    `Nur ${dateien.length} Workflows im Wurzelverzeichnis: ${dateien.join(', ')}`);

  // Der Web-Lauf muss dabei sein. Er ist der einzige, der die Testsuite
  // ausführt — ohne ihn prüft KEIN Lauf die Web-App.
  assert.ok(dateien.includes('web-ci.yml'),
    `Der Web-CI-Lauf fehlt. Vorhanden: ${dateien.join(', ')}`);
});

test('ein Workflow benutzt jede Action überall in derselben Fassung', () => {
  // ── Warum ──────────────────────────────────────────────────────────────────
  // In android.yml steht ein langer, nachgemessener Absatz dazu, warum
  // upload-artifact auf v6 gehoben wurde: v4 und v5 laufen auf Node 20 und
  // warnen, erst v6 läuft auf Node 24. Die Recherche wurde einmal gemacht,
  // aufgeschrieben — und docker-publish.yml blieb auf v4 stehen.
  //
  // Zwei Fassungen derselben Regel, wieder. Diese Prüfung sagt nicht, WELCHE
  // Fassung richtig ist (das hängt am Tag ab und steht in android.yml), nur
  // dass es eine ist.
  const fassungen = new Map();   // Action -> Map(Fassung -> [Dateien])
  for (const f of fs.readdirSync(ECHTER_ORT).filter(f => /\.ya?ml$/.test(f))) {
    const yml = fs.readFileSync(path.join(ECHTER_ORT, f), 'utf8')
      .split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
    for (const m of yml.matchAll(/uses:\s*([\w.-]+\/[\w.\-/]+)@([\w.-]+)/g)) {
      const [, action, fassung] = m;
      if (!fassungen.has(action)) fassungen.set(action, new Map());
      const je = fassungen.get(action);
      if (!je.has(fassung)) je.set(fassung, []);
      if (!je.get(fassung).includes(f)) je.get(fassung).push(f);
    }
  }

  // Selbstbeweis 3: Ohne gefundene Actions ist die Schleife darunter leer.
  assert.ok(fassungen.size >= 8,
    `Nur ${fassungen.size} Actions gefunden — Muster veraltet?`);
  const mehrfach = [...fassungen].filter(([, je]) =>
    [...je.values()].reduce((n, d) => n + d.length, 0) > 1);
  assert.ok(mehrfach.length >= 3,
    `Nur ${mehrfach.length} Actions stehen an mehr als einer Stelle — dann ` +
    'kann diese Prüfung nichts finden.');

  const uneinig = [...fassungen]
    .filter(([, je]) => je.size > 1)
    .map(([action, je]) => `${action}: ` +
      [...je].map(([v, d]) => `${v} (${d.join(', ')})`).join(' vs. '));
  assert.deepEqual(uneinig, [],
    'Dieselbe Action steht in zwei Fassungen:\n  ' + uneinig.join('\n  '));
});

test('ein Lauf, der Tests ausführt, läuft auf JEDEM Zweig', () => {
  // ── Warum (Nachtrag 125) ───────────────────────────────────────────────────
  //
  // android.yml stand auf `push: branches: [main]`, web-ci.yml daneben auf
  // `branches: ['**']`. Dieselbe Regel in zwei Fassungen — und die App zog den
  // Kürzeren.
  //
  // GEMESSEN: In der Sitzung, aus der diese Prüfung stammt, gingen vier Pushes
  // mit Android-Änderungen auf einen Zweig. Die Web-CI lief viermal von selbst,
  // der Android-Lauf kein einziges Mal. Dreimal war er rot, als er endlich von
  // Hand angestossen wurde — der Fehler lag jedes Mal längst im Zweig.
  //
  // Der Zweig ist genau der Ort, an dem der Befund gebraucht wird: bevor etwas
  // nach main geht. Ein Lauf, der erst auf main prüft, sagt es zu spät.
  //
  // GESUCHT, nicht aufgezählt: Betroffen ist jeder Workflow, der TESTS
  // AUSFÜHRT — erkannt am Testbefehl in seinen Schritten, nicht an seinem
  // Namen. Ein neuer Testlauf ist damit von selbst mitgeprüft.
  //
  // Und NUR, wenn er überhaupt auf Push reagiert. Die erste Fassung dieser
  // Prüfung liess das weg und meldete prompt android-playstore.yml: Der führt
  // `testDebugUnitTest` aus, wird aber ausschliesslich von Hand angestossen
  // (`workflow_dispatch` mit der Play-Spur als Eingabe). „Läuft nicht auf
  // jedem Zweig-Push" ist bei einem Lauf ohne Push-Auslöser keine Aussage —
  // das wäre eine erfundene Regel gewesen, und die meldet nur Rauschen.
  // Veröffentlichungsläufe sollen auf ein Etikett oder einen Knopf warten.
  const TESTBEFEHLE = [/npm\s+test/, /testDebugUnitTest/];

  const pruefend = [];
  for (const f of fs.readdirSync(ECHTER_ORT).filter(f => /\.ya?ml$/.test(f))) {
    const roh = fs.readFileSync(path.join(ECHTER_ORT, f), 'utf8');
    // Kommentarzeilen raus: In den Erklärblöcken dieser Dateien stehen die
    // Testbefehle als Fliesstext, und ein Workflow wäre sonst allein deswegen
    // "prüfend", weil er über das Prüfen SCHREIBT.
    const yml = roh.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
    if (TESTBEFEHLE.some(r => r.test(yml))) pruefend.push([f, yml]);
  }

  // Selbstbeweis: Es gibt mindestens die zwei — Web und Android. Fände das
  // Muster keinen, wäre die Schleife darunter leer und die Prüfung still grün.
  assert.ok(pruefend.length >= 2,
    `Nur ${pruefend.length} testausführende Workflows gefunden — Muster veraltet? ` +
    'Ohne Fund prüft der Rest dieses Tests nichts.');

  const eng = [];
  for (const [f, yml] of pruefend) {
    // Der `branches:`-Eintrag UNTER `push:` — nicht der unter `pull_request:`
    // und nicht irgendeiner weiter unten im Text.
    const push = yml.match(/\n\s*push:\s*\n((?:\s{4,}.*\n|\s*\n)*)/);
    if (!push) continue;   // reiner Veröffentlichungslauf — siehe oben
    const zweige = push[1].match(/branches(?:-ignore)?:\s*(.+)/);
    // Kein branches-Eintrag heisst bei GitHub: alle Zweige. Das ist erlaubt.
    if (!zweige) continue;
    if (!zweige[1].includes('**')) eng.push(`${f}: push nur auf ${zweige[1].trim()}`);
  }

  assert.deepEqual(eng, [],
    'Diese Workflows führen Tests aus, laufen aber nicht auf jedem Zweig-Push:\n  ' +
    eng.join('\n  ') +
    '\nDamit kommt ihr Befund erst nach dem Zusammenführen — genau so blieben ' +
    'drei rote Android-Läufe unbemerkt im Zweig stehen.');
});
