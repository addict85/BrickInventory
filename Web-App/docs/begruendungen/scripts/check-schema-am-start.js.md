# Begründungen zu `scripts/check-schema-am-start.js`

Die ausführlichen Kommentare aus `scripts/check-schema-am-start.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fs-stelle"></a>
## `const fs = require('fs');`

```text
Das Schema steht an EINER Stelle — nicht im Anfragepfad.

── Woher diese Prüfung kommt ───────────────────────────────────────────────
`db/database.ts` trägt seit der Umstellung eine Etappe namens
`frueherZurLaufzeitAngelegt()` mit dem Kommentar:

    „csv_import_jobs (heute import_stand) entstand per ensureJobTable() bei jedem Aufruf des
     CSV-Status-Endpunkts, qr_login_tokens per ensureQrTable() bei jedem
     QR-Token. DDL im Request-Pfad ist aus zwei Gründen unschön: Sie kostet
     bei jeder Anfrage einen Katalog-Zugriff, und sie verteilt das Schema
     über die Codebasis, sodass niemand mehr an einer Stelle sehen kann, wie
     die Datenbank aussieht. Beide gehören hierher."

Die zentrale Fassung kam dazu — die alte blieb stehen. `ensureJobTable()`
lief weiterhin vor jedem Import und jedem Abbruch, `ensureQrTable()` bei
jeder Token-Erzeugung und jeder Einlösung. Der Satz „Beide gehören hierher"
stimmte also nicht, und zwar unbemerkt, weil beide Fassungen zeichengleich
waren.

Genau das ist das Tückische: Zwei Fassungen einer Regel fallen nicht auf,
solange sie dasselbe wollen. Wer die zentrale um eine Spalte erweitert,
bekommt bei einer NEUINSTALLATION je nach Reihenfolge die alte Tabelle —
und `CREATE TABLE IF NOT EXISTS` meldet das nicht, es tut einfach nichts.

── Was geprüft wird, und was bewusst NICHT ─────────────────────────────────
Geprüft wird der ANFRAGEPFAD: `routes/` und die Leseabfragen (`src/<bereich>/abfragen.ts`,
`src/bestand/gemeinsam.ts`, `src/bestand/kennzahlen.ts`). Dort darf
keine Schema-Anweisung stehen (CREATE TABLE / CREATE INDEX / ALTER TABLE).

Sicher ist das, weil `server.ts` `app.listen()` erst im `then()` von
`initSchemaOnce()` aufruft — wenn die erste Anfrage ankommt, steht das
Schema bereits.

NICHT geprüft werden `jobs/` und `src/teile/partsSummary.ts`. Der erste Entwurf
dieser Prüfung verlangte „DDL nur unter db/" und meldete zwanzig weitere
Stellen — alle ausserhalb des Anfragepfads, keine davon der beschriebene
Fehler. Eine Regel, die zu weit greift, ist so wenig wert wie eine, die zu
eng greift: Sie wird abgeschaltet statt befolgt.

(`initPartsSummary()` läuft aus `db/database.ts` beim Start; der
Katalog-Abgleich in `jobs/` ist ein Hintergrundlauf. Beide sind nachgesehen,
nicht angenommen.)

── Ein Fehlalarm, der beinahe einer geworden wäre ──────────────────────────
Beim Vergleich der doppelt definierten Tabellen sah `rb_colors` zunächst
auseinandergelaufen aus: Der Job legt sie mit `bl_color_id` an,
`db/schema.sql` ohne. Die Spalte kommt dort aber eine Zeile später per
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Wer nur das CREATE vergleicht,
meldet einen Fehler, den es nicht gibt — der Endzustand zählt, nicht die
erste Anweisung.
```

<a id="migverz"></a>
## `const migVerz = path.join(ROOT, 'db/migrations');`

```text
── Der Selbstbeweis, und warum er JEDEN Teil einzeln prüft ─────────────────
Die Prüfung muss sich an einer bekannten Stelle beweisen: db/ MUSS alle drei
Arten von Schema-Anweisungen enthalten. Sonst ist das Muster veraltet, und
ein leeres Ergebnis oben sagt nichts.

Der erste Entwurf prüfte MUSTER als Ganzes gegen db/database.ts — und blieb
grün, als in einer Gegenprobe „CREATE TABLE" zu „CREATE TABEL" verstümmelt
wurde: „CREATE INDEX" traf ja weiterhin. Ein Selbstbeweis, den eine kaputte
Hälfte besteht, beweist die andere Hälfte nicht.
```

<a id="stelle"></a>
## `/**`

```text
═══════════════════════════════════════════════════════════════════════════
Regel 2 — jede Tabelle und jeder Index wird an GENAU EINER Stelle angelegt
═══════════════════════════════════════════════════════════════════════════

Regel 1 oben hätte den zweiten Fund dieser Reihe NICHT gesehen:
jobs/rebrickableCsvSync.ts legte in einer Funktion ensureSchema() sieben
Tabellen an, die wortgleich schon in db/schema.sql standen — und zwei
weitere (rb_themes, rb_inventory_minifigs), die es SONST NIRGENDS gab.

Die zweite Hälfte ist die gefährlichere. Der Abgleich läuft nur im primären
Arbeitsprozess; die übrigen nehmen Anfragen an, sobald das Schema steht. Auf
einer frischen Installation gab es die beiden Tabellen in dieser Spanne noch
nicht, und eine Abfrage darauf bekommt kein leeres Ergebnis, sondern
"relation does not exist".

Deshalb hier die schärfere Frage: Wo wird dieselbe Tabelle zweimal angelegt?
Zwei Fassungen fallen nicht auf, solange sie dasselbe wollen — und beim
Vergleich fiel nebenbei auf, dass zwei der Indizes im Job überzählig waren
(derselbe Index unter anderem Namen, und ein Präfix eines vorhandenen).
```
