# Begründungen zu `test/verwendende-sets-db.test.js`

Die ausführlichen Kommentare aus `test/verwendende-sets-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Welche Sets verwenden dieses Teil / diese Figur?

── Marcos Wunsch ───────────────────────────────────────────────────────────
„Auch die automatisch erfassten Teile und Minifiguren sollen einen
Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden, die
Anzahl soll nicht geändert werden können. Dafür soll angezeigt werden,
welche Sets dieses Teil und Minifigur verwenden — inkl. Link, um den
Detail-Dialog des Sets öffnen zu können."

── Warum gegen die echte Datenbank ─────────────────────────────────────────
Die Antwort entsteht aus einer Verknüpfung über zwei Tabellen, einer
Gruppierung und einer Summe. Ein Test mit Attrappe prüfte davon nichts —
gerade die Summe je Set und die Trennung „aus einem Set" gegen „manuell
erfasst" sind die Stellen, an denen so etwas schiefgeht.

── Was hier ausdrücklich mitgeprüft wird ───────────────────────────────────
 1. Blickfeld: Im Haushalt gehört auch das Set des Geschwisterkontos dazu.
    Sonst sagte der Dialog etwas anderes als die Teileliste darüber, aus der
    man kommt.
 2. Manuell erfasste Positionen tauchen NICHT auf. Sie haben keine
    Set-Nummer, und ein Eintrag ohne Set wäre in dieser Liste sinnlos.
 3. Teile und Figuren gehen durch DIESELBE Funktion. Beide werden geprüft —
    sonst könnte eine Seite still auseinanderlaufen, und genau das ist in
    diesem Projekt zwischen routes/parts.ts und routes/minifigs.ts schon
    passiert.

Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
```

<a id="stelle"></a>
## `{`

```text
── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────

Diese Datei loescht das Schema und baut es neu auf. initSchemaOnce()
laeuft dabei voll durch (die Marke in schema_meta ist mit weg), bleibt
aber auf dem Stand von db/schema.sql — also VOR allen Migrationen. Das
ist nicht nur fuer diese Datei falsch, sondern fuer jede danach: Sie erbt
eine halbe Datenbank.

GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
`parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
```

<a id="stelle-2"></a>
## `await haeltTeil(db, haupt, '3001', { setNumber: '75192-1', menge: 15, `

```text
Dasselbe Teil in drei Sets — zweimal beim Hauptkonto, einmal beim Kind.

Hier standen fuer 75192-1 ZWEI Zeilen (10 und 5), damit die Gruppierung
etwas zu tun bekommt. Seit Migration 0038 gibt es diesen Zustand nicht
mehr: idx_parts_eindeutig erlaubt je Konto, Set, Teil und Farbe genau eine
Zeile, und die Stueckzahl steht einmal im Katalog des Sets. Der Aufbau
sagt das jetzt so — und beweist es gleich darunter.
```
