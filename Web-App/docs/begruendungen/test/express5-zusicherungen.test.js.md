# Begründungen zu `test/express5-zusicherungen.test.js`

Die ausführlichen Kommentare aus `test/express5-zusicherungen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Zwei Zusicherungen, die der Umstieg auf Express 5 lautlos gekostet haette.

── Woher die kommen ────────────────────────────────────────────────────────

Beim Heben von express 4.22.3 auf 5.2.1 (05.10.) sind zwei Dinge
aufgefallen, die KEIN bestehender Test abgedeckt hat — und beide waeren im
Betrieb aufgefallen, nicht vorher.

── 1. Die Startseite ───────────────────────────────────────────────────────

Express 5 verlangt fuer einen Platzhalter einen Namen. Die naheliegende
Uebersetzung von `app.get('*')` ist `app.get('/*splat')` — und die trifft
die nackte Wurzel NICHT. GEMESSEN gegen express 5.2.1:

  '/*splat'    /  → 404      /start → 200
  '/{*splat}'  /  → 200      /start → 200

Ein Aufruf von https://…/ ohne Pfad ist der Normalfall: das Lesezeichen,
das Symbol auf dem Startbildschirm, jeder erste Besuch. Kein Test hat je `/`
abgerufen — nachgesehen, es war wirklich keiner.

Geprueft wird deshalb die WIRKUNG und nicht die Schreibweise: Das Muster
wird aus server.ts gelesen, auf einem leeren Express registriert und
abgefragt. Wer es auf '/*splat' zurueckdreht, bekommt hier einen 404 — egal
wie die Zeile sonst aussieht.

── 2. Der Rumpf einer Anfrage ──────────────────────────────────────────────

In Express 4 war `req.body` ein leeres Objekt, wenn kein Parser etwas fand.
In Express 5 ist es `undefined`. Vierzehn Handler schreiben
`const { … } = req.body` — das wirft darauf, und zwar als 500.

Vorher liefen dieselben Anfragen in die eigene Pruefung des Handlers und
bekamen einen sauberen 400. Wer den Content-Type vergisst, verdient die
zweite Antwort.
```

<a id="kandidaten"></a>
## `const kandidaten = [];`

```text
Den Catch-all an seiner AUFGABE finden, nicht an seinem Muster: Es ist
die app.get-Registrierung, die renderIndexHtml() ausliefert. Haenge die
Suche am Muster, muesste sie bei jeder Umbenennung mitgepflegt werden —
und dann prueft sie irgendwann die Schreibweise statt der Sache.
── Nachtrag 17.10.: renderIndexHtml() liefert nicht mehr NUR der
   Catch-all aus ──────────────────────────────────────────────────────

Hier stand `break` beim ERSTEN Treffer. Das stimmte, solange genau eine
Route die Seite rendert. Seit /reset-password über denselben Renderer
geht (sonst gängen von dort die Assets OHNE Stempel hinaus, siehe
src/infra/assetStempel.ts), findet die Suche den festen Pfad zuerst — und
meldete einen 404 für `/`, obwohl der Catch-all heil war. Eine Prüfung,
die die falsche Route misst, ist schlimmer als keine: Sie sieht nach
einem Befund aus.

Gesucht wird deshalb unter ALLEN rendernden Routen die mit einem
Platzhalter. Das ist nicht dasselbe wie die Schreibweise festzunageln,
wogegen der Absatz oben argumentiert: Ob `/*splat` oder `/{*splat}`
dasteht, bleibt offen — gefordert ist nur, dass überhaupt eines
ALLES fängt.
```

<a id="3-die-startseite-geht-durch-den-renderer"></a>
## `test('3. die Startseite geht durch den Renderer', () => {`

```text
Die Startseite geht durch den Renderer — nicht an ihm vorbei.

── Der Befund, am laufenden Server gemessen ────────────────────────────────

`express.static` liefert index.html fuer `/` von sich aus aus (Option
`index`, Vorgabe `index.html`) und kommt damit dem SPA-Catch-all zuvor.
GEMESSEN am 17.10., bevor das abgestellt wurde:

  /           <html lang="de">                       ?v=2026.10.17.1217
  /irgendwas  <html data-theme="classic" lang="de">   ?v=mvccag5c-14dl

Auf der Startseite fielen damit ZWEI Dinge aus:

  • das serverseitig gesetzte `data-theme`. Genau dafuer gibt es
    src/konto/indexHtml.ts: Ohne den Wert startet ein frischer Browser im
    Standarddesign und springt nach dem Abgleich sichtbar um. Der Kopf
    jener Datei beschreibt diesen Sprung als geloest — auf `/` war er es
    nie.
  • der Dateistempel (src/infra/assetStempel.ts). Deshalb blieb die
    Cache-Reparatur bei Marco wirkungslos: Sie kam an seiner Adresse gar
    nicht zum Einsatz.

── Warum hier die SCHREIBWEISE gepruefte wird ──────────────────────────────

Der Absatz oben argumentiert, man solle die Wirkung pruefen und nicht das
Muster. Hier ist die Option selbst die Wirkung: `index: false` sagt genau
„liefere keine Verzeichnis-Startdatei aus", und etwas anderes gibt es dafuer
nicht. Die Wirkung am echten Server zu pruefen hiesse, ihn samt Datenbank
hochzufahren — das tut keine Pruefung dieser Reihe.
```
