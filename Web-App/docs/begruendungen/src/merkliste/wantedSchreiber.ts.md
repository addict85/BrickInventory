# Begründungen zu `src/merkliste/wantedSchreiber.ts`

Die ausführlichen Kommentare aus `src/merkliste/wantedSchreiber.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="postenergebnis"></a>
## `PostenErgebnis`

```text
Was aus einem Posten geworden ist.

── Warum hier Bild und Name mitreisen (Marcos Vorschau) ───────────────────

  „noch besser wäre wenn es beim Import die zu importierende Liste
   vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
   Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
   rebrickable ids ergänzen könnte"

Eine Vorschau, die nur Nummern zeigt, ist keine. Wer 224 Posten prüfen
soll, erkennt am BILD in einer Sekunde, dass Posten 57 der falsche Stein
ist — an „3001 → 3001, katalogtreffer" erkennt er es nie.

Die Beschreibung kommt aus den KATALOGEN dieses Baums, ohne jeden Abruf
(siehe beschreibePosten). Was dort fehlt, bleibt leer statt geraten.
```

<a id="postenergebnis-2"></a>
## Abschnitt

```text
Derselbe Grund als Kennung, für die Oberfläche.

`grund` ist ein deutscher Satz — richtig fürs Protokoll, falsch in einer
englischen Tabelle. Die Kennung lässt die Oberfläche den Text in der
Sprache des Betrachters setzen; `blFarbe` steht in der Zeile und kann
dort eingesetzt werden.

Ein Fehler beim Anlegen hat keine Kennung: Dort steht die Meldung der
Ausnahme, und die lässt sich nicht in Fälle einteilen.
```

<a id="anleger"></a>
## `Anleger`

```text
Die drei Anleger, die der Import braucht.

