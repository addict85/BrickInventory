/**
 * Every address the web app calls must exist on the server.
 *
 * ── Why this check exists ──────────────────────────────────────────────────
 * For the Android app this has been settled since test/app-interface.test.js — there
 * it revealed a method pointing to a route deleted long ago.
 * For the web app the counter-check did not exist, although the risk there is
 * GREATER: a wrong path in the browser only fails at runtime, and quite a few
 * calls end in `.catch(() => null)` — then a chart is simply missing
 * without anything turning red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare, routerEinhaengungen, pathForm, leseLiteral } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** `/api/sets/:setNumber` → `/api/sets/:X` — the SHAPE is compared. */
function form(p) {
  return ('/' + String(p).replace(/^\/+|\/+$/g, '')).replace(/\/:[A-Za-z_]\w*/g, '/:X');
}

/**
 * Resolve template expressions, then cut off the query part.
 */
function pathFormV1(roh) {
  return form(pathForm(roh));
}

function serverRoutes() {
  const alle = new Set();
  const collect = (datei, mount) => {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of require('./helpers/sources').routesFromSource(src, mount))
      alle.add(`${m[1].toUpperCase()} ${form(mount + '/' + m[2].replace(/^\//, ''))}`);
  };
  // Mount points READ from server.ts instead of copied: a
  // copied list silently goes stale. See routerEinhaengungen().
  for (const r of routerEinhaengungen()) collect(r.datei, r.mount);
  const v1 = path.join(ROOT, 'routes/api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    collect(path.join(v1, f), '/api/v1');
  }
  // And the three that hang directly in server.ts.
  const srv = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  for (const m of srv.matchAll(/app\.(get|post|put|delete)\(\s*'(\/api\/[^']+)'/g))
    alle.add(`${m[1].toUpperCase()} ${form(m[2])}`);
  return alle;
}

