# Begründungen zu `utils/dateiAusliefern.ts`

Die ausführlichen Kommentare aus `utils/dateiAusliefern.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="dateifehler"></a>
## `DateiFehler`

```text
Eine Datei ausliefern — und einen Fehler dabei auf die RICHTIGE Antwort
abbilden.

── Der Befund, aus dem diese Datei kam ─────────────────────────────────────

Marcos Meldung: „Nach ein paar Mal die Anleitung abrufen aus der App
erscheint folgende Meldung" — „Fehler beim Laden: HTTP 404".

Die Anleitung lag die ganze Zeit da. Der Weg dorthin:

  1. Der PDF-Viewer der App laedt fortsetzbar: Liegt schon etwas im Cache,
     schickt er `Range: bytes=<vorhanden>-` und haengt den Rest an.
  2. Nach einem VOLLSTAENDIGEN Download ist `vorhanden` genau die
     Dateigroesse. Der Bereich beginnt damit HINTER dem letzten Byte.
  3. `send` (unter res.sendFile) beantwortet das mit 416 — korrekt: „diesen
     Bereich gibt es nicht".
  4. Die Route hier bildete JEDEN Fehler auf 404 ab. Aus „dein Bereich ist
     zu gross" wurde „die Datei gibt es nicht".

NACHGEMESSEN an derselben Express- und send-Fassung, die der Server
benutzt (express 4.22.3, send 0.19.2), mit einer 5000-Byte-Datei:

    ohne Range              -> 200
    Range bytes=0-          -> 206
    Range bytes=2500-       -> 206
    Range bytes=5000-       -> 404   ← mit dem alten Callback
    Range bytes=5000- ohne Callback -> 416

Der Callback war also die einzige Ursache fuer die falsche Zahl. Die
eigentliche Ursache der FEHLGESCHLAGENEN ANZEIGE liegt in der App (sie
darf einen fertigen Download nicht fortsetzen wollen) und ist dort
behoben — aber eine 404 fuer eine vorhandene Datei ist fuer sich genommen
falsch und hat die Suche in die falsche Richtung geschickt. Beides gehoert
repariert, nicht nur eines.

── Warum nicht einfach den Callback weglassen ──────────────────────────────

Ohne Callback antwortet Express selbst — mit einer HTML-Fehlerseite und,
schlimmer, indem es den Fehler an den naechsten Fehler-Handler weiterreicht.
Der Callback ist richtig; nur sein Inhalt war es nicht.
```
