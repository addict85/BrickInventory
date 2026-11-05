# Begründungen zu `test/data-layout.test.js`

Die ausführlichen Kommentare aus `test/data-layout.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ordnung unter data/ — Bilder nach Art getrennt, Anleitungen ohne "shared".

── Was sich geändert hat ───────────────────────────────────────────────────
  data/part_images/          → data/images/parts/  +  data/images/minifigs/
  data/instructions/shared/  → data/instructions/

"part_images" enthielt auch die Minifiguren-Bilder (server.ts rief dieselbe
downloadImage()-Funktion auf) — der Name war für die Hälfte des Inhalts
falsch. "shared" war der einzige Unterordner von instructions/ und grenzte
gegen benutzereigene Anleitungen ab, die dort gar nicht liegen (sondern unter
data/uploads/<id>/).

Der einmalige Umzug (db/migrations/0002 plus utils/migrateLayout.ts) ist
entfernt, nachdem er auf der Installation durchgelaufen war. Was hier bleibt,
sind die Zusicherungen über den ZIELZUSTAND: dass keine Quelle mehr die alten
Pfade schreibt, dass Teile und Figuren getrennt landen und dass die
Bildroute Anmeldepflicht und Heilung behält.
```

<a id="src-stelle"></a>
## `const src = strip(read('server.ts'));`

```text
Seit der Vereinheitlichung gibt es EINE Route für den ganzen Baum unter
data/images/ — vorher war sie zweigeteilt: Teile und Figuren
authentifiziert, Sets über express.static ohne Prüfung. Dass gar kein
statischer Mount mehr auf das Datenverzeichnis zeigt, prüft
test/media-auth.test.js.
Kommentare ausblenden, BEVOR das Fenster geschnitten wird: Ein längerer
Erklärtext in der Route (Nachtrag 37 begründet dort die Cache-Kopfzeile)
schob die geprüfte Zeile sonst aus den 2000 Zeichen — die Regel galt
weiter, nur der Ausschnitt war zu kurz. strip() gibt es in dieser Datei
bereits.
```

<a id="src-stelle-2"></a>
## `const src = read('server.ts');`

```text
── Bewusste Entscheidung ────────────────────────────────────────────────
Kurzzeitig gab es hier Weiterleitungen: /data/part_images/* per 301 auf den
neuen Ort, und /data/instructions/shared/* wurde transparent aufgelöst.
Gedacht waren sie für eine Android-App, die noch eine zwischengespeicherte
Liste mit alten Adressen hält.

Sie sind entfallen, weil beide Clients aus derselben Hand kommen und
gemeinsam aktualisiert werden. Eine Weiterleitung, die niemand braucht,
ist kein Netz, sondern eine zweite Wahrheit: Sie hält den alten Pfad am
Leben, verdeckt beim Testen, wenn irgendwo doch noch der alte Wert
entsteht, und muss bei jeder weiteren Umsortierung mitgepflegt werden.

Der einmalige Umzug hat Datenbank und Dateien längst umgestellt; die alten
Pfade gibt es schlicht nicht mehr. Ein Client mit veraltetem
Zwischenspeicher bekommt 404 und lädt neu — das gewollte Verhalten.
```
