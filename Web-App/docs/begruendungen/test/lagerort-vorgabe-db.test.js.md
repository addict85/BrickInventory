# Begründungen zu `test/lagerort-vorgabe-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-vorgabe-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Lagerort-VORGABE gegen eine echte Datenbank.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Weiter möchte ich ein Lagerort in den Einstellungen als Default setzen
 können. Der soll dann bei einer Neuerfassung bereits vorausgewählt sein.
 Ich stelle mir das mit einem Sternicon vor."

── Warum mit DB und nicht am Quelltext ─────────────────────────────────────

Die Vorgabe steht als ID in `user_settings`, der Ort in
`storage_locations`. Die beiden Aussagen, auf die es ankommt, sind
Aussagen über ZEILEN in zwei Tabellen und über das, was beim Umbenennen und
Löschen mit ihnen passiert:

  umbenennen → die Vorgabe bleibt und heisst neu
  löschen    → die Vorgabe ist weg, nicht kaputt

Genau das ist der Grund, aus dem die ID gespeichert wird und nicht der Name
(begründet in src/bestand/lagerort.ts). Mit dem Namen bräuchte es an zwei weiteren
Stellen Code, der mitzieht — und übersähe man eine, zeigte die Vorgabe auf
einen Ort, den die Auswahlliste nicht kennt. Diese Datei ist der Nachweis,
dass es dafür keinen Code braucht.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `await assert.rejects(() => L.setzeVorgabe(U.ich, fremd.id),`

```text
Das Kinderzimmer des Kindes ist nicht mein Regal (Migration 0020). Ohne
diese Grenze stuende mein Stern an einem Ort in einer anderen Wohnung.
Geprueft wird `e.code` und nicht der Text: Der erste Entwurf suchte
„lagerort_unbekannt" in der MELDUNG, und die lautet auf Deutsch
(„Diesen Lagerort gibt es nicht (mehr)"). Die Zusicherung war damit
rot, obwohl die Absage kam — dieselbe Form wie in
lagerort-vorrat-db.test.js, deshalb jetzt auch dieselbe Schreibweise.
```
