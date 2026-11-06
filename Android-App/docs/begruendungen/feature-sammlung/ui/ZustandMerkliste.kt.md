# Begründungen zu `feature-sammlung/ui/ZustandMerkliste.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/ZustandMerkliste.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z16"></a>
## z16

```text
── Der Filter ──

Drei Werte hier; der vierte, der Inhaber, steht wie in jeder Ansicht in
AppUiState.scopeModes — dieselbe Wahl unter demselben Schlüssel wie in Galerie,
Teilen, Minifiguren und Finanzen. Angewandt werden alle am Server: Die
Sortierung nach Marktpreis braucht price_cache, den die App nicht kennt; so
zeigen beide Oberflächen dasselbe.
```

<a id="setnumber"></a>
## `setNumber`

```text
Welches Set dieses Detail zeigt — gesetzt, sobald geladen wird, vor jeder
Antwort. Daran erkennt setzePreisalarm(), dass der Bildschirm offen ist und die
Alarme nachgeladen werden dürfen; das Merkposten-Detail lädt kein SetDetail, an
dem es sonst zu sehen wäre. Nicht `katalog?.setNumber`: Ein Set, das rb_sets
nicht kennt, hat keinen Katalogeintrag, und gerade dort bliebe die Anzeige
stumm.
```
