# Begründungen zu `public/js/08-init.js`

Die ausführlichen Kommentare aus `public/js/08-init.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="letztefehlermeldung"></a>
## `_letzteFehlermeldung`

```text
Auffangnetz für Fehler, die niemand behandelt.

── Wozu ────────────────────────────────────────────────────────────────────
api() liefert inzwischen bei jedem Fehlschlag ein Objekt statt zu werfen
(siehe 01-core.js), damit die bestehenden success/error-Pfade greifen. Das
deckt den Regelfall ab — aber nicht einen Programmierfehler in einem
Rückruf, einen fehlgeschlagenen Aufruf ausserhalb von api() oder ein
Promise, das niemand einsammelt. Ohne dieses Netz endet so etwas
ausschliesslich in der Browser-Konsole: Der Benutzer klickt, nichts
passiert, und niemand erfährt, dass etwas kaputt war.

Eine sichtbare Meldung ist hier nicht Selbstzweck: Sie unterscheidet für den
Benutzer „hat nicht funktioniert" von „hat nichts getan" — und im
Fehlerbericht steht dann eine Beobachtung statt „irgendwie ging es nicht".

Bewusst knapp gehalten: eine kurze Meldung, die Einzelheiten bleiben in der
Konsole. Und höchstens eine alle fünf Sekunden — ein Fehler in einer
Schleife soll den Bildschirm nicht zupflastern.
```

<a id="vonuns"></a>
## `vonUns`

```text
Stammt der Fehler aus UNSEREM Code?

── Der Befund aus dem Betrieb ──────────────────────────────────────────────

Marcos Konsole zeigte (rot, aus app.bundle.js):

    [promise] i: Failed to connect to MetaMask
    Caused by: Error: MetaMask extension not found
      at inpage.js:4:42708

Das Auffangnetz unten hoert am FENSTER, und dort landet jede unbehandelte
Ablehnung der Seite — auch die einer Browser-Erweiterung, die mit
BrickInventory nichts zu tun hat. Wir haben sie als unsere protokolliert
und Marco dazu eine Meldung „Unerwarteter Fehler" angezeigt. Er sollte also
einen Fehler unserer Anwendung sehen, weil seine MetaMask-Erweiterung ihre
eigene Wallet nicht fand.

── Woran man es unterscheidet ──────────────────────────────────────────────

Am Aufrufstapel. Unsere Bilder liegen alle unter unserem Ursprung; eine
Erweiterung bringt `chrome-extension://…` oder `moz-extension://…` mit.
Traegt der Stapel KEINE einzige Adresse von uns, ist es nicht unserer.

Im Zweifel unserer: Ohne Stapel (etwa `Promise.reject('kaputt')`) und ohne
erkennbare Adresse wird weiter gemeldet. Ein verschwiegener eigener Fehler
waere der teurere der beiden Irrtuemer — genau darum gibt es dieses Netz.
```

<a id="zusammengefasst-wird-nach-der-rebrickabl"></a>
## `key`

```text
── Zusammengefasst wird nach der REBRICKABLE-Nummer ─────────────

Marcos Frage: „Kann der Abgleich im Hintergrund nicht über die
Rebrickable ID erfolgen, die Anzeige aber weiterhin über die
BrickLink ID?" — Ja, und genau hier lag der Fehler.

Hier stand `${blNum}|…`. Zusammengefasst wurde also nach der
BrickLink-Nummer, nachgefragt wird der Bestand aber mit der
REBRICKABLE-Nummer (plRenderTable: data-key). Mehrere
Rebrickable-Teile teilen sich regelmässig EINE BrickLink-Nummer —
Formvarianten sind genau das. Für die fielen zwei Zeilen zu einer
zusammen: Der BEDARF beider addiert, gesucht wurde aber nur nach
der Nummer, die zufällig zuerst kam. Das Teil galt als fehlend,
obwohl es im Bestand lag.

Angezeigt wird weiterhin die BrickLink-Nummer (der Titel nennt
die Rebrickable-Nummer daneben), und der BrickLink-Export fasst
ohnehin selbst noch einmal zusammen — `blMap` in
plExportBricklink schlüsselt nach `type|partNum|colorId`. Die
feinere Aufteilung hier kostet dort also nichts.
```

<a id="plfuellebestand"></a>
## `plFuelleBestand`

```text
„Kann ich das bauen?" — die Spalte „Vorhanden" aus dem eigenen Bestand füllen.

── Warum das hier und nicht als eigene Ansicht steht ────────

Die Teileliste hatte die Spalte schon, nur als leeres Feld: Man trug von
Hand ein, was man besitzt, und die BrickLink-Wunschliste zog es vom Bedarf
ab. Es fehlte also nicht die Ansicht, sondern nur die Antwort auf „was davon
habe ich schon?". Eine zweite Ansicht daneben hätte dieselbe Tabelle noch
einmal gebaut — und zwei Orte geschaffen, an denen sich die Rechnung
unterscheiden kann.

── Die Zahl überschreibt, was von Hand dasteht ─────────────────────────────

Absicht: Der Knopf heisst „eintragen", nicht „ergänzen". Wer ihn drückt,
will den gemessenen Stand, nicht eine Summe aus Schätzung und Messung. Die
Eingabefelder bleiben danach von Hand änderbar.
```

<a id="blcolorid"></a>
## `blColorId`

```text
── Kein Rückfall auf die REBRICKABLE-Nummer ─────────────────────────

Hier stand `… ?? p.color_id ?? 0`. Fehlte die Zuordnung, ging damit
die Rebrickable-Farbnummer als BrickLink-Farbnummer hinaus — eine
gültige Datei mit der FALSCHEN Farbe. Das ist der Fehler vom 19.10.
spiegelverkehrt: Dort wurde beim Import eine Farbe erfunden, hier
würde eine falsche bestellt.

Leer heisst jetzt „unbekannt". plExportBricklink lässt solche Posten
weg und NENNT sie, statt zu raten.
```

<a id="ohnefarbe"></a>
## `ohneFarbe`

```text
── Posten OHNE bekannte BrickLink-Farbe gehen NICHT mit ────────────────

Sie werden genannt. Eine geratene Farbnummer ergibt eine gültige Datei,
die das falsche Teil bestellt — und das fällt erst auf, wenn das Paket da
ist. Dieselbe Regel wie beim Import (src/merkliste/wantedListe.ts): Was sich
nicht abbilden lässt, bleibt offen und wird gesagt.

Minifiguren (Typ M) haben keine Farbe und sind deshalb nie betroffen.
```

<a id="bricklink-weist-eine-datei-ueber"></a>
## `if`

```text
── Eine Datei oder mehrere ─────────────────────────────────────────────

BrickLink nimmt höchstens BL_UPLOAD_MAX_BYTES je Upload und weist eine
grössere Datei GANZ ab. Passt alles in ein Stück, bleibt es beim alten
Verhalten: in einem neuen Tab öffnen, damit man den Text kopieren kann.
Sonst werden die Stücke heruntergeladen — ein Tab je Stück wäre ein
Popup-Gewitter.
```
