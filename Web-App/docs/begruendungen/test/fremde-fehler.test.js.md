# Begründungen zu `test/fremde-fehler.test.js`

Die ausführlichen Kommentare aus `test/fremde-fehler.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `/** 'vonUns' woertlich aus 08-init.js holen und mit gestelltem Ursprun`

```text
Das Auffangnetz faengt nur UNSERE Fehler.

── Der Befund aus dem Betrieb ──────────────────────────────────────────────

Marcos Konsole zeigte, rot und mit unserem Bundle als Quelle:

    [promise] i: Failed to connect to MetaMask
    Caused by: Error: MetaMask extension not found
      at inpage.js:4:42708

MetaMask ist eine Browser-Erweiterung und hat mit BrickInventory nichts zu
tun. Der Lauscher in 08-init.js hoert aber am FENSTER, und dort landet jede
unbehandelte Ablehnung der Seite. Wir haben sie als unsere protokolliert —
und Marco dazu eine Meldung „Unerwarteter Fehler" angezeigt. Er sollte also
einen Fehler unserer Anwendung sehen, weil SEINE Wallet-Erweiterung ihre
Wallet nicht fand.

── Warum das mehr ist als Kosmetik ─────────────────────────────────────────

Dieselbe Ueberlegung wie beim leeren Bildquell eine Runde vorher: Ein
Warnzeichen, das regelmaessig ohne Anlass erscheint, wird nicht gelesen.
Hier trifft es zusaetzlich den Benutzer und nicht nur die Konsole.

── Warum der Test die FUNKTION laufen laesst ───────────────────────────────

Ein Nachbau der Regel im Test prueft den Nachbau. Deshalb wird `vonUns`
woertlich aus der Quelldatei geschnitten und ausgefuehrt — mit gestelltem
`location`, weil es im Browser lebt.
```

<a id="ordner"></a>
## `const ordner = path.join(__dirname, '..', 'public', 'js');`

```text
── Der zweite Befund aus derselben Konsole ──────────────────────────────

  [showApp] called, scheduling gibCheckOnLoad
  [gibCheckOnLoad] firing

Zwei console.log aus einer Fehlersuche, die im Betrieb stehen geblieben
sind. Keine Fehler — aber sie stehen zwischen den echten Meldungen.

Geprueft wird die Form, nicht eine Liste von Namen: `console.log` mit
einem Text in eckigen Klammern ist das Muster, in dem hier
Fehlersuchspuren geschrieben werden.
```
