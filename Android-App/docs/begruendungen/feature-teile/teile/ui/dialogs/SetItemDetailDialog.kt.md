# Begründungen zu `feature-teile/ui/dialogs/SetItemDetailDialog.kt`

Die ausführlichen Kommentare aus `feature-teile/src/main/java/ch/brickinventoryapp/teile/ui/dialogs/SetItemDetailDialog.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="setitemdetaildialog"></a>
## `SetItemDetailDialog`

```text
Detail für ein Teil / eine Figur aus einem Set, auf dem Telefon als Blatt von unten:
Bild mit Zoom und die Sets, die es verwenden, mit Link zum Set-Detail. Ein Blatt
statt eines Dialogs, weil Lagerort und Liste Platz brauchen und das Wischen nach
unten schliesst wie überall.

Was er bewusst nicht hat: • Keinen Marktpreis — gewünscht ohne. • Keine
Mengenwahl. Die Zahl entsteht aus den Inventaren der Sets; eine Änderung
verschwände beim nächsten Abgleich. • Keinen Löschknopf. Ein Teil aus einem Set
verschwindet mit dem Set, nicht einzeln.

Gegenstück in der Webapp: public/js/13-acquisition-modals.js,
openSetItemDetail() — dieselbe Reihenfolge, dieselbe Adresse
(/v1/parts/:nr/:farbe/sets bzw. /v1/minifigs/:nr/sets).

@param onOpenSet Öffnet das Set-Detail. Parameter, weil nur der Navigationsgraph
        den NavController kennt — wie `onOpenDetail` in PartsScreen.
```

<a id="kopffarbe"></a>
## `kopfFarbe`

```text
── Lagerort ──

Nur für Teile (kopf.colorId ist bei Figuren null): Eine Minifigur steckt
in ihrem Set, dessen Ort im Set-Detail steht — ein zweiter Ort könnte
auseinanderlaufen. Bearbeitbar wie in der Webapp; das Feld schreibt auf
alle Zeilen dieses Teil-Farb-Paares. Die Auswahlliste gehört dem Besitzer
wie beim Set: Der Kopf führt seine Konten mit (owner_ids).
```
