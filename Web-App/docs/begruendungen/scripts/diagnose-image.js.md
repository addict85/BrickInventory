# Begründungen zu `scripts/diagnose-image.js`

Die ausführlichen Kommentare aus `scripts/diagnose-image.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bild-Diagnose für EIN Set — wo bricht die Kette?

  node scripts/diagnose-image.js 60445-1

Die leere Kachel hatte in den Nachträgen 36, 37 und 40 drei verschiedene
Ursachen. Damit die vierte nicht wieder erraten werden muss, geht dieses
Skript dieselbe Kette entlang, die auch Webapp und App gehen, und sagt bei
jedem Glied, was es vorfindet:

  1. Was steht in der Tabelle `sets` (je Konto)?
  2. Was steht im gemeinsamen `set_catalog`?
  3. Welche Adresse liefert die API daraus (COALESCE, seit Nachtrag 36)?
  4. Liegt die lokale Datei wirklich da — Original und Vorschau getrennt?
  5. Antwortet die CDN-Adresse, und mit welchem Inhaltstyp?

Nur lesend; es verändert nichts.
```
