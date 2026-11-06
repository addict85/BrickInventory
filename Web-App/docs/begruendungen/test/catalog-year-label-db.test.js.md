# Begründungen zu `test/catalog-year-label-db.test.js`

Die ausführlichen Kommentare aus `test/catalog-year-label-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das Jahres-Etikett am Scrollbalken nennt das Jahr, das dort WIRKLICH steht.

── Marcos Befund ───────────────────────────────────────────────────────────
„Wenn dann die Bilder geladen werden, erscheinen sie von einem anderen Jahr,
als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von 1999
geladen, obwohl rechts 1965 steht."

── Die Annahme, die niemand ausgesprochen hatte ────────────────────────────
Das Etikett rechnete die Position LINEAR auf den Jahresbereich um — als läge
zwischen 1949 und 2027 in jedem Jahr gleich viel. Tatsächlich stammt der
weitaus grösste Teil des Katalogs aus den letzten Jahrzehnten. Wer neun
Zehntel hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.

Gemessen an einer schiefen Verteilung wie im echten Katalog (1960–1969 je 2
Sets, 1990–1999 je 20, 2010–2019 je 100):

    Position   dort steht   Etikett neu   Etikett alt (linear)
         25%         2016          2016                   2004
         50%         2013          2013                   1990
         75%         2010          2010                   1975
         90%         1995          1995                   1966

── Was dieser Test prüft ───────────────────────────────────────────────────
Nicht die Verteilung für sich, sondern dass sie TRIFFT: Zu jeder Position
wird das Set an dieser laufenden Nummer aus der echten Liste geholt und sein
Jahr mit dem verglichen, was das Etikett sagen würde. Ein Test auf „die Route
liefert Jahre" hätte die lineare Schätzung nie auffliegen lassen.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```
