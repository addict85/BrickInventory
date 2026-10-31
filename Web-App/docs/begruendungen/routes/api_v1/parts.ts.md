# Begründungen zu `routes/api_v1/parts.ts`

Die ausführlichen Kommentare aus `routes/api_v1/parts.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="get-parts"></a>
## Abschnitt

```text
page_size: der TATSÄCHLICH verwendete Wert, nicht der angefragte.

Vorher spiegelte die Antwort die Anfrage zurück. Die Set-Detailansicht
der App fragt 2000, bekam 500 gedeckelt — und las in der Antwort
„page_size: 2000". Damit konnte kein Client merken, dass Teile fehlen.
Der tatsächliche Wert steht jetzt drin; zusammen mit `total` lässt sich
ablesen, ob eine weitere Seite nötig ist.
`...result` bringt page_size selbst mit — ausdrücklich davorgestellt war
es wirkungslos (der Spread überschrieb es mit demselben Wert). Es hier
stehen zu lassen liest sich, als sicherte die Zeile etwas zu, was in
Wahrheit an getParts hängt.
```

<a id="put-parts-partnumber-colorid-color"></a>
## `put-/parts/:partNumber/:colorId/color`

```text
PUT /api/v1/parts/:partNumber/:colorId/color — die Farbe nachträglich ändern.

Marcos Bitte vom 19.10.: „Weiter möchte ich die Farbe nachträglich anpassen
können für den Fall dass diese nicht korrekt geladen wurde." Begründung,
Zusammenlegen und die Behandlung der Erfassungen stehen an einer Stelle:
src/teile/teilFarbeAendern.ts.

Eine eigene Adresse und nicht ein Feld in PUT /parts/:nr/:farbe: Dort IST
die Farbe Teil der Adresse. Ein `color_id` im Körper derselben Anfrage
hiesse, dass Adresse und Nutzlast dasselbe Ding verschieden benennen.
```

<a id="post-parts-owned"></a>
## `post-/parts/owned`

```text
POST /api/v1/parts/owned — „was davon habe ich schon?"

Nimmt die Teile EINER Teileliste entgegen und antwortet je Teil-Farb-Paar
mit zwei Zahlen: `gesamt` (alles im Blickfeld) und `lose` (nur, was nicht in
einem Set steckt). Welche gilt, entscheidet der Mensch — siehe die
Begruendung an getOwnedQuantities().

POST, obwohl nichts geaendert wird: Eine Teileliste hat weit ueber tausend
Paare, als Abfrageparameter waere die Adresse laenger als jeder Proxy
durchlaesst. Der Kontofilter reist trotzdem als `accounts=` mit — er gehoert
zur Ansicht, nicht zur Nutzlast.
```

<a id="get-parts-partnumber-colorid-price-history"></a>
## `get-/parts/:partNumber/:colorId/price-history`

```text
Preisverlauf eines manuell erfassten Teils, je Zustand getrennt.

Gegenstück zu /api/finance/part-price-history — dieselbe Umsetzung
(utils/priceHistory.ts), damit beide Clients dieselbe Antwort sehen. Vorher
gab es den Verlauf NUR für die Webapp; der Detail-Dialog der App zeigte
deshalb weder Marktpreis je Zustand noch ein Diagramm.

Die Route steht bewusst GANZ UNTEN: Express probiert der Reihe nach, und ein
Muster mit zwei Platzhaltern würde sonst auch auf feste Pfade wie
/parts/manual passen, sobald dort ein zweites Segment stünde.
```

<a id="get-parts-partnumber-colorid-sets"></a>
## `get-/parts/:partNumber/:colorId/sets`

```text
In welchen Sets steckt dieses Teil?

Marcos Wunsch zum Detail-Dialog automatisch erfasster Teile: „Es soll
angezeigt werden, welche Sets dieses Teil verwenden — inkl. Link, um den
Detail-Dialog des Sets öffnen zu können."

Die Abfrage steht in src/bestand/gemeinsam.ts, weil die Figuren-Route
daneben WORT FÜR WORT dieselbe ist (nur Tabelle und Schlüssel wechseln).

Blickfeld, nicht eigenes Konto: Im Haushalt soll auch das Set des
Geschwisterkontos auftauchen, in dem dasselbe Teil steckt — sonst sagt die
Liste etwas anderes als die Teileliste darüber, aus der man kommt.

Steht UNTER /parts/:partNumber/:colorId/price-history aus demselben Grund
wie diese: Express probiert der Reihe nach, und zwei Platzhalter passen
sonst auch auf feste Pfade.
```
