# Begründungen zu `feature-konto/ui/screens/EinstellungenKonto.kt`

Die ausführlichen Kommentare aus `feature-konto/src/main/java/ch/brickinventoryapp/ui/screens/EinstellungenKonto.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="geraetecard"></a>
## `GeraeteCard`

```text
Angemeldete Geräte: die ausgestellten Zugänge sehen und aussperren.

Der eigene Zugang hat keinen Knopf: Der Server markiert die Zeile, mit der
gerade gefragt wird, und wer sie entwertet, meldet sich selbst ab. Dafür gibt es
den Abmelden-Knopf am Ende der Seite, der benennt, was er tut.

Datumsangaben über fmtDatum(), weil api_tokens Zeitstempel ohne Millisekunden
liefert und die gemeinsame Fassung damit umgeht (DatumFormatTest). „Nie benutzt“
bekommt einen eigenen Text — ein leeres Feld sähe aus wie ein Fehler.
```
