# Begründungen zu `core-zustand/ui/Vorwaermen.kt`

Die ausführlichen Kommentare aus `core-zustand/src/main/java/ch/brickinventoryapp/zustand/ui/Vorwaermen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="bildadressendersammlung"></a>
## `bildAdressenDerSammlung`

```text
Die Adressen aller Kacheln der eigenen Sammlung, zum Vorwärmen.

Gesammelt wird hier und nicht in VorschauVorwaermer, weil nur hier der
Kontofilter bekannt ist: Vorgewärmt werden soll die Sammlung, die man zu
sehen bekommt. Der Katalog bleibt draussen — rund 25'000 Sets sprengten die
Ablage und verdrängten ausgerechnet die eigene Sammlung.

Nicht `load…` benannt: Die Funktion füllt keinen Zustand, sie sammelt nur.
```