Als Schnittstelle und nicht als Einfuhr: So kennt diese Datei nur die FORM
(„etwas, das ein Teil anlegt") und nicht den Ort. Die Route steckt die
echten Funktionen hinein; ein Test könnte Zähler hineinstecken.

Die Reihenfolge der Parameter folgt den echten Funktionen, damit das
Hereingeben eine Zuweisung bleibt und keine Übersetzung: addManualPart und
addManualFig nehmen (uid, body), addSet nimmt die Setnummer zuerst — daher
die eigene Form für `set`.
```

<a id="importierewantedliste"></a>
## Abschnitt

```text
Eine eingetragene Rebrickable-Nummer MERKEN.

Hereingegeben und nicht hier gerufen — dieselbe Begründung wie beim
Anleger, nur milder: merkeBlNummer liegt unter utils/ und wäre von hier
aus erreichbar. Sie als Rückruf zu nehmen hält diese Funktion aber
schreibfrei bis auf den Anleger, und ein Test kann zählen, was gemerkt
wurde, ohne eine Datenbank dafür zu brauchen.

Nur beim ECHTEN Import, nie in der Vorschau: Eine Vorschau, die etwas
speichert, ist keine.
```

<a id="importierewantedliste-grund"></a>
## `grund`

```text
── Eine Farbe, die sich nicht abbilden laesst, wird NICHT erfunden ────

Marcos Befund vom 19.10.: „Die Farbe wurde nicht immer uebernommen und
die Teile sind nun mehrfach vorhanden (bsp 3001)."

Hier stand `color_id: a.rbFarbe ?? 0`. Die 0 ist bei Rebrickable aber
SCHWARZ und nicht „keine Farbe" — die Warnung steht woertlich in
routes/parts.ts („fuer die Bildsuche fatal: 0 ist bei Rebrickable
SCHWARZ"). Ein Posten mit unbekannter Farbe landete damit als
schwarzes Teil im Bestand, NEBEN demselben Teil in seiner richtigen
Farbe. Das ist das Doppelte, das Marco sieht.

NACHGESTELLT: Liste mit 3001 in BL-Farbe 5 (abbildbar) und BL-Farbe 85
(nicht abbildbar) ergab zwei Zeilen, color_id 4 und color_id 0.

Der Bericht wusste es die ganze Zeit — `farbeOffen` zaehlt genau diese
Posten — und schrieb sie trotzdem. Jetzt bleiben sie OFFEN, mit Grund.
Damit fehlt der Posten im Bestand, statt falsch darin zu stehen; die
Vorschau (Stufe 3) gibt Marco die Gelegenheit, die Farbe zu setzen.
── Der Grund kommt ZWEIMAL: als Satz und als Kennung ─────────────────

Der Satz ist für das Protokoll und für jeden Aufrufer, der nur lesen
will. Die Kennung ist für die Oberfläche: Sie zeigt den Grund in der
Sprache des Betrachters, und ein deutscher Satz in einer englischen
Tabelle ist genau das, was dabei herauskam, bevor es sie gab (am
laufenden Server gesehen: „open / BrickLink-Farbe 85 ist im Katalog
keiner Rebrickable-Farbe zugeordnet" zwischen lauter englischen
Spalten).

Dieselbe Teilung wie bei src/infra/fehlerTexte.ts: EINE Entscheidung, zwei
Sprachen am Rand.
```

<a id="importierewantedliste-4"></a>
## Abschnitt

```text
── Eine NACHGESCHLAGENE Nummer wird GEMERKT ──────────────────────

Marcos Bitte war „rebrickable ids ergänzen" — und wer sie einmal
eingetragen hat, soll sie beim nächsten Import nicht wieder
eintippen. Gemerkt wird in bl_zuordnung; dort liest loeseLokalAuf
sie als Stufe 1 ('zuordnung') wieder, also als Abbildung und nicht
als Vermutung.

── Warum 'rebrickable' dazugehört (Marcos Frage vom 20.10.) ──────

  „wenn das gleiche xml-File 2x importiere sollte der 2. Lauf massiv
   schneller sein korrekt?" … „Wieso wird das Mapping BL zu Rebr.
   nicht gespeichert?"

Hier stand allein 'korrigiert', begründet mit: „Die anderen Stufen
kommen schon von dort oder aus dem Katalog." Das trifft auf drei der
vier anderen zu — 'zuordnung' und 'gleich_vermerkt' stehen schon in
bl_zuordnung, 'katalogtreffer' ist wirklich geraten. Auf
'rebrickable' trifft KEINES von beidem zu: Sie steht nirgends, und
sie ist nicht geraten. Die Stufe ist beim Aufzählen schlicht unter
„die anderen" gefallen.

GEMESSEN: dieselbe Datei zweimal importiert, mit einem Zähler auf
dem Rebrickable-Client. Lauf 1 zwei Abrufe, Lauf 2 noch EINER —
`blTeilZuRb 98765`, obwohl die Antwort beim ersten Mal schon dastand.
bl_zuordnung war nach beiden Läufen leer. Bei einer Liste mit 224
Posten kostet jeder weitere Lauf dieselben 1,5 Sekunden je Posten
mit abweichender Nummer, und jedes Mal aus dem Tageskontingent.

Dass es eine Abbildung ist und keine Vermutung, steht an blTeilZuRb
selbst: „Jeder Treffer muss in seinen external_ids.BrickLink die
GESUCHTE Nummer tragen" — nachgeschlagen und gegengeprüft, nur von
Rebrickable statt von Hand.

NICHT gemerkt wird weiterhin ein Posten, den auch Rebrickable nicht
auflösen konnte: Er steht gar nicht hier (er ist 'offen' und wird
nie angelegt), und ein „nachgesehen, nichts gefunden" kennt
bl_zuordnung nicht — die Tabelle führt Abbildungen, keine
Fehlanzeigen. Diese Posten kosten jeden Lauf erneut einen Abruf.

Ein Fehlschlag hier bricht den Import nicht ab: Der Posten steht im
Bestand, und das ist die Hauptsache. Die Notiz ist Bequemlichkeit.
```

