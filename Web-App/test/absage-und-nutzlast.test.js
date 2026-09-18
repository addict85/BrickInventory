const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const lies = rel => fs.readFileSync(path.join(WEB, rel), 'utf8');

/**
 * Eine Absage darf nicht heissen wie die Nutzlast.
 *
 * ── Der Fehler aus dem Betrieb ──────────────────────────────────────────────
 *
 * Marco: „Wenn ich auf Einladungscode erzeugen klicke, kommt folgender Fehler:
 * POST /api/v1/settings/household/invite 500: TypeError: Cannot read
 * properties of undefined (reading 'de')".
 *
 * createInvite() lieferte im ERFOLGSFALL `{ code: <Einladungstoken> }` und im
 * FEHLERFALL `{ code: 'konto_bereits_verknuepft_eine_stufe' }`. Die Route
 * entschied mit `if (r.code)`, ob etwas schiefgegangen war — und hielt damit
 * jede erfolgreiche Einladung fuer einen Fehler. Der Zufallstoken ging als
 * Fehlercode in fehlerText(), stand dort in keiner Tabelle, und der Zugriff
 * auf `eintrag['de']` lief in undefined.
 *
 * Die Funktion hat seit jenem Umbau NIE funktioniert.
 *
 * ── Warum es keine Pruefung gemerkt hat ─────────────────────────────────────
 *
 * household-db.test.js prueft beide Rueckgaben — aber einzeln, direkt an der
 * Funktion, und beide Male ueber `.code`. Die ENTSCHEIDUNG trifft die Route,
 * und die kam in keinem Test vor. Ein Feld, das zwei Dinge bedeutet, faellt
 * genau dann nicht auf, wenn man beide Bedeutungen getrennt betrachtet.
 *
 * Deshalb pruefen die Regeln hier die Naht zwischen Helfer und Route, nicht
 * die Enden.
 */

test('Absagen aus utils/household.ts heissen fehler, nicht code', () => {
  const quelle = lies('utils/household.ts');
  // `code` ist in dieser Datei ein NUTZLAST-Name: der Einladungscode selbst.
  // Eine Absage darf ihn deshalb nicht belegen.
  const absagen = [...quelle.matchAll(/return \{ (\w+): '([a-z_]+)' as const/g)];
  // Selbstbeweis: GEMESSEN sind es acht Absagen. Findet die Suche keine, waere
  // die Zusicherung darunter still gruen.
  assert.equal(absagen.length, 8,
    `${absagen.length} Absagen gefunden statt acht — greift die Suche noch?`);
  const falsch = absagen.filter(m => m[1] !== 'fehler').map(m => `${m[1]}: '${m[2]}'`);
  assert.deepEqual(falsch, [],
    'Diese Absagen benutzen einen anderen Schluessel als `fehler`. Heisst er ' +
    '`code`, kollidiert er mit dem Einladungscode im Erfolgsfall — und die ' +
    'Route haelt jeden Erfolg fuer einen Fehler.');
});

test('die Route entscheidet am Absage-Feld, nicht an der Nutzlast', () => {
  const route = lies('routes/api_v1/settings.ts');
  const haushalt = [...route.matchAll(/router\.post\('\/settings\/household\/(\w+)'[\s\S]{0,400}?\n\}\);/g)];
  // Selbstbeweis: GEMESSEN sind es drei — invite, redeem, unlink.
  assert.equal(haushalt.length, 3,
    `${haushalt.length} Haushalts-Routen gefunden statt drei — greift die Suche noch?`);

  const falsch = [];
  for (const m of haushalt) {
    const block = m[0];
    if (!/sendeFehler/.test(block)) continue;          // unlink kennt keine Absage
    if (/\(r as any\)\.code/.test(block)) falsch.push(m[1]);
  }
  assert.deepEqual(falsch, [],
    'Diese Routen entscheiden an `.code`, ob etwas schiefging. `code` ist hier ' +
    'die NUTZLAST (der Einladungscode) — die Absage steht in `.fehler`.');
});

