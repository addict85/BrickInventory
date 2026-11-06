# Begründungen zu `test/hardening-block1.test.js`

Die ausführlichen Kommentare aus `test/hardening-block1.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Block 1 der Optimierungsliste: Punkte 1, 3, 5 und 6.

1 — Session-Rotation beim Login (Session Fixation)
3 — Rate-Limits worker-übergreifend statt pro Prozess
5 — Vorschaubilder in allen Listenansichten
6 — avg_price statt qty_avg_price in den Teile- und Minifiguren-Pfaden

Ausführen: npm test
```

<a id="lim-stelle"></a>
## `const lim = require('./helpers/sources').dienstQuelle('src/konto/login`

```text
Die Tabelle heisst rate_limit_attempts, nicht rate_counters.

Der Test prüfte bis hierher gegen einen Entwurf, den es im Code nie gab —
rate_counters wurde zwar angelegt, aber von keiner Abfrage benutzt (die
CREATE-Anweisung ist inzwischen entfernt). Geprüft wird jetzt, was die
Implementierung tatsächlich zusichert: Zähler in der Datenbank, atomares
Hochzählen in einem Statement, Rückfall auf den Prozessspeicher.
```

<a id="stelle"></a>
## `assert.doesNotMatch(fc, /avg_price > 0 \|\| \w+\.qty_avg_price > 0/,`

```text
Die Aussage ist unverändert: Ein Datensatz mit avg_price = 0 darf nicht
als „hat einen Preis" durchgehen, sonst steht überall 0.

Gezählt wurden dafür früher fünf Vorkommen von `pd.avg_price > 0` — Sets,
Teile und Minifiguren, je Haupt- und Rückfall-Zustand. Die gibt es nicht
mehr: Dieselbe Frage stand in dieser Datei an 22 Stellen, in drei
Fassungen, und widersprach dabei der Fassung in clients/bricklink.ts.
Sie liegt jetzt einmal in src/katalog/bricklinkPreise.ts (siehe
test/preisregel-db.test.js). Gezählt werden deshalb die Stellen, die sie
BENUTZEN — die Zahl bleibt die Zusicherung, dass keine davon verschwindet.
```

<a id="stelle-2"></a>
## `const { ohneKommentare, setKernQuelle, coreQuelle } = require('./helpe`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
src/konto/auth.ts fuehrte eine Liste TOKEN_QUERY_ALLOWED: drei Pfade, auf
denen `?token=` als Ausweis zaehlte. Begruendung war, dass <img src>,
EventSource und window.open() keine Kopfzeilen setzen koennen. Das stimmt
— nur hatte im ganzen Baum KEINER der drei Eintraege noch einen Nutzer:
der Browser oeffnet den SSE-Kanal mit Cookie, der Polling-Rueckfall setzt
eine echte Kopfzeile, und die Anleitung holt die App ueber ihren OkHttp-
Client, dessen Interceptor den Authorization-Kopf ohnehin anhaengt.
Uebrig blieb eine Erlaubnis, ueber die der SITZUNGSTOKEN in
Proxy-Protokolle und Browserverlauf wandern konnte.

Dieser Test haelt beide Haelften fest: den Server, der `?token=` nicht
mehr ansieht, und die Aufrufer, die keinen mehr anhaengen. Nur eine der
beiden zu pruefen reichte nicht — die Ausnahmeliste hier war jahrelang
gruen, WEIL nur ihr Vorhandensein geprueft wurde und nie ihr Nutzen.
```

<a id="anhaengen"></a>
## `const anhaengen = [`

```text
── Und die Aufrufer ──────────────────────────────────────────────────────

Nicht nach der blossen Zeichenkette `?token=` gesucht: src/mail/mailer.ts
baut damit die Links `/verify?token=` und `/reset-password?token=` fuer
die E-Mail. Das sind EIGENE, kurzlebige Token mit eigenen Handlern in
server.ts — kein Sitzungsausweis. Gesucht wird deshalb das Anhaengen
eines gespeicherten Zugangs an eine Adresse.
```

<a id="server"></a>
## `const server = read('server.ts');`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
shutdown() wartete auf httpServer.close(). Dessen Rückruf kommt erst,
wenn die LETZTE Verbindung weg ist — und ein SSE-Strom geht von sich aus
nie weg. Jeder Neustart lief deshalb in die Frist von acht Sekunden und
endete über die Reissleine mit process.exit(1): Für Docker sah jedes
Deploy aus wie ein Absturz.

Der Kommentar dort nannte das einen Ausnahmefall („bleibt eine Verbindung
hängen"). Es war der Regelfall — der Fortschrittskanal der Webapp bleibt
ausdrücklich dauerhaft offen, auch wenn gar kein Import läuft.

Nachgemessen: ohne Registry kam close() nie zurück, mit ihr nach 2 ms.
Reine Keep-Alive-Verbindungen brauchen das NICHT — die beendet Node beim
Schliessen des Servers von selbst.
```

<a id="dateien"></a>
## `const dateien = ['routes/api_v1/settings.ts', 'routes/api_v1/sets.ts',`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
POST /api/settings/import führte am Ende ein unbedingtes
`DELETE FROM price_cache` aus — der Router trägt aber nur requireLogin.
Jedes Konto, auch ein Unterkonto im Haushalt, konnte damit eine
Ein-Zeilen-Datei ({"user_settings":{"currency":"CHF"}}) hochladen und den
Preis-Cache der GANZEN Installation leeren. Beliebig oft. Der nächste
Bewertungslauf holt dann alle Preise neu bei BrickLink, und deren
Tageskontingent ist endlich.

Dieselbe Lücke war in routes/finance.ts schon einmal geschlossen worden
(POST /refresh trägt seitdem requireAdmin, mit einer Notiz über das
verbrannte Kontingent). Der Import-Weg wurde übersehen — er sieht ja auch
nicht nach „Cache leeren" aus. Genau deshalb prüft dieser Test die REGEL
und nicht eine einzelne Route: Wer den Cache leert, braucht requireAdmin.
```

<a id="leser"></a>
## `const leser = require('./helpers/sources').alleQuellen()`

```text
Die Begründung, warum die Zeile im Import ERSATZLOS entfallen ist und
nicht bloss hinter isAdmin gewandert ist: price_cache ist über
set_number, condition UND currency_code verschlüsselt. Einträge in der
alten Währung passen nach einem Wechsel schlicht nicht mehr auf die
Abfrage, und für die neue wird ohnehin frisch geholt.

Bricht jemand diese Eigenschaft (eine Abfrage ohne currency_code), wäre
die Zeile plötzlich wieder nötig — dann soll hier etwas rot werden.
Alle Quellen statt einer Liste: Eine Liste veraltet beim nächsten Umzug.
```
