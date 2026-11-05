# Begründungen zu `test/merkposten-zustand-preislauf-db.test.js`

Die ausführlichen Kommentare aus `test/merkposten-zustand-preislauf-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Welchen Zustand holt der Preislauf für einen Merkposten?

── Woher die Frage kommt ───────────────────────────────────────────────────
Marco: „Die Preise für die Merkliste sollen auch hier benutzerabhängig
sein." Die Währung war es schon (runPriceRefresh liest sie je Nutzer), der
ZUSTAND nicht: Die Schleife bestimmte ihn aus set_acquisitions und der
sets-Zeile — beides hat ein Merkposten nicht. Er fiel damit auf
DEFAULT_PRICE_CONDITION durch, und das ist 'U' (src/finanzen/rechnung/preise.ts).
Gemessen hiess das: Jeder Merkposten wurde als GEBRAUCHT geholt, auch der auf
ein neues Set — und der Verlauf im Merkposten-Detail füllte sich für den
falschen Zustand.

── Warum gegen eine echte Datenbank ────────────────────────────────────────
Die Regel liest aus DREI Tabellen mit einer Vorrangregel zwischen ihnen
(set_acquisitions → sets → wanted). Genau das Zusammenspiel ist die
Aussage; mit erfundenen Zeilen wäre davon nichts geprüft.
```

<a id="stelle"></a>
## `await haeltSet(db, a, '75192-1', 0);  // Menge 0: die Erfassung dahint`

```text
── Bestand ohne Merkposten: der Zustand kommt aus der Erfassung ────────

Hier stand `INSERT INTO sets (… condition) VALUES (…,'U')` und die
Zusage „der gespeicherte Zustand eines eigenen Sets entscheidet
weiterhin". Die Spalte ist mit Migration 0032 weg; entschieden wird
ueber die Erfassung, und die Aussage bleibt dieselbe: Ein gebraucht
gehaltenes Set braucht den Gebraucht-Preis.
```
