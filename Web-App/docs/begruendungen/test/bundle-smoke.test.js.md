# Begründungen zu `test/bundle-smoke.test.js`

Die ausführlichen Kommentare aus `test/bundle-smoke.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Rauchtest für das Frontend-Bündel.

── Warum es diesen Test braucht ────────────────────────────────────────────
Mit der Umstellung auf ES-Module hat sich die riskanteste Eigenschaft des
Frontends geändert: Vorher waren alle Handler globale Funktionen und der
Dispatcher fand sie über window[name]. Jetzt melden sich die Module bei einer
Registry an (js/00-registry.js). Vergisst ein Modul die Anmeldung — oder
bricht es beim Auswerten ab —, merkt man das NICHT beim Bauen und nicht beim
Typprüfen, sondern erst, wenn jemand auf den betroffenen Knopf klickt.

Dieser Test wertet das gebaute Bündel in jsdom aus und prüft danach:
  1. Es läuft überhaupt durch (kein Fehler beim Modul-Init).
  2. Jeder im Markup verwendete data-click/data-change-Name ist auflösbar.

Punkt 2 ist die eigentliche Zusicherung: Er ersetzt genau die Sicherheit,
die vorher darin lag, dass alles global war.

Ausführen: npm test (setzt `npm run build:frontend` voraus)
```

<a id="api-liefert-bei-jedem-fehlschlag-ein-obj"></a>
## `test('api() liefert bei jedem Fehlschlag ein Objekt statt zu werfen', `

```text
HINWEIS: Hier stand der Versuch eines Wächters gegen vergessene Importe —
erst als Klick-Test durch alle Reiter, dann als statische Prüfung "jeder
modulfremde Aufruf muss importiert sein".

Beide sind wieder entfernt, weil sie nicht funktionierten:
  • Der Klick-Test scheiterte an abgewiesenen Zusagen aus den Datenabrufen.
    Der Node-Test-Runner rechnet die dem Test an, unabhängig von einem
    eigenen unhandledRejection-Abfang.
  • Die statische Prüfung meldete NICHTS, als der fehlende Import von
    initCatalog zur Gegenprobe wieder entfernt wurde. Ein Test, der grün
    bleibt, während der Fehler vorhanden ist, ist schlechter als kein Test:
    Er erzeugt Sicherheit, die es nicht gibt.

Die Lücke bleibt damit offen und ist hier benannt statt kaschiert: Ein
vergessener Import in einem Funktionsrumpf fällt weiterhin erst im Browser
auf. Wer das lösen will, braucht einen echten Parser (z. B. esbuild als
Bibliothek mit Metafile-Analyse) statt Regex über den Quelltext.
```

<a id="http"></a>
## `const http = require('node:http');`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
api() war `return (await fetch(...)).json()` — ohne Blick auf res.ok.
Jede nicht-JSON-Antwort (502/504 vom Reverse Proxy, 413, HTML-Fehlerseite)
liess .json() einen SyntaxError werfen: "Unexpected token '<'". Bei rund
88 Aufrufstellen ist längst nicht jede in try/catch — für den Benutzer
hiess das: klicken, nichts passiert, keine Meldung. Die Fehlerbehandlung
war da (sie prüft d.success und zeigt d.error), sie bekam nur nie ein
Objekt zu sehen.
```

<a id="core"></a>
## `const core = require('./helpers/sources').coreQuelle();`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Ein 401 wurde zu einem Hinweis pro Klick („Nicht angemeldet"), während
die Oberfläche weiter alte Daten zeigte und sich nicht mehr bedienen
liess. Die Android-App macht es längst richtig: Interceptor meldet den
401, die App zeigt „Sitzung abgelaufen" und führt zur Anmeldung.

Wahrscheinlicher geworden ist der Fall durch die Sitzungs-Bereinigung
beim Passwortwechsel — seitdem verwerfen alle drei Passwort-Wege
sämtliche Sitzungen des Kontos, offene Tabs landen also genau hier.

Verhalten gegen einen echten kleinen Server nachgestellt:
  abgemeldet + 401 → nichts        (sonst Schleife auf der Anmeldemaske)
  angemeldet + 401 → login-screen: flex, app: none
```