/** All calls of the web app: api('VERB', pfad) and fetch(pfad, { method }). */
function webCalls() {
  const out = [];
  for (const datei of fs.readdirSync(JS)) {
    if (!datei.endsWith('.js') || datei === 'app.bundle.js') continue;
    const src = ohneKommentare(fs.readFileSync(path.join(JS, datei), 'utf8'));
    const rowOf = i => src.slice(0, i).split('\n').length;

    for (const m of src.matchAll(/\bapi(?:Roh|Raw)?\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit?.text.startsWith('/')) continue;
      out.push({ datei, zeile: rowOf(m.index), verb: m[1], pfad: pathFormV1('/api' + lit.text) });
    }
    for (const m of src.matchAll(/fetch\(\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit?.text.startsWith('/api/')) continue;
      // The method is in the second argument; without it, it is GET.
      const rest = src.slice(lit.ende, lit.ende + 300);
      const verb = (rest.match(/method\s*:\s*['"`](\w+)['"`]/)?.[1] ?? 'GET').toUpperCase();
      out.push({ datei, zeile: rowOf(m.index), verb, pfad: pathFormV1(lit.text) });
    }
  }
  return out;
}

test('every address of the web app exists on the server', () => {
  const server = serverRoutes();
  const aufrufe = webCalls();

  // Self-proof in both directions: if one of the patterns finds nothing, the
  // error list would be empty and the test green without having checked anything.
  assert.ok(server.size >= 120, `Nur ${server.size} Server-Routen gefunden — Muster veraltet?`);
  assert.ok(aufrufe.length >= 100, `Nur ${aufrufe.length} Webapp-Aufrufe gefunden — Muster veraltet?`);

  const fehlend = [
    ...new Set(
      aufrufe.filter(a => !server.has(`${a.verb} ${a.pfad}`)).map(a => `${a.datei}:${a.zeile}  ${a.verb} ${a.pfad}`),
    ),
  ].sort();

  assert.deepEqual(
    fehlend,
    [],
    'Diese Adressen ruft die Webapp auf, der Server hat sie nicht:\n  ' +
      fehlend.join('\n  ') +
      '\nIm Browser scheitert das erst zur Laufzeit — und wo der Aufruf auf ' +
      '.catch(() => null) endet, fehlt danach still ein Teil der Anzeige.',
  );
});

/**
 * And the opposite direction: what can only the web app do?
 */
const TRASH =
  'Papierkorb: vorerst nur in der Webapp. Löschen in der App landet trotzdem ' +
  'darin (der Schnappschuss entsteht im Server), zurückholen geht über die ' +
  'Webapp. Eine App-Ansicht ist als Nachzug vorgesehen.';

const SECOND_FACTOR =
  'Den zweiten Faktor eines ANDEREN Kontos zurücksetzen gehört zur ' +
  'Nutzerverwaltung, und die steht absichtlich nur in der Webapp ' +
  '(VerwaltungApi.kt, Abschnitt Server-Protokoll).';

const SETUP =
  'Der Einrichtungs-Assistent richtet den SERVER ein (Startpasswort, ' +
  'Schlüssel der Quellen) — das geschieht am Rechner, bevor jemand die App ' +
  'verbindet; die Schlüssel stehen dort auch in den Einstellungen.';

const EVERYTHING_DELETE =
  '„Alle meine Daten löschen" steht in der Gefahrenzone der Webapp. Auf dem ' +
  'Telefon gibt es den Knopf absichtlich nicht — ein Fehlgriff dort träfe die ' +
  'ganze Sammlung; einzelne Elemente löscht die App wie bisher.';

const NUR_WEB = new Map([
  [
    '/api/v1/auth/uebernahme-abbrechen',
    'Der Link steht in einer Mail und öffnet die Webseite; die App hat dafür keinen eigenen Weg nötig.',
  ],
  [
    '/api/v1/auth/anmeldung-freigeben',
    'Der Link steht in einer Mail und öffnet die Webseite; die freigegebene Adresse gilt danach auch für die App.',
  ],
  [
    '/api/v1/einrichtung/stand',
    'Die Prüfung erklärt die Installation des Wurzelzertifikats im Browser. Die App ' +
      'richtet sich über den QR-Code ein und bekommt den Fingerabdruck dort (`fp`).',
  ],
  [
    '/api/v1/settings/tls',
    'Fingerabdruck der CA zum Abgleich von Hand. Die App bekommt ihn mit dem ' +
      'QR-Code (`fp`) und pinnt ihn; eine Anzeige brächte ihr nichts.',
  ],
  [
    '/api/v1/auth/passkeys',
    'Passkeys entstehen und verschwinden im Browser (Passwort und Sitzung); die App meldet sich nur mit ihnen an.',
  ],
  ['/api/v1/auth/passkeys/:X', 'wie /api/v1/auth/passkeys'],
  ['/api/v1/auth/passkey/registrieren', 'wie /api/v1/auth/passkeys'],
  ['/api/v1/auth/passkey/registrieren/optionen', 'wie /api/v1/auth/passkeys'],
  [
    '/api/v1/admin/protokoll',
    'Protokoll der Verwalteraktionen an fremden Konten. Diese Aktionen ' +
      '(Passwort setzen, Rolle, Löschen) gibt es absichtlich nur in der ' +
      'Webapp (VerwaltungApi.kt nennt den Grund), also auch ihr Protokoll.',
  ],
  [
    '/api/v1/admin/job-status',
    'Stand des Preis-Jobs samt BrickLink-Kontingent. Die App zeigt BEIDES ' +
      'schon: den Fortschritt über /admin/jobs (jobMonitor, mit progress/total) ' +
      'und das Kontingent über /admin/cache-stats (rate_limits, ' +
      'MonitoringSections.kt). Ein zweiter Abruf für dieselben zwei Zahlen wäre ' +
      'die Doppelung, gegen die dieser Baum sonst prüft.',
  ],
  [
    '/api/v1/auth/qr-token',
    'Erzeugt den Nonce für die QR-Anmeldung — das ist die Seite, die den Code ' +
      'ZEIGT. Die App ist die andere Seite und liest ihn (/auth/qr-login). Ein ' +
      'Telefon, das sich selbst einen Code zum Abscannen anzeigt, hat niemand.',
  ],
  [
    '/api/v1/auth/qr-kopplung/:X',
    'Bestätigt oder lehnt die QR-Kopplung in der Sitzung ab, die den Code ' +
      'erzeugt hat; die App ist das Gerät, das gekoppelt wird, und zeigt nur den Code.',
  ],
  [
    '/api/v1/auth/qr-kopplung/:X/bestaetigen',
    'Bestätigt oder lehnt die QR-Kopplung in der Sitzung ab, die den Code ' +
      'erzeugt hat; die App ist das Gerät, das gekoppelt wird, und zeigt nur den Code.',
  ],
  [
    '/api/v1/auth/qr-kopplung/:X/ablehnen',
    'Bestätigt oder lehnt die QR-Kopplung in der Sitzung ab, die den Code ' +
      'erzeugt hat; die App ist das Gerät, das gekoppelt wird, und zeigt nur den Code.',
  ],
  [
    '/api/v1/auth/reset-password',
    'Setzt das Passwort mit dem Token aus der E-Mail. Der Link darin zeigt auf ' +
      'die WEBSEITE (src/mail/mailer.ts: `${baseUrl}/reset-password#token=`), also ' +
      'landet auch ein App-Nutzer dort. Was die App braucht, hat sie: ' +
      '/auth/forgot-password löst die Mail aus.',
  ],
  [
    '/api/v1/auth/email-bestaetigen',
    'Der Knopf auf der Seite hinter dem Link aus der Mail (/verify). Der Link ' +
      'öffnet die Webseite, auch auf dem Telefon; die App hat dafür keinen Bildschirm.',
  ],
  ['/api/v1/auth/email-bestaetigen/vorschau', 'Nennt auf derselben Seite (/verify) vor dem Knopf das Konto des Links.'],
  [
    '/api/v1/auth/bestaetigung-erneut',
    'Neuer Bestätigungslink; er zeigt auf die Webseite (/verify), dort wird bestätigt. ' +
      'Neu seit Runde 6 – die App kann den Knopf nachziehen, bis dahin hilft die Webseite.',
  ],
  [
    '/api/v1/auth/users',
    'Nutzerverwaltung. ABSICHTLICH nicht in der App — die Begründung steht in ' +
      'VerwaltungApi.kt: sie gehört an den Rechner, nicht auf ein Telefon.',
  ],
  ['/api/v1/auth/users/:X', 'Nutzer löschen — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/admin', 'Verwalterrecht umschalten — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/password', 'Fremdes Passwort zurücksetzen — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/aktiv', 'Fremdes Konto deaktivieren — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/freischalten', 'Offene Registrierung ohne Mail freischalten — siehe /auth/users.'],
  [
    '/api/v1/wanted-list/import/xml',
    'BrickLink-Wanted-Liste einlesen. NOCH NICHT in der App, und der Grund ' +
      'steht hier, damit ihn der Naechste nicht neu herleitet: Dieser Import ist ' +
      'ZWEISTUFIG. Der erste Schritt schreibt nichts, sondern liefert einen ' +
      'BERICHT — wie viele Posten sich ueber eine eingetragene Zuordnung ' +
      'abbilden liessen, wie viele ueber einen blossen Katalogtreffer (also auf ' +
      'einer Vermutung) und welche BrickLink-Nummern offen blieben, mit ihren ' +
      'Nummern zum Nachsehen. Erst danach entscheidet der Mensch. Das ist eine ' +
      'Tabelle zum Lesen und ein Knopf zum Bestaetigen, und dafuer braucht die ' +
      'App einen eigenen Bildschirm — die Dateiauswahl allein genuegt hier ' +
      'nicht, anders als bei den CSV-Importen, die einfach laufen und eine Zahl ' +
      'melden. Marco weiss es und kann es anfordern; bis dahin ist dies kein ' +
      'Versehen, sondern ein benannter Rest.',
  ],
  [
    '/api/v1/vouchers/export/pdf',
    'Alle Gutscheine als EIN PDF. Die App RUFT die Adresse sehr wohl auf — seit ' +
      'Marcos Vorgabe vom 15.10. („Bitte auch den Button … in der Android-App ' +
      'einbauen. Das erzeugte PDF soll analog den andere PDFs angezeigt werden") ' +
      'steht der Knopf in GutscheineCard.kt. Sie ruft sie nur nicht ueber ' +
      'Retrofit: Der PdfViewerScreen bekommt die ADDRESS ' +
      '(gutscheinExportAdresse() in ui/GutscheinFeature.kt) und laedt sie mit ' +
      'dem angemeldeten Client der App — genau wie beim einzelnen Gutschein-PDF, ' +
      'zu dem in GutscheineApi.kt steht, warum dort keine Methode liegt. ' +
      'Dieses Muster sieht die Messung oben nicht, weil sie @GET/@POST sucht. ' +
      'Was bleibt: Die Befunde in der Kopfzeile (welcher Betrag ersetzt wurde ' +
      'und welcher nicht) liest nur die Webapp; im Betrachter steht das PDF, ' +
      'nicht die Auskunft darueber.',
  ],
  [
    '/api/v1/settings/import',
    'Spielt eine gesicherte Verwaltungs-Konfiguration aus einer JSON-Datei ' +
      'zurück. Dasselbe Urteil wie bei der Nutzerverwaltung: eine Aufgabe für ' +
      'den Rechner, an dem die Sicherung liegt.',
  ],
  [
    '/api/v1/settings/raw',
    'Alle Einstellungen für die Einstellungsseite, mit Verwalter-Sicht und ' +
      'maskierten Geheimnissen. Die App holt über /v1/settings bewusst eine ' +
      'ENGERE Auswahl (sechs Felder, isAdmin=false) — nicht dieselbe Antwort ' +
      'unter anderem Namen, sondern eine andere Frage.',
  ],
  [
    '/api/v1/settings/smtp-test',
    'Verschickt eine Probe-Mail zum Prüfen der SMTP-Angaben. Die App richtet ' +
      'kein SMTP ein; ohne die Formularfelder daneben hätte der Knopf nichts zu ' +
      'prüfen.',
  ],

  // Four addresses the app KNEW and no longer calls
  [
    '/api/v1/sets/:X/instructions',
    'Verwirft die hinterlegten Anleitungen eines Sets und lässt die ' +
      'automatische Suche noch einmal laufen. War im Set-Detail der App und ist ' +
      'auf Marcos ausdrücklichen Wunsch entfernt.',
  ],
  [
    '/api/v1/sets/:X/parts',
    'Liest die Teileliste eines Sets neu aus dem Katalog ein. Ebenfalls im ' +
      'Set-Detail der App gewesen, auf Marcos Wunsch entfernt.',
  ],
  [
    '/api/v1/parts/bl-color-map',
    'Rebrickable-Farbnummer → BrickLink-Farbnummer. Wurde in der App NUR vom ' +
      'BrickLink-Export der Teileliste gebraucht; der ist auf Marcos Wunsch ' +
      'entfernt, und damit hat die Karte dort keinen Leser mehr.',
  ],
  [
    '/api/v1/minifigs/:X/parts',
    'Die Einzelteile einer Minifigur. Dieselbe Herkunft: Der Export löste ' +
      'fehlende Figuren in ihre Teile auf, weil man die Figur oft nicht als ' +
      'Ganzes kaufen kann. Mit dem Export entfiel der einzige Aufrufer.',
  ],
  ['/api/v1/papierkorb', TRASH],
  ['/api/v1/papierkorb/:X', TRASH],
  ['/api/v1/papierkorb/:X/wiederherstellen', TRASH],
  ['/api/v1/auth/users/:X/zweiter-faktor', SECOND_FACTOR],
  ['/api/v1/settings/einrichtung', SETUP],
  ['/api/v1/settings/einrichtung/fertig', SETUP],
  ['/api/v1/settings/quelle-testen', SETUP],
  ['/api/v1/bestand', EVERYTHING_DELETE],
  [
    '/api/v1/auth/konto',
    'Das eigene Konto endgültig löschen (Sicherheitsprüfung Runde 9, H4): mit Passwort und ' +
      'zweitem Faktor in der Webapp; in der App wäre ein Fehlgriff auf dem Telefon zu teuer.',
  ],
  [
    '/api/v1/settings/household/redeem/pruefen',
    'Nennt vor dem Annehmen einer Haushaltseinladung das einladende Konto (UI-Prüfung 13, M2). ' +
      'Die App fragt beim Annehmen nur das Passwort ab; sie bekommt die Prüfung mit ihrem eigenen Befund.',
  ],
  [
    '/api/v1/vouchers/:X/pdf',
    'Die App holt das Gutschein-PDF nicht über Retrofit, sondern über seine Adresse im ' +
      'PdfViewerScreen (gutscheinPdfAdresse); die Webapp lädt es seit dem Einmal-Ticket per fetch.',
  ],
]);

test('what only the web app can do has a reason', () => {
  // The app's Retrofit routes (shared/app-schnittstelle.json); `{x}` becomes `:X`.
  const appPaths = new Set(
    require('./helpers/contract')
      .appSchnittstelle()
      .routen.map(r => form(r.pfad.replace(/\{[^}]+\}/g, ':X'))),
  );
  // MEASURED, there are 94 addresses.
  assert.ok(appPaths.size >= 60, `Nur ${appPaths.size} App-Adressen — Muster veraltet?`);

  const webPaths = new Set(webCalls().map(a => a.pfad));
  // MEASURED, there are 68.
  assert.ok(webPaths.size >= 50, `Nur ${webPaths.size} Webapp-Adressen — Muster veraltet?`);

  const nurWeb = [...webPaths].filter(p => !appPaths.has(p)).sort();

  const unjustified = nurWeb.filter(p => !NUR_WEB.has(p));
  assert.deepEqual(
    unjustified,
    [],
    'Diese Adressen ruft nur die Webapp auf, und es steht kein Grund dabei:\n  ' +
      unjustified.join('\n  ') +
      '\nEntweder die App zieht nach — dann sind die beiden Oberflächen wieder ' +
      'gleich viel wert —, oder es gibt einen Grund; der gehört dann in NUR_WEB, ' +
      'damit ihn der Nächste nicht neu herleiten muss.',
  );

  // The same rule as for every exception list in this tree: an entry
  // that no longer describes anything looks like a decision and is merely
  // a guess. If the app catches up with one of these addresses, the entry
  // must become ROUTE — otherwise it silently covers the next gap as well.
  const veraltet = [...NUR_WEB.keys()].filter(p => !nurWeb.includes(p)).sort();
  assert.deepEqual(
    veraltet,
    [],
    'Diese Einträge in NUR_WEB beschreiben nichts mehr:\n  ' +
      veraltet.join('\n  ') +
      '\nEntweder ruft die App die Adresse inzwischen auch auf (dann Eintrag ' +
      'streichen), oder die Webapp ruft sie nicht mehr auf (dann ebenfalls).',
  );
});
