# Begründungen zu `test/asset-stempel.test.js`

Die ausführlichen Kommentare aus `test/asset-stempel.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der `?v=`-Stempel kommt aus der DATEI, nicht aus einer gesetzten Zahl.

── Woher das kommt ─────────────────────────────────────────────────────────

Marcos Meldung, zweimal mit Bildschirmfoto: „Beim Logout-Eintrag fehlt der
Text." GEMESSEN in einem echten Chromium rendert derselbe Eintrag korrekt
(„🚪 Sign out", rgb(185,28,28) auf Weiss, 210×32 px) — sein Browser lud
also andere Dateien, als sein Server hatte.

Die Ursache war nicht im Menü: index.html band alle Assets mit
`?v=2026.10.11.1317` ein, und diese Zahl setzt scripts/bump-version.js, das
„automatisch als npm postinstall und explizit im Docker-Build" läuft — also
genau dann NICHT, wenn jemand `git pull` macht und neu startet. Der Stempel
stand sechs Tage still, server.ts gibt Assets sieben Tage frei.

── Was test/asset-version.test.js prüft, und was nicht ─────────────────────

Jene Prüfung hält fest, dass die Verweise unter sich und mit package.json
einig sind, und sagt ausdrücklich: „Ob die Version überhaupt erhöht WURDE,
nachdem sich eine Datei geändert hat" prüfe sie nicht — „das ist eine
Freigabe-Entscheidung und keine Eigenschaft des Quelltextes."

Das stimmte, solange der Stempel eine Entscheidung WAR. Seit er aus mtime
und Grösse der Datei kommt, ist er eine Eigenschaft — und damit prüfbar.
Die beiden Prüfungen widersprechen sich nicht: Die eine sichert den
Quelltext, diese das Verhalten beim Ausliefern.
```

<a id="dir-stelle"></a>
## `const dir = baue('.a{color:red}');`

```text
Die Hälfte, die man vergisst: Ein Stempel, der sich IMMER ändert (etwa
aus der Uhrzeit), bestünde den Fall darüber und entwertete bei jedem
Seitenaufruf 223 KB Bündel und sechs Designs.

Die PAUSE dazwischen ist der Kern dieses Falls, und sie fehlte zuerst.
GEMESSEN: Ohne sie fallen beide Aufrufe in dieselbe Millisekunde, ein
`Date.now()`-Stempel liefert zweimal denselben Wert, und der Fall wird
GRÜN — obwohl er genau diesen Fehler fangen soll. Gefunden hat das die
```
