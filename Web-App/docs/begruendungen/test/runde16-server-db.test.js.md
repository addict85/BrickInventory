# Begründungen zu `test/runde16-server-db.test.js`

Die ausführlichen Kommentare aus `test/runde16-server-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Befunde der UI-Prüfung 16, soweit sie am Server liegen, an der echten API:
  - Meldungen kommen als Code und in der Sprache des Anfragenden (M2):
    leere CSV-Datei, Zeilenfehler im Importstand, übersprungene Zeilen.
  - Lagerorte: /v1/storage/locations liefert auch leere Orte, /v1/storage
    nur belegte (M1; die Oberfläche füllt daraus Auswahl und Filter).
  - Ein Kaufpreis in fremder Währung ohne Kurs steht mit Betrag und
    Währung in der Bewertung (M6).
  - Der Katalog zeigt ein Set des Unterkontos als vorhanden, wie die
    Merkliste (niedrig 5).
```
