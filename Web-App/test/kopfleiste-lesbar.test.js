const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const P = (...t) => path.join(WEB, ...t);

/**
 * Was in der Kopfleiste steht, muss auf ihr lesbar sein.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Marco: „Die Zahlen oben rechts sind im neuen Design nicht wirklich lesbar."
 * Im Browser GEMESSEN war es schlimmer als „nicht wirklich":
 *
 *     Zahlen (466, 280,5k …)   Kontrast 1.00
 *     „Manager" im Titel       Kontrast 1.00
 *     Beschriftungen (SETS …)  Kontrast 1.22
 *
 * 1.00 heisst: exakt dieselbe Farbe wie der Untergrund. styles.css faerbt die
 * Kennzahlen mit `var(--b600)`, weil die Kopfleiste dort WEISS ist. Das
 * Steindesign streicht die Kopfleiste mit genau diesem --b600 — und schreibt
 * rot auf rot.
 *
 * ── Warum die Regel der KONTRAST ist und nicht „ueberschreiben" ─────────────
 *
 * Die naheliegende Fassung waere: „Wer die Kopfleiste streicht, muss auch die
 * Texte darin neu faerben." Die waere falsch. themes/werkbank.css streicht die
 * Kopfleiste dunkel und faerbt NICHTS davon um — dort ist --b600 ein helles
 * Blau und --mut ein helles Grau, beides GEMESSEN ueber 5.0. Ein Zwang zum
 * Ueberschreiben haette ein funktionierendes Design gemeldet.
 *
 * Genau derselbe Irrtum ist dieser Sitzung eine Runde vorher bei
 * design-haftung.test.js unterlaufen (dort brick.css). Deshalb hier gleich
 * die Eigenschaft, um die es geht.
 *
 * ── Woher die Liste der Stellen kommt ───────────────────────────────────────
 *
 * Nicht von Hand: aus index.html. Gesucht sind Klassen, die AUSSCHLIESSLICH im
 * <header> vorkommen; Regeln in styles.css, die eine solche Klasse nennen, eine
 * Textfarbe setzen und KEINEN eigenen Hintergrund haben, erben den Grund der
 * Kopfleiste. GEMESSEN sind das genau drei — und genau die drei waren rot.
 * Kommt eine vierte dazu, ist sie automatisch mitgeprueft.
 */

const ohneKommentare = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

function regeln(css) {
  const raus = [];
  for (const stueck of ohneKommentare(css).split('}')) {
    const i = stueck.indexOf('{');
    if (i < 0) continue;
    raus.push([stueck.slice(0, i).split(',').map(s => s.trim()), stueck.slice(i + 1)]);
  }
  return raus;
}

/** Die Klassen, die es nur im <header> gibt. */
function kopfKlassen() {
  const html = fs.readFileSync(P('public', 'index.html'), 'utf8');
  const auf = html.indexOf('<header'), zu = html.indexOf('</header>');
  assert.ok(auf > 0 && zu > auf, 'Kein <header> in index.html gefunden');
  const sammle = s => new Set([...s.matchAll(/class="([^"]+)"/g)]
    .flatMap(m => m[1].split(/\s+/).filter(Boolean)));
  const drin = sammle(html.slice(auf, zu));
  const draussen = sammle(html.slice(0, auf) + html.slice(zu));
  return [...drin].filter(k => !draussen.has(k));
}

/**
 * Stellen in der Kopfleiste mit ihrer Textfarbe — und mit dem Grund, auf dem
 * sie steht.
 *
 * Zwei Arten, und BEIDE zaehlen:
 *
 *   erbt  — kein eigener Hintergrund, steht also auf der Kopfleiste
 *           (.logo h1 span, .hs .v, .hs .l)
 *   eigen — bringt seinen Grund mit (.ubadge, .abadge)
 *
 * Die erste Fassung liess die zweite Art weg, weil der gemeldete Fehler in der
 * ersten lag. Das war zu eng: Die Admin-Plakette stand GEMESSEN bei 1.93:1 —
 * bernsteinfarben auf bernstein —, direkt neben den Kennzahlen, und diese
 * Pruefung sah daran vorbei. Eine eigene Flaeche schuetzt nicht vor zu
 * schwachem Text; sie verschiebt nur, wogegen man misst.
 */
