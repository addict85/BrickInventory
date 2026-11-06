# Begründungen zu `test/entrypoint-start.test.js`

Die ausführlichen Kommentare aus `test/entrypoint-start.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="der-start-sagt-was-er-tut"></a>
## `test('der Start sagt, was er tut', () => {`

```text
Der Start des Containers schweigt nicht, und er arbeitet nicht umsonst.

── Marcos Befund ───────────────────────────────────────────────────────────
„Das Docker-Image scheint allgemein extrem lange zu benoetigen bis es
startet. Die anderen sind viel schneller gestartet. Meist dauert es um die
5min bis der 1. Log-Eintrag erscheint."

── Die Beweiskette ─────────────────────────────────────────────────────────
Die erste Zeile des Servers steht unmittelbar nach den Importen, und
console.log schreibt synchron nach stdout (server.ts, _intercept). Minuten
ohne Ausgabe koennen also nicht vom Server kommen — sie kommen von dem, was
VOR ihm laeuft. Dazwischen stand genau ein Schritt, der mit der Zahl der
Dateien waechst: `chown -R` ueber das ganze Datenverzeichnis, bei jedem
Start, obwohl nach dem ersten Mal alles laengst richtig ist.
```

<a id="stelle"></a>
## `assert.match(ep, /MARKE=\/app\/data\/\.\w+/,`

```text
── Marcos Rueckfrage ────────────────────────────────────────────────────
„Kann dieser Schritt mit den Dateien nicht erfolgen nachdem der Server
gestartet ist?"

Durch den Server nicht: Er laeuft via su-exec als brickinv und darf nicht
chownen. Die Frage DAHINTER — warum kostet ein normaler Start ueberhaupt
etwas? — hat aber eine bessere Antwort als Nebenlaeufigkeit: gar nicht
erst suchen.

Die Suche schreibt zwar nichts, laeuft aber ueber jede Datei. Auf einem
Netzlaufwerk ist schon das Durchgehen teuer: jede Abfrage ein Paket.
Deshalb eine Marke — nach einem erfolgreichen Durchgang steht die Ziel-UID
in einer Datei, und der naechste Start liest sie statt zu suchen.
```
