# Begründungen zu `feature-teile/ui/screens/FarbWahlFeld.kt`

Die ausführlichen Kommentare aus `feature-teile/src/main/java/ch/brickinventoryapp/teile/ui/screens/FarbWahlFeld.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="farbwahlfeld"></a>
## `FarbWahlFeld`

```text
Die Farbe eines manuell erfassten Teils auswählen — zum Korrigieren, wenn sie
beim Import nicht richtig übernommen wurde.

Nicht die Auswahl aus AddPartDialog: Die hält selbst ein `FarbeAnsicht?` („noch
nichts gewählt“ = null). Hier hat das Teil eine Farbe, sie ist nur falsch; die
aktuelle kommt deshalb von aussen und muss auch anzeigbar sein, wenn die Liste
sie nicht kennt. Dafür [aktuellerName] und [aktuellerHex]: Die Farbliste kommt
über das Netz und kann leer sein (kein Rebrickable-Schlüssel, kein Netz) — dann
steht die heutige Farbe da und die Liste bleibt zu.

Eine Wahl speichert sofort, ohne Ruhezeit — wie die Ortswahl in [LagerortFeld].

@param farben        Auswahl aus /parts/brick-colors; leer heisst „nur die
        heutige Farbe“.
@param aktuell       die Rebrickable-Farbnummer, die das Teil heute trägt.
@param aktuellerName ihr Name, soweit bekannt — sonst steht die Nummer da.
@param onWahl        wird nur gerufen, wenn eine andere Farbe gewählt wird.
```
