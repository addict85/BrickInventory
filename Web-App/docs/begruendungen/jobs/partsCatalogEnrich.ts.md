# Begründungen zu `jobs/partsCatalogEnrich.ts`

Die ausführlichen Kommentare aus `jobs/partsCatalogEnrich.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Bild herunterladen und lokal ablegen.

@param {string} imgUrl
@param {string} partNum Teile- oder Figurennummer
@param {number} colorId
@param {'part'|'minifig'} kind Bestimmt Zielverzeichnis und Web-Pfad.
       Bewusst OHNE Vorgabewert: Ein stiller Standard 'part' hätte einen
       vergessenen Aufruf für Minifiguren unbemerkt in den falschen Ordner
       schreiben lassen — genau der Fehler, den die Trennung beheben sollte.
```

<a id="rbblrows"></a>
## `rbBlRows`

```text
── Die Abfrage auf set_parts_catalog ist WEG ──────────────────────────

Sie las dort `bl_part_number` — eine Abschrift je Set-Teile-Zeile, also
fuer dasselbe Teil so oft, wie es Sets damit gibt. Migration 0037 hat die
Spalte geloescht; die Abfrage auf bl_zuordnung darunter liest dieselbe
Aussage einmal je Teil.

Und sie war TOT: Ihr Ergebnis landete in einer Abbildung existingBlMap,
die nirgends gelesen wurde (nachgemessen am Stand vor dieser Aenderung —
zwei Vorkommen, Deklaration und Zuweisung). Aufgefallen ist das erst beim
Umzug der Spalte. Sie ist deshalb ersatzlos weg, nicht umgestellt.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Fehlende Bilder neu laden ─────────────────────────────────────────────
"Fehlend" = image_local ist in der DB gesetzt, die Datei fehlt aber physisch.
Solche Einträge werden über image_url neu geladen (rate-limited) und das
Thumbnail neu erzeugt. Schlägt der Download fehl (oder fehlt image_url), wird
image_local geleert, damit Web + Android auf die CDN-URL zurückfallen.
Fortschritt liegt für das Monitoring in global_settings (Key imgredl_status).

── Warum eine prozessübergreifende Sperre ──────────────────────────────────
Ausgelöst wird der Lauf AUSSCHLIESSLICH aus einem Request-Handler heraus
(POST /api/v1/admin/redownload-missing-images), also im bearbeitenden
Cluster-Worker. `_redlRunning` liegt im Speicher eines Prozesses: Zwei Klicks
auf den Knopf im Monitoring landeten in verschiedenen Workern, und beide
starteten einen vollständigen Lauf — dieselben Dateien zweimal vom CDN
geladen (nebenläufig auf denselben Dateinamen geschrieben) und zwei Läufe,
die im Sekundentakt dasselbe Feld `imgredl_status` überschrieben, sodass die
Fortschrittsanzeige zwischen zwei Ständen hin und her sprang.

downloadSetImages() hat für genau dieses Problem längst einen Lock (42 je
Set); dieser Weg lädt aber über downloadFile() direkt und lief ungeschützt.
```

<a id="fspathfromlocal"></a>
## `_fsPathFromLocal`

```text
Web-Pfad → Dateipfad, für ALLE drei Bildarten (Nachtrag 49).

Vorher liess diese Funktion alles ausser `/images/parts/` fallen und gab
null zurück. Damit war der Bilder-Nachlauf faktisch auf Teilebilder
beschränkt: Set- und Minifiguren-Bilder wurden schon beim Auflösen des
Pfades verworfen — noch bevor irgendetwas geprüft werden konnte. Genau
deshalb blieb Marcos Set-Bild ohne Vorschau, obwohl der Lauf durchlief und
„fertig" meldete.
```

<a id="redlsetstatus"></a>
## `_redlSetStatus`

```text
Den Fortschritt des Bilder-Nachlaufs ablegen.

── Das `await` hat gefehlt ─────────────────────────────────────────────────

Hier stand `setGlobalSetting(...).catch(() => {})` OHNE await. Die Funktion
ist `async` und war damit sofort fertig, obwohl die Zeile noch gar nicht
geschrieben war. Alle sieben Aufrufer schreiben `await _redlSetStatus(...)`
und warteten auf nichts.

Folgenreich ist genau der LETZTE Aufruf, `{ running: false, phase: 'done' }`:
Danach kehrt der Lauf zurueck, der Handler antwortet — und wird der Prozess
in diesem Fenster beendet (Neustart, Auslieferung, Container gestoppt),
ist der zuletzt WIRKLICH geschriebene Stand `{ running: true }`. Der bleibt
dann fuer immer stehen, und die Kachel „Bild-Download (CDN)" meldet Betrieb,
bis jemand den Schluessel von Hand loescht.

Das ist Marcos alter Befund an der Nachbarstelle („Der Job scheint zu laufen
laut Monitoring, aber im Log sind keine Eintraege dazu zu finden"). Fuer den
Katalog-Job ist er behoben worden, fuer diesen hier nicht.

Das `.catch` bleibt: Ein misslungenes Schreiben des Fortschritts soll den
Lauf nicht abbrechen. Gewartet wird jetzt trotzdem.
```

<a id="redownloadmissingimages"></a>
## Abschnitt

```text
── Nicht wiederherstellbar -> image_local leeren ─────────────

Damit fallen beide Oberflaechen auf die CDN-URL zurueck. Die
Liste MUSS zu den Tabellen passen, die die Spalte wirklich haben,
und das tat sie nicht mehr:

  'sets'  — Migration 0033 hat sets.image_local geloescht. Der
            Aufruf lief seither in einen Fehler, den das
            .catch(() => {}) verschluckte: Ein verlorenes
            Set-Bild blieb als toter Pfad stehen, und die Galerie
            zeigte eine Luecke statt des CDN-Bildes.
  'parts' — dasselbe seit Migration 0034.

Jetzt die vier Tabellen, die die Spalte fuehren. Ohne .catch an
dieser Stelle gaebe es keinen Grund mehr — aber ein fehlgeschlagenes
Leeren soll den Lauf nicht abbrechen, also bleibt es, und der
Fehler kommt wenigstens ins Protokoll.
```
