# Begründungen zu `core-ui/ui/screens/KameraErlaubnis.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/screens/KameraErlaubnis.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kameraueberlagerung"></a>
## `KameraUeberlagerung`

```text
Die Überlagerung über dem Kamerabild: Rahmen in der Mitte, darunter ein dunkles
Schild mit dem Hinweistext — eine Gestaltung für Barcode-Scanner und QR-Aufbau
(Gewichtung 0.2 / 0.8, damit der Rahmen etwas über der Mitte sitzt; Schwarz mit
72 % Deckung, Formen.kachel, weisse Schrift in 13 sp). Nur der Rahmen ist
verschieden: ein breites Rechteck mit Eckwinkeln für den Strichcode, ein Quadrat
für den QR-Code.

@param rahmen Was in der Mitte steht; bekommt den ColumnScope, damit ein Rahmen
        sich darin ausrichten kann.
@param unten  Was unter dem Schild noch dazugehört — im Barcode-Scanner der
        Lampenknopf, im QR-Aufbau nichts. Den Abstand nach oben setzt der
        Aufrufer, weil nur er weiss, ob etwas kommt.
```
