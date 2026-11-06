# Begründungen zu `test/helpers/bestand.js`

Die ausführlichen Kommentare aus `test/helpers/bestand.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bestand anlegen und lesen — für Testaufbauten.

── Warum es diese Datei gibt ───────────────────────────────────────────────

Bis Migration 0036 stand die Stückzahl eines Sets in `sets.quantity`, und
jeder Testaufbau schrieb sie dort hin:

    INSERT INTO sets (user_id, set_number, quantity) VALUES ($1,$2,1)

GEMESSEN: 65-mal, in 48 Dateien. Die Spalte ist weg (sie lief mit den
Erfassungen auseinander — sets.quantity = 10 bei drei Erfassungen mit Summe
7), die Stückzahl steht in `set_acquisitions`. Ein Bestand ist seitdem ZWEI
Zeilen: eine in `sets` („dieses Konto hält dieses Set") und eine je Kauf.

Diese zwei Zeilen 65-mal hinzuschreiben hiesse: 65 Stellen, die beim
nächsten Schnitt wieder einzeln angefasst werden müssen. Hier steht es
einmal.
```

<a id="stelle"></a>
## `/**`

```text
═══════════════════════════════════════════════════════════════════════════
Teile und Minifiguren
═══════════════════════════════════════════════════════════════════════════

Dieselbe Geschichte wie bei den Sets, eine Migration spaeter: Bis 0038 stand
die Stückzahl in `parts.quantity` bzw. `minifigs.quantity`, und 79
Testaufbauten schrieben sie dorthin (gemessen). Die Spalte trug ZWEI
Bedeutungen, und beide waren Abschriften:

  source='manual'  Summe der Erfassungen       → part_acquisitions
  source='set'     Stückzahl im Set            → set_teile.quantity

Ein Bestand ist seitdem ZWEI Zeilen, und welche zweite es ist, haengt an der
Herkunft. Genau das nehmen die beiden Funktionen hier auseinander — damit
ein Testaufbau sagt, WAS er herstellt, und nicht, in welche Spalten er
schreibt.
```

<a id="stelle-2"></a>
## `await db.run(`

```text
ON CONFLICT auf die Tagesregel: Ein zweiter Aufruf fuer dieselbe
Position SETZT die Menge, statt abzubrechen oder sie zu addieren.
Das ist die Zusage dieser Funktion — „dieses Konto haelt N davon",
nicht „kauf N dazu". Wer zwei Kaeufe braucht, gibt zwei Daten mit
(opt.am) oder ruft erfasseTeil() zweimal.

── `COALESCE(condition,'N')` seit Migration 0040 ────────────────────

Die Spaltenliste muss den Index WOERTLICH treffen; der Name genuegt
nicht. Ohne diese Ergaenzung sagt Postgres „there is no unique or
exclusion constraint matching the ON CONFLICT specification" — und
zwar in 25 Tests auf einmal, weil fast jeder DB-Test ueber diesen
Helfer Bestand anlegt. Genau so ist es passiert.

Die Zusage aendert sich dadurch leicht: „N davon" gilt jetzt je
ZUSTAND. Zweimal mit verschiedenem `opt.zustand` am selben Tag ergibt
zwei Zeilen — was der Sache entspricht, seit zwei Zustaende zwei
Kaeufe sind.
Erst die Zeile desselben Tages und Zustands entfernen, dann neu: Der
eindeutige Index enthält seit Migration 0047 auch Preis und Währung, ein
ON CONFLICT auf Tag und Zustand allein träfe ihn nicht mehr.
```
