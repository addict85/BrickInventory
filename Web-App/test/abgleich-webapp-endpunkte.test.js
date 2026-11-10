/**
 * Jede Adresse, die die Webapp aufruft, muss es auf dem Server geben.
 * Ausführlich: docs/begruendungen/test/abgleich-webapp-endpunkte.test.js.md#kopf
 *
 * ── Warum es diese Prüfung gibt ─────────────────────────────────────────────
 * Für die Android-App steht das seit test/abgleich-app-endpunkte.test.js fest — dort
 * fiel damit eine Methode auf, die auf eine längst gelöschte Route zeigte.
 * Für die Webapp gab es die Gegenprobe nicht, obwohl das Risiko dort GRÖSSER
 * ist: Ein falscher Pfad im Browser scheitert erst zur Laufzeit, und etliche
 * Aufrufe enden auf `.catch(() => null)` — dann fehlt einfach ein Diagramm,
 * ohne dass irgendwo etwas rot wird.
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare, routerEinhaengungen, pfadForm, leseLiteral } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** `/api/sets/:setNumber` → `/api/sets/:X` — verglichen wird die FORM. */
function form(p) {
  return ('/' + String(p).replace(/^\/+|\/+$/g, '')).replace(/\/:[A-Za-z_]\w*/g, '/:X');
}

/**
 * Template-Ausdrücke auflösen, dann den Abfrageteil abschneiden.
 * Ausführlich: docs/begruendungen/test/abgleich-webapp-endpunkte.test.js.md#pfadformv1
 */
