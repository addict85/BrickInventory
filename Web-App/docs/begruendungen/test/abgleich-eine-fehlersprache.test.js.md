# Begründungen zu `test/eine-fehlersprache.test.js`

Die ausführlichen Kommentare aus `test/eine-fehlersprache.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Server antwortet in der Sprache, die der Anfragende ZEIGT.

Beide Oberflächen sind zweisprachig; eine feste deutsche Fehlermeldung des
Servers bräche die englische Oberfläche genau dann, wenn etwas schiefgeht.

── Was hier geprüft wird ───────────────────────────────────────────────────

GESUCHT, nicht aufgezählt: Jede `.ts` unter routes/ und src/ wird gelesen.
Wer eine feste Zeichenkette als `error:` verschickt, steht in ERLAUBT — mit
dem Grund. Eine neue Route erbt die Regel damit von selbst.

Und: Jeder Eintrag der Tabelle muss BEIDE Sprachen haben, und die
Platzhalter müssen in beiden dieselben sein — sonst steht in der einen
Sprache ein `{name}` auf dem Bildschirm.
```

<a id="stelle"></a>
## `/** Alle .ts unter den angegebenen Ordnern, auch in Unterordnern. */`

```text
── Drei Eintraege standen hier und beschrieben nichts mehr ─────────────────

Nachgemessen, nicht vermutet: Die neue Pruefung am Ende des Tests belegt
fuer jeden Eintrag, dass er wirklich einen Treffer verdeckt. Diese drei
taten es nicht:

  src/infra/fehlerTexte.ts       „Die Tabelle selbst." — die Tabelle fuehrt
                             ihre Texte als `{ de: '…', en: '…' }`, nie als
                             `error: '…'`. Der Eintrag nahm ausgerechnet
                             die Datei mit ALLEN Fehlertexten von der
                             Pruefung aus, ohne je gebraucht zu werden.
  jobs/csvImportWorker.ts    schickt `error: \`Unbekannte Aufgabe: …\`` —
                             mit Backtick, und Backticks sieht das Muster
                             bewusst nicht (siehe unten).
  routes/api_v1/admin.ts     schickt `error: 'timeout'`; das faellt schon
                             durch den Filter „nur Kleinbuchstaben ist kein
                             Satz".

Die Begruendungen waren nicht falsch, sie waren nur gegenstandslos. Und ein
gegenstandsloser Eintrag ist gefaehrlicher als keiner: Er nimmt die Datei
dauerhaft aus der Pruefung, auch fuer alles, was spaeter dazukommt.
```

<a id="for-stelle"></a>
## `for (const m of src.matchAll(/error:\s*(['"])((?:[^\\\n]|\\.)*?)\1/g))`

```text
KEIN Backtick und KEIN Zeilenumbruch im Text: Der erste Entwurf nahm
beides und lief damit über Zeilenenden hinweg — er meldete sechs Stellen,
an denen `error:` mitten in einem PROTOKOLLTEXT steht
(`console.error(\`[pdf] error: \`, e.message)`). Sechs Fehlalarme für
null echte Funde; genau die Sorte Prüfung, die abgeschaltet statt
befolgt wird.
```
