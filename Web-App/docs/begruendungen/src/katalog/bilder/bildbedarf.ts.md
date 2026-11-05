# Begründungen zu `src/katalog/bilder/bildbedarf.ts`

Die ausführlichen Kommentare aus `src/katalog/bilder/bildbedarf.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="loescheverfallene"></a>
## `loescheVerfallene`

```text
Verfallene Notizen löschen.

── Was der Kommentar behauptete und der Code nicht tat (Nachtrag 121) ──────
Bei NOTIZ_GILT_MS stand „Ältere Notizen als diese verfallen". Sie verfielen
nicht: Die Abfrage des Stapels grenzt nur ein, was sie AUSWÄHLT — gelöscht
wurde nie etwas anderes. Notizen älter als drei Tage blieben also für immer
liegen, zählten weiter in der Kachel (COUNT(*) ohne Frist) und liessen den
Job verstummen, weil die Logzeile an `gesamt > 0` hängt. Von aussen sah das
aus wie eine Warteschlange, die bei einer Zahl stehenbleibt.
```
