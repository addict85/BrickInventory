# Begründungen zu `test/image-catchup-db.test.js`

Die ausführlichen Kommentare aus `test/image-catchup-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Bilder-Nachlauf deckt ALLE Bildarten ab — und zieht fehlende Vorschauen
nach, nicht nur fehlende Dateien.

── Woher dieser Test kommt (Nachtrag 49) ───────────────────────────────────
Beim Aufräumen nach dem .tmp-Fehler (Nachtrag 48) fielen zwei Lücken auf,
die zusammen erklären, warum ein einmal verpasstes Vorschaubild NIE mehr
entstand:

1. `_fsPathFromLocal()` liess alles ausser `/images/parts/` fallen und gab
   null zurück. Der Lauf war damit faktisch auf Teilebilder beschränkt —
   Set- und Minifiguren-Bilder wurden schon beim Auflösen des Pfades
   verworfen, noch bevor irgendetwas geprüft werden konnte. Er meldete
   trotzdem „fertig".
2. Repariert wurden ausschliesslich fehlende DATEIEN. Lag die Datei vor und
   fehlte nur die Verkleinerung, tat der Lauf nichts.

Beides zusammen hiess: Wer im Monitoring „fehlende Bilder neu laden" drückt,
bekam für Set-Bilder gar nichts — obwohl genau die in der Galerie am
sichtbarsten sind.

Geprüft wird VERHALTEN gegen echte Dateien und echte Datenbank: Bild liegt
da, Vorschau fehlt, Lauf anstossen, Vorschau muss existieren.
```
