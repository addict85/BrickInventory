# Begründungen zu `test/ci-rote-tests.test.js`

Die ausführlichen Kommentare aus `test/ci-rote-tests.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Annotation fuer einen roten Test traegt die BEGRUENDUNG, nicht nur den
Namen.

── Woher dieser Test kommt ─────────────────────────────────────────────────

Ein Lauf auf main war rot, genau ein Test. Ueber die API abrufbar war:

    [failure] Roter Test
    Sitzung: gelesen wird immer, geschrieben nur alle paar Minuten (3178ms)

Der Name, sonst nichts. DASS er rot war, stand fest; WARUM nicht — und die
Suche ging eine halbe Stunde ins Leere. Die Begruendung lag die ganze Zeit im
Joblog (der Schritt schreibt sie mit `grep -A 12` dorthin), nur ist das
Joblog von aussen nicht zu holen: GitHub liefert es ueber einen anderen Host,
und der Proxy lehnt die Weiterleitung mit 403 ab.

Das ist dieselbe Fehlerart, gegen die der Workflow schon zwei Absaetze
enthaelt („Klartext im Protokoll reicht NICHT") — sie war nur eine Zeile zu
hoch behoben.

── Warum das geprueft werden MUSS ──────────────────────────────────────────

Der Schritt laeuft unter `if: failure()`. Er wird also genau dann zum ersten
Mal ausprobiert, wenn schon etwas anderes kaputt ist — und dann ist keine
Zeit, ihn zu reparieren. Ein Diagnosewerkzeug ohne eigenen Test ist der am
wenigsten gepruefte Teil eines Workflows.
```
