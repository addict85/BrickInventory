# Begründungen zu `src/teile/teilFarbeAendern.ts`

Die ausführlichen Kommentare aus `src/teile/teilFarbeAendern.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="farbwechsel"></a>
## `FarbWechsel`

```text
Die Farbe eines manuell erfassten Teils NACHTRÄGLICH ändern.

── Warum es das gibt ───────────────────────────────────────────────────────

Marcos Befund vom 19.10., nach dem Import mehrerer BrickLink-Wanted-Listen:
„Die Farbe wurde nicht immer übernommen und die Teile sind nun mehrfach
 vorhanden (bsp 3001). … Weiter möchte ich die Farbe nachträglich anpassen
 können für den Fall dass diese nicht korrekt geladen wurde."

Der Import legt die Farbe seit dem Fix nicht mehr falsch an (siehe
src/merkliste/wantedListe.ts) — aber Marcos BESTEHENDER Bestand trägt die falschen
Farben schon. Ohne diesen Weg bliebe ihm nur Löschen und neu Erfassen, und
damit wäre die Erfassungshistorie weg (Kaufpreise, Daten).

── Warum es kein einfaches UPDATE ist ──────────────────────────────────────

Dieselbe Teilenummer kann in der ZIELFARBE schon im Bestand stehen — bei
Marco ist das der Normalfall, denn genau daneben steht das Teil ja richtig.
Ein `UPDATE parts SET color_id` läuft dann in den eindeutigen Index
`idx_parts_eindeutig` (user_id, set_number, part_number, color_id) und
scheitert. Zwei Zeilen desselben Teils in derselben Farbe wären auch keine
Lösung — das ist das Doppelte, das Marco gerade loswerden will.

Also: Gibt es die Zielfarbe schon, werden die beiden ZUSAMMENGELEGT, sonst
zieht die Zeile um.

Dasselbe gilt für die Erfassungen, nur eine Ebene feiner: `idx_part_acq_tag_zustand`
ist eindeutig über (user_id, part_number, color_id, Tag). Zwei Erfassungen
vom gleichen Tag — eine in der falschen, eine in der richtigen Farbe —
müssen zu einer addiert werden, nicht nebeneinander stehen.

── Das Bild der neuen Farbe ────────────────────────────────────────────────

`part_color_catalog` führt das Bild je Teil UND Farbe (ein roter 2x4 sieht
anders aus als ein blauer). Für eine Farbe, die noch kein Import gesehen
hat, steht dort keines — die Kachel zeigte nach der Änderung also den
Platzhalter.

Marcos Befund vom 20.10.: „Wenn ich die Farbe der manuell erfassten Teile
ändere wird das Bild nicht aktualisiert." NACHGEMESSEN am laufenden Server:
Vor dem Wechsel trug die Kachel von 3001/Rot das Bild 300121.jpg, nach dem
Wechsel auf Blau keines mehr, und `part_color_catalog` hatte für (3001, 7)
eine Zeile ohne image_url.

Hier stand, der Bildabgleich (jobs/imageQueue.ts) hole es nach. Das war
FALSCH und ist die Korrektur, die dieser Nachtrag am eigenen Kommentar
vornimmt: Jener Job arbeitet Notizen über ANGEFRAGTE Adressen ab
(`image_wanted`) und legt sie lokal ab. Wo gar keine Adresse steht, hat er
nichts zu holen. Die einzige Stelle im Baum, die ein fehlendes Farbbild je
nachgetragen hat, ist backfillPartImages() in
jobs/purchasePriceBackfill.ts — ein Nachlauf beim Serverstart, also nichts,
was eine Farbänderung begleitet.

Deshalb trägt bildNachtragen() es jetzt nach, NACH der Transaktion und in
zwei Schritten: erst aus den eingespielten Set-Teilelisten (lokal, kostet
nichts), dann über Rebrickable (dieselbe Abfrage, die auch das Erfassen von
Hand macht — lookupPart liefert für eine Farbe das Farbbild). Beides
ausserhalb der Transaktion, weil ein Netzabruf darin der falsche Ort wäre:
Er dauert, er kann scheitern, und die Farbe soll sich auch ohne Netz ändern
lassen. Findet sich keines, bleibt es leer und das Ergebnis SAGT das
(`bild: null`) — die Oberfläche schreibt es in die Meldung, statt Marco ein
zweites Mal vor einem leeren Platz stehen zu lassen.

Teile AUS SETS (`source='set'`) sind ausgenommen. Ihre Farbe kommt aus der
Set-Teileliste von Rebrickable; sie dort zu ändern hiesse, die Teileliste
des Sets zu bestreiten, und der nächste Set-Import setzte sie zurück.
```

<a id="bildnachtragen"></a>
## `bildNachtragen`

```text
Das Bild der ZIELFARBE nachtragen — nach der Transaktion, nie darin.

── Die Reihenfolge der Quellen ─────────────────────────────────────────────

1. `set_parts_catalog`. Dieselbe Tabelle führt das Bild ebenfalls je Teil
   UND Farbe, nur zusätzlich je Set. Steckt der Stein in dieser Farbe in
   einem eingespielten Set, ist es dasselbe Bild — lokal, ohne Abruf, und
   oft sogar schon als Datei (`image_local`). Zeilen mit Datei zuerst.
   Diese Reihenfolge steht seit dem 20.10. in katalogTeil()
   (src/katalog/katalogPflege.ts) und nicht mehr hier: addManualPartIntern()
   braucht dieselbe, und zwei Fassungen derselben Staffelung laufen
   auseinander.
2. `lookupPart()`. Derselbe Weg wie beim Erfassen von Hand (routes/parts.ts)
   und beim Nachtrag in jobs/purchasePriceBackfill.ts: Für eine angegebene
   Farbe fragt er den Parts/Colors-Endpunkt, der das FARBBILD liefert. Ohne
   Rebrickable-Schlüssel gibt er sofort null zurück — ohne Netz kostet
   dieser Schritt also nichts.

Geschrieben wird über merkeTeilFarbe(), und das heisst: COALESCE. Ein
bereits dastehendes Bild wird NICHT überschrieben — darum fragt der Schritt
davor auch zuerst, ob überhaupt eines fehlt.

── Was dabei in Kauf genommen wird ─────────────────────────────────────────

Scheitert in lookupPart() der Farb-Abruf, fällt es intern auf
`part_img_url` zurück — das ALLGEMEINE Teilebild, bei vielen Teilen die
weisse Fassung. Das landet dann hier, und wegen des COALESCE bleibt es auch
stehen. Hier KEIN zweites Urteil darüber zu fällen ist Absicht: Dieselbe
Antwort nimmt auch das Erfassen von Hand (routes/parts.ts, addManualPart),
und ein Bild, das wir anders bewerten als die Stelle daneben, wäre eine
zweite Regel für dieselbe Frage. Wieder herauskommt ein solches Bild über
backfillPartImages() in jobs/purchasePriceBackfill.ts — der Nachlauf
schreibt bewusst ÜBERSCHREIBEND und ist genau dafür entstanden.
```
