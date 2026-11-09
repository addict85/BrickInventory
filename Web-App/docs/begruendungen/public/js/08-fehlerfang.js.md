# Begründungen zu `public/js/08-fehlerfang.js`

Die ausführlichen Kommentare aus `public/js/08-fehlerfang.js`, wörtlich. Im Code steht je
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