test('jeder Fehlercode aus utils/household.ts steht in der Texttabelle', () => {
  // ── Die zweite Haelfte desselben Unfalls ─────────────────────────────────
  //
  // Selbst mit getrennten Feldern kippt fehlerText() in ein 500, sobald ein
  // Code in FEHLER fehlt: Es liest `eintrag[sprache]` ohne zu pruefen, ob es
  // den Eintrag gibt. Ein Tippfehler im Code reicht.
  const codes = [...lies('utils/household.ts')
    .matchAll(/return \{ fehler: '([a-z_]+)' as const/g)].map(m => m[1]);
  assert.ok(codes.length >= 5, `Nur ${codes.length} Fehlercodes — greift die Suche noch?`);

  const tabelle = lies('utils/fehlerTexte.ts');
  const fehlend = codes.filter(c => !new RegExp(`\\b${c}\\s*:`).test(tabelle));
  assert.deepEqual(fehlend, [],
    'Diese Fehlercodes stehen in keiner Texttabelle. fehlerText() liest den ' +
    'Eintrag ungeprueft — ein fehlender Code endet als HTTP 500, genau wie bei ' +
    'der Einladung.');
});

test('fehlerText faellt bei unbekanntem Code nicht um', () => {
  // ── Der Gurt ──────────────────────────────────────────────────────────────
  //
  // Die Regeln oben halten den Baum sauber. Diese hier sorgt dafuer, dass ein
  // Durchrutscher trotzdem keine 500 wird: Eine Fehlermeldung ist das
  // Letzte, was selbst noch abstuerzen darf.
  const quelle = lies('utils/fehlerTexte.ts');
  // Bis zur schliessenden Klammer der Funktion und nicht die ersten N Zeichen:
  // Die erste Fassung nahm 500 Zeichen und wurde rot, sobald die BEGRUENDUNG
  // der Pruefung darueber laenger wurde als der Ausschnitt.
  const ab = quelle.indexOf('export function fehlerText');
  const koerper = quelle.slice(ab, quelle.indexOf('\n}', ab));
  assert.ok(koerper.includes('FEHLER[code]'), 'fehlerText() sieht anders aus — greift der Schnitt noch?');
  assert.match(koerper, /if \(!eintrag\)/,
    'fehlerText() prueft nicht, ob es den Eintrag ueberhaupt gibt — dann ' +
    'endet ein unbekannter Code als TypeError und damit als HTTP 500.');
});

test('nach dem Waehrungswechsel wird die Haushaltskarte neu gezeichnet', () => {
  // ── Marcos Befund ────────────────────────────────────────────────────────
  //
  // „Wenn ich die Waehrung aendere z. B. von CHF auf Euro, steht beim
  // Einladungscode noch immer CHF (Dieses Konto ist mit keinem anderen
  // verknuepft. Waehrung: CHF)."
  //
  // Die Karte nennt die Waehrung im Klartext — locales/de.js:
  // 'household.state_none': '… Waehrung: {cur}'. Gezeichnet wird sie von
  // loadHousehold(), und die lief nach dem Speichern nicht noch einmal. Der
  // Wert war also nicht falsch, sondern alt; sichtbar wurde es erst beim
  // naechsten Seitenaufruf.
  //
  // Geprueft wird die NACHBARSCHAFT und keine Aufrufreihenfolge: Wer die
  // Waehrung setzt, muss auch die Karte nachziehen. Dieselbe Regel gilt zwei
  // Zeilen weiter schon fuer den Standard-Zustand.
  const quelle = lies('public/js/05-settings.js');
  const ab = quelle.indexOf('set_CURRENCY(');
  assert.ok(ab > 0, 'set_CURRENCY() wird nicht mehr aufgerufen — greift die Suche noch?');
  // Der Block bis zum Ende der speichernden Funktion.
  const block = quelle.slice(ab, quelle.indexOf('\n}', ab));
  assert.match(block, /loadHousehold\(/,
    'Nach dem Setzen der Waehrung wird die Haushaltskarte nicht neu geladen. ' +
    'Sie nennt die Waehrung im Text und zeigt sonst bis zum naechsten ' +
    'Seitenaufruf den alten Wert.');

  // Selbstbeweis: Nennt der Text die Waehrung ueberhaupt noch? Sonst waere die
  // Zusicherung oben eine Regel ohne Gegenstand.
  assert.match(lies('public/locales/de.js'), /'household\.state_none':[^\n]*\{cur\}/,
    'Der Haushaltstext nennt die Waehrung nicht mehr — dann ist diese Regel ' +
    'gegenstandslos und gehoert geloescht.');
});