function pfadFormV1(roh) {
  return form(pfadForm(roh));
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
  const v1 = path.join(ROOT, 'routes/api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    sammle(path.join(v1, f), '/api/v1');
  }
  // Und die drei, die direkt in server.ts hängen.
  const srv = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  for (const m of srv.matchAll(/app\.(get|post|put|delete)\(\s*'(\/api\/[^']+)'/g))
    alle.add(`${m[1].toUpperCase()} ${form(m[2])}`);
  return alle;
}

/** Alle Aufrufe der Webapp: api('VERB', pfad) und fetch(pfad, { method }). */
function webAufrufe() {
  const out = [];
  for (const datei of fs.readdirSync(JS)) {
    if (!datei.endsWith('.js') || datei === 'app.bundle.js') continue;
    const src = ohneKommentare(fs.readFileSync(path.join(JS, datei), 'utf8'));
    const zeileVon = (i) => src.slice(0, i).split('\n').length;

    for (const m of src.matchAll(/\bapi(?:Roh)?\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit || !lit.text.startsWith('/')) continue;
      out.push({ datei, zeile: zeileVon(m.index), verb: m[1], pfad: pfadFormV1('/api' + lit.text) });
    }
    for (const m of src.matchAll(/fetch\(\s*/g)) {
      const lit = leseLiteral(src, m.index + m[0].length);
      if (!lit || !lit.text.startsWith('/api/')) continue;
      // Die Methode steht im zweiten Argument; ohne Angabe ist es GET.
      const rest = src.slice(lit.ende, lit.ende + 300);
      const verb = (rest.match(/method\s*:\s*['"`](\w+)['"`]/) || [, 'GET'])[1].toUpperCase();
      out.push({ datei, zeile: zeileVon(m.index), verb, pfad: pfadFormV1(lit.text) });
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
 * Und die Gegenrichtung: Was kann nur die Webapp?
 * Ausführlich: docs/begruendungen/test/abgleich-webapp-endpunkte.test.js.md#papierkorb
 */
const PAPIERKORB =
  'Papierkorb: vorerst nur in der Webapp. Löschen in der App landet trotzdem ' +
  'darin (der Schnappschuss entsteht im Server), zurückholen geht über die ' +
  'Webapp. Eine App-Ansicht ist als Nachzug vorgesehen.';

const ZWEITER_FAKTOR =
  'Den zweiten Faktor eines ANDEREN Kontos zurücksetzen gehört zur ' +
  'Nutzerverwaltung, und die steht absichtlich nur in der Webapp ' +
  '(VerwaltungApi.kt, Abschnitt Server-Protokoll).';

const EINRICHTUNG =
  'Der Einrichtungs-Assistent richtet den SERVER ein (Startpasswort, ' +
  'Schlüssel der Quellen) — das geschieht am Rechner, bevor jemand die App ' +
  'verbindet; die Schlüssel stehen dort auch in den Einstellungen.';

const ALLES_LOESCHEN =
  '„Alle meine Daten löschen" steht in der Gefahrenzone der Webapp. Auf dem ' +
  'Telefon gibt es den Knopf absichtlich nicht — ein Fehlgriff dort träfe die ' +
  'ganze Sammlung; einzelne Elemente löscht die App wie bisher.';

const NUR_WEB = new Map([
  ['/api/v1/einrichtung/stand',
   'Die Prüfung erklärt die Installation des Wurzelzertifikats im Browser. Die App ' +
   'richtet sich über den QR-Code ein und bekommt den Fingerabdruck dort (`fp`).'],
  ['/api/v1/settings/tls',
   'Fingerabdruck der CA zum Abgleich von Hand. Die App bekommt ihn mit dem ' +
   'QR-Code (`fp`) und pinnt ihn; eine Anzeige brächte ihr nichts.'],
  ['/api/v1/auth/passkeys', 'Passkeys entstehen und verschwinden im Browser (Passwort und Sitzung); die App meldet sich nur mit ihnen an.'],
  ['/api/v1/auth/passkeys/:X', 'wie /api/v1/auth/passkeys'],
  ['/api/v1/auth/passkey/registrieren', 'wie /api/v1/auth/passkeys'],
  ['/api/v1/auth/passkey/registrieren/optionen', 'wie /api/v1/auth/passkeys'],
  ['/api/v1/admin/protokoll',
   'Protokoll der Verwalteraktionen an fremden Konten. Diese Aktionen ' +
   '(Passwort setzen, Rolle, Löschen) gibt es absichtlich nur in der ' +
   'Webapp (VerwaltungApi.kt nennt den Grund), also auch ihr Protokoll.'],
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
  ['/api/v1/auth/qr-kopplung/:X',
   'Bestätigt oder lehnt die QR-Kopplung in der Sitzung ab, die den Code ' +
   'erzeugt hat; die App ist das Gerät, das gekoppelt wird, und zeigt nur den Code.'],
  ['/api/v1/auth/qr-kopplung/:X/bestaetigen',
   'Bestätigt oder lehnt die QR-Kopplung in der Sitzung ab, die den Code ' +
   'erzeugt hat; die App ist das Gerät, das gekoppelt wird, und zeigt nur den Code.'],
  ['/api/v1/auth/qr-kopplung/:X/ablehnen',
   'Bestätigt oder lehnt die QR-Kopplung in der Sitzung ab, die den Code ' +
   'erzeugt hat; die App ist das Gerät, das gekoppelt wird, und zeigt nur den Code.'],
  ['/api/v1/auth/reset-password',
   'Setzt das Passwort mit dem Token aus der E-Mail. Der Link darin zeigt auf ' +
   'die WEBSEITE (src/mail/mailer.ts: `${baseUrl}/reset-password?token=`), also ' +
   'landet auch ein App-Nutzer dort. Was die App braucht, hat sie: ' +
   '/auth/forgot-password löst die Mail aus.'],
  ['/api/v1/auth/email-bestaetigen',
   'Der Knopf auf der Seite hinter dem Link aus der Mail (/verify). Der Link ' +
   'öffnet die Webseite, auch auf dem Telefon; die App hat dafür keinen Bildschirm.'],
  ['/api/v1/auth/email-bestaetigen/vorschau',
   'Nennt auf derselben Seite (/verify) vor dem Knopf das Konto des Links.'],
  ['/api/v1/auth/bestaetigung-erneut',
   'Neuer Bestätigungslink; er zeigt auf die Webseite (/verify), dort wird bestätigt. ' +
   'Neu seit Runde 6 – die App kann den Knopf nachziehen, bis dahin hilft die Webseite.'],
  ['/api/v1/auth/users',
   'Nutzerverwaltung. ABSICHTLICH nicht in der App — die Begründung steht in ' +
   'VerwaltungApi.kt: sie gehört an den Rechner, nicht auf ein Telefon.'],
  ['/api/v1/auth/users/:X',        'Nutzer löschen — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/admin',  'Verwalterrecht umschalten — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/password', 'Fremdes Passwort zurücksetzen — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/aktiv',  'Fremdes Konto deaktivieren — siehe /auth/users.'],
  ['/api/v1/auth/users/:X/freischalten', 'Offene Registrierung ohne Mail freischalten — siehe /auth/users.'],
  ['/api/v1/wanted-list/import/xml',
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
   'Versehen, sondern ein benannter Rest.'],
  ['/api/v1/vouchers/export/pdf',
   'Alle Gutscheine als EIN PDF. Die App RUFT die Adresse sehr wohl auf — seit ' +
   'Marcos Vorgabe vom 15.10. („Bitte auch den Button … in der Android-App ' +
   'einbauen. Das erzeugte PDF soll analog den andere PDFs angezeigt werden") ' +
   'steht der Knopf in GutscheineCard.kt. Sie ruft sie nur nicht ueber ' +
   'Retrofit: Der PdfViewerScreen bekommt die ADRESSE ' +
   '(gutscheinExportAdresse() in ui/GutscheinFeature.kt) und laedt sie mit ' +
   'dem angemeldeten Client der App — genau wie beim einzelnen Gutschein-PDF, ' +
   'zu dem in GutscheineApi.kt steht, warum dort keine Methode liegt. ' +
   'Dieses Muster sieht die Messung oben nicht, weil sie @GET/@POST sucht. ' +
   'Was bleibt: Die Befunde in der Kopfzeile (welcher Betrag ersetzt wurde ' +
   'und welcher nicht) liest nur die Webapp; im Betrachter steht das PDF, ' +
   'nicht die Auskunft darueber.'],
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

  // Vier Adressen, die die App KANNTE und nicht mehr aufruft
  // Ausführlich: docs/begruendungen/test/abgleich-webapp-endpunkte.test.js.md#stelle
  ['/api/v1/sets/:X/instructions',
   'Verwirft die hinterlegten Anleitungen eines Sets und lässt die ' +
   'automatische Suche noch einmal laufen. War im Set-Detail der App und ist ' +
   'auf Marcos ausdrücklichen Wunsch entfernt.'],
  ['/api/v1/sets/:X/parts',
   'Liest die Teileliste eines Sets neu aus dem Katalog ein. Ebenfalls im ' +
   'Set-Detail der App gewesen, auf Marcos Wunsch entfernt.'],
  ['/api/v1/parts/bl-color-map',
   'Rebrickable-Farbnummer → BrickLink-Farbnummer. Wurde in der App NUR vom ' +
   'BrickLink-Export der Teileliste gebraucht; der ist auf Marcos Wunsch ' +
   'entfernt, und damit hat die Karte dort keinen Leser mehr.'],
  ['/api/v1/minifigs/:X/parts',
   'Die Einzelteile einer Minifigur. Dieselbe Herkunft: Der Export löste ' +
   'fehlende Figuren in ihre Teile auf, weil man die Figur oft nicht als ' +
   'Ganzes kaufen kann. Mit dem Export entfiel der einzige Aufrufer.'],
  ['/api/v1/papierkorb',
   PAPIERKORB],
  ['/api/v1/papierkorb/:X',
   PAPIERKORB],
  ['/api/v1/papierkorb/:X/wiederherstellen',
   PAPIERKORB],
  ['/api/v1/auth/users/:X/zweiter-faktor',
   ZWEITER_FAKTOR],
  ['/api/v1/settings/einrichtung',
   EINRICHTUNG],
  ['/api/v1/settings/einrichtung/fertig',
   EINRICHTUNG],
  ['/api/v1/settings/quelle-testen',
   EINRICHTUNG],
  ['/api/v1/bestand',
   ALLES_LOESCHEN],
  ['/api/v1/auth/konto',
   'Das eigene Konto endgültig löschen (Sicherheitsprüfung Runde 9, H4): mit Passwort und ' +
   'zweitem Faktor in der Webapp; in der App wäre ein Fehlgriff auf dem Telefon zu teuer.'],
  ['/api/v1/settings/household/redeem/pruefen',
   'Nennt vor dem Annehmen einer Haushaltseinladung das einladende Konto (UI-Prüfung 13, M2). ' +
   'Die App fragt beim Annehmen nur das Passwort ab; sie bekommt die Prüfung mit ihrem eigenen Befund.'],
  ['/api/v1/vouchers/:X/pdf',
   'Die App holt das Gutschein-PDF nicht über Retrofit, sondern über seine Adresse im ' +
   'PdfViewerScreen (gutscheinPdfAdresse); die Webapp lädt es seit dem Einmal-Ticket per fetch.'],
]);

test('was nur die Webapp kann, hat einen Grund', () => {
  const SERVICE = path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');
  assert.ok(fs.existsSync(SERVICE), `App-Schnittstelle nicht gefunden unter ${SERVICE}`);
  const { apiQuelltext } = require('../scripts/kotlin-vertrag.js');

  const appPfade = new Set([...ohneKommentare(apiQuelltext(SERVICE))
    // @HTTP(method = …, path = "…"): Retrofits Weg zu DELETE mit Rumpf.
    .matchAll(/@(?:GET|POST|PUT|DELETE|PATCH)\(\s*"([^"]+)"\s*\)|@HTTP\([^)]*\bpath\s*=\s*"([^"]+)"/g)]
    // Retrofit schreibt `{setNumber}`, Express `:setNumber` — beides wird zu
    // `:X`. form() oben kennt nur die Express-Form; ohne diesen Schritt galten
    // sechs Adressen als „nur Webapp", die die App sehr wohl aufruft.
    .map(m => form('/' + (m[1] ?? m[2]).replace(/^\/+/, '').replace(/\{[^}]+\}/g, ':X'))));
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
