# Begründungen zu `test/anmeldung-eine-adresse-db.test.js`

Die ausführlichen Kommentare aus `test/anmeldung-eine-adresse-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die EINE Anmeldung — durchgespielt, nicht gelesen.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Es gab zwei Anmeldungen: /api/auth/login stellte eine Sitzung aus,
/api/v1/auth/login einen Bearer-Token. Sie sind zusammengelegt; beide
Clients rufen jetzt dieselbe Adresse.

Genau dieser Umbau ist der, bei dem ein Fehler NICHT „ein Diagramm fehlt"
heisst, sondern „niemand kommt mehr rein". Ein quelltextlesender Test kann
das nicht beantworten: Er sieht, dass eine Zeile dasteht, nicht dass sie
wirkt. Deshalb hier ein echter Server mit echtem Sitzungs-Store, echten
Cookies und echten Token — und die Verdrahtung wird aus server.ts GELESEN
(einhaengung()), damit der Prüfstand nicht seine eigene Adresse prüft.

── Was durchgespielt wird ──────────────────────────────────────────────────
 1. Ohne `ohne_token` -> nur ein Token mit Ablaufdatum, kein Keks;
    mit `ohne_token` (Browser) -> nur die Sitzung
 2. App meldet sich an      -> Token OHNE Ablaufdatum (never_expires)
 3. /me mit Cookie, mit Token, ohne alles, mit ungültigem Token
 4. Abmelden entwertet BEIDES — Sitzung und Token, in einem Aufruf

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
```

<a id="app1"></a>
## `const app1 = await ruf('/login', { method: 'POST',`

```text
── 2. Die App: gleitende Frist statt gar keiner ────────────────────────

Hier stand `never_expires === true` und `expires_at === null`. Das war
bis zur Gleitfrist richtig — und war zugleich die Luecke: Die 90 Tage
aus TOKEN_IDLE_DAYS setzte allein der stuendliche Aufraeumjob durch, die
Pruefung im Anfrageweg liess `expires_at IS NULL` immer passieren.

Das Feld heisst weiter `never_expires` — die App SCHICKT es so, und ein
umbenanntes Feld wuerde jede aeltere Fassung woechentlich abmelden. Es
antwortet jetzt nur ehrlich: „ohne Ablauf" ist der Token nur noch, wenn
die Frist ganz abgeschaltet ist (TOKEN_IDLE_DAYS=0).
```
