/**
 * Jede Adresse, die die Webapp aufruft, muss es auf dem Server geben.
 *
 * ── Warum es diese Prüfung gibt ─────────────────────────────────────────────
 * Für die Android-App steht das seit test/app-endpunkte.test.js fest — dort
 * fiel damit eine Methode auf, die auf eine längst gelöschte Route zeigte.
 * Für die Webapp gab es die Gegenprobe nicht, obwohl das Risiko dort GRÖSSER
 * ist: Ein falscher Pfad im Browser scheitert erst zur Laufzeit, und etliche
 * Aufrufe enden auf `.catch(() => null)` — dann fehlt einfach ein Diagramm,
 * ohne dass irgendwo etwas rot wird.
 *
 * ── Was das Parsen schwierig macht (und schon dreimal danebenlag) ───────────
 * 1. Der Pfad ist oft ein Template-Literal mit VERSCHACHTELTEN Ausdrücken:
 *    `/v1/parts/${nr}/${farbe}${owner ? `?owner=${owner}` : ''}`
 *    Wer zuerst am `?` abschneidet, zerschneidet den Ausdruck und behält ein
 *    `${owner ` übrig. Erst die `${…}` auflösen (innerste zuerst, bis nichts
 *    mehr passt), DANN am `?` kappen.
 * 2. `fetch()` ist nicht immer GET — die Methode steht im zweiten Argument.
 * 3. Drei Routen stehen direkt in server.ts, nicht in einem Router.
 * Alle drei Punkte haben beim Nachmessen falsche Treffer erzeugt; sie stehen
 * hier, damit die nächste Fassung nicht wieder daran scheitert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare, routerEinhaengungen } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** `/api/sets/:setNumber` → `/api/sets/:X` — verglichen wird die FORM. */
function form(p) {
  return ('/' + String(p).replace(/^\/+|\/+$/g, '')).replace(/\/:[A-Za-z_]\w*/g, '/:X');
}

/**
 * Template-Ausdrücke auflösen, dann den Abfrageteil abschneiden.
 *
 * Ein `${…}` ist nur dann ein PFADABSCHNITT, wenn direkt ein `/` davorsteht:
 *
 *     `/v1/parts/${nr}/${farbe}`            → /v1/parts/:X/:X
 *     `/v1/minifigs/${nr}${owner ? …: ''}`  → /v1/minifigs/:X
 *
 * Im zweiten Fall hängt der Ausdruck am Segment und liefert einen
 * Abfrageteil oder gar nichts. Ohne diese Unterscheidung entstand
 * `/v1/minifigs/:X:X` — ein Pfad, den es nirgends gibt, und vier falsche
 * Treffer beim Nachmessen.
 */
function pfadForm(roh) {
  let s = String(roh);
  let vor = null;
  while (vor !== s) { vor = s; s = s.replace(/\$\{[^{}]*\}/g, '\u0000'); }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\u0000') { out += s[i]; continue; }
    if (out.endsWith('/')) { out += ':X'; continue; }
    break;                       // Anhängsel, kein Abschnitt → hier endet der Pfad
  }
  return form(out.split('?')[0].replace(/'\s*\+.*$/, ''));
}

function serverRouten() {
  const alle = new Set();
  const sammle = (datei, mount) => {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g))
      alle.add(`${m[1].toUpperCase()} ${form(mount + '/' + m[2].replace(/^\//, ''))}`);
  };
  // Einhaengepunkte aus server.ts GELESEN statt abgeschrieben. Die Liste stand
  // hier als Literal und wurde beim Zusammenlegen der API-Oberflaechen still
  // falsch — samt „ENOENT: routes/finance.ts". Siehe routerEinhaengungen().
  for (const r of routerEinhaengungen()) sammle(r.datei, r.mount);
  const v1 = path.join(ROOT, 'routes', 'api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    sammle(path.join(v1, f), '/api/v1');
  }
  // registerAcquisitionRoutes() baut diese zur Laufzeit zusammen.
  for (const basis of ['/sets/:X/acquisitions', '/parts/:X/:X/acquisitions', '/minifigs/:X/acquisitions'])
    for (const verb of ['GET', 'POST', 'PUT', 'DELETE']) alle.add(`${verb} /api/v1${basis}/:X`);
  // Und die drei, die direkt in server.ts hängen.
  const srv = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  for (const m of srv.matchAll(/app\.(get|post|put|delete)\(\s*'(\/api\/[^']+)'/g))
    alle.add(`${m[1].toUpperCase()} ${form(m[2])}`);
  return alle;
}

/**
 * Ein Zeichenketten-Literal ab Position `i` lesen — mit VERSCHACHTELTEN
 * Template-Ausdrücken.
 *
 * Ein einzelner regulärer Ausdruck kann das nicht: Der Pfad
 * `/v1/parts/${nr}${owner ? `?owner=${owner}` : ''}` enthält BACKTICKS in
 * seinem eigenen Inneren. Jedes `[^`]+` bricht dort ab und liefert einen
 * halben Ausdruck — beim Nachmessen kamen so fünf falsche Treffer heraus.
 */
