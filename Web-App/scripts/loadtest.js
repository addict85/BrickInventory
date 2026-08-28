#!/usr/bin/env node
/**
 * Lastprofil — wie verhält sich der Server unter GLEICHZEITIGEN Anfragen?
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 * Die Messwerte aus Durchgang 119 (Teile-Seite ~5 ms, portfolioHistory
 * ~70–86 ms, Neuaufbau Teile-Zusammenfassung ~240–330 ms) waren
 * EINZELabfragen auf einem sonst untätigen Server. Das ist die eine Hälfte der
 * Wahrheit. Die andere: Was passiert, wenn zwanzig Anfragen gleichzeitig
 * ankommen und der Verbindungspool sie sich teilen muss? Eine Abfrage, die
 * allein 80 ms braucht, kann zu zwanzigst 1,6 s brauchen oder 90 ms — je
 * nachdem, ob sie an der Datenbank hängt oder am Event-Loop des Workers.
 *
 * Dieses Skript beantwortet genau diese Frage. Es ist KEIN Test und läuft
 * nicht in `npm test` mit: Lastmessungen schwanken je nach Maschine, ein
 * Schwellwert darin wäre entweder nutzlos hoch oder ständig grundlos rot.
 *
 * ── Ausführen ───────────────────────────────────────────────────────────────
 *   npm run build
 *   TEST_DATABASE_URL=postgres://tester@localhost:5433/cattest \
 *     node scripts/loadtest.js [--users 20] [--dauer 10] [--sets 800]
 *
 * ⚠️  Das Schema der angegebenen Datenbank wird GELEERT. Niemals gegen die
 *    Produktionsdatenbank laufen lassen — der Schutz unten prüft das grob,
 *    aber die Verantwortung bleibt beim Aufrufer.
 *
 * ── Wie man die Ausgabe liest ───────────────────────────────────────────────
 * p50 ist der Normalfall, p95 das, was jeder zwanzigste Nutzer erlebt — und
 * das ist die Zahl, die über den gefühlten Eindruck entscheidet. Die Spalte
 * „allein" misst denselben Endpunkt ohne Nebenlast: Der ABSTAND zwischen
 * „allein" und p50 ist der eigentliche Befund. Bleibt er klein, skaliert der
 * Endpunkt; wächst er stark, ist er ein Engpass.
 */

