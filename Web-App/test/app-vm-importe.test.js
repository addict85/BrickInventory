/**
 * Jeder `vm.…()`-Aufruf in der App ist auch erreichbar.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 *
 * Android-CI Lauf 196, nach neun Minuten Wartezeit und einem roten Lauf:
 *
 *     SetItemDetailDialog.kt:80:59 Unresolved reference 'loadLagerortVorrat'
 *
 * Die Zustandsfunktionen der App sind Erweiterungen auf MainViewModel und
 * liegen im Paket `ch.brickinventoryapp.ui`. Die Bildschirme liegen in
 * `ui.screens`, die Dialoge in `ui.dialogs`, die Navigation in `nav` — also
 * in ANDEREN Paketen. Jede dieser Dateien braucht einen Import, und manche
 * führen ihn einzeln statt mit Stern. Wer dort einen neuen Aufruf einfügt,
 * merkt den fehlenden Import erst, wenn der Kotlin-Compiler läuft.
 *
 * ── Warum diese Prüfung hier steht und nicht im Android-Testbaum ────────────
 *
 * Genau deswegen. Ein Kotlin-Test liefe ebenfalls erst in der CI — er würde
 * dasselbe neun Minuten später melden, nur mit einem freundlicheren Satz. Das
 * ist kein Gewinn. Hier läuft er mit `npm test`, also VOR dem Push, und das
 * ist der ganze Zweck: In diesem Baum ist die GitHub-Action der einzige
 * Kotlin-Compiler, und alles, was sie ohne sie findbar macht, spart einen
 * roten Lauf.
 *
 * Dass eine Android-Regel im Web-Testbaum steht, ist der Preis dafür. Er ist
 * benannt, und die Pfade sind ausgeschrieben (test/baumbruecken.test.js).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const APP = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src', 'main', 'java',
                      'ch', 'brickinventoryapp');

/** Alle .kt-Dateien des Hauptbaums. */
function dateien(d = APP, raus = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) dateien(p, raus);
    else if (e.name.endsWith('.kt')) raus.push(p);
  }
  return raus;
}

/** Zeilenweise und konservativ — wie Quellen.ohneKommentare im Android-Baum. */
const ohneKommentare = s => s.split('\n').map(z => {
  const t = z.trim();
  return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z;
}).join('\n');

test('jeder vm.…()-Aufruf findet seine Erweiterung', () => {
  const alle = dateien();
  // Untergrenze: Ein leerer Dateilauf liesse diese Prüfung stillschweigend
  // bestehen — dieselbe Vorsicht wie in Quellen.alle() im Android-Baum.
  assert.ok(alle.length >= 60, `Nur ${alle.length} Kotlin-Dateien gefunden — Pfad veraltet?`);

  // Erst alle Erweiterungen sammeln: Name → Paket, in dem sie steht.
  const zuhause = new Map();
  for (const f of alle) {
    const s = ohneKommentare(fs.readFileSync(f, 'utf8'));
    const paket = /^package ([\w.]+)/m.exec(s)?.[1];
    for (const m of s.matchAll(/^(?:internal |private |public )?fun MainViewModel\.(\w+)\s*[(<]/gm)) {
      zuhause.set(m[1], paket);
    }
  }
  assert.ok(zuhause.size >= 80,
    `Nur ${zuhause.size} MainViewModel-Erweiterungen gefunden — Muster veraltet?`);

  const offen = [];
  for (const f of alle) {
    const roh = fs.readFileSync(f, 'utf8');
    const s = ohneKommentare(roh);
    const paket = /^package ([\w.]+)/m.exec(s)?.[1];
    // `\*` gehört ins Muster, und der nachgestellte Kommentar muss draussen
    // bleiben: `import ch.brickinventoryapp.ui.*  // Feature-Extensions` ist
    // die häufigste Form im Baum. Ohne beides meldete der erste Entwurf 118
    // Verstösse, von denen 117 keine waren — die Prüfung hätte sich selbst
    // widerlegt, bevor sie das erste Mal gelaufen wäre.
    const importe = new Set([...roh.matchAll(/^import ([\w.*]+)/gm)].map(m => m[1]));
    for (const m of s.matchAll(/\bvm\.(\w+)\s*\(/g)) {
      const heim = zuhause.get(m[1]);
      if (!heim || heim === paket) continue;
      if (importe.has(`${heim}.${m[1]}`) || importe.has(`${heim}.*`)) continue;
      offen.push(`${path.relative(APP, f)}:${s.slice(0, m.index).split('\n').length}  ` +
                 `vm.${m[1]}() — liegt in ${heim}, aber nicht importiert`);
    }
  }
  assert.deepEqual(offen, [],
    'Diese Aufrufe erreichen ihre Erweiterung nicht. Der Kotlin-Compiler sagt dazu ' +
    '„Unresolved reference" — aber erst in der CI, neun Minuten später:\n  ' +
    offen.join('\n  '));
});
