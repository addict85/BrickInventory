/**
 * Jede Mail geht in der Sprache ihres EMPFÄNGERS hinaus — und sieht aus wie
 * die anderen.
 *
 * ── Marcos Fragen vom 25.09. ────────────────────────────────────────────────
 *
 *   „Kannst du die Mail noch etwas schöner gestalten analog der E-Mail
 *    Bestätigen Mail?"
 *   „Werden alle E-Mails in der eingestellten Sprache des Benutzers
 *    versendet?"
 *
 * Auf die zweite Frage war die Antwort NEIN, an drei Stellen:
 *
 *   1. sendPasswordResetMail() kannte gar keine Sprache — sie ging immer
 *      deutsch hinaus.
 *   2. Der E-Mail-Wechsel rief sendVerificationMail() OHNE `lang` und fiel
 *      damit auf die Vorgabe zurück, während derselbe Versand bei der
 *      Registrierung sie längst mitgab.
 *   3. Die Alarmmail konnte beide Sprachen, war aber die einzige ohne Hülle.
 *
 * ── Warum eine Regel und nicht nur der Fix ──────────────────────────────────
 *
 * Alle drei sind derselbe Fehler in drei Ausprägungen: Eine Mail entsteht,
 * und niemand fragt, wer sie liest. Das fällt nicht auf — in einem Baum, der
 * auf Deutsch geschrieben ist, sieht eine deutsche Mail immer richtig aus.
 * Gemeldet hat es der einzige, der Englisch eingestellt haben könnte.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) `lang` aus sendPasswordResetMail() entfernt        → Schritt 1 rot.
 *   b) Den englischen Zweig daraus entfernt               → Schritt 2 rot.
 *   c) Das Argument am Aufruf des E-Mail-Wechsels weg     → Schritt 3 rot.
 *   d) emailTemplate aus der Alarmmail entfernt           → Schritt 4 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const MAILER = lies('utils/mailer.ts');

/** Der Rumpf einer Funktion — ab ihrem Kopf bis zur nächsten auf Spaltenanfang. */
function rumpf(quelle, kopf) {
  const i = quelle.indexOf(kopf);
  assert.ok(i >= 0, `${kopf} nicht gefunden — umbenannt?`);
  const rest = quelle.slice(i + kopf.length);
  const m = rest.search(/\n(?:export )?(?:async )?function |\nexport \{/);
  return m >= 0 ? rest.slice(0, m) : rest;
}

/** Die Argumentliste eines Aufrufs — über Klammern gezählt, nicht per Regex. */
function argumente(quelle, aufruf) {
  const i = quelle.indexOf(aufruf);
  if (i < 0) return null;
  let tiefe = 0, args = [], akt = '';
  for (let k = i + aufruf.length - 1; k < quelle.length; k++) {
    const c = quelle[k];
    if (c === '(' || c === '[' || c === '{') { tiefe++; if (tiefe === 1) continue; }
    if (c === ')' || c === ']' || c === '}') { tiefe--; if (tiefe === 0) { args.push(akt); break; } }
    if (tiefe === 1 && c === ',') { args.push(akt); akt = ''; continue; }
    if (tiefe >= 1) akt += c;
  }
  return args.map(a => a.trim()).filter(a => a !== '');
}

test('1. jede Mail-Funktion nimmt die Sprache entgegen', () => {
  // Gefunden wird über den NAMEN, nicht über eine Liste: Eine vierte Mail
  // soll von dieser Regel erfasst werden, ohne dass jemand sie hier einträgt.
  const namen = [...MAILER.matchAll(/async function (send\w*Mail|baue\w*Mail)\s*\(/g)]
    .map(m => m[1])
    .filter(n => n !== 'sendMail');          // der Versand selbst formuliert nichts
  assert.ok(namen.length >= 3,
    `Nur ${namen.length} Mail-Funktionen gefunden (gemessen waren es 3) — umbenannt?`);

  for (const n of namen) {
    const kopf = MAILER.slice(MAILER.indexOf(`async function ${n}(`));
    const liste = kopf.slice(0, kopf.indexOf(')') + 1);
    // Zwei zulässige Formen, und beide kommen vor: `lang = 'de'` direkt in der
    // Liste (die beiden send*-Funktionen) oder ein benannter Typ, der das Feld
    // trägt (baueAlarmMail nimmt ein Datenobjekt, weil es neun Werte sind).
    // Nur auf die Zeichenkette „lang" in der Liste zu prüfen, hätte die zweite
    // Form fälschlich gemeldet — was sie beim ersten Lauf auch tat.
    const typ = (liste.match(/:\s*(\w+)\s*\)/) || [])[1];
    const traegtLang = /lang/.test(liste) ||
      (typ && /lang\s*:/.test(MAILER.slice(MAILER.indexOf(`interface ${typ} {`))
                                    .slice(0, MAILER.slice(MAILER.indexOf(`interface ${typ} {`)).indexOf('}'))));
    assert.ok(traegtLang,
      `${n}() kennt die Sprache des Empfängers nicht — sie ginge immer in der Vorgabe hinaus.`);
  }
});

test('2. und beherrscht beide Sprachen wirklich', () => {
  // Ein `lang`-Parameter, der nirgends gelesen wird, ist schlimmer als keiner:
  // Er sieht nach Mehrsprachigkeit aus.
  for (const [n, kopf] of [
    ['sendVerificationMail',  'async function sendVerificationMail('],
    ['sendPasswordResetMail', 'async function sendPasswordResetMail('],
    ['baueAlarmMail',         'async function baueAlarmMail('],
  ]) {
    const body = rumpf(MAILER, kopf);
    assert.match(body, /lang (?:!==|===) 'en'/,
      `${n}() verzweigt nicht nach der Sprache.`);
    // Ein englischer Satz, der nicht bloss ein Schlüsselwort ist.
    assert.ok(/Hello |Hi |Reset |Confirm |Price alert/.test(body),
      `${n}() hat keinen englischen Text — der Parameter wäre Dekoration.`);
  }
});

test('3. und jeder Aufrufer gibt sie mit', () => {
  // Der eigentliche Befund vom 25.09.: Die Funktion KONNTE es, der Aufrufer
  // gab es nur nicht mit. Deshalb werden hier die Aufrufe gezählt, nicht die
  // Signaturen.
  const auth = lies('routes/auth.ts');
  const stellen = [...auth.matchAll(/(sendVerificationMail|sendPasswordResetMail)\s*\(/g)]
    .map(m => m[1]);
  assert.ok(stellen.length >= 3,
    `Nur ${stellen.length} Aufrufe gefunden (gemessen waren es 3, davon einer der Import) — umbenannt?`);

  let geprueft = 0;
  for (const name of new Set(stellen)) {
    let rest = auth;
    for (;;) {
      const i = rest.indexOf(`${name}(`);
      if (i < 0) break;
      const args = argumente(rest, `${name}(`);
      rest = rest.slice(i + name.length + 1);
      if (!args || args.length < 2) continue;      // der Import, kein Aufruf
      geprueft++;
      assert.ok(args.length >= 5,
        `${name}() wird mit ${args.length} Argumenten gerufen — die Sprache fehlt:\n  ${args.join(' | ')}`);
    }
  }
  assert.ok(geprueft >= 2, `Nur ${geprueft} echte Aufrufe geprüft — das Muster greift nicht mehr.`);
});

test('4. die Alarmmail trägt dieselbe Hülle wie die anderen', () => {
  // Marcos erste Frage. Sie war reiner Text, als einzige.
  const body = rumpf(MAILER, 'async function baueAlarmMail(');
  assert.match(body, /emailTemplate\(/, 'Die Alarmmail läuft nicht durch die gemeinsame Vorlage.');
  assert.match(body, /getMailTheme\(\)/, 'Die Alarmmail nimmt das eingestellte Design nicht auf.');
  // Der Klartext bleibt trotzdem: Er geht als text/plain mit hinaus.
  assert.match(body, /text,/, 'Die Alarmmail hat keinen Klartext mehr.');

  // Und die Regel dahinter: Die GESTALTUNG steht im Mailer, nicht in der
  // Alarmlogik. Dort steht das WANN.
  const alarm = lies('utils/preisalarm.ts');
  assert.ok(!/<table|<p style/.test(alarm),
    'In utils/preisalarm.ts steht wieder HTML — die Gestaltung gehört in utils/mailer.ts.');
  assert.match(alarm, /baueAlarmMail\(/, 'preisalarm.ts benutzt die Vorlage nicht.');
});
