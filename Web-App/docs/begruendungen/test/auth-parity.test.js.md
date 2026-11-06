# Begründungen zu `test/auth-parity.test.js`

Die ausführlichen Kommentare aus `test/auth-parity.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Auth-Paritätstest (ohne DB).

api-parity.test.js vergleicht, ob /api und /api/v1 dieselben DATEN liefern.
Die Vorbedingungen des Logins waren davon nicht abgedeckt — und genau dort
lag eine echte Lücke: /api/v1/auth/login hat weder is_active noch
email_verified geprüft. Ein deaktiviertes Konto konnte sich über die
Android-API anmelden und bekam dort einen Token OHNE Ablaufdatum.

Der Test hat zwei Teile:
  1. assertLoginAllowed() selbst (Verhalten, inkl. der 0/1-vs-boolean-Fälle,
     die Postgres je nach Spaltentyp liefert).
  2. Ein statischer Check, dass BEIDE Login-Handler die Funktion aufrufen —
     damit die Regel nicht wieder auseinanderläuft.

Ausführen: npm test
```

<a id="anmeldehandler"></a>
## `function anmeldeHandler() {`

```text
Jeden Anmelde-Handler SUCHEN statt zwei aufzuzählen.

Die vorige Fassung dieses Tests nannte die beiden Dateien beim Namen und
prüfte, ob dort `assertLoginAllowed(user)` steht. Das hat genau das
abgesichert, was schon dastand — und nichts über den Rest gesagt. Genau in
dieser Lücke lag der zweite Unterschied zwischen den beiden Logins: der
fehlende Vergleich gegen den Dummy-Hash. Eine dritte Anmeldung wäre
ebenfalls unbemerkt geblieben.

Gefunden wird über den Pfad (`…login…`); geprüft wird nur, was ein PASSWORT
entgegennimmt. `/qr-login` löst eine Nonce ein und hat keins — es fällt
dadurch von selbst heraus, ohne Ausnahmeliste.
```

<a id="stelle"></a>
## `assert.ok(gefunden.length >= 2,`

```text
Selbstbeweis: Findet das Muster nichts, wäre die Fehlerliste leer und der
Test grün, ohne etwas geprüft zu haben.

Die Zahlen sind bewusst klein: Seit dem Zusammenlegen gibt es genau ZWEI
Anmelde-Routen (/login und /qr-login) und davon EINE mit Passwort. Genau
das ist das Ziel — eine Untergrenze von zwei passwortbasierten
Anmeldungen hätte den erreichten Zustand als Fehler gemeldet. Das Gewicht
liegt deshalb auf der Prüfung darunter und auf der Zähler-Regel danach;
hier wird nur belegt, dass das Muster ueberhaupt noch greift.
```

<a id="stelle-2"></a>
## `assert.match(fn, /targetId === nutzerId\(req\)/,`

```text
Das eigene Konto ist ausgenommen: Hier wird KEIN altes Passwort verlangt,
also könnte eine übernommene Sitzung den Besitzer sonst aussperren.

Geprüft wird der VERGLEICH, nicht mehr die Schreibweise seiner rechten
Seite. Hier stand `Number(req.session.userId)` — genau die Schreibweise,
die es seit Nachtrag 127 nicht mehr gibt: „Wer fragt hier?" stand in vier
Fassungen und heisst jetzt überall nutzerId(req), damit die App mit ihrem
Bearer-Token dieselben Routen erreicht wie die Webapp. Der Test war rot,
obwohl die Regel unverändert galt — ein Test, der die Formulierung
festhält statt die Aussage, verbietet jede Vereinheitlichung.
```

<a id="auth"></a>
## `const auth  = require('./helpers/sources').anmeldeQuelle();`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Drei Stellen im Anmeldeweg trugen .catch(() => {}):

  • Der Web-Token beim Login. Scheiterte das INSERT, galt die Anmeldung
    trotzdem als erfolgreich, und der Client legte einen Token in den
    sessionStorage, den die Datenbank nie gesehen hatte — der SSE-Kanal
    (?token=…, EventSource kann keine Header setzen) lief dann in ein 401.
    Jetzt wird der Token bei einem Fehler WEGGELASSEN; ohne ihn fällt der
    Client auf die Cookie-Session zurück, die ohnehin funktioniert.
  • Das Verwerfen von Sessions und Tokens nach einem Passwortwechsel.
    Verschluckt hiess: neues Passwort gesetzt, alte Zugänge gelten weiter.
  • revokeAllTokens() — dieselbe Regel an der zentralen Stelle.
```

<a id="authohne"></a>
## `const authOhne = ohneKommentare(auth);`

```text
Das Feld heisst `token`; ausgestellt wird es in angemeldetAntworten(),
dem gemeinsamen Weg von Passwort- und Passkey-Anmeldung.

Kommentare raus, BEVOR gesucht wird: Der Erklaertext IN der Route nennt
`.catch(() => {})` als das, was dort frueher stand — die Prüfung schlug
darauf an, sobald der Ausschnitt frueher begann. Dieselbe Falle wie
mehrfach zuvor in dieser Suite; sie ist der haeufigste Fehler beim
Schreiben quelltextlesender Tests.
```

<a id="auth-2"></a>
## `const auth  = require('./helpers/sources').anmeldeQuelle();`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Der Admin-Reset suchte die Sitzungen in einer Tabelle `session` und
übersprang den Schritt, wenn es sie nicht gibt. Es gibt sie NIE: Der
Store läuft auf `user_sessions` (server.ts, tableName). to_regclass
lieferte immer NULL, das DELETE lief nie — ein Administrator konnte das
Passwort eines übernommenen Kontos zurücksetzen, und die Sitzung des
Angreifers blieb angemeldet. Gegen echten Store nachgestellt: vorher
blieb die Sitzung gültig, jetzt ist sie weg.

Drei Wege ändern ein Passwort — Admin-Reset, Reset per E-Mail-Token und
die eigene Änderung. Alle drei müssen Tokens UND Sitzungen schliessen.
```

<a id="utils"></a>
## `const utils = require('./helpers/sources').dienstQuelle('src/konto/aut`

```text
── Woher diese Regel kommt ─────────────────────────────────────────────
Tokens der Android-App und des QR-Logins werden bewusst ohne Ablaufdatum
angelegt (expires_at NULL) — wer die App öffnet, soll nicht ständig sein
Passwort eintippen. Der Preis war: Ein Token auf einem verlorenen oder
verkauften Telefon gilt unbegrenzt, und ausser einem Passwortwechsel gibt
es keinen Weg, ihn loszuwerden.

Das Mass ist „ungenutzt", nicht „alt": Ein Telefon, das täglich
synchronisiert, wird nie ausgesperrt, egal wie lange es das Konto schon
hat. Nur was ohnehin niemand mehr benutzt, verfällt.
```
