# Begründungen zu `app/ui/components/ZertifikatDialog.kt`

Die ausführlichen Kommentare aus `app/src/main/java/ch/brickinventoryapp/app/ui/components/ZertifikatDialog.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="zertifikatdialog"></a>
## `ZertifikatDialog`

```text
Die Frage nach einem Zertifikat, das die App nicht von selbst annimmt. Der
Fingerabdruck steht in derselben Schreibweise da wie in der Webapp, damit man
ihn vergleichen kann. Ohne öffentliche CA oder bei geändertem Schlüssel gilt er erst,
wenn man ihn aus einer zweiten Quelle abschreibt, und steht hier nur angefangen da —
dort prüft sonst niemand die Kette, und ein Tipp wird zur Gewohnheit eines Angreifers.
[onVertrauen] bekommt die Eingabe und sagt, ob sie passte.
```
