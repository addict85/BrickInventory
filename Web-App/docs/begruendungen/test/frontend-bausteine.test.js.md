# Begründungen zu `test/frontend-bausteine.test.js`

Die ausführlichen Kommentare aus `test/frontend-bausteine.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wiederkehrende Ansichtsteile stehen an EINER Stelle.

── Der Befund ──────────────────────────────────────────────────────────────
Die 01-Module sammeln WERKZEUGE: Escaping, Bild-URLs, Formatierung, Toasts,
Theme. Was fehlte, waren Bausteine für die ANSICHT — und die standen deshalb
als HTML-Zeichenkette in jedem Modul neu:

  Detailzeile   15× in vier Modulen
  Ladeanzeige    5× in vier Modulen

Wer die Detailzeile ändern will — Abstand, Trennlinie, Verhalten auf dem
Telefon —, musste alle fünfzehn finden. Und wer eine neue Detailansicht
baute, schrieb die sechzehnte ab, samt der Frage, ob `dl` oder `dt` die
richtige Klasse war.

── Was hier geprüft wird ───────────────────────────────────────────────────
Das Markup steht nur noch in 01-bausteine.js. Gefunden statt aufgezählt: Ein
neues Modul, das die Zeile wieder von Hand schreibt, fällt auf.

KEIN Test auf den Wortlaut der Klassennamen — `dr`/`dl`/`dv` sind eine
innere Angelegenheit des Bausteins und dürfen sich ändern, solange CSS und
Baustein zusammenpassen.
```
