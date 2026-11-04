/**
 * Befunde der UI-Prüfung 10 im echten Browser: Zahlen, die sich nicht
 * widersprechen, Diagramme, die mit der Schrift wachsen, Meldungen, die sagen,
 * was los ist, und Bedienelemente, die nicht gegen das eigene Konto zielen.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in zeigeKennzahlen den Titel wieder fest „Kaufpreis gesamt“ und die
 *      Unterzeile „Summe der Kaufpreise“ → rot: „Kaufpreis-Karte nennt ihren Bezug“
 *   B  die Fusszeile der Teile wieder mit parts.stat.types → rot: „Fusszeile
 *      der Teile nennt Einträge“
 *   C  .diagramm-wert wieder mit max-height:180px, diagrammBreite teilt wieder
 *      durch die Schriftgrösse und schriftFaktor liefert 1 (der alte Stand) →
 *      rot: „Diagramm wächst mit der Schrift“
 *   D  in openModal wieder nur toast('Fehler') → rot: „unbekanntes Set“
 *   E  nutzerAktionen ohne die Ausnahme für das eigene Konto → rot:
 *      „keine Aktionen gegen das eigene Konto“
 *   F  im Set-Dialog die Klassen v-mehr nach-oben entfernt → rot: „Weitere
 *      Aktionen überlagern den Inhalt“ (die Liste steht in der Fusszeile)
 *   G  in zeigeDesignWahl das Sperren der Darstellung entfernt → rot:
 *      „Werkbank sperrt die Darstellung“
 *   H  die Wertlinie wieder fest var(--chart-new) → rot: „Wertlinie in der
 *      Akzentfarbe“
 *   I  in doLogin wieder ['lp','lu'] → rot: „leere Anmeldung: Fokus ins erste Feld“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

test('UI-Prüfung 10: Zahlen, Diagramme, Meldungen', { timeout: 280_000 }, async (t) => {
  const app = await starteApp(t, { name: `r11_${process.pid}`, bestand: musterSammlung });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis, db } = app;
  const geh = async (pfad) => { await b.auswerten(`location.hash = '#/${pfad}'; true`); await warte(300); };

  await t.test('Kaufpreis-Karte nennt ihren Bezug', async () => {
    await geh('finanzen');
    await bis(`!!document.querySelector('#fin-tbl .dt-summe tfoot')`, 'Finanzen geladen', 200);
    const z = await b.auswerten(`({ titel: document.getElementById('fin-einstand-titel').textContent.trim(),
      unter: document.getElementById('fin-einstand-sub').textContent,
      gesamt: document.querySelector('#fin-tbl .dt-summe tfoot td.fin-fuss-wert').textContent.trim(),
      basis: document.getElementById('fin-basis').hidden })`);
    assert.equal(z.basis, false, 'Testdaten: Positionen ohne Marktpreis');
    assert.equal(z.titel, 'Kaufpreis (nur bewertete Posten)', 'Kaufpreis-Karte nennt ihren Bezug, nicht „gesamt“');
    assert.ok(z.unter.includes(z.gesamt), `die Summe aller Kaufpreise steht darunter: ${z.unter} / ${z.gesamt}`);
  });

  await t.test('Wertlinie in der Akzentfarbe', async () => {
    await bis(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm', 200);
    const farbe = await b.auswerten(`(() => { const h = document.documentElement, alt = h.getAttribute('data-theme');
      h.setAttribute('data-theme', 'werkbank'); const f = getComputedStyle(document.querySelector('#portfolio-chart svg polyline')).stroke;
      if (alt === null) h.removeAttribute('data-theme'); else h.setAttribute('data-theme', alt); return f; })()`);
    assert.equal(farbe, 'rgb(201, 150, 63)', 'Wertlinie in der Akzentfarbe (Messing bei Werkbank)');
  });

  await t.test('Diagramm wächst mit der Schrift', async () => {
    // Der Massstab des Gezeichneten (getScreenCTM), nicht der Rahmen: Mit
    // max-height steht ein verkleinertes Bild mittig in einem breiten Rahmen.
    const mass = `(() => { const svg = document.querySelector('#portfolio-chart svg');
      const k = svg.getScreenCTM().a;
      return { breite: svg.viewBox.baseVal.width * k, behaelter: document.getElementById('portfolio-chart').clientWidth,
        schrift: Math.min(...[...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * k)) }; })()`;
    const vorher = await b.auswerten(mass);
    // Das alte Bild weg, damit gemessen wird, was bei 200 % neu gezeichnet ist.
    await b.auswerten(`document.documentElement.style.fontSize = '200%'; document.getElementById('portfolio-chart').innerHTML = ''; true`);
    await geh('sammlung'); await geh('finanzen');
    await bis(`!!document.querySelector('#portfolio-chart svg polyline')`, 'Wertdiagramm bei 200 %', 200);
    const nachher = await b.auswerten(mass);
    await b.auswerten(`document.documentElement.style.fontSize = ''; true`);
    assert.ok(nachher.breite >= nachher.behaelter * 0.95, `Diagramm wächst mit der Schrift: ${JSON.stringify(nachher)}`);
    assert.ok(nachher.schrift >= vorher.schrift * 1.8, `Diagramm wächst mit der Schrift: ${vorher.schrift} → ${nachher.schrift}`);
  });

  await t.test('Fusszeile der Teile nennt Einträge', async () => {
    await geh('teile');
    await bis(`/\\d/.test(document.getElementById('parts-sentinel')?.textContent || '')`, 'Teileliste', 200);
    const fuss = await b.auswerten(`document.getElementById('parts-sentinel').textContent`);
    assert.match(fuss, /Einträge aus Sets \(Teil × Farbe\)/);
    assert.doesNotMatch(fuss, /Teilesorten/);
  });

  await t.test('unbekanntes Set: Klartext statt „Fehler“', async () => {
    await geh('sammlung');
    await b.auswerten(`location.hash = '#/sammlung/set/99999-9'; true`);
    await bis(`[...document.querySelectorAll('#toasts .toast')].some(x => /nicht in deiner Sammlung/.test(x.textContent))`, 'unbekanntes Set', 100);
    assert.equal(await b.auswerten(`!!document.querySelector('#toasts .toast .toast-aktion')`), true, 'mit „Hinzufügen“');
  });

  await t.test('Weitere Aktionen überlagern den Inhalt', async () => {
    await geh('sammlung');
    await b.auswerten(`location.hash = '#/sammlung/set/10294-1'; true`);
    await bis(`document.getElementById('set-modal').classList.contains('open') && !!document.getElementById('m-det').querySelector('.dr')`, 'Set-Dialog', 100);
    const hoehe = `document.querySelector('#set-modal .mfooter').getBoundingClientRect().height`;
    const vorher = await b.auswerten(hoehe);
    await b.auswerten(`document.querySelector('#set-modal .mehr-menue > summary').click(); true`);
    await bis(`document.querySelector('#set-modal .mehr-menue').open`, 'Menü offen');
    const lage = await b.auswerten(`({ liste: document.querySelector('#set-modal .mehr-liste').getBoundingClientRect().bottom,
      fuss: document.querySelector('#set-modal .mehr-menue > summary').getBoundingClientRect().top })`);
    assert.ok(lage.liste <= lage.fuss + 1, `Weitere Aktionen überlagern den Inhalt (über ihrem Knopf): ${JSON.stringify(lage)}`);
    assert.ok(Math.abs(await b.auswerten(hoehe) - vorher) < 2, 'die Fusszeile wächst nicht');
    await b.auswerten(`document.querySelector('#set-modal [data-dialog-zu]').click(); true`);
  });

  await t.test('keine Aktionen gegen das eigene Konto', async () => {
    const ANDERE = `r11_andere_${process.pid}`;
    await db.run(`INSERT INTO users (username, email, password_hash, is_active, email_verified) VALUES ($1, $2, 'x', true, true)`, [ANDERE, `${ANDERE}@example.org`]);
    t.after(() => db.run('DELETE FROM users WHERE username = $1', [ANDERE]).catch(() => {}));
    await geh('einstellungen/benutzer');
    await bis(`[...document.querySelectorAll('#users-tbl tr')].some(r => r.textContent.includes(${JSON.stringify(ANDERE)}))`, 'Benutzerliste', 100);
    const z = await b.auswerten(`(() => { const zeile = n => [...document.querySelectorAll('#users-tbl tbody tr')].find(r => r.querySelector('strong')?.textContent === n);
      const eigene = zeile(${JSON.stringify(`r11_${process.pid}`)}), andere = zeile(${JSON.stringify(ANDERE)});
      return { eigene: eigene.querySelectorAll('button').length, andereDirekt: andere.querySelectorAll('.nutzer-aktionen > button').length,
        andereMehr: andere.querySelectorAll('.v-mehr .mehr-liste button').length }; })()`);
    assert.equal(z.eigene, 0, 'keine Aktionen gegen das eigene Konto');
    assert.deepEqual([z.andereDirekt, z.andereMehr], [2, 2], 'Passwort und Rolle direkt, Deaktivieren und Löschen hinter „Weitere“');
  });

  await t.test('Werkbank sperrt die Darstellung', async () => {
    await geh('konto');
    await bis(`document.getElementById('design-wahl')?.options.length > 1`, 'Design-Wahl');
    await b.auswerten(`(() => { const s = document.getElementById('design-wahl'); s.value = 'werkbank'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await bis(`document.getElementById('dunkel-wahl').disabled`, 'Werkbank sperrt die Darstellung', 50);
    assert.equal(await b.auswerten(`document.getElementById('dunkel-hinweis').hidden`), false);
    await b.auswerten(`(() => { const s = document.getElementById('design-wahl'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await bis(`!document.getElementById('dunkel-wahl').disabled`, 'andere Designs geben sie frei', 50);
  });

  await t.test('leere Anmeldung: Fokus ins erste Feld', async () => {
    await b.auswerten(`document.getElementById('btn-logout').click(); true`);
    await bis(`getComputedStyle(document.getElementById('login-screen')).display !== 'none'`, 'Anmeldemaske');
    await b.auswerten(`document.getElementById('btn-login').click(); true`);
    await bis(`(document.getElementById('lerr').textContent || '') !== ''`, 'Fehler der Anmeldung', 100);
    assert.equal(await b.auswerten(`document.activeElement?.id`), 'lu', 'leere Anmeldung: Fokus ins erste Feld');
  });
});
