# Begründungen zu `core-model/data/model/HaushaltModels.kt`

Die ausführlichen Kommentare aus `core-model/src/main/java/ch/brickinventoryapp/model/data/model/HaushaltModels.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z156"></a>
## z156

```text
Der Kaufpreis einer Erfassungszeile — bei Sets. Der Server liest das Preisfeld
unter dem Namen der Spalte (`req.body[cfg.priceCol]`):

    Sets                    → purchase_price
    Teile und Minifiguren   → unit_price

Bei einem Set ist es der Preis des Sets, bei Teilen und Figuren der Preis je
Stück. Unter dem falschen Namen lässt der Server den Preis still unverändert.
Beide Felder sind nullbar; `fuerSet()` und `fuerStueck()` unten setzen immer
genau eines, das andere geht als null mit (ApiJson schreibt Vorgabewerte).
```

<a id="z174"></a>
## z174

```text
Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile. Der Server
behandelt das Feld vor allen anderen und beendet damit die Anfrage: Preis oder
Datum im selben Aufruf hiesse, die Zeile zweimal zu suchen, beim Empfänger
womöglich schon verschmolzen.

Der Absender wird nicht mitgeschickt: Die Erfassungs-ID ist eindeutig, und wem
die Zeile gehört, ermittelt der Server (acquisitionMoveSource) — ein Client kann
das nicht falsch beantworten. MoveSetRequest behält from_user_id, weil dort
mehrere Zeilen gemeint sind und der Absender Teil der Auswahl ist.
```
