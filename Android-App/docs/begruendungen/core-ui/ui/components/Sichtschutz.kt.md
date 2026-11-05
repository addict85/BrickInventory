# Begründungen zu `core-ui/ui/components/Sichtschutz.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/components/Sichtschutz.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="sichtschutz"></a>
## `Sichtschutz`

```text
Kein Bildschirmfoto, keine Aufnahme und kein Vorschaubild in der App-Übersicht,
solange dieser Bildschirm steht — für Nummer und PIN der Gutscheine. Gezählt,
weil beim Übergang von der Gutscheinseite in ihr PDF beide kurz stehen und das
Ende der ersten den Schutz der zweiten sonst aufhöbe; der Zähler hängt am
Fenster, nicht an der Datei.

Was nicht gesehen werden soll, soll auch nicht untergeschoben angetippt werden:
Darum gehört der Schutz vor Überlagerung dazu ([ueberdeckung]); so kann ihn keine
neue heikle Seite vergessen (sec8 H8). Nur der app-weite Wunsch „Vorschau
verbergen“ lässt ihn weg — app-weit verlören Bildschirmfilter jede Bedienung.
```
