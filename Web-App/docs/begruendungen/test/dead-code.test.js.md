# Begründungen zu `test/dead-code.test.js`

Die ausführlichen Kommentare aus `test/dead-code.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Funktionen ohne Aufrufer.

── Warum es diesen Test braucht ────────────────────────────────────────────
In drei Durchgängen hintereinander war toter Code der Ausgangspunkt eines
echten Fehlers: Eine 90-zeilige Zweitfassung des Rebrickable-Teileabrufs
lief am Tageskontingent vorbei, `getSetByBarcode` lag unbenutzt daneben
während die Route einen Namen aufrief, den es nicht gab, und im CSV-Abgleich
standen zwei vollständige Zweitfassungen des Download-Wegs samt eigener
CSV-Zerlegung. Solche Fassungen altern unbemerkt mit: Sie bekommen keine
Korrekturen, keine Sperren, keine Kontingentprüfung — und irgendwann ruft
sie doch jemand auf.

Der Test ist bewusst grob: Er zählt Vorkommen des Namens im ganzen
Serverbaum plus Tests. Wer eine Funktion exportiert, „benutzt" sie damit
(die Exportzeile zählt) — das ist die Grenze dieses Tests und der Preis
dafür, dass er keine falschen Alarme schlägt.
```

<a id="kein-exportierter-wert-ohne-einen-einzig"></a>
## `test('kein exportierter Wert ohne einen einzigen Aufrufer', () => {`

```text
Die zweite Haelfte: EXPORTIERTE Namen ohne Aufrufer.

── Warum es sie braucht ────────────────────────────────────────────────────
Der Test darueber benennt seine eigene Grenze: „Wer eine Funktion
exportiert, ‚benutzt' sie damit (die Exportzeile zaehlt)." Genau in dieser
Grenze wohnten sechs Namen — nachgemessen, nicht geschaetzt:

  db/migrate.ts: listMigrations                     versprach im Kommentar
                                                    eine Admin-Oberflaeche,
                                                    die es nicht gibt
  src/katalog/teileAnreicherung.ts: activeDownloads       Diagnosezaehler, kein Leser
  src/sets/abfragen.ts: updateSetQuantity         ueberholte Zweitfassung
  src/http/sseRegistry.ts: openSseCount                „fuer Diagnose und Tests",
                                                    kein Test benutzte sie
  src/katalog/bilder/thumbs.ts: generateThumbsBackground         seit dem ersten Commit
                                                    nie aufgerufen
  src/infra/lockNamespaces.ts: TXLOCK_NAMENSRAUM_…      eine Anmerkung in Form
                                                    eines Wertes

Der gefaehrlichste war updateSetQuantity: eine vollstaendige, GEPFLEGTE
Mengenaenderung (ihr Kommentar beschreibt einen darin behobenen Fehler), die
niemand aufruft — waehrend die lebende Route ueber updateSet() laeuft und
dabei bewusst „bei den eigenen Exemplaren deckelt, fremde lassen sich nicht
wegnehmen". Die tote Fassung haette fremde Exemplare blind ueberschrieben.
Genau davor warnt der Absatz ganz oben: Solche Fassungen altern unbemerkt
mit — und irgendwann ruft sie doch jemand auf.

── Was diese Pruefung anders macht ─────────────────────────────────────────
Sie zaehlt Vorkommen OHNE die Deklarations- und die Exportlisten-Zeile. Damit
sieht sie, was der Test darueber nicht sehen kann — und bleibt trotzdem grob
genug, um keine Fehlalarme zu schlagen: Wer einen Namen auch nur EINMAL
irgendwo sonst schreibt, faellt hier nicht auf.

TYPEN sind ausgenommen. Ein exportiertes `interface` ohne externen Nutzer
kostet zur Laufzeit nichts und traegt Lesbarkeit; es zu streichen waere ein
Verlust ohne Gewinn.
```

<a id="stelle"></a>
## `assert.ok(gefunden.inline > 70,`

```text
── Selbstbeweis, je Schreibweise EINZELN ────────────────────────────────

Hier stand eine Summe ueber beide Muster. Die Gegenprobe hat sie
ueberlebt: Ich habe das erste Muster zerstoert, das zweite fand weiterhin
genug Namen, und die Schranke blieb erfuellt. Ein Selbstbeweis, der
Zahlen addiert, deckt das Sterben eines Summanden zu — genau die
Fehlerart, gegen die er gebaut ist.

Beide Zahlen sind GEMESSEN; die Schranken liegen bei rund der Haelfte,
damit sie einen kaputten Ausdruck fangen und nicht jede neue Datei.
```
