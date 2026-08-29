# Nachträge 151–175

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 151 (hardened-240) — Wortlaut gegen Aussage, zum siebten Mal

Zwölf weitere Prüfungen nagelten ganze Signaturen wörtlich fest. Neuer Helfer
`pruefeParameter(src, name, params, hinweis)` prüft die Parameter der Reihe
nach, ohne Rücksicht auf Typannotationen, Vorgabewerte oder Umbrüche.

Wo die VORGABE der eigentliche Punkt war — `theme = MAIL_THEMES.classic`,
`condition = 'N'` —, steht sie jetzt als eigene, gezielte Prüfung daneben.

**Gegenproben in beide Richtungen:** Parameter entfernt → rot mit dem echten
Kopf in der Meldung. Typannotation ergänzt → grün. Vorher war es andersherum.

Ein dreizehnter Fall (`resolveIfExists`) fiel erst beim vollen Testlauf auf —
mein `grep` hatte ihn übersehen, weil er nur EINEN Parameter nennt. Ein Muster
ist eben nicht dasselbe wie ein Testlauf.

`noImplicitAny` von 631 auf 556, 44 auf 30 offene Dateien. Der
Ausnahmelisten-Wächter hat dabei zweimal angehalten, weil ich Dateien bereinigt
und die Liste nicht nachgezogen hatte — genau die Richtung, für die er da ist.

Alle semver-verträglichen Abhängigkeiten aktualisiert (`pg` 8.23, `sharp`
0.35.4, `nodemailer` 9.0.6, `multer` 2.3). Die Hauptversionssprünge (Express
4→5, archiver, csv-parse, jsdom, esbuild) bleiben liegen — die gehören einzeln
angefasst.

746 Tests grün.

## Nachtrag 152 (hardened-241) — Node 20 war seit vier Monaten ohne Patches

Das Dockerfile lief an beiden Stufen auf `node:20-alpine`. Node 20 hat am
30.04.2026 sein Lebensende erreicht — seitdem gibt es keine Sicherheits-Patches
mehr, auch nicht für kritische CVEs in V8, den HTTP-Parsern oder OpenSSL. Das
ist keine alte Version, sondern eine ungepatchte Laufzeitumgebung.

Schlimmer: Der CI-Workflow aus Nachtrag 150 schrieb `node-version: '20'` mit
der Begründung „wie im Dockerfile". Die Begründung war richtig, die Zahl schon
damals falsch — der Lebenszyklus war nicht nachgesehen worden.

Umgestellt auf Node 24 (Active LTS). Der Wächter hält die drei Stellen zusammen
und prüft gegen eine Liste ABGELAUFENER Zeilen — bewusst eine Sperr- und keine
Erlaubnisliste, sonst müsste sie bei jeder neuen Node-Zeile nachgepflegt werden
und meldete einen Aufstieg als Fehler.

### Abdeckungs-Landkarte

`npm run coverage` (bewusst nicht in CI — sie lässt nichts durchfallen).
Ergebnis: 59,3 % der Zeilen, nur `server.ts` wird von keinem ausgeführten Test
berührt. Die interessante Hälfte ist die Rangliste:

| Anteil | Modul |
|---|---|
| 15 % | jobs/rebrickableCsvSync.ts |
| 18 % | clients/brickset.ts |
| **18 %** | **routes/sets.ts** (522 Zeilen) |
| 23 % | utils/instructions.ts |
| 24 % | routes/imgProxy.ts |

`routes/sets.ts` ist der Anlege- und Verschiebeweg für Sets — der Kern der App.

Die Zahl ist KEINE Zielgrösse. Eine Abdeckungsquote als Ziel führt zuverlässig
zu Tests, die Zeilen berühren, ohne etwas zu behaupten.

### Der Restore-Weg, einmal wirklich durchgespielt

Im README stand „Den Restore-Weg einmal ausprobieren". Genau die Sorte
Anweisung, die niemand befolgt — und ein Backup, das nie zurückgespielt wurde,
ist eine Vermutung, kein Backup.

`backup-restore-db.test.js` spielt gegen echtes Postgres durch: Daten anlegen →
`pg_dump` → Schema komplett verwerfen → zurückspielen → Feld für Feld
vergleichen. Die beiden Vorkehrungen aus den Skripten sind jetzt gemessen statt
behauptet — dass ein abgeschnittener Dump die Endmarke nicht trägt, und dass
`psql` ohne `ON_ERROR_STOP` einen fehlgeschlagenen Restore mit Exit 0
quittiert.

Die erste Gegenprobe blieb grün: Das Muster fand die Endmarke im ERKLÄRTEXT des
Skripts statt in der Befehlszeile. Derselbe Fehler wie beim CI-Wächter zwei
Durchgänge zuvor. Kommentarzeilen werden jetzt vorher herausgefiltert.

755 Tests grün.

## Nachtrag 153 (hardened-243) — Node 26 und ein Typpaket, das zufällig passte

Node 26 an allen drei Stellen. Bewusste Abweichung von der LTS-Empfehlung des
Node-Projekts, mit Begründung im Dockerfile: 26 wird im Oktober 2026 ohnehin zu
Active LTS, der Support läuft dann bis 30.04.2029 statt bis 2028, und der
Abhängigkeitsbaum hier ist klein genug, dass der Rückweg auf 24 eine Zeile ist.

Beim Prüfen fiel auf, dass `@types/node` bereits auf `^26` stand — rein
zufällig, weil `npm update` es in Nachtrag 151 hochgezogen hatte. Andersherum
wäre es unbemerkt geblieben: Der Übersetzer hätte gegen eine andere
Standardbibliothek geprüft als die laufende, und ein Aufruf, den es in der
ausgelieferten Fassung gar nicht gibt, wäre sauber durchgekommen.

Dafür gibt es jetzt eine eigene Regel. Die allgemeine „Typpaket und Paket in
derselben Hauptversion" aus Nachtrag 148 greift hier nicht — `node` ist gar
keine Abhängigkeit in der `package.json`, die Version steht im Dockerfile.

**Nach dem ersten Start zu prüfen:** `sharp` bringt libvips als native
Bibliothek mit und lädt eine fertige Binärdatei für Plattform und
C-Bibliothek. Genau dort geht ein Node-Sprung schief, wenn überhaupt — und zwar
leise, weil `routes/thumbs.ts` dann auf Jimp zurückfällt und weiterläuft.
Einmal eine Vorschau erzeugen und ins Log sehen. Taucht die Jimp-Warnung auf,
ist 24 der Rückweg.

756 Tests grün.
