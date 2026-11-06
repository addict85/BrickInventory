# Begründungen zu `test/alles-loeschen-haushalt-db.test.js`

Die ausführlichen Kommentare aus `test/alles-loeschen-haushalt-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Alle meine Sets löschen" löscht MEINE Sets — nicht die des Haushalts.

── Der Befund ──────────────────────────────────────────────────────────────
Der Knopf in den Einstellungen tat zwei Dinge:

    const s = await api('GET','/v1/sets');
    for (const set of s.sets||[]) await api('DELETE', `/v1/sets/${…}`);

Beides ohne Blickfeld. `/v1/sets` liefert ohne `accounts` den ganzen
HAUSHALT, und `DELETE /v1/sets/:nr` löschte mit writableIds(), also im
vollen Schreib-Blickfeld.

NACHGEMESSEN mit zwei verknüpften Konten (Hauptkonto besitzt 75192-1, das
Unterkonto 75192-1 und 21318-1 samt Teilen und Minifiguren):

    „Alle meine Sets loeschen" listet: [75192-1, 21318-1]
    DELETE laeuft ueber writableIds(haupt) = [2, 3]
    NACHHER  haupt: Sets [], kind: Sets [], Teile 0, Figuren 0

Das Unterkonto verlor seine gesamte Sammlung — darunter ein Set, das das
Hauptkonto nie besass. Der Knopf heisst „Alle MEINE Sets löschen", der
Text verspricht „Deine gesamte Sammlung".

── Warum der Test gegen die ECHTE Route läuft ──────────────────────────────
Eine Quelltextprüfung hätte hier nur die beiden `accounts=own` bestätigt.
Der Schaden entsteht aber erst aus dem Zusammenspiel von Auflisten und
Löschen — und genau das prüft nur ein Durchlauf gegen die Datenbank.

── Seit dem Papierkorb ─────────────────────────────────────────────────────
Der Knopf ruft jetzt EINEN Endpunkt (DELETE /api/v1/bestand), der Sets,
manuelle Teile und Figuren des EIGENEN Kontos in den Papierkorb legt. Die
Regel „nur meine" steht damit am Server; geprüft wird sie hier am selben
Haushalt wie zuvor.
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
