/**
 * Die drei Striche stecken IM Benutzernamen — und bleiben dort.
 * Ausführlich: docs/begruendungen/test/benutzername-menueknopf.test.js.md#kopf
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 * A  Name und Striche zu EINEM Element verschmolzen, das `ubadge` heisst:
 *      <button class="ubadge" id="ubadge" data-click="benutzerMenue">— ☰</button>
 *    → „die Striche stecken im Knopf"        GRÜN  (die Glyphe ist ja drin)
 *      „die Striche überleben den Namen"     rot: „Die drei Striche sind nach
 *                                            dem Setzen des Namens verschwunden"
 *      „sagt einem Bildschirmleser …"        rot (keine eigene Glyphe, die man
 *                                            verstecken könnte)
 *
 * B  die Glyphe aus dem Knopf entfernt      → alle drei rot
 *
 * C  zurück zum alten, getrennten Aufbau (Plakette, daneben ein Knopf):
 *    → „die Striche stecken im Knopf"        rot: „Name und Striche sind
 *                                            wieder getrennt"
 *      „die Striche überleben den Namen"     rot
 *      „sagt einem Bildschirmleser …"        GRÜN — und das ist richtig so:
 *                                            der alte Knopf war barrierefrei,
 *                                            er war nur nicht der Namenszug.
 *
 * A ist der Fall, auf den es ankommt: Dort bleibt Fall 1 grün und nur Fall 2
 * fällt. Die beiden messen also wirklich Verschiedenes — „die Striche sind im
 * Knopf" und „sie bleiben dort, wenn sich jemand anmeldet".
 *
 * Und eine Gegenprobe, die NICHTS gemessen hat, als Warnung: Beim ersten
 * Versuch suchte die Prüfung den Knopf über `getElementById('btn-umenu')` und
 * die Variante gab dem Knopf versehentlich zwei `id`-Attribute. Der Parser
 * nimmt das erste, `btn-umenu` war damit gar nicht da, und alle drei Fälle
 * fielen über `assert.ok(knopf)` — aus formalem Grund, nicht am Schaden. Drei
 * rote Fälle sahen nach einer scharfen Prüfung aus und waren eine kaputte
 * Vorlage. Daher die Suche über `data-click`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { oeffneOberflaeche, ANMELDUNG, sicht, warte } = require('./helpers/oberflaeche');

const ROOT = path.join(__dirname, '..');
/** Die Striche sind seit dem 27.10. ein Symbol der Symbolfamilie statt „☰“. */
const striche = (knopf) => knopf.querySelector('.ubadge-striche use[href="#i-menue"]');

function kopfleiste() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const auf = html.indexOf('<header');
  const zu = html.indexOf('</header>');
  assert.ok(auf > 0 && zu > auf, 'Kein <header> in index.html — greift die Suche noch?');
  return new JSDOM('<!doctype html><html><body>' + html.slice(auf, zu + 9) + '</body></html>');
}

/**
 * Den Menüknopf über seinen HANDLER finden, nicht über die ID.
 * Ausführlich: docs/begruendungen/test/benutzername-menueknopf.test.js.md#menueknopf
 */
function menueKnopf(document) {
  const knopf = document.querySelector('[data-click="benutzerMenue"]');
  assert.ok(knopf, 'Kein Element mit data-click="benutzerMenue" in der Kopfleiste');
  assert.equal(knopf.tagName, 'BUTTON');
  return knopf;
}

test('die Striche stecken im Knopf, nicht daneben', () => {
  const { document } = kopfleiste().window;
  const knopf = menueKnopf(document);

  assert.ok(striche(knopf),
    'Die drei Striche stehen nicht im Menüknopf — sind sie wieder ein eigenes Element daneben?');

  // Und der Name steht im SELBEN Knopf. Genau das ist „integrieren": nicht
  // zwei Elemente, die nebeneinander liegen, sondern eines.
  const name = document.getElementById('ubadge');
  assert.ok(name, 'Kein #ubadge in der Kopfleiste');
  assert.ok(knopf.contains(name),
    'Der Namenszug liegt nicht im Menüknopf — Name und Striche sind wieder getrennt');
});

test('die Striche überleben den Benutzernamen', () => {
  const { document } = kopfleiste().window;
  const knopf = menueKnopf(document);
  const name = document.getElementById('ubadge');
  assert.ok(name, 'Kein #ubadge — 01-konto.js schreibt den Namen genau dorthin');

  // Genau was 01-konto.js in showApp() tut.
  name.textContent = 'marco';

  assert.ok(striche(knopf),
    'Die drei Striche sind nach dem Setzen des Namens verschwunden — ' +
    'liegt `id="ubadge"` am Knopf statt am inneren Feld?');
  assert.ok(knopf.textContent.includes('marco'),
    'Der Benutzername steht nach dem Setzen nicht im Knopf');
});

