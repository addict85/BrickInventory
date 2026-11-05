# Begründungen zu `scripts/loadtest.js`

Die ausführlichen Kommentare aus `scripts/loadtest.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Lastprofil — wie verhält sich der Server unter GLEICHZEITIGEN Anfragen?

── Warum es das gibt ───────────────────────────────────────────────────────
Die Messwerte aus Durchgang 119 (Teile-Seite ~5 ms, portfolioHistory
~70–86 ms, Neuaufbau Teile-Zusammenfassung ~240–330 ms) waren
EINZELabfragen auf einem sonst untätigen Server. Das ist die eine Hälfte der
Wahrheit. Die andere: Was passiert, wenn zwanzig Anfragen gleichzeitig
ankommen und der Verbindungspool sie sich teilen muss? Eine Abfrage, die
allein 80 ms braucht, kann zu zwanzigst 1,6 s brauchen oder 90 ms — je
nachdem, ob sie an der Datenbank hängt oder am Event-Loop des Workers.

Dieses Skript beantwortet genau diese Frage. Es ist KEIN Test und läuft
nicht in `npm test` mit: Lastmessungen schwanken je nach Maschine, ein
Schwellwert darin wäre entweder nutzlos hoch oder ständig grundlos rot.

── Ausführen ───────────────────────────────────────────────────────────────
  npm run build
  TEST_DATABASE_URL=postgres://tester@localhost:5433/cattest \
    node scripts/loadtest.js [--users 20] [--dauer 10] [--sets 800]

⚠️  Das Schema der angegebenen Datenbank wird GELEERT. Niemals gegen die
   Produktionsdatenbank laufen lassen — der Schutz unten prüft das grob,
   aber die Verantwortung bleibt beim Aufrufer.

── Wie man die Ausgabe liest ───────────────────────────────────────────────
p50 ist der Normalfall, p95 das, was jeder zwanzigste Nutzer erlebt — und
das ist die Zahl, die über den gefühlten Eindruck entscheidet. Die Spalte
„allein" misst denselben Endpunkt ohne Nebenlast: Der ABSTAND zwischen
„allein" und p50 ist der eigentliche Befund. Bleibt er klein, skaliert der
Endpunkt; wächst er stark, ist er ein Engpass.
```

<a id="stelle"></a>
## `await db.run(`

```text
── Dieser Aufbau war kaputt, und niemand hat es gemerkt ─────────────────

Er schrieb in sets.name/year/theme/pieces/minifigs (Migration 0033),
sets.purchase_price/condition (0032), parts.part_name/color_name (0034)
und minifigs.fig_name (0034) — alles Spalten, die es nicht mehr gibt.
Das Skript waere also schon seit Migration 0032 an der ersten Anweisung
gescheitert.

Aufgefallen ist es erst jetzt, beim Zaehlen der Leser von sets.quantity,
denn KEIN Test ruft dieses Skript auf: Es ist ein Messwerkzeug von Hand.
Ein Messwerkzeug, das nicht laeuft, ist schlimmer als keines — man greift
danach, wenn man eine Zahl braucht.

Die Stammdaten gehen jetzt in die Kataloge, Preis, Zustand und Menge in
die Erfassungen. Die GROESSENORDNUNGEN bleiben dieselben, damit die
Messungen aus Durchgang 119 vergleichbar bleiben.
```

<a id="stelle-2"></a>
## `await db.run(`

```text
Marktpreise je Zustand — ohne sie rechnen die Finanz-Endpunkte im Leeren.

WICHTIG: Die Währung muss zur Nutzereinstellung passen. Der Cache ist über
set_number + condition + currency_code verschlüsselt; steht dort CHF und
der Nutzer rechnet in EUR, ist JEDER Zugriff ein Fehlschlag und die
Bewertung versucht für jedes Set einen Live-Abruf bei BrickLink. Genau das
ist beim ersten Lauf dieses Skripts passiert (Bewertung: 21 s statt 60 ms)
— gemessen wurde damit der Ausnahmefall, nicht der Alltag. EUR ist der
Vorgabewert in src/finanzen/financeCalc.ts.
```

<a id="stelle-3"></a>
## `/** @type {Array<[string, string]>} */`

```text
Die Endpunkte, die eine Sitzung tatsächlich anfasst: Galerie öffnen, Teile
durchblättern, Finanzen ansehen.

Die Typangabe ist der Grund, warum es hier keine `?? ''` braucht: Ohne sie
liest der Pruefer `string[][]`, und dann ist JEDER Zugriff — auch `p[0]` auf
eine handgeschriebene Zeile mit zwei Feldern — moeglicherweise leer. Als
Tupel steht die Laenge fest, und fuenfzehn Meldungen verschwinden an ihrer
Ursache statt an fuenfzehn Symptomen.
```
