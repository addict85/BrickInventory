# Begründungen zu `core-ui/ui/components/Ueberdeckungsschutz.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/components/Ueberdeckungsschutz.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ueberdeckungsschutz"></a>
## `Ueberdeckungsschutz`

```text
Berührungen verwerfen, solange ein fremdes Fenster darüber liegt (Tapjacking;
ab Android 12 blockiert das System selbst, betroffen ist Android 11). In einem
Dialog gilt es für dessen Fenster, sonst für die Activity, solange der
Bildschirm steht — nur dort, wo ein untergeschobener Tipp schadet (Konto,
Haushalt, Bestätigungen). App-weit verlören Nutzer von Bildschirmfiltern auf
Android 11 jede Bedienung. Gezählt wie beim Sichtschutz.
```