test('der Knopf sagt einem Bildschirmleser, dass er ein Menü ist', () => {
  const { document } = kopfleiste().window;
  const knopf = menueKnopf(document);

  // Die ID bleibt gefordert: menueSchliessen() und benutzerMenue() in
  // js/02-gallery.js führen `aria-expanded` über G('btn-umenu') mit.
  assert.equal(knopf.id, 'btn-umenu',
    'Der Menüknopf heißt nicht mehr `btn-umenu` — 02-gallery.js führt `aria-expanded` darüber mit');

  assert.equal(knopf.getAttribute('aria-haspopup'), 'true');
  assert.equal(knopf.getAttribute('aria-expanded'), 'false',
    'Zu Beginn ist das Menü zu — `aria-expanded` muss das sagen');
  assert.equal(knopf.getAttribute('aria-controls'), 'umenu-pop');

  // KEIN aria-label: Das ersetzt den sichtbaren Namen, der Bildschirmleser
  // hätte den Benutzernamen dann gar nicht mehr genannt. Der Zusatz steht
  // stattdessen als vorgelesener Text im Knopf.
  assert.equal(knopf.getAttribute('aria-label'), null,
    'Ein `aria-label` am Knopf würde den Benutzernamen für Bildschirmleser verdecken');

  const zusatz = knopf.querySelector('.vh');
  assert.ok(zusatz && zusatz.textContent.trim().length >= 2,
    'Der vorgelesene Zusatz („Menü") fehlt — der Knopf hiesse dann nur „marco ☰"');

  // Die Striche selbst sind für einen Bildschirmleser nichts wert.
  const glyphe = knopf.querySelector('.ubadge-striche');
  assert.ok(glyphe, 'Kein .ubadge-striche im Knopf');
  assert.equal(glyphe.getAttribute('aria-hidden'), 'true',
    '„☰" vorgelesen ergibt nichts — die Glyphe gehört versteckt');
});

/**
 * Nachtrag vom 17.10.: der Verwalter-Hinweis steht IM Namen
 * Ausführlich: docs/begruendungen/test/benutzername-menueknopf.test.js.md#der-namenszug-traegt-den-verwalter-hinwe
 *
 * Gegenproben (durchgeführt): `ME.isAdmin` in der Bedingung durch `true`
 * ersetzt → „ohne Verwalterrecht steht nur der Name" rot. Den Zusatz ganz
 * entfernt → „mit Verwalterrecht steht (Admin) dahinter" rot.
 * Gegenproben (08.11.2026 gemessen, am Bündel): zeigeBenutzernamen() ohne
 * `ME.isAdmin &&` bzw. mit fest „Admin“ statt tRaw('users.admin_badge') →
 * rot (englisch stünde „Verwalter“); die Profilseite wieder mit eigenem `G('ubadge').textContent =
 * username` statt zeigeBenutzernamen() → rot (nach dem Speichern).
 */
test('der Namenszug trägt den Verwalter-Hinweis, die Kachel ist weg', () => {
  const { document } = kopfleiste().window;
  assert.equal(document.getElementById('abadge'), null,
    'Die Admin-Plakette steht wieder in der Kopfleiste — dann sagt sie dasselbe ' +
    'wie der Name daneben, und das Menü sitzt nicht mehr ganz rechts.');

  // Der Namensknopf ist das LETZTE Element der Reihe.
  const reihe = document.querySelector('.umenu');
  assert.ok(reihe, 'Keine .umenu in der Kopfleiste');
  const letztes = [...reihe.children].at(-1);
  assert.ok(letztes.contains(document.getElementById('btn-umenu')),
    'Nach dem Menüknopf steht noch etwas in der Reihe — dann ist er nicht ganz rechts.');
});

test('mit Verwalterrecht steht (Admin) dahinter, ohne nur der Name', async () => {
  // Am Bündel in jsdom: anmelden als Verwalter und als Nutzer, auf Englisch, und nach dem Speichern des Profils.
  const ich = (u) => ({ '/v1/auth/me': { ...ANMELDUNG['/v1/auth/me'], user: { ...ANMELDUNG['/v1/auth/me'].user, ...u } } });
  const name = async (antworten, opt) => {
    const o = await oeffneOberflaeche(antworten, opt);
    await warte(() => o.d.getElementById('ubadge').textContent.trim());
    return o;
  };
  for (const [u, opt, soll] of [[{}, {}, 'anna (Verwalter)'], [{ is_admin: false }, {}, 'anna'], [{}, { sprache: 'en' }, 'anna (Admin)']]) {
    const { w, d } = await name(ich(u), opt);
    try { assert.equal(d.getElementById('ubadge').textContent.trim(), soll, JSON.stringify([u, opt])); } finally { w.close(); }
  }
  // Die Profilseite setzt den Namen über dieselbe Regel — der Hinweis bleibt nach dem Speichern.
  const { w, d } = await name({ '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } } });
  try {
    await sicht(w, 'profil');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    d.getElementById('prof-user').value = 'anna2';
    d.getElementById('btn-sav-prof').click();
    await warte(() => d.getElementById('confirm-modal').style.display === 'flex');
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => d.getElementById('ubadge').textContent.trim() === 'anna2 (Verwalter)'),
      `nach dem Speichern: ${d.getElementById('ubadge').textContent}`);
  } finally { w.close(); }
});
