# Begründungen zu `test/namen-eindeutig.test.js`

Die ausführlichen Kommentare aus `test/namen-eindeutig.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Funktionsname bedeutet eine Sache.

── Der Anlass ──────────────────────────────────────────────────────────────
`effectiveCondition` gab es ZWEIMAL, und die beiden beantworteten
verschiedene Fragen:

    src/finanzen/financeCalc.ts   Welchen Zustand hat dieses SET?
                           (die Erfassungen schlagen den gespeicherten Wert)
    src/einstellungen/settings.ts      Welchen Standardzustand hat dieser NUTZER?
                           (die Nutzereinstellung schlaegt den globalen)

Genau diese Verwechslung — der Zustand eines Stuecks gegen die Vorgabe fuer
den Preis — hat in diesem Baum ACHT Fehler erzeugt. Und der Name stoerte
schon aktiv: DREI Dateien benannten den Import beim Holen um, um an ihrer
eigenen lokalen Variablen vorbeizukommen, jeweils mit einem Kommentar
„Alias wegen der lokalen effectiveCondition". Ein Name, um den herum drei
Dateien ausweichen muessen, ist der falsche Name. Die settings-Fassung
heisst jetzt nutzerStandardZustand().

── Was hier geprueft wird ──────────────────────────────────────────────────
Gefunden, nicht aufgezaehlt: Alle Funktionsnamen des Baums werden gesammelt;
steht einer in mehreren Dateien, muss er in ERLAUBT stehen — mit dem Grund.

Die Liste ist bewusst nicht leer: Ein gleicher Name ist nicht per se falsch.
`start` in drei Jobs oder `get` im Datenbankmodul und im Job-Monitor sind
dieselbe Sache in verschiedenen Zusammenhaengen. Falsch wird es, wenn
derselbe Name VERSCHIEDENE Fragen beantwortet — und genau dafuer zwingt die
Liste dazu, den Grund hinzuschreiben.
```
