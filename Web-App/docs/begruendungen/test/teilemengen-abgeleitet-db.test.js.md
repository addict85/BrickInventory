# Begründungen zu `test/teilemengen-abgeleitet-db.test.js`

Die ausführlichen Kommentare aus `test/teilemengen-abgeleitet-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
der Endstand und die Lesewege.

Die Stückzahl eines Teils oder einer Figur steht nicht mehr an der Zeile.

── Marcos Befund ───────────────────────────────────────────────────────────

  „Bei den Minifigs und parts gibt es noch immer ein quantity"

Richtig, und er hätte es nicht selbst finden müssen. Migration 0036 hat
`sets.quantity` gelöscht; bei Teilen und Figuren blieb die Spalte stehen,
weil sie ZWEI Bedeutungen trug:

  source='manual'  wie viele ich besitze    → Summe der Erfassungen
  source='set'     wie viele im SET stecken → set_parts_catalog.quantity
                                              bzw. set_minifigs_catalog

Beide waren Abschriften. GEMESSEN: src/katalog/partsImport.ts schrieb denselben
Wert in DERSELBEN Schleife nach `parts.quantity` UND nach
`set_parts_catalog.quantity`; src/katalog/minifigsImport.ts wortgleich. Für die
manuellen Positionen war mengeNeuRechnen() in db/bestandsmenge.ts der
einzige Schreiber — und der rechnete nichts anderes als die Summe der
Erfassungen.

Migration 0038 löscht beide Spalten. Die Fallunterscheidung steht einmal,
in db/bestandsmenge.ts (teilmengeJoin/teilmengeAus), und wird von den
Lesestellen eingesetzt — dieselbe Bauart wie mengeJoin/mengeAus für die
Sets.

── Was dieser Test prüft ───────────────────────────────────────────────────

  1. Nach der GANZEN Kette gibt es die beiden Spalten nicht mehr — und
     VORHER gibt es sie, weil Schritt 1 und der Riegel von 0038 sie LESEN.
     Dazu: die vier Indizes, die 0038 setzt.
  2. Die Migration lässt nichts verschwinden. Sieben Läufe, jeder mit
```

<a id="ix-stelle"></a>
## `const ix = await indizes();`

```text
Die vier Indizes aus Schritt 5 und 6. Die beiden eindeutigen sind nicht
Kosmetik: Ohne sie war das `ON CONFLICT DO NOTHING` der Importe
WIRKUNGSLOS (es gab keinen Konflikt, auf den es treffen konnte), und
jeder erneute Import desselben Sets legte neue Zeilen an. Ab 0038 liest
jede Zeile dieselbe Katalogzahl — zwei Zeilen zaehlten doppelt.
Die beiden Gruppen-Indizes der Erfassungen hat Migration 0068 entfernt:
Sie waren der Anfang der eindeutigen Tagesindizes, die jede ihrer Suchen
bedienen (test/indizes-db.test.js).
```

<a id="proben"></a>
## `const proben = [`

```text
── Selbstbeweis ─────────────────────────────────────────────────────────

Die Muster finden jetzt nichts — das ist der Punkt, sagt aber allein noch
nicht, dass sie ueberhaupt etwas finden KOENNTEN. Also an Zeilen
nachgewiesen, die in genau dieser Form im Baum standen (die ersten drei
woertlich aus db/bestandsmenge.ts und src/katalog/partsImport.ts, Fassung vor
0038).
```

<a id="stelle"></a>
## `await db.run('INSERT INTO set_catalog (set_number,name,year,pieces)`

```text
── Die Lage ─────────────────────────────────────────────────────────────

Beide Konten halten dasselbe Set, das Hauptkonto ZWEI Exemplare. Darin
steckt ein Teil sechsmal und eine Figur einmal. Daneben hält das
Hauptkonto eine manuelle Position mit zwei Erfassungen (2 + 3) und eine
manuelle Figur (2).

Diese Lage trennt alles, was sich verwechseln lässt: Katalogzahl gegen
Erfassungssumme, Set-Zweig gegen manuellen Zweig, ein Konto gegen den
Haushalt, und die Multiplikation mit der Setmenge gegen ihr Ausbleiben
bei einer manuellen Position.
```

<a id="stelle-2"></a>
## `assert.equal(Number((await P.getPartsStats([haupt])).total_parts), 12,`

```text
getPartsStats zaehlt ABSICHTLICH nur Set-Teile — manuell erfasste haben in
der Oberflaeche ihren eigenen Bereich (der Filter steht in
src/teile/partsSummary.ts und im Rueckfall darunter). Also 12, nicht 17. Diese
Zahl ist hier kein Nebenbefund: Stuende 17, zaehlte die Kennzahl die
manuelle Position doppelt zum eigenen Bereich dazu, und zwar je nachdem,
ob die Zusammenfassung gerade frisch ist — genau der sporadische
Unterschied, der schon einmal in api-parity aufgefallen ist.
```

<a id="stelle-3"></a>
## `const { rebuildNow } = _req('src/teile/partsSummary.js');`

```text
rebuildNow() und nicht rebuild(): Die Listenaufrufe darueber haben ueber
ensureFresh() schon einen HINTERGRUNDaufbau angestossen, und der haelt
die Sperre pg_try_advisory_xact_lock. rebuild() direkt gerufen sieht die
Sperre, kehrt stillschweigend zurueck („ein anderer baut gerade") und baut
nichts — GEMESSEN: parts_summary war danach LEER. rebuildNow() wartet auf
den laufenden Aufbau, statt daneben einen zweiten zu versuchen.
```

<a id="b-stelle"></a>
## `const B = _req('src/finanzen/rechnung/bewertung.js');`

```text
── Bewertung und CSV ───────────────────────────────────────────────────

Beide tragen die Fallunterscheidung ebenfalls. Hier wird nur AUSGEFÜHRT
und auf die Stückzahl gesehen — der Geldbetrag haengt an den Marktpreisen
und ist Sache von test/bewertung-abfragen-db.test.js.
Beide Bewertungen rechnen NUR die manuellen Positionen — ein Set-Teil
wird ueber sein Set bewertet, nicht einzeln (die Bedingung
`p.source = 'manual'` steht in src/finanzen/rechnung/bewertung.ts). Also auf die
manuelle Position gesehen; deren Stueckzahl ist die Erfassungssumme.
```