const path = require('node:path');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('Bitte TEST_DATABASE_URL setzen (das Schema darin wird GELEERT).');
  process.exit(1);
}
if (/prod|live/i.test(DB_URL)) {
  console.error(`Die Verbindung sieht nach Produktion aus — abgebrochen: ${DB_URL}`);
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;
process.env.WEB_WORKERS = '1';

// ── Argumente ────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const USERS    = arg('users', 20);   // gleichzeitige virtuelle Nutzer
const DAUER_S  = arg('dauer', 10);   // Messdauer je Durchgang
const N_SETS   = arg('sets', 800);   // Sammlungsgrösse (wie in Durchgang 119)

const db = require(path.join(ROOT, 'dist/db/database.js'));

const USER = { id: null, username: 'loadtest-user' };

// ── Seed: eine Sammlung in realistischer Grössenordnung ──────────────────────
async function seed() {
  console.log(`Seed: ${N_SETS} Sets, Teile und Preisverlauf …`);
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  await db.run(`INSERT INTO users (username, password_hash) VALUES ($1, 'x')`, [USER.username]);
  USER.id = (await db.get(`SELECT id FROM users WHERE username = $1`, [USER.username])).id;

  await db.run(
    `INSERT INTO sets (user_id, set_number, name, year, theme, pieces, minifigs, quantity, purchase_price, condition)
     SELECT $1, (10000+g)||'-1', 'Set '||g, 1990 + (g % 35), 'Theme '||(g%12),
            100 + (g*7)%8000, g%9, 1 + (g%3), 20 + (g%400), CASE WHEN g%3=0 THEN 'U' ELSE 'N' END
       FROM generate_series(1, $2) g`, [USER.id, N_SETS]);

  // Erfassungen: im Schnitt gut eine je Set, verteilt über zwei Jahre.
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition, quantity, created_at)
     SELECT $1, (10000+g)||'-1', 20 + (g%400), CASE WHEN g%3=0 THEN 'U' ELSE 'N' END, 1,
            NOW() - ((g % 700) || ' days')::interval
       FROM generate_series(1, $2) g`, [USER.id, N_SETS]);

  // Teile: ~75 je Set — das ergibt bei 800 Sets die Grössenordnung 60'000
  // aus den Messungen von Durchgang 119.
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, part_name, color_id, color_name, quantity)
     SELECT $1, (10000+g)||'-1', (3000 + (g*13 + p) % 900)::text, 'Part '||((g*13+p)%900),
            (p % 60), 'Color '||(p % 60), 1 + (p % 4)
       FROM generate_series(1, $2) g, generate_series(1, 75) p`, [USER.id, N_SETS]);

  await db.run(
    `INSERT INTO minifigs (user_id, set_number, fig_number, fig_name, quantity)
     SELECT $1, (10000+g)||'-1', 'fig'||((g*3+m)%2500), 'Minifig '||((g*3+m)%2500), 1
       FROM generate_series(1, $2) g, generate_series(1, 4) m`, [USER.id, N_SETS]);

  // Marktpreise je Zustand — ohne sie rechnen die Finanz-Endpunkte im Leeren.
  //
  // WICHTIG: Die Währung muss zur Nutzereinstellung passen. Der Cache ist über
  // set_number + condition + currency_code verschlüsselt; steht dort CHF und
  // der Nutzer rechnet in EUR, ist JEDER Zugriff ein Fehlschlag und die
  // Bewertung versucht für jedes Set einen Live-Abruf bei BrickLink. Genau das
  // ist beim ersten Lauf dieses Skripts passiert (Bewertung: 21 s statt 60 ms)
  // — gemessen wurde damit der Ausnahmefall, nicht der Alltag. EUR ist der
  // Vorgabewert in utils/financeCalc.ts.
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity)
     SELECT (10000+g)||'-1', c, 'EUR', 10+(g%300), 30+(g%500), 60+(g%800), 31+(g%500), 5
       FROM generate_series(1, $1) g, (VALUES ('N'),('U')) AS t(c)`, [N_SETS]);

  // Preisverlauf: 180 Tage, aber mit Lücken (nicht jedes Set schreibt täglich).
  await db.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
     SELECT (10000+g)||'-1', 'N', 'EUR', 30 + (g%500) + d*0.05, 31 + (g%500),
            (CURRENT_DATE - (180 - d))::timestamptz + interval '9 hours'
       FROM generate_series(1, $1) g, generate_series(1, 180) d
      WHERE (d + g) % 4 = 0`, [N_SETS]);

  const z = async (t) => (await db.get(`SELECT count(*)::int n FROM ${t}`)).n;
  console.log(`  → sets ${await z('sets')}, parts ${await z('parts')}, ` +
              `minifigs ${await z('minifigs')}, price_history ${await z('price_history')}\n`);
}

// ── Der echte Stack, wie im Paritätstest ─────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: USER.id, username: USER.username, isAdmin: false };
    next();
  });
  app.use('/api/sets',     require(path.join(ROOT, 'dist/routes/sets.js')));
  app.use('/api/parts',    require(path.join(ROOT, 'dist/routes/parts.js')));
  app.use('/api/finance',  require(path.join(ROOT, 'dist/routes/finance.js')));
  app.use('/api/settings', require(path.join(ROOT, 'dist/routes/settings.js')));
  app.use('/api/minifigs', require(path.join(ROOT, 'dist/routes/minifigs.js')));
  return app;
}

// Die Endpunkte, die eine Sitzung tatsächlich anfasst: Galerie öffnen, Teile
// durchblättern, Finanzen ansehen.
const PFADE = [
  ['Galerie (Seite 1)',      '/api/sets/?page=1&page_size=60'],
  ['Galerie (Seite 5)',      '/api/sets/?page=5&page_size=60'],
  ['Teile-Liste',            '/api/parts/?page=1&page_size=60'],
  ['Teile-Suche',            '/api/parts/?search=Part%201&page=1&page_size=60'],
  ['Teile-Statistik',        '/api/parts/stats'],
  ['Minifiguren',            '/api/minifigs/?page=1&page_size=60'],
  ['Bewertung Sets',         '/api/finance/valuation'],
  ['GuV',                    '/api/finance/pnl'],
  ['Portfolio-Verlauf',      '/api/finance/portfolio-history?range=year'],
];

