# Begründungen zu `test/merkliste-filter-db.test.js`

Die ausführlichen Kommentare aus `test/merkliste-filter-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Filter der Merkliste — Suche, Zustand, Sortierung und Inhaber.

── Marcos Vorgabe vom 24.09. ───────────────────────────────────────────────

  „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
   Inhaber."

── Warum gegen eine echte Datenbank ────────────────────────────────────────

Weil die Aussagen alle vier in SQL stehen und keiner davon man am Quelltext
ansieht, ob sie stimmt: ob die Suche den NAMEN aus rb_sets mittrifft (die
Merkliste hält keine Kopie der Stammdaten, siehe Migration 0021), ob die
Parameternummern nach dem Einbau dreier neuer Parameter noch zueinander
passen, ob NULLS LAST greift und ob die Maskierung in LIKE wirkt.

Der Zahlendreher ist dabei die reale Gefahr: merkpostenVon() zählt seine
Platzhalter beim Bauen hoch, und die Währung steht ganz am Ende. Verrutscht
die Reihenfolge, bekäme Postgres die Währung als Setnummer — und liefe
still leer statt zu scheitern.
```

<a id="stelle"></a>
## `await db.run('INSERT INTO rb_sets (set_num, name, year) VALUES ('60000`

```text
Zwei Namen, an denen die Maskierung hängt: einer MIT Prozentzeichen und
einer, der nur „50" enthält. Ohne das zweite Set wäre der Schritt unten
wirkungslos — die Gegenprobe hat genau das gezeigt: Maskierung entfernt,
Prüfung blieb grün, weil „%50%%" im damaligen Bestand nichts anderes traf
als „50%". Eine Prüfung, die nur den einen Fall kennt, unterscheidet ihn
nicht vom anderen.
```

<a id="nachname"></a>
## `const nachName = await M.merkpostenVon(alle, undefined, 'EUR', { sorti`

```text
99999-1 hat keinen Namen (nicht im Katalog).

── Was die Gegenprobe hier GEMESSEN hat ─────────────────────────────

Hier stand „ohne NULLS LAST stünde es bei name_asc ganz oben". Das ist
falsch: Bei ASC ist NULLS LAST die Vorgabe von Postgres — NULLS LAST aus
name_asc zu streichen ändert nichts, und diese Prüfung blieb grün.
Entscheidend ist es bei DESC, wo NULLS FIRST die Vorgabe ist: Genau dort
stünden die Merkposten OHNE Preis ganz oben. Die Angabe steht trotzdem
in allen Zeilen der Tabelle, damit sie sich gleich liest — aber die
Aussage dieses Schritts hängt an price_desc darunter.
```