function leseLiteral(src, i) {
  const anf = src[i];
  if (anf !== '`' && anf !== "'" && anf !== '"') return null;
  let j = i + 1, tiefe = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (anf === '`' && c === '$' && src[j + 1] === '{') { tiefe++; j += 2; continue; }
    if (tiefe > 0) {
      if (c === '{') tiefe++;
      else if (c === '}') tiefe--;
      // Innerhalb eines ${…} darf ein weiteres Literal stehen; es wird
      // mitgelesen, damit sein Inhalt die Zählung nicht durcheinanderbringt.
      else if (c === '`' || c === "'" || c === '"') {
        const inner = leseLiteral(src, j);
        if (inner) { j = inner.ende; continue; }
      }
      j++; continue;
    }
    if (c === anf) return { text: src.slice(i + 1, j), ende: j + 1 };
    j++;
  }
  return null;
}

/** Alle Aufrufe der Webapp: api('VERB', pfad) und fetch(pfad, { method }). */
function webAufrufe() {
  const out = [];
  for (const datei of fs.readdirSync(JS)) {
    if (!datei.endsWith('.js') || datei === 'app.bundle.js') continue;
    const src = ohneKommentare(fs.readFileSync(path.join(JS, datei), 'utf8'));
    const zeileVon = (i) => src.slice(0, i).split('\n').length;

    for (const m of src.matchAll(/api\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit || !lit.text.startsWith('/')) continue;
      out.push({ datei, zeile: zeileVon(m.index), verb: m[1], pfad: pfadForm('/api' + lit.text) });
    }
    for (const m of src.matchAll(/fetch\(\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit || !lit.text.startsWith('/api/')) continue;
      // Die Methode steht im zweiten Argument; ohne Angabe ist es GET.
      const rest = src.slice(lit.ende, lit.ende + 300);
      const verb = (rest.match(/method\s*:\s*['"`](\w+)['"`]/) || [, 'GET'])[1].toUpperCase();
      out.push({ datei, zeile: zeileVon(m.index), verb, pfad: pfadForm(lit.text) });
    }
  }
  return out;
}

test('jede Adresse der Webapp existiert auf dem Server', () => {
  const server = serverRouten();
  const aufrufe = webAufrufe();

  // Selbstbeweis in beide Richtungen: Findet eines der Muster nichts, wäre die
  // Fehlerliste leer und der Test grün, ohne etwas geprüft zu haben.
  assert.ok(server.size >= 120, `Nur ${server.size} Server-Routen gefunden — Muster veraltet?`);
  assert.ok(aufrufe.length >= 100, `Nur ${aufrufe.length} Webapp-Aufrufe gefunden — Muster veraltet?`);

  const fehlend = [...new Set(aufrufe
    .filter(a => !server.has(`${a.verb} ${a.pfad}`))
    .map(a => `${a.datei}:${a.zeile}  ${a.verb} ${a.pfad}`))].sort();

  assert.deepEqual(fehlend, [],
    'Diese Adressen ruft die Webapp auf, der Server hat sie nicht:\n  ' + fehlend.join('\n  ') +
    '\nIm Browser scheitert das erst zur Laufzeit — und wo der Aufruf auf ' +
    '.catch(() => null) endet, fehlt danach still ein Teil der Anzeige.');
});

/**
 * ── Und die Gegenrichtung: Was kann nur die Webapp? ─────────────────────────
 *
 * Die Prüfung oben und app-endpunkte.test.js fragen beide „gibt es die Route?".
 * Die Frage, die dieses Projekt seit Nachtrag 129 begleitet, ist eine andere:
 * WELCHE Adresse ruft nur die eine Oberfläche auf — und ist das Absicht?
 *
 * Sie wurde bisher von Hand beantwortet, bei jeder Messung neu. Genau das ist
 * die Form, die sich als brüchig erwiesen hat: eine Liste im Kopf, die
 * niemand nachprüft (siehe die vier toten Ausnahmeeinträge in Nachtrag 158).
 * Deshalb steht sie jetzt hier, mit Begründung je Eintrag — und der Test
 * besteht darauf, dass jede Begründung noch einen Gegenstand hat.
 *
 * NACHGEMESSEN sind es genau diese sieben. Jede ist geprüft worden, nicht
 * vermutet:
 */
const NUR_WEB = new Map([
  ['/api/v1/admin/job-status',
   'Stand des Preis-Jobs samt BrickLink-Kontingent. Die App zeigt BEIDES ' +
   'schon: den Fortschritt über /admin/jobs (jobMonitor, mit progress/total) ' +
   'und das Kontingent über /admin/cache-stats (rate_limits, ' +
   'MonitoringSections.kt). Ein zweiter Abruf für dieselben zwei Zahlen wäre ' +
   'die Doppelung, gegen die dieser Baum sonst prüft.'],
  ['/api/v1/auth/qr-token',
   'Erzeugt den Nonce für die QR-Anmeldung — das ist die Seite, die den Code ' +
   'ZEIGT. Die App ist die andere Seite und liest ihn (/auth/qr-login). Ein ' +
   'Telefon, das sich selbst einen Code zum Abscannen anzeigt, hat niemand.'],
  ['/api/v1/auth/reset-password',
   'Setzt das Passwort mit dem Token aus der E-Mail. Der Link darin zeigt auf ' +
   'die WEBSEITE (routes/mailer.ts: `${baseUrl}/reset-password?token=`), also ' +
   'landet auch ein App-Nutzer dort. Was die App braucht, hat sie: ' +
   '/auth/forgot-password löst die Mail aus.'],
  ['/api/v1/auth/users',
   'Nutzerverwaltung. ABSICHTLICH nicht in der App — die Begründung steht in ' +
   'BrickApiService.kt: sie gehört an den Rechner, nicht auf ein Telefon.'],
  ['/api/v1/auth/users/:X',        'Nutzer löschen — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/admin',  'Verwalterrecht umschalten — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/password', 'Fremdes Passwort zurücksetzen — siehe /auth/users.'],
  ['/api/v1/settings/import',
   'Spielt eine gesicherte Verwaltungs-Konfiguration aus einer JSON-Datei ' +
   'zurück. Dasselbe Urteil wie bei der Nutzerverwaltung: eine Aufgabe für ' +
   'den Rechner, an dem die Sicherung liegt.'],
  ['/api/v1/settings/raw',
   'Alle Einstellungen für die Einstellungsseite, mit Verwalter-Sicht und ' +
   'maskierten Geheimnissen. Die App holt über /v1/settings bewusst eine ' +
   'ENGERE Auswahl (sechs Felder, isAdmin=false) — nicht dieselbe Antwort ' +
   'unter anderem Namen, sondern eine andere Frage.'],
  ['/api/v1/settings/smtp-test',
   'Verschickt eine Probe-Mail zum Prüfen der SMTP-Angaben. Die App richtet ' +
   'kein SMTP ein; ohne die Formularfelder daneben hätte der Knopf nichts zu ' +
   'prüfen.'],
]);

test('nur die Webapp kann diese sieben Dinge — und zwar mit Grund', () => {
  const SERVICE = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main',
    'java', 'ch', 'brickinventoryapp', 'data', 'api', 'BrickApiService.kt');
  assert.ok(fs.existsSync(SERVICE), `BrickApiService.kt nicht gefunden unter ${SERVICE}`);

  const appPfade = new Set([...ohneKommentare(fs.readFileSync(SERVICE, 'utf8'))
    .matchAll(/@(?:GET|POST|PUT|DELETE|PATCH)\(\s*"([^"]+)"\s*\)/g)]
    // Retrofit schreibt `{setNumber}`, Express `:setNumber` — beides wird zu
    // `:X`. form() oben kennt nur die Express-Form; ohne diesen Schritt galten
    // sechs Adressen als „nur Webapp", die die App sehr wohl aufruft.
    .map(m => form('/' + m[1].replace(/^\/+/, '').replace(/\{[^}]+\}/g, ':X'))));
  // GEMESSEN sind es 94 Adressen.
  assert.ok(appPfade.size >= 60, `Nur ${appPfade.size} App-Adressen — Muster veraltet?`);

  const webPfade = new Set(webAufrufe().map(a => a.pfad));
  // GEMESSEN sind es 68.
  assert.ok(webPfade.size >= 50, `Nur ${webPfade.size} Webapp-Adressen — Muster veraltet?`);

  const nurWeb = [...webPfade].filter(p => !appPfade.has(p)).sort();

  const unbegruendet = nurWeb.filter(p => !NUR_WEB.has(p));
  assert.deepEqual(unbegruendet, [],
    'Diese Adressen ruft nur die Webapp auf, und es steht kein Grund dabei:\n  ' +
    unbegruendet.join('\n  ') +
    '\nEntweder die App zieht nach — dann sind die beiden Oberflächen wieder ' +
    'gleich viel wert —, oder es gibt einen Grund; der gehört dann in NUR_WEB, ' +
    'damit ihn der Nächste nicht neu herleiten muss.');

  // Dieselbe Regel wie bei jeder Ausnahmeliste in diesem Baum: Ein Eintrag,
  // der nichts mehr beschreibt, sieht aus wie eine Entscheidung und ist doch
  // bloss eine Vermutung. Zieht die App eine dieser Adressen nach, muss der
  // Eintrag WEG — sonst deckt er still die nächste Lücke mit ab.
  const veraltet = [...NUR_WEB.keys()].filter(p => !nurWeb.includes(p)).sort();
  assert.deepEqual(veraltet, [],
    'Diese Einträge in NUR_WEB beschreiben nichts mehr:\n  ' + veraltet.join('\n  ') +
    '\nEntweder ruft die App die Adresse inzwischen auch auf (dann Eintrag ' +
    'streichen), oder die Webapp ruft sie nicht mehr auf (dann ebenfalls).');
});