function kopfStellen() {
  const nurKopf = kopfKlassen();
  const treffer = [];
  for (const [sels, rumpf] of regeln(fs.readFileSync(P('public', 'styles.css'), 'utf8'))) {
    const farbe = rumpf.match(/(?:^|[;\s])color:\s*([^;]+)/);
    if (!farbe) continue;
    const eigen = rumpf.match(/(?:^|[;\s])background(?:-color)?:\s*([^;]+)/);
    for (const sel of sels) {
      const klassen = [...sel.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
      if (!klassen.some(k => nurKopf.includes(k))) continue;
      treffer.push({ sel, farbe: farbe[1].trim(), eigenerGrund: eigen ? eigen[1].trim() : null });
    }
  }
  return treffer;
}

// ── Farbrechnen ────────────────────────────────────────────────────────────
const hex = s => {
  const t = s.trim().replace('#', '');
  const v = t.length === 3 ? [...t].map(c => c + c) : t.match(/../g);
  return v.slice(0, 3).map(x => parseInt(x, 16));
};
function leuchtdichte([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const verhaeltnis = (a, b) => {
  const [x, y] = [leuchtdichte(a), leuchtdichte(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * `var(--x)` aufloesen — in der Reihenfolge, in der der Browser es tut:
 * erst was das Design selbst setzt, dann tokens.css, dann :root in styles.css.
 */
function werte(designCss, design) {
  const tokens = fs.readFileSync(P('public', 'tokens.css'), 'utf8');
  const grund = fs.readFileSync(P('public', 'styles.css'), 'utf8');
  const karte = new Map();
  /**
   * ALLE Bloecke des Designs, in Reihenfolge — und der spaetere gewinnt.
   *
   * Die erste Fassung nahm den ERSTEN Fund und liess ihn stehen. Bei
   * "hochglanz" griff damit ein beliebiger Regelrumpf aus hochglanz.css statt
   * des Variablenblocks in noppe.css, und --mut loeste anders auf als im
   * Browser: Die Gegenprobe rechnete 1.06, wo der Browser 1.22 misst. Das
   * URTEIL war in beiden Faellen dasselbe (viel zu schwach) — die ZAHL aber
   * falsch, und eine Pruefung, deren Zahlen nicht stimmen, ist als Beleg
   * nichts wert.
   *
   * Alle genannten Selektoren haben dieselbe Spezifitaet (0-1-0), damit
   * entscheidet allein die Reihenfolge.
   */
  const lies = (css, nurBlock) => {
    const text = ohneKommentare(css);
    const stellen = [];
    if (nurBlock) {
      for (let i = text.indexOf(nurBlock); i >= 0; i = text.indexOf(nurBlock, i + 1)) {
        // Die dunkle Variante (data-dunkel, seit 29.10.) ist eine zweite
        // Belegung; geprüft wird hier die helle.
        if (text.slice(text.lastIndexOf('}', i) + 1, i).includes('[data-dunkel]')) continue;
        const auf = text.indexOf('{', i);
        if (auf >= 0) stellen.push(text.slice(auf, text.indexOf('}', auf)));
      }
    } else {
      stellen.push(text);
    }
    for (const block of stellen) {
      for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) karte.set(m[1], m[2].trim());
    }
  };
  // Von hinten nach vorn: Was frueher gelesen wird, soll NICHT ueberschrieben
  // werden — deshalb zuerst die schwaechste Quelle.
  lies(grund, ':root');
  lies(tokens, `[data-theme="${design}"]`);
  lies(designCss, `[data-theme="${design}"]`);
  return (name, unter) => {
    let w = String(name);
    for (let i = 0; i < 8 && /^var\(/.test(w); i++) {
      w = karte.get(w.slice(4, w.indexOf(')')).trim()) || '';
    }
    w = w.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(w)) return hex(w);
    // rgb()/rgba() ebenfalls: Ein Design darf seine Ueberschreibung so
    // schreiben — themes/brick.css tut es (`rgba(255,255,255,.72)`). Die
    // erste Fassung liess nur Hex zu und uebersprang so eine Ueberschreibung
    // STILL. Eine Pruefung, die bei der interessanten Schreibweise wegsieht,
    // ist keine.
    const t = w.match(/^rgba?\(([^)]+)\)/i);
    if (!t) return null;
    const z = t[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (z.length < 3 || z.slice(0, 3).some(Number.isNaN)) return null;
    const a = z.length > 3 && !Number.isNaN(z[3]) ? z[3] : 1;
    if (a >= 1) return z.slice(0, 3);
    if (!unter) return null;
    return [0, 1, 2].map(k => a * z[k] + (1 - a) * unter[k]);
  };
}

/**
 * Jedes Design mit ALLEM, was fuer es gilt — nicht nur mit seiner eigenen
 * Datei.
 *
 * "hochglanz" hat keine eigene Kopfleistenregel: Es ist "noppe" in einem
 * anderen Material, und die Anatomie steht in themes/noppe.css, deren Regeln
 * beide Designs nennen. Die erste Fassung las nur die gleichnamige Datei und
 * hat hochglanz deshalb STILL uebersprungen — ausgerechnet eines der beiden,
 * um die es hier geht. Aufgefallen ist das erst beim Abgleich mit dem
 * Browser: Der zeigte dreizehn Zeilen, die Rechnung acht.
 */
function designs() {
  const ordner = P('public', 'themes');
  const dateien = fs.readdirSync(ordner).filter(n => n.endsWith('.css'))
    .map(n => fs.readFileSync(path.join(ordner, n), 'utf8'));
  const namen = new Set(dateien.flatMap(css =>
    [...css.matchAll(/\[data-theme="([\w-]+)"\]/g)].map(m => m[1])));
  // Reihenfolge wie im <link>: spaeter geladen gewinnt.
  return [...namen].sort().map(name => [name, dateien.join('\n')]);
}

/** Was faerbt dieses Design der Kopfleiste als Grund? */
function kopfGrund(css, design) {
  let wert = null;
  for (const [sels, rumpf] of regeln(css)) {
    if (!sels.some(s => s.startsWith(`[data-theme="${design}"] `) &&
                        s.replace(/^\[data-theme="[\w-]+"\]\s*/, '') === 'header')) continue;
    const t = rumpf.match(/(?:^|[;\s])background(?:-color)?:\s*([^;]+)/);
    if (t) wert = t[1].trim();
  }
  return wert;
}

/**
 * Was gilt fuer `stelle` in diesem Design — die Ueberschreibung oder der Wert
 * aus styles.css? `eigenschaft` ist `color` oder `background`.
 *
 * Auch der GRUND muss so gesucht werden, nicht nur die Schrift: themes/brick.css
 * gibt den Plaketten eigene Flaechen (`rgba(255,255,255,.16)` und
 * `var(--brick-petrol)`). Die erste Fassung las nur die Schrift nach und mass
 * sie gegen den Grund aus styles.css — und meldete brick mit 1.29 und 1.11,
 * obwohl dort weiss auf Petrol steht. Wieder ein Design, das die Sache richtig
 * macht, und wieder haette die Pruefung es als Fehler ausgegeben.
 */
function eigenschaftFuer(css, design, stelle, grundwert, eigenschaft) {
  let wert = grundwert;
  const muster = eigenschaft === 'color'
    ? /(?:^|[;\s])color:\s*([^;]+)/
    : /(?:^|[;\s])background(?:-color)?:\s*([^;]+)/;
  for (const [sels, rumpf] of regeln(css)) {
    // `endsWith` und kein Gleichheitszeichen: themes/brick.css schreibt
    // `header .hstats .hs .v`, die Grundregel `.hs .v`. Ein Vergleich auf
    // Gleichheit hat brick deshalb als ungefaerbt gelesen und ein Design
    // gemeldet, das die Sache laengst richtig macht — dieselbe Falle wie bei
    // design-haftung.test.js, hier von der Gegenprobe gefangen. Mehr Vorfahren
    // heisst hoehere Spezifitaet, die Regel gewinnt also wirklich.
    const trifft = sels.some(s => {
      if (!s.startsWith(`[data-theme="${design}"] `)) return false;
      const rein = s.replace(/^\[data-theme="[\w-]+"\]\s*/, '').trim();
      return rein === stelle || rein.endsWith(' ' + stelle);
    });
    if (!trifft) continue;
    const t = rumpf.match(muster);
    if (t) wert = t[1].trim();
  }
  return wert;
}

test('jeder Text in einer gestrichenen Kopfleiste ist lesbar', () => {
  const stellen = kopfStellen();
  // Selbstbeweis: GEMESSEN sind es sechs — .logo h1 span, .hs .v und .hs .l
  // auf der Leiste, dazu .ubadge, .abadge und .umenu-item auf eigenem Grund.
  // Findet die Ableitung nichts, waere die Schleife darunter still gruen.
  //
  // Von fuenf auf sechs am 16.10.: Das Menue hinter dem Benutzernamen
  // (Marcos Vorgabe) steht im <header> und faellt damit in die Ableitung. Es
  // liegt aber auf der Klappe und nicht auf dem Streifen — deshalb traegt
  // `.umenu-item` in styles.css ausdruecklich seinen eigenen Grund, und die
  // Pruefung misst die richtige Paarung.
  //
  // Von sechs auf SIEBEN am 17.10.: „Abmelden" ist aus der Kopfleiste in die
  // Menueklappe gezogen (Marcos Vorgabe) und hat dort eine eigene Farbe
  // bekommen — es beendet die Sitzung, waehrend die sieben Punkte darueber
  // nur die Sicht wechseln. Eine eigene Farbe heisst: eine eigene Stelle,
  // die gegen ihren eigenen Grund gemessen werden muss. Deshalb traegt
  // `.umenu-abmelden` in styles.css ausdruecklich auch einen Hintergrund.
  //
  // Und von sieben auf SECHS, noch am 17.10.: Die Admin-Plakette ist aus der
  // Kopfleiste verschwunden. Der Hinweis steht jetzt IM Namen —
  // „marco.bigolin (Admin)" —, auf Marcos Vorgabe. Damit faellt `.abadge`
  // aus der Ableitung: Die Klasse steht nicht mehr im <header>.
  //
  // Die REGEL in styles.css bleibt stehen, und das ist Absicht:
  // themes/brick.css faerbt `header .abadge` eigens um, und die
  // Benutzerverwaltung zeigt dieselbe Plakette weiter an.
  assert.equal(stellen.length, 6,
    `${stellen.length} Stellen abgeleitet statt sechs: ` +
    stellen.map(s => s.sel).join(', ') + ' — greift die Ableitung noch?');
  assert.equal(stellen.filter(s => s.eigenerGrund).length, 3,
    'Die Stellen mit eigenem Grund sind nicht mehr drei — greift die Ableitung noch?');

  const alle = designs();
  assert.ok(alle.length >= 4, `Nur ${alle.length} Designs — greift die Suche noch?`);

  const schwach = [];
  let geprueft = 0;
  for (const [design, css] of alle) {
    const grundName = kopfGrund(css, design);
    if (!grundName) continue;              // streicht die Kopfleiste nicht
    const loese = werte(css, design);
    const leiste = loese(grundName);
    if (!leiste) continue;                 // z. B. `transparent` — kein Farbwert
    for (const { sel: stelle, farbe: grundfarbe, eigenerGrund } of stellen) {
      // Gemessen wird gegen den Grund, auf dem der Text WIRKLICH steht: die
      // eigene Flaeche, wenn es eine gibt, sonst die Leiste. Eine
      // halbdurchsichtige eigene Flaeche wird ueber den Grund DARUNTER
      // gerechnet.
      //
      // ── Und der Grund darunter ist nicht immer die Leiste ──────────────
      //
      // Bis zum 17.10. wurde IMMER ueber die Leiste gerechnet. Fuer die
      // Eintraege der Menueklappe ist das falsch: Sie liegen auf der KLAPPE,
      // und die ist weiss. GEMESSEN an einer Gegenprobe: Faerbt ein Design
      // `.umenu-abmelden` weiss auf `rgba(255,255,255,.14)`, ergibt das ueber
      // der blauen Leiste ein helles Blau — weisse Schrift darauf besteht.
      // In Wahrheit liegt es ueber WEISS, und der Text ist unsichtbar. Genau
      // diese Fehlerklasse hat Marco dreimal gemeldet, und genau hier ist sie
      // durchgerutscht.
      const unterlage = /\bumenu-(item|abmelden)\b/.test(stelle)
        ? loese(eigenschaftFuer(css, design, '.umenu-pop', 'var(--sur)', 'background'), leiste)
        : leiste;
      const grund = eigenerGrund
        ? loese(eigenschaftFuer(css, design, stelle, eigenerGrund, 'background'), unterlage)
        : leiste;
      if (!grund) continue;
      const farbe = loese(eigenschaftFuer(css, design, stelle, grundfarbe, 'color'), grund);
      if (!farbe) continue;
      geprueft++;
      const v = verhaeltnis(farbe, grund);
      // 4.5:1 — die Schwelle der WCAG fuer normalen Text. Die Kennzahlen sind
      // klein (0.62–0.88rem), da gilt keine Ausnahme fuer grosse Schrift.
      if (v < 4.5) schwach.push(`${design}: "${stelle}" steht bei ${v.toFixed(2)}:1`);
    }
  }
  assert.ok(geprueft >= 10,
    `Nur ${geprueft} Paare geprueft — loesen die Farbwerte noch auf?`);
  assert.deepEqual(schwach, [],
    'Diese Texte in der Kopfleiste stehen zu schwach (noetig 4.5:1). ' +
    'Bei 1.00 ist es exakt dieselbe Farbe — genau so standen die Kennzahlen im ' +
    'Steindesign. Das Design muss ihnen eine eigene Farbe geben.');
});

/**
 * ── Nachtrag 17.10.: die Lücke, durch die der Fehler gegangen ist ───────────
 *
 * Marcos Befund, dreimal gemeldet: „Beim Logout-Eintrag fehlt der Text."
 *
 * Die Ursache war eine Regel in themes/brick.css:
 *
 *     [data-theme="brick"] header #btn-logout{
 *       background:rgba(255,255,255,.14);color:#fff;…}
 *
 * Sie stammte aus der Zeit, als „Abmelden" ein Knopf IN DER KOPFLEISTE war —
 * weiss auf dem blauen Streifen, richtig so. Seit der Knopf in die WEISSE
 * Menüklappe gezogen ist, malt sie weisse Schrift auf weissen Grund.
 * GEMESSEN im echten Browser: `rgb(255,255,255)` auf `rgba(255,255,255,.14)`.
 *
 * ── Warum die Prüfung darüber sie NICHT gefangen hat ────────────────────────
 *
 * `kopfStellen()` leitet die Textstellen aus den KLASSEN in styles.css ab und
 * fragt dann jedes Design, ob es sie umfärbt (`eigenschaftFuer`). Eine
 * Design-Regel, die über eine ID zielt, kommt in dieser Ableitung gar nicht
 * vor — sie ist für die ganze Maschinerie unsichtbar.
 *
 * Darum diese Regel: In der Kopfleiste fassen Design-Regeln KLASSEN an, keine
 * IDs. Das ist keine Stilfrage. Eine Klassenregel wird oben mitgemessen, eine
 * ID-Regel nicht — und sie wiegt obendrein schwerer als alles, was styles.css
 * setzen kann. Genau deshalb blieb auch der Rückfallwert
 * `color:var(--r700,#b91c1c)` wirkungslos: (1,1,1) schlägt (0,1,0).
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 *   A  die entfernte brick-Regel wieder eingesetzt
 *      → rot, nennt `[data-theme="brick"] header #btn-logout`
 *   B  stattdessen dieselbe Farbe über `.umenu-abmelden` gesetzt
 *      → beim ersten Messen GRÜN in BEIDEN Fällen. Meine Behauptung „über
 *        eine Klasse ist der Fehler wieder messbar" war also FALSCH, und die
 *        Gegenprobe hat sie widerlegt.
 *
 *        Der Grund war ein Mangel in der Prüfung darüber: Sie rechnete einen
 *        durchscheinenden Hintergrund IMMER über die Leiste. Weiss auf
 *        `rgba(255,255,255,.14)` ergibt über dem blauen Streifen ein helles
 *        Blau — und besteht. In Wahrheit liegt der Eintrag auf der weissen
 *        Klappe. Seit dem 17.10. rechnet sie für Einträge der Klappe über die
 *        KLAPPE, und B wird rot.
 */
/**
 * IDs, die ein Design faerben DARF — mit Grund, und der Grund ist gemessen.
 *
 * Beide gehoeren zur Import-Leiste (`#global-import-bar`). NACHGESEHEN in
 * index.html liegt sie im <header>, aber NICHT in der Menueklappe: Sie sitzt
 * wirklich auf dem gestrichenen Streifen, und dort ist weisse Schrift richtig.
 *
 * Sie stehen trotzdem hier und nicht einfach ungeprueft da: Ein Eintrag in
 * dieser Liste sieht aus wie eine Entscheidung und ist doch nur eine
 * Vermutung, sobald niemand mehr nachsieht. Wer hier etwas eintraegt, muss
 * NACHGESEHEN haben, wo das Element wirklich sitzt.
 *
 * Gemessen bleiben beide damit NICHT — die Ableitung oben sieht keine IDs.
 * Das ist der Preis dafuer, dass sie als IDs dastehen; er faellt nur deshalb
 * nicht ins Gewicht, weil ihr Grund derselbe ist wie der der Leiste.
 */
const ID_ERLAUBT = new Set(['#gib-text', '#gib-chevron']);

test('Design-Regeln in der Kopfleiste fassen Klassen an, keine IDs', () => {
  const ordner = P('public', 'themes');
  const treffer = [];
  for (const name of fs.readdirSync(ordner).filter(n => n.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(ordner, name), 'utf8');
    for (const [sels, rumpf] of regeln(css)) {
      if (!/(?:^|[;\s])color:/.test(rumpf)) continue;
      for (const sel of sels) {
        if (!/\bheader\b/.test(sel)) continue;
        const ids = sel.match(/#[\w-]+/g) || [];
        if (!ids.length) continue;
        if (ids.every(id => ID_ERLAUBT.has(id))) continue;
        treffer.push(`${name}: ${sel.trim()}`);
      }
    }
  }
  assert.deepEqual(treffer, [],
    'Diese Design-Regeln färben Text in der Kopfleiste über eine ID:\n  ' +
    treffer.join('\n  ') +
    '\n\nDie Prüfung oben leitet ihre Stellen aus KLASSEN ab und sieht solche ' +
    'Regeln nicht — und eine ID wiegt schwerer als jede Klasse in styles.css. ' +
    'Genau so ist der weisse „Abmelden"-Text auf weissem Grund entstanden. ' +
    'Über eine Klasse zielen, dann wird sie mitgemessen.');
});
