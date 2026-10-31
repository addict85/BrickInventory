# Begründungen zu `src/infra/dateiEmpfang.ts`

Die ausführlichen Kommentare aus `src/infra/dateiEmpfang.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Dateien entgegennehmen — die Grenzen stehen an EINER Stelle.

── Warum es diese Datei gibt (Nachtrag 128) ────────────────────────────────

Die CSV-Annahme stand DREIMAL zeichengleich da:

    routes/sets.ts:64       const upload    = multer({ … 15 * 1024 * 1024 })
    routes/parts.ts:502     const csvUpload = multer({ … 15 * 1024 * 1024 })
    routes/minifigs.ts:486  const csvUpload = multer({ … 15 * 1024 * 1024 })

Drei Namen, eine Sache — und drei Orte, an denen die Grenze steht. Wer sie
einmal anhebt, hebt sie an einem Drittel der Wege an, und welcher Import
dann eine grössere Datei annimmt, hängt davon ab, welche Datei man
aufgemacht hat. Genau diese Form hat in dieser Reihe schon ein Dutzend Mal
zu auseinanderlaufendem Verhalten geführt.

Die ZAHL ist hier nicht nur eine Zahl: Sie muss zu dem passen, was die
Oberflächen dem Nutzer sagen, bevor er eine Datei wählt. Die Android-App
liest sie nicht aus dem Netz, sie steht dort ebenfalls — deshalb trägt die
Konstante ihren Wert im Namen der Fehlermeldung mit.
```

<a id="csvempfang"></a>
## `csvEmpfang`

```text
Die Annahme für Textdateien, die sofort zerlegt werden: die CSV-Importe
(Sets, Teile, Minifiguren, Merkliste, Preisalarme) und die
BrickLink-Wanted-Liste als XML.

`memoryStorage`, weil alle diese Importe die Datei ohnehin sofort zerlegen
und nie auf die Platte legen. Das Feld heisst überall `file` — dieselbe
Schreibweise wie in der Webapp und in der App.

Der Name sagt „csv" und die Liste nennt jetzt auch XML: Hier steht KEIN
Typfilter, und eine zweite Instanz mit derselben Einstellung anzulegen wäre
dieselbe Sache zweimal. Richtiggestellt ist deshalb der Kommentar, nicht
der Name — ein Umbenennen ginge durch sechs Dateien, ohne etwas zu
verbessern.
```
