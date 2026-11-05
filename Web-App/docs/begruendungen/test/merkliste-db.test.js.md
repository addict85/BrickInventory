# Begründungen zu `test/merkliste-db.test.js`

Die ausführlichen Kommentare aus `test/merkliste-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Merkliste — gegen eine echte Datenbank.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Eine Merkliste. Aus dem Katalog sollen in der Detailansicht Sets in die
Merkliste hinzugefügt werden können inkl. Zustand und einem Preisalarm.
In der Merkliste soll analog den Sets, neue Einträge per Barcodescanner
oder Setnummern hinzugefügt werden können. In der Merkliste sollen
Einträge gelöscht oder direkt in die Galerie übernommen werden können."

Dazu Marcos zwei Festlegungen auf Rückfrage:
  * Der Kontenbaum gilt wie überall — der Grossvater sieht die Enkel.
  * Bei der Übernahme verschwinden Eintrag UND Preisalarm.

── Warum mit DB ────────────────────────────────────────────────────────────

Jede dieser Aussagen ist eine Aussage über DATEN, und keine davon lässt
sich am Quelltext prüfen:

  1. Ein Merkposten ist KEIN Besitz — er darf in `sets` nichts anlegen, sonst
     zählte er in Galerie, Portfolio und Finanzen mit.
  2. Neu und gebraucht sind zwei Merkposten, nicht einer.
  3. Die Übernahme legt das Set über addSet() an — mit Erfassungszeile.
  4. Danach sind Merkposten UND Alarm weg.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="uebrig"></a>
## `const uebrig = (await W.merkpostenVon([U.enkel], '10276-1')).map(w => `

```text
Genau der U-Merkposten ist weg. Der N-Merkposten auf dasselbe Set bleibt
stehen — er ist ein ANDERER Merkposten, und genau dafuer steht der Zustand
im Schluessel.

Die erste Fassung dieser Zusicherung zaehlte stumpf auf 0 und war rot,
obwohl der Code recht hatte: Sie hat den N-Merkposten mitgezaehlt. Eine
Zahl, die zwei Dinge zusammenfasst, sagt nicht, welches davon schiefging.
```

<a id="fs-stelle"></a>
## `const fs = require('node:fs');`

```text
Marcos zwei Befunde in einem Test:

  „Die Bilder in der Merkliste werden nicht geladen. Anscheinend wird
   direkt das CDN aufgerufen."
  „Leider wird es auch nach ein paar Minuten noch über den Proxy
   geladen … als würde das Bild nicht im Hintergrund heruntergeladen."

Beides hing an derselben Lücke: Die Merkliste war die einzige Liste
ohne image_local, und eine Notiz für den Bild-Job entsteht im Proxy nur
bei einer VORSCHAU-Anfrage (routes/imgProxy.ts) — das Detail fragt die
volle Auflösung.
```
