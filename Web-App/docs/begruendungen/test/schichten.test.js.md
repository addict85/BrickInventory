# Begründungen zu `test/schichten.test.js`

Die ausführlichen Kommentare aus `test/schichten.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Abhängigkeiten zeigen nach innen.

    server.ts, startup/    hängt alles ein
    routes/                HTTP: Eingabe prüfen, Dienst rufen, antworten
    jobs/                  Hintergrundarbeit, ruft Dienste
    src/<bereich>/         Dienste (Fachlogik) und repository (SQL), in STUFEN geordnet
    clients/, db/          Aussenwelt (nur HTTP) und Datenbank, kennen nur src/infra/
    src/infra/             fachfreie Helfer, kennen nichts darüber

Ausnahmen stehen namentlich in den Listen und dürfen nur kürzer werden.
Überblick für Menschen: docs/architektur.md (der letzte Test hält ihn aktuell).
```

<a id="ausnahmen"></a>
## `const AUSNAHMEN = new Set([]);`

```text
Was noch aus einer Route nach innen geholt wird — und warum es noch steht.

Die Liste ist LEER — und das ist das Ergebnis eines Durchgangs, nicht der
Ausgangszustand. Sie hatte acht Eintraege, und beim Aufloesen zeigte sich,
dass sie aus DREI verschiedenen Gruenden dort standen:

  • Zwei UMWEGE: jobs/rebrickableCsvSync und src/teile/abfragen holten
    fetchMissingBlIds ueber routes/parts — die Route hatte sie selbst nur
    importiert und weiterexportiert. Kein Code am falschen Ort, nur ein
    Import am falschen Ort. Sie holen sie jetzt direkt aus utils/partsImport.
  • Zwei FEHLER IN DIESER REGEL: startup/ zaehlte hier zu den inneren
    Schichten, obwohl es nur von server.ts benutzt wird und damit
    ausgelagerter Serverstart ist. Siehe die Ordnerliste unten.
  • Vier ECHTE Faelle: die Marktpreise fuer Teile und Figuren, die
    Preisschaetzung aus Einzelteilen und die Rebrickable-Teileabfrage. Sie
    stehen jetzt in src/finanzen/marketPrice.ts (bei dem fuer Sets, wo sie
    hingehoerten) bzw. in clients/rebrickable.ts.

Bleibt die Liste leer, ist das die Aussage. Wird ein Eintrag noetig, gehoert
er hierher — mit Grund, nicht als stille Duldung.
```

<a id="erlaubtohnerouter"></a>
## `const erlaubtOhneRouter = {`

```text
── Woher diese Pruefung kommt ───────────────────────────────────────────
routes/thumbs.ts enthielt keine einzige Route. Der Ordnername sagte damit
etwas Falsches ueber den Inhalt — und weil die Datei dort lag, mussten
sechs Fachdateien aus der aeussersten Schicht importieren.

Zwei Dateien in routes/ definieren ebenfalls kein `router.<methode>`,
gehoeren aber dorthin, jede aus einem eigenen Grund. Sie stehen deshalb
hier mit Begruendung statt als stille Ausnahme.
```
