const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const lies = rel => fs.readFileSync(path.join(WEB, rel), 'utf8');

/**
 * Eine Absage darf nicht heissen wie die Nutzlast.
 * Ausführlich: docs/begruendungen/test/absage-und-nutzlast.test.js.md#absagen-aus-src-haushalt-haushalt-ts-hei
 */

test('Absagen aus src/haushalt/haushalt.ts heissen fehler, nicht code', () => {
  const quelle = (lies('src/haushalt/haushalt.ts') + lies('src/haushalt/repository.ts'));
  // `code` ist in dieser Datei ein NUTZLAST-Name: der Einladungscode selbst.
  // Eine Absage darf ihn deshalb nicht belegen.
  const absagen = [...quelle.matchAll(/return \{ (\w+): '([a-z_]+)' as const/g)];
  // Selbstbeweis: GEMESSEN sind es sieben Absagen. Findet die Suche keine, waere
  // die Zusicherung darunter still gruen.
  //
  // Es waren acht, bis eine frühere Runde die drei Absagen „nur eine Stufe" durch
  // die eine Kreispruefung ersetzt hat; sieben seit der Grenze offener Einladungen,
  // zwölf seit pruefeEinladung (dieselben Absagen vor dem Passwort).
  assert.equal(absagen.length, 12,
    `${absagen.length} Absagen gefunden statt zwölf — greift die Suche noch?`);
  const falsch = absagen.filter(m => m[1] !== 'fehler').map(m => `${m[1]}: '${m[2]}'`);
  assert.deepEqual(falsch, [],
    'Diese Absagen benutzen einen anderen Schluessel als `fehler`. Heisst er ' +
    '`code`, kollidiert er mit dem Einladungscode im Erfolgsfall — und die ' +
    'Route haelt jeden Erfolg fuer einen Fehler.');
});

test('die Route entscheidet am Absage-Feld, nicht an der Nutzlast', () => {
  const route = lies('routes/api_v1/settings.ts');
  const haushalt = [...route.matchAll(/router\.post\('\/settings\/household\/(\w+)'[\s\S]{0,1500}?\n\}\);/g)];
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

test('jeder Fehlercode aus src/haushalt/haushalt.ts steht in der Texttabelle', () => {
  // ── Die zweite Haelfte desselben Unfalls ─────────────────────────────────
  //
  // Selbst mit getrennten Feldern kippt fehlerText() in ein 500, sobald ein
  // Code in FEHLER fehlt: Es liest `eintrag[sprache]` ohne zu pruefen, ob es
  // den Eintrag gibt. Ein Tippfehler im Code reicht.
  const codes = [...(lies('src/haushalt/haushalt.ts') + lies('src/haushalt/repository.ts'))
    .matchAll(/return \{ fehler: '([a-z_]+)' as const/g)].map(m => m[1]);
  assert.ok(codes.length >= 5, `Nur ${codes.length} Fehlercodes — greift die Suche noch?`);

  const tabelle = lies('src/infra/fehlerTexte.ts');
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
  const quelle = lies('src/infra/fehlerTexte.ts');
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
  // Marcos Befund
  // Ausführlich: docs/begruendungen/test/absage-und-nutzlast.test.js.md#quelle
  const quelle = require('./helpers/sources').ansichtQuelle('05');
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