const perzentil = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

async function miss(base, pfad) {
  const t0 = process.hrtime.bigint();
  const r = await fetch(base + pfad);
  await r.arrayBuffer();               // Antwort vollständig lesen
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, ok: r.status === 200, status: r.status };
}

async function main() {
  await seed();
  const app = buildApp();
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Aufwärmen: erster Treffer baut Caches und Abfragepläne auf.
  for (const [, p] of PFADE) await miss(base, p).catch(() => {});

  // ── Durchgang 1: allein (Referenz) ─────────────────────────────────────────
  console.log('Referenz ohne Nebenlast (je 5 Aufrufe, Median):');
  const allein = {};
  for (const [name, p] of PFADE) {
    const w = [];
    for (let i = 0; i < 5; i++) w.push((await miss(base, p)).ms);
    allein[name] = perzentil(w, 0.5);
    console.log(`  ${name.padEnd(24)} ${allein[name].toFixed(0).padStart(6)} ms`);
  }

  // ── Durchgang 2: USERS gleichzeitig, DAUER_S lang ──────────────────────────
  console.log(`\n${USERS} gleichzeitige Nutzer, ${DAUER_S} s …`);
  const messung = Object.fromEntries(PFADE.map(([n]) => [n, []]));
  const fehler = {};
  const ende = Date.now() + DAUER_S * 1000;
  let gesamt = 0;

  const nutzer = async (id) => {
    // Versetzter Start, damit nicht alle im Gleichschritt laufen.
    await new Promise(r => setTimeout(r, (id * 37) % 250));
    while (Date.now() < ende) {
      const [name, p] = PFADE[Math.floor(Math.random() * PFADE.length)];
      try {
        const { ms, ok, status } = await miss(base, p);
        messung[name].push(ms);
        gesamt++;
        if (!ok) fehler[`${name} → HTTP ${status}`] = (fehler[`${name} → HTTP ${status}`] || 0) + 1;
      } catch (e) {
        fehler[`${name} → ${e.message}`] = (fehler[`${name} → ${e.message}`] || 0) + 1;
      }
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: USERS }, (_, i) => nutzer(i)));
  const sek = (Date.now() - t0) / 1000;

  // ── Ausgabe ────────────────────────────────────────────────────────────────
  console.log(`\n${gesamt} Anfragen in ${sek.toFixed(1)} s = ${(gesamt / sek).toFixed(0)}/s\n`);
  console.log('Endpunkt                   allein     p50     p95     max   Faktor   n');
  console.log('─'.repeat(76));
  for (const [name] of PFADE) {
    const w = messung[name];
    const p50 = perzentil(w, 0.5), p95 = perzentil(w, 0.95), max = Math.max(0, ...w);
    const faktor = allein[name] > 0 ? (p50 / allein[name]) : 0;
    console.log(
      `${name.padEnd(24)} ${allein[name].toFixed(0).padStart(6)}  ${p50.toFixed(0).padStart(6)}  ` +
      `${p95.toFixed(0).padStart(6)}  ${max.toFixed(0).padStart(6)}  ${faktor.toFixed(1).padStart(6)}x  ${String(w.length).padStart(4)}`
    );
  }
  const fehlerListe = Object.entries(fehler);
  if (fehlerListe.length) {
    console.log('\n⚠️  Fehler:');
    for (const [k, n] of fehlerListe) console.log(`  ${n}× ${k}`);
  } else {
    console.log('\n✅ Keine Fehler — alle Antworten HTTP 200.');
  }
  console.log('\nLesehilfe: „Faktor" ist p50 geteilt durch „allein". Nahe 1 = der');
  console.log('Endpunkt trägt die Last; deutlich darüber = er wird zum Engpass.');

  srv.close();
  await db.pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
