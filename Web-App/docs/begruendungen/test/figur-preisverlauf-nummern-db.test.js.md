# Begründungen zu `test/figur-preisverlauf-nummern-db.test.js`

Die ausführlichen Kommentare aus `test/figur-preisverlauf-nummern-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Preisverlauf einer Minifigur findet ihre Preise auch unter der
BrickLink-Nummer.

── Der Befund ──────────────────────────────────────────────────────────────
Für Teile ist das in Nachtrag 143 beschrieben und behoben: Preise stehen
unter der BrickLink-Nummer, Erfassungen unter der des Benutzers, also
braucht die Abfrage ZWEI Schlüssel. Für Minifiguren stand ein Schlüssel für
beides — und der Kommentar an manualPriceHistory behauptete ausdrücklich,
bei Minifiguren stimmten beide überein.

Sie stimmen nicht überein, sobald eine Figur eine eigene bl_fig_number
trägt. getCurrentFigMarketPrice versucht `[blFigNumber, figNumber]` der
Reihe nach; fetchMinifigPrice legt Cache und Verlauf unter der Nummer ab,
mit der der Abruf geklappt hat. Gesucht wurde unter der Nummer des
Benutzers.

Sichtbar wie bei den Teilen: In der Finanzliste steht ein Marktpreis, im
Detailfenster ein „—", und das Diagramm bleibt leer.

── Warum gegen eine echte Datenbank ────────────────────────────────────────
Die Aussage ist, welche Zeilen eine Abfrage findet. Am Quelltext wäre es die
Frage, ob irgendwo zwei Parameter stehen.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `await haeltFigur(db, uid, OHNE_BL, { menge: 0 });  // Menge 0: die Erf`

```text
── Und die andere Hälfte: die EIGENE Nummer darf nicht wegfallen ───────

Ohne diesen Fall wäre die Regel halb bewiesen: Eine Fassung, die NUR
die BrickLink-Nummer abfragt, käme oben durch. Der Schätzpfad
(estimateFigPriceFromParts) legt aber ausdrücklich unter der Nummer des
Benutzers ab, und ältere Zeilen stammen aus der Zeit vor der
bl_fig_number.
```
