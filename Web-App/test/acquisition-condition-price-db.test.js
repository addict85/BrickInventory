/**
 * Der nachgefüllte Marktpreis gilt dem Zustand DIESER Erfassung.
 *
 * ── Marcos Befund (Nachtrag 146) ────────────────────────────────────────────
 * „Wenn ich bei der Minifigur einen zweiten Preis mit einem anderen Zustand
 * erfasse, z.B. gebraucht, wird der Marktpreis dieses Zustands nicht angezeigt.
 * Der Preis ist ebenfalls identisch, wenn ich das Feld leer lasse. Es sieht so
 * aus, als würde der Preis vom anderen Zustand übernommen."
 *
 * ── Was los war ─────────────────────────────────────────────────────────────
 * Wird das Kaufpreisfeld geleert, füllt `resolvePrice()` den Marktpreis nach.
 * Der Aufrufer reicht dafür seit Nachtrag 68 den Zustand DIESER Zeile durch:
 *
 *     p = await cfg.resolvePrice(uid, keys, cond);
 *
 * Die SETS-Fassung nimmt ihn entgegen. Teile und Minifiguren deklarierten den
 * dritten Parameter nicht und liessen ihn fallen. Beide leiteten stattdessen
 * einen Zustand aus ALLEN Erfassungen des Eintrags ab — eine Regel, die nicht
 * stimmen KANN, sobald zwei Erfassungen verschiedene Zustände haben.
 *
 * Folge: Die Gebraucht-Zeile bekam den Preis des Sammelzustands, und ein
 * Marktpreis für „Gebraucht" wurde nie ermittelt — deshalb blieb die Zeile im
 * Detailfenster leer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

test('alle drei Erfassungsarten reichen den Zustand an resolvePrice durch', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'api_v1', 'acquisitions.ts'), 'utf8');

  // Der Aufrufer gibt ihn mit — ohne das ist alles Weitere sinnlos.
  assert.match(src, /cfg\.resolvePrice\(uid, keys, cond\)/,
    'Der Zustand der Zeile wird nicht mehr durchgereicht (Nachtrag 68)');

  // Und jede Fassung muss ihn annehmen UND weitergeben.
  const faelle = [
    [/resolvePrice: \(uid, \[sn\], cond\) =>/, 'Sets'],
    [/resolvePrice: \(uid, \[pn, cid\], cond\) =>[\s\S]{0,160}?getCurrentPartMarketPrice\(pn, cid, uid, cond\)/, 'Teile'],
    [/resolvePrice: async \(uid, \[fn\], cond\) =>[\s\S]{0,400}?getCurrentFigMarketPrice\([^)]*cond\)/, 'Minifiguren'],
  ];
  for (const [muster, name] of faelle) {
    assert.match(src, muster,
      `${name}: Der Zustand der Zeile wird verworfen. Dann bekommt eine ` +
      'Gebraucht-Erfassung den Preis des Sammelzustands — und für ihren ' +
      'eigenen Zustand wird nie einer ermittelt.');
  }
});

test('die Preisermittler nehmen einen Zustand entgegen', () => {
  // Sonst wäre das Durchreichen oben wirkungslos.
  const mf = fs.readFileSync(path.join(__dirname, '..', 'utils', 'marketPrice.ts'), 'utf8');
  const pt = fs.readFileSync(path.join(__dirname, '..', 'utils', 'marketPrice.ts'), 'utf8');

  // Auf den PARAMETER geprüft, nicht auf seine Schreibweise: Ob dort
  // `condition = null` oder `condition: string | null = null` steht, ist eine
  // Frage der Typannotation und ändert an der Zusicherung nichts. Der Wortlaut
  // stand hier fest und wurde beim Einschalten von strictNullChecks rot,
  // obwohl sich am Verhalten nichts geändert hatte — dieselbe Sorte Test, die
  // in Nachtrag 118 eine Sicherheitslücke festgeschrieben hat.
  const nimmtZustand = (src, name) => {
    const i = src.indexOf(`function ${name}(`);
    assert.ok(i >= 0, `${name} gibt es nicht mehr`);
    const kopf = src.slice(i, src.indexOf(')', i) + 1);
    assert.match(kopf, /\bcondition\b/,
      `${name} nimmt keinen Zustand mehr entgegen: ${kopf}`);
    assert.match(kopf, /condition[^,)]*=\s*null/,
      `${name} muss den Zustand mit Vorgabe null annehmen, damit Aufrufer ` +
      `ihn weglassen dürfen: ${kopf}`);
  };
  nimmtZustand(mf, 'getCurrentFigMarketPrice');
  nimmtZustand(pt, 'getCurrentPartMarketPrice');

  // Und der übergebene muss Vorrang haben vor dem abgeleiteten.
  assert.match(mf, /let effCond = condition;/,
    'Der übergebene Zustand hat keinen Vorrang mehr');
  assert.match(pt, /const effCond\s*=\s*condition \|\|/,
    'Der übergebene Zustand hat keinen Vorrang mehr');
});

test('die Schätzung legt je Zustand einen eigenen Eintrag ab', () => {
  // Zwei Zustände = zwei Marktpreise. Lägen sie unter demselben Schlüssel,
  // überschriebe der eine den anderen und die zweite Zeile bliebe für immer
  // leer — genau Marcos Bild.
  const mf = fs.readFileSync(path.join(__dirname, '..', 'utils', 'marketPrice.ts'), 'utf8');
  const i = mf.indexOf('async function estimateFigPriceFromParts');
  const fn = mf.slice(i, mf.indexOf('\n}', i));

  assert.match(fn, /INSERT INTO minifig_price_cache[\s\S]{0,200}?condition/,
    'Der Cache-Eintrag trägt keinen Zustand');
  assert.match(fn, /fetchPartPrice\([^)]*cond[^)]*\)/,
    'Die Teilepreise werden nicht im Zustand dieser Schätzung geholt — dann ' +
    'ergäben „Neu" und „Gebraucht" denselben Wert.');
});

test('jeder Marktpreis-Abruf bekommt einen Zustand mit', () => {
  // ── Zweimal dieselbe Lücke (Nachträge 146 und 147) ────────────────────────
  //
  // 146 hat das BEARBEITEN behoben (resolvePrice in den Erfassungsrouten).
  // Marcos nächster Befund zeigte, dass das ERFASSEN denselben Fehler hatte:
  // Zwei heute angelegte Einträge derselben Figur, „Neu" und „Gebraucht",
  // beide Kaufpreis CHF 2.18 — obwohl die Marktpreise 2.18 und 2.20 sind.
  //
  // Beim Anlegen der zweiten Zeile gab es erst die erste; der ohne Zustand
  // geholte Preis leitete sich also aus ihr ab.
  //
  // Ich hatte beim ersten Mal nur die Stellen angesehen, die im Fehlerbericht
  // vorkamen. Diese Prüfung sieht ALLE — auch die, die noch niemand gemeldet
  // hat.
  const fs = require('node:fs');
  const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');
  const ROOT = path.join(__dirname, '..');

  const dateien = [];
  (function sammle(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sammle(p);
      else if (e.name.endsWith('.ts')) dateien.push(p);
    }
  })(path.join(ROOT, 'routes'));
  for (const f of fs.readdirSync(path.join(ROOT, 'utils'))) {
    if (f.endsWith('.ts')) dateien.push(path.join(ROOT, 'utils', f));
  }

  const treffer = [];
  for (const datei of dateien) {
    const code = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const fn of ['getCurrentFigMarketPrice', 'getCurrentPartMarketPrice']) {
      const re = new RegExp(String.raw`(?<!function )${fn}\(([^)]*)\)`, 'g');
      for (const m of code.matchAll(re)) {
        const args = m[1].split(',').map(a => a.trim()).filter(Boolean);
        if (args.length >= 4) continue;   // …, condition
        const zeile = code.slice(0, m.index).split('\n').length;
        treffer.push(`${path.relative(ROOT, datei)}:${zeile} ${fn}(${m[1].slice(0, 40)})`);
      }
    }
  }
  assert.deepEqual(treffer, [],
    'Marktpreis ohne Zustand geholt:\n  ' + treffer.join('\n  ') +
    '\nMarktpreise gelten JE ZUSTAND. Ohne Angabe wird einer aus den ' +
    'vorhandenen Erfassungen abgeleitet — und der stimmt nicht, sobald ein ' +
    'Eintrag in beiden Zuständen vorliegt.');
});
