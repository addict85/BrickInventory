# Begründungen zu `test/schema-start-ohne-fehler-db.test.js`

Die ausführlichen Kommentare aus `test/schema-start-ohne-fehler-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="der-schemastart-meldet-keinen-verschluck"></a>
## `test('der Schemastart meldet keinen verschluckten Fehler', async (t) =`

```text
Der Schemastart darf keinen Fehler verschlucken.

── Wie das aufgefallen ist ─────────────────────────────────────────────────
Beim Umstellen der stillen catch-Bloecke auf `logAndContinue` protokollierte
der Start plötzlich zwei Zeilen, die vorher niemand sah:

  [weiter-trotz-fehler] start:erfassungen fuer Teile nachtragen:
      syntax error at or near "das"
  [weiter-trotz-fehler] start:erfassungen fuer Minifiguren nachtragen:
      column m.added_at does not exist

Beides waren echte Fehler, und beide liefen seit jeher ins Leere:

 - Der Teile-Nachtrag stand VOR den ALTER TABLEs, die parts.added_at und
   parts.condition anlegen. Auf jeder Datenbank ohne diese Spalten — also
   bei jedem Hochziehen von einem aelteren Stand — scheiterte er und lief
   erst beim naechsten Start.
 - Der Minifiguren-Nachtrag las m.added_at. Diese Spalte gibt es GAR NICHT:
   weder im Schema noch in einer Migration. Manuell erfasste Minifiguren aus
   der Zeit vor den Erfassungen haben deshalb bis heute keine
   Erst-Erfassung; ihr Kaufpreis fehlt in Historie und Finanzansicht.

── Warum als VERHALTEN und nicht als Quelltextpruefung ─────────────────────
Eine Regex haette weder das eine noch das andere gefunden. Der eine Fehler
war ein Kommentar INNERHALB der Zeichenkette, der andere eine Spalte, die es
anderswo sehr wohl gibt (parts.added_at). Beides sagt einem nur die
Datenbank selbst. Deshalb wird hier der Start wirklich ausgefuehrt und
mitgehoert, was er meldet.

Der Test gilt fuer ALLE Aufrufe von logAndContinue im Schemastart, nicht nur
fuer diese zwei — jeder kuenftige verschluckte Fehler faellt hier auf.
```
