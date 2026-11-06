# Begründungen zu `core-ui/util/NumericInput.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/util/NumericInput.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="numericinput"></a>
## `NumericInput`

```text
Zahlenfelder — eine Fassung für Tastatur und erlaubte Zeichen, für Setnummer,
Preise und Anzahlen.

Beides gehört zusammen: Die Tastaturwahl ist eine Bitte an die Tastatur-App,
keine Zusicherung — viele zeigen trotzdem eine Umschalttaste zu Buchstaben, und
über die Zwischenablage kommt alles herein. Ohne Filter landete Text im Feld;
ohne Tastaturwahl müsste man jedes Mal zu den Zahlen wechseln. Die Aufrufer
nehmen immer das Paar.

Der Bindestrich bei der Setnummer bleibt erlaubt: LEGO-Setnummern tragen eine
Variante hinter dem Strich (10179-2, 75192-1), ohne ihn liesse sich nur die
erste erfassen. Die App ergänzt „-1“ nur, wenn keine Variante angegeben ist; das
Zahlenpad zeigt den Strich praktisch überall mit an.
```
