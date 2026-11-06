# Begründungen zu `core-model/data/model/GutscheinModels.kt`

Die ausführlichen Kommentare aus `core-model/src/main/java/ch/brickinventoryapp/data/model/GutscheinModels.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="gutschein"></a>
## `Gutschein`

```text
LEGO-Geschenkkarten im eigenen Profil. Die Modelle spiegeln genau das, was
routes/api_v1/vouchers.ts ausgibt — keine eigene Form, keine Umbenennung —, weil
beide Apps dieselben Dienste des Backends verwenden; was hier anders hiesse,
müsste die Webapp nachziehen.

Der Betrag ist ein Double: NUMERIC(12,2) käme vom pg-Treiber als Zeichenkette,
`fuerAussen()` in vouchers.ts macht daraus eine Zahl. Für die Anzeige genügt
Double — ein Gutschein hat zwei Nachkommastellen und wird gezeigt, nicht
gerechnet.
```

<a id="guthabenantwort"></a>
## `GuthabenAntwort`

```text
Die Antwort der Guthaben-Abfrage.

`angezeigt` ist der formatierte Text der LEGO-Seite („CHF 250.00“) — nur zur
Anzeige, nicht gespeichert: Er steht in der Schreibweise des Ausgabelandes, die
App formatiert selbst.

`wartenSek` und `grund` kommen bei HTTP 429: Der Server erlaubt höchstens eine
Abfrage je 30 Sekunden über alle Benutzer. Die App wartet nicht selbst, sie
zeigt den Satz des Servers. Die Felder stehen trotzdem hier, weil
`ignoreUnknownKeys` sie sonst still wegwürfe.
```
