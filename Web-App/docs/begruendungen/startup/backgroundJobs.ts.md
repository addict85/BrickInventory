# Begründungen zu `startup/backgroundJobs.ts`

Die ausführlichen Kommentare aus `startup/backgroundJobs.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="startehintergrundlaeufe"></a>
## `starteHintergrundlaeufe`

```text
Was nach dem Start im Hintergrund anläuft — ausschliesslich im Primär-Worker.

── Warum eigene Datei (Nachtrag 134) ───────────────────────────────────────

server.ts hatte fünf Aufgaben in 1174 Zeilen: Log-Abfangen nach PostgreSQL,
Cluster-Aufbau, Sicherheits-Header, Auslieferung statischer Dateien — und
diese Staffel aus zehn Hintergrundläufen.

Die STAFFELUNG ist der eigentliche Grund für den Umzug. Sie ist bewusst
gewählt (Katalogabgleich nach 10 s, Anleitungen nach 15, Brickset-Wiederholung
nach 20, Bilder nach 45, Kaufpreis-Nachtrag nach 45), aber verstreut über
hundertdreissig Zeilen liess sie sich nur rekonstruieren, indem man jedes
`setTimeout` einzeln suchte. Hier stehen sie beieinander.

ALLES HIER LÄUFT NUR IM PRIMÄR-WORKER. Der Aufrufer prüft das; in dieser
Datei wird es nicht noch einmal geprüft, damit es genau eine Stelle gibt, an
der die Bedingung steht.
```

<a id="abschnitt"></a>
## Abschnitt

```text
HINWEIS: Hier standen zwei einmalige Umzüge — migrateImagesToData()
(public/images/ → data/images/) und migrateLayout() (data/part_images/
→ data/images/{parts,minifigs}/, data/instructions/shared/ →
data/instructions/). Beide sind entfernt, nachdem der Umzug auf der
Installation durchgelaufen war.

Sie liefen bei JEDEM Start und durchsuchten dabei Verzeichnisse, die es
längst nicht mehr gibt — Aufwand ohne Gegenwert, und zwei Dateien, die
beim Lesen des Startpfads erklärt werden mussten. Die zugehörige
Schema-Migration (db/migrations/0002) ist ebenfalls entfallen; der
Eintrag in schema_migrations bleibt bestehen und stört nicht.
```
