# Nachträge 51–75

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 51 (hardened-161) — Kaufpreis erreichte die Kachel nicht (nur App)

**Marcos Screenshot:** In der Erfassung steht 107.00 CHF, die Kachel oben zeigt
weiterhin 108.00 CHF. Der Preis wurde also gespeichert, die Anzeige blieb alt.

**Ursache.** In der Konfiguration der v1-Erfassungsrouten stand für SETS
`parentPriceSql: null` — als einzige der drei Elementarten. Teile und
Minifiguren spiegeln seit jeher in ihre Elternzeile, und die Webapp-Route tut
es für Sets ebenfalls (routes/sets.ts). Nur der Android-Weg liess
`sets.purchase_price` stehen.

Das wirkt weiter als es klingt: Galerie-Kachel, Finanzübersicht und
Detail-Kachel lesen alle aus `sets.purchase_price`. Nach einer Änderung über
die App zeigte damit die ganze Anwendung dauerhaft den alten Wert — auch die
Webapp, auch nach dem Neuladen. Nur die Erfassungsliste selbst stimmte.

Wieder das Muster „dieselbe Regel fehlt am zweiten Weg". Die Bedingung („nur
wenn die geänderte Erfassung die neueste ist") steckt bereits im gemeinsamen
Ablauf und gilt damit automatisch mit — der Test prüft auch diese
Gegenrichtung: Eine ältere Erfassung darf die Kachel NICHT überschreiben.

Am laufenden Server gemessen, beide Wege nebeneinander: vorher Webapp 107 /
Android 108, nachher beide 107. Test
`test/acquisition-price-mirror-db.test.js`, Gegenprobe bestanden.

**Eigene Falle beim Messen, als Warnung notiert:** Mein erster Aufbau leerte
zwischen den beiden Läufen nur `sets`, nicht `set_acquisitions`. Die Erfassung
aus dem ersten Lauf blieb liegen, „die neueste Erfassung" war dadurch eine
andere Zeile — und die Messung zeigte den Fehler noch, als er längst behoben
war. Beinahe hätte ich an der falschen Stelle weitergesucht. Erst die
Gegenprobe (Fix zurückdrehen) trennte Artefakt von Befund sauber.

543 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 52 (hardened-162 + Android) — Menge im Haushalt, und höhere Kacheln

**1. Marcos Bericht:** „Wenn die Anzahl eines Sets erhöht wird, welches einem
Unterkonto gehört, funktioniert die ganze Logik nicht mit dem Kaufpreis und die
Anzahl wird nicht gespeichert."

`updateSet()` suchte das Set mit `WHERE user_id=$1` und der EIGENEN
Betrachter-ID — 404 für jedes Set des Unterkontos. Beim Nachmessen zeigte sich:
Es trifft BEIDE Wege, auch die Webapp, die Marco noch nicht getestet hatte.

Dieselbe Klasse wie Nachtrag 45 (dort der Kaufpreis, hier die Menge) — und
weil die Mengenänderung über `adjustAcquisitionsToQuantity()` auch Erfassungen
anlegt und Preise bestimmt, blieb gleich die ganze Kette wirkungslos. Genau das
meint Marcos „die ganze Logik mit dem Kaufpreis".

Fix: `writableIds()` statt eigener ID, danach durchgehend der BESITZER der
Zeile (sonst entstünden die Erfassungen im falschen Konto). Am laufenden Server
gemessen: vorher beide Wege 404 und Menge unverändert 1, nachher beide 200 mit
Menge 3 und mitgezogener Erfassung. Test `test/set-quantity-scope-db.test.js`
prüft zusätzlich, dass KEINE Erfassung im Konto des Betrachters entsteht.
Gegenprobe bestanden.

**2. Zur Frage „nur eine Erfassung, alter Preis müsste ersetzt werden":** Das
ist genau der Fix aus Nachtrag 51 (hardened-161) — bei einer einzigen Erfassung
ist diese immer die neueste, und die Kachel übernimmt den neuen Preis. Ist auf
Marcos Screenshot noch der alte Stand zu sehen, fehlt dort schlicht das Update.

**3. Android, Kachelhöhe:** Die Etiketten (Zustand, Besitzer) liegen am unteren
Rand ÜBER dem Bild und verdeckten es bei Fotos, die die Fläche ausfüllen. Die
Kachel ist jetzt 272 statt 232 dp hoch, der Bildbereich 154/170 statt 114/130 —
und das Bild lässt unten 44 dp frei, genau den Streifen, in dem die Etiketten
sitzen. `ContentScale.Fit` skaliert in den verbleibenden Raum, das Bild wird
also nicht beschnitten, sondern rückt nach oben. Die Textzeilen darunter
bleiben unverändert.

544 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 53 (hardened-163) — Löschen im Haushalt (Marcos Rückfrage)

**Marco fragte, ob ich die Löschlogik ebenfalls geprüft habe.** Hatte ich
nicht — und sie hatte dieselbe Lücke wie Kaufpreis (45) und Menge (52): Beide
Wege suchten mit der eigenen Betrachter-ID und gaben für jedes Set des
Unterkontos 404. Nachgemessen: Set blieb stehen, Teile und Erfassungen
ebenfalls.

Immerhin war die Lücke ungefährlich — es wurde nie fälschlich etwas gelöscht.
Aber im Haushalt liess sich schlicht nichts entfernen.

Zwei Auffälligkeiten kamen dabei ans Licht:

- `deleteSet()` in utils/handlers.ts KONNTE das Blickfeld längst (asIds + ANY,
  aus einem früheren Durchgang) — es bekam vom Aufrufer nur eine nackte ID.
  Die Fähigkeit lag also brach.
- Die Webapp-Route führte vier einzelne DELETEs OHNE Transaktion aus, obwohl
  der andere Weg dafür längst eine hatte (mit genau der Begründung, dass sonst
  Teile und Minifiguren ohne Set zurückbleiben). Jetzt läuft auch sie in EINER
  Transaktion.

Fix: `writableIds()` an beiden Wegen, danach der BESITZER der Zeile — sonst
löschte die Anweisung im Konto des Betrachters, wo nichts steht, und die Teile
des Unterkontos blieben als Waisen zurück.

Bewusst `writableIds()` und NICHT `scopeIds()`: Löschen ist der Schritt, bei
dem „Lesen weit, Schreiben eng" am meisten zählt. Nachgemessen und im Test
festgehalten: vorwärts 200 und alles weg, rückwärts (Unterkonto → Set des
Hauptkontos) 404 und nichts angetastet. Test
`test/set-delete-scope-db.test.js`, Gegenprobe bestanden.

**Damit sind alle vier Änderungswege am Set im Haushalt geprüft:** Kaufpreis
(45), Menge (52), Löschen (53) — und der Eigentümerwechsel, der schon in
Durchgang 115 auf die Zeile statt den Betrachter umgestellt wurde.

545 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 54 (hardened-164) — pgweb im compose-File

Marcos Wunsch: pgweb einbinden, um die Datenbank im Browser ansehen zu können.

Umgesetzt als **optionaler** Dienst — drei Entscheidungen, die alle demselben
Gedanken folgen:

**1. Profil statt Dauerbetrieb.** `docker compose up -d` startet weiterhin nur
Datenbank und App. pgweb kommt nur auf Anforderung:

    docker compose --profile tools up -d pgweb    # → http://localhost:8081
    docker compose --profile tools down pgweb

Ein Werkzeug, das man dreimal im Jahr braucht, soll nicht dauerhaft mitlaufen —
schon gar keins ohne Anmeldung.

**2. Bindung an 127.0.0.1.** Das ist der wichtigste Punkt: **pgweb bringt keine
Anmeldung mit.** Wer die Seite erreicht, hat vollen Zugriff auf alle Konten,
Sitzungen und Daten — und kann sie ändern. Mit `127.0.0.1:8081:8081` ist der
Dienst nur auf dem Server selbst erreichbar; ein blosses `8081:8081` würde ihn
an alle Schnittstellen binden und wäre je nach Router von aussen offen. Zugriff
von einem anderen Rechner gehört durch einen SSH-Tunnel.

**3. `--readonly` als Voreinstellung.** Zum Nachsehen ist das die richtige
Einstellung; für Reparaturen kann die Zeile auskommentiert werden. Lieber
bewusst freischalten als versehentlich ein UPDATE ohne WHERE absetzen.

Neuer Test `test/compose-pgweb.test.js` hält die drei Eigenschaften fest —
Bindung, Profil, kein Volume — und prüft dabei die YAML-STRUKTUR, nicht den
Wortlaut: Eine Prüfung auf Zeichenketten wäre zu leicht auszuhebeln, ein
Kommentar mit der richtigen Zeichenfolge genügte. Der Test prüft zusätzlich die
Gegenrichtung: Datenbank und App dürfen KEIN Profil tragen, sonst startet der
normale Aufruf gar nichts mehr. Gegenproben bestanden (offene Bindung → rot,
Profil entfernt → rot).

Dazu ein README-Abschnitt mit den Befehlen und dem SSH-Tunnel.

549 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 55 (hardened-165) — Erfassungen im Haushalt: die restlichen FÜNF Wege

**Marcos Bericht:** Kaufpreis eines Unterkontos löschen → `404 Nicht gefunden`
aus `routes/sets.js:1345`, die Zeile bleibt stehen.

**Beim Nachsehen war der gemeldete Fall nur einer von sechs.** Nachtrag 45
hatte dieselbe Lücke geschlossen, aber nur an zwei Stellen: der v1-Fabrik und
der Webapp-Route zum ÄNDERN einer Set-Erfassung. Offen geblieben waren:

- Set-Erfassung **löschen** (Marcos Fall)
- Teil-Erfassung ändern **und** löschen
- Minifiguren-Erfassung ändern **und** löschen

Alle suchten mit `WHERE id=$1 AND user_id=$2` und der eigenen Betrachter-ID.

**Zwei der Löschwege waren dabei schlimmer als 404:** Sie prüften gar nicht, ob
eine Zeile getroffen wurde. Das DELETE lief ins Leere, die Antwort meldete
trotzdem `success: true` — der Nutzer sah „gelöscht", die Zeile blieb stehen.
Beide geben jetzt 404, wenn es nichts zu löschen gibt.

Fix überall gleich: `writableIds()` zum Finden, danach der BESITZER der Zeile
für alles Weitere (Löschung, Mengensumme, Rückspiegelung nach `parts`/
`minifigs`/`sets`). Am laufenden Server alle sechs Wege nebeneinander gemessen:
vorher 404, nachher 200.

**Das hätte ich in Nachtrag 53 schon tun sollen.** Dort stand die Lehre bereits
im Changelog — nach zwei Funden derselben Klasse sofort die ganze Familie
durchgehen. Ich habe sie auf die Set-Routen angewandt und die anderen beiden
Elementarten übersehen. Der neue Test deckt deshalb ALLE sechs Wege ab, nicht
nur den gemeldeten.

Test `test/acquisition-all-paths-db.test.js`, Gegenprobe bestanden.

550 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 66 (hardened-166) — Kontowahl im Katalog-Dialog, Finanz-Filter rechts

**1. Marcos Fund:** Katalog → Set → „In Galerie aufnehmen" → im Zwischendialog
(Anzahl, Kaufpreis, Zustand) fehlte die Kontowahl.

Der Katalog-Dialog war der **vierte** Erfassungsweg. Galerie-Formular,
manuelles Teil und manuelle Minifigur fragen das Konto längst ab — hier war es
nie angeschlossen. Der Aufruf schickte schlicht kein `owner_user_id` mit, also
landete jedes so aufgenommene Set stillschweigend beim eigenen Konto. Wieder
dasselbe Muster wie durch die ganze Reihe.

Fix: Auswahlfeld `cat-m-owner` im Dialog (blendet sich ohne Haushalt selbst
aus, wie die anderen drei), `selectedOwner()` beim Hinzufügen, und der Katalog
steht jetzt in derselben Liste, die die Mitglieder einträgt.

Der bestehende Test pinnte die Liste als GANZES („alle drei Formulare") und
wurde dadurch rot, obwohl die Regel erfüllt war. Jetzt prüft er jeden
Erfassungsweg EINZELN: Er wird rot, wenn einer fehlt, aber nicht, wenn ein
weiterer dazukommt — dieselbe Umformulierung wie bei den Tests aus 131.

**2. Finanz-Filter rechts.** Die Kopfzeile ist flex mit `space-between`, also
stand der Filter auf breiten Fenstern schon rechts. Sie bricht aber um, und
nach einem Umbruch beginnt die neue Zeile wieder links — genau das sieht man
auf schmalen Fenstern und auf dem Handy. `margin-left:auto` hält ihn in beiden
Fällen am rechten Rand.

WICHTIG nach Frontend-Änderungen: `npm run build:frontend` — sonst bleibt
public/js/app.bundle.js alt. Nachgeprüft, dass beide Katalog-Stellen im Bündel
angekommen sind.

550 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 68 (hardened-167) — Geleerter Kaufpreis blieb leer (nur App)

**Marcos Bericht:** „Wenn ich bei einem bestehenden Set die Anzahl erhöhe und
dann den Kaufpreis lösche (bei einem anderen Besitzer), wird der aktuelle Preis
nicht von BrickLink abgefüllt." Auf seinem Screenshot stand in der
Kaufpreis-Kachel ein Strich, obwohl der Marktpreis (12.55 CHF) bekannt war.

**Ursache.** In der Konfiguration der v1-Erfassungsrouten stand für SETS
`resolvePrice: null` — als einzige der drei Elementarten. Teile und Minifiguren
holen den Marktpreis seit jeher, die Webapp-Route tut es für Sets ebenfalls.
Nur der Android-Weg liess das Feld leer. Und weil die Kachel aus
`sets.purchase_price` liest und die Spiegelung den leeren Wert übernimmt, stand
danach in der ganzen App ein Strich.

Das ist dieselbe Zeile in derselben Konfiguration wie schon bei
`parentPriceSql` (Nachtrag 51) — beim damaligen Fix habe ich nur die eine
Zeile angefasst und die Nachbarzeile nicht geprüft. Genau deshalb steht die
Regel jetzt zum zweiten Mal hier: bei einem Fund in einer Konfigurationstabelle
die GANZE Zeile durchgehen, nicht nur das gemeldete Feld.

**Zustand zählt.** Der Auflöser bekommt jetzt den Zustand der Zeile mit
(bzw. den neuen aus dem Rumpf, falls er mitgeändert wird): Ein „Neu"-Eintrag
muss den Neu-Preis bekommen, nicht den der Gebraucht-Erfassung daneben. Der
Test hat dafür bewusst zwei verschiedene Preise im Cache.

Am laufenden Server in Marcos Lage gemessen (Set des Unterkontos, zwei
Erfassungen, Hauptkonto leert den Preis der Neu-Zeile): vorher Webapp 12.55 /
Android leer, nachher beide 12.55 — in Erfassung UND Kachel. Test
`test/acquisition-price-refill-db.test.js`, Gegenprobe bestanden.

551 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 69 (hardened-168) — EINE Preisregel statt zweier

**Marcos Befund:** „Android füllt 12.55 CHF, die Webapp 18.90 CHF — anscheinend
nicht dieselbe Logik." Genau so war es.

Der Webapp-Weg hatte eine ZWEITE, eigene Fassung der Preisregel: Sie las
`price_cache` mit der GLOBALEN Währung aus `global_settings` statt mit der des
Kontos. Steht dort noch EUR, während Marco CHF nutzt, trifft die Abfrage einen
anderen Cache-Eintrag — daher zwei verschiedene Zahlen für denselben Vorgang.
Zusätzlich holte sie nichts nach, wenn der Cache leer war.

Jetzt nutzen beide Wege dieselbe Funktion: `getCurrentMarketPrice(setNummer,
BESITZER, Zustand)` — Währung des Kontos, ausdrücklicher Zustand, frischer
Abruf bei leerem Cache. Nachgestellt mit abweichender globaler Währung: vorher
Webapp 18.90 / Android 12.55, nachher beide 12.55.

Der Test setzt diese abweichende globale Währung jetzt DAUERHAFT und
vergleicht am Ende die beiden Ergebnisse miteinander. Läuft irgendwann wieder
eine zweite Fassung mit, fallen die Wege sofort auseinander und der Test wird
rot — die Regel „gleiches Verhalten" ist damit nicht mehr nur Absicht, sondern
geprüft.

**Zur strukturellen Frage (Marco: „Können die beiden Apps nicht dieselben APIs
nutzen?").** Stand heute: 80 Endpunkte in der App-Familie, 67 in der
Session-Familie, aber nur 17 gemeinsame Handler. Der Boden ist also gelegt,
aber die Mehrheit der Wege ist doppelt implementiert — und genau daher stammen
die letzten zwölf Fehlermeldungen (Kaufpreis, Menge, Löschen, Erfassungen,
Kontowahl, Preisauffüllung). Die Empfehlung steht im Antworttext: EIN Router,
zwei Authentifizierungen davor.

551 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 70 (hardened-169) — Erfassungen: EINE Route für beide Clients

Marcos Vorgabe: „Können die beiden Apps nicht die gleichen APIs nutzen (mit
unterschiedlichen Authentifizierungsarten), damit die Logik nur einmal
implementiert werden muss und das Verhalten immer gleich ist?" — erste Etappe
umgesetzt, für die Erfassungen (dort kamen die meisten Fehler her).

**Neun doppelte Routen entfernt** (GET/PUT/DELETE × Sets/Teile/Minifiguren).
Sie leben nur noch in routes/api_v1/acquisitions.ts. Möglich war das ohne neue
Schicht, weil `requireToken` BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER
Bearer-Token. Es brauchte also nur das Entfernen der Zweitfassung. Das
Frontend ruft an allen zehn Stellen `/api/v1/...`.

**FAST VERLORENGEGANGEN — und der wichtigste Punkt dieses Nachtrags:** Die
Fabrik kannte das Feld `date` gar nicht. Die Änderung des Kaufdatums samt
Tagesregel („pro Tag, Element und Konto genau EIN Eintrag") gab es nur in den
Webapp-Routen. Mit dem Entfernen wäre die Fähigkeit stillschweigend
verschwunden — die App schickt `date` nicht, es wäre also nie aufgefallen.
Gefunden hat es ein bestehender Test, der den gemeinsamen Tagesprüfer
verlangte. Genau dafür sind solche Tests da.

Die Datumsänderung ist jetzt generisch in der Fabrik (cfg.kind), inklusive
Neubestimmung der neuesten Erfassung danach — sonst zeigte die Kachel den Preis
der falschen Zeile.

**Tests: fünf Gruppen umformuliert, nicht abgeschaltet.** Sie schrieben die
Doppelung fest („beide Routenfamilien liefern dasselbe"). Nach dem Umbau lautet
die richtige Aussage anders und ist SCHÄRFER: dieselbe Route, mit Sitzung UND
mit Token aufgerufen, muss dasselbe liefern. Genau das prüft die Parität jetzt
— plus eine Gegenrichtung, die rot wird, falls die alten Zweitfassungen je
zurückkehren.

Am laufenden Server nachgemessen: Sitzung 200, Token 200, gemeinsamer Stand;
Datum ändern 200, ungültiges Datum 400.

**Nächste Etappen** (gleiches Muster): Sets/Teile/Minifiguren als Ganzes, dann
Finanzen und Einstellungen. Nach jeder Etappe volle Suite und ein Paket.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 72 (hardened-170) — Minifiguren: eine Route für beide Clients

Zweite Etappe des Umbaus, bewusst mit der kleinsten Familie begonnen, damit
sich der Ablauf an wenigen Routen bewährt.

**Erst gemessen, dann entfernt** — auf Marcos ausdrückliche Nachfrage, ob die
Endpunkte dasselbe liefern. Alle fünf Paare (GET Liste, GET manuell, POST, PUT,
DELETE) wurden vorher gegeneinander geprüft: Antwort UND Wirkung auf die
Datenbank, jeweils identisch. Erst danach ist die Zweitfassung gefallen.

**Fünf doppelte Routen entfernt**; sie leben nur noch in
routes/api_v1/minifigs.ts. Das Frontend ruft an sieben Stellen /api/v1/….

**Drei Routen sind bewusst geblieben:** /stats, /export/csv und /import/csv gibt
es nur an einem Ort — sie können gar nicht auseinanderlaufen. Sie zu
verschieben wäre Umzug ohne Gewinn.

Tests: Die Kontofilter- und Schreibrecht-Regeln prüfen jetzt
routes/api_v1/minifigs.ts statt der entfernten Session-Route (Regel unverändert,
nur der Ort). Die beiden Paritäts-Paare wurden zu „eine Adresse, beide Ausweise"
umgeformt, und die alten Adressen stehen in der 404-Gegenprobe.

Nachgemessen: POST mit Sitzung 200, POST mit Token 200, beide Figuren angelegt.

**Eigene Panne beim Prüfen:** Mein Kontrollskript schickte zuerst PUT statt POST
und meldete 404 — das sah nach einem echten Fehler aus. Erst der Blick in die
Route zeigte, dass es dort gar kein PUT auf die Sammeladresse gibt. Merke: bei
einer überraschenden 404 zuerst prüfen, ob die eigene Anfrage zur Route passt.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 73 (hardened-171) — Teile: eine Route für beide Clients

Dritte Etappe. NEUN doppelte Routen entfernt (Liste, manuelle Liste, Farben,
Statistik, BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen); sie
leben nur noch in routes/api_v1/parts.ts. Frontend an neun Stellen umgestellt.

**Erst gemessen, dann entfernt — und danach nochmal gemessen** (Marcos
Vorgabe). 18 Fälle gegen den gesicherten Vorher-Stand, jeweils HTTP-Antwort UND
vollständiger Datenbankzustand (alle Spalten aus `parts` und
`part_acquisitions`):

- lesend: Liste, manuelle Liste, Farben, Statistik, beide Farbtabellen
- schreibend: neues Teil, bestehendes Teil (Mengenaddition), ohne Preis, ohne
  Teilenummer (Fehlerfall), Menge ändern, Preis+Zustand ändern, Menge 0,
  unbekanntes Teil, löschen (vorhanden und unbekannt)
- Haushalt: für das Unterkonto anlegen, für ein fremdes Konto anlegen (abgelehnt)

Ergebnis: **18 von 18 identisch.**

Zwei gemeldete Abweichungen entpuppten sich als Messartefakte, was ich erst
beim Aufschlüsseln der einzelnen FELDER sah: Die Liste nennt zusätzlich `page`
(mehr Information, keine andere Auswahl — beide Wege nutzen denselben Handler),
und in der manuellen Liste unterschieden sich Zeilen-IDs und Zeitstempel, weil
mein Prüfaufbau vor jedem Aufruf neue Zeilen anlegt. MERKE für die nächste
Etappe: Beim Vorher/Nachher-Vergleich IDs und Zeitstempel von vornherein
ausblenden, sonst meldet der Vergleich Unterschiede, die keine sind.

**Geblieben** sind /categories, /import/csv und /export/csv — die gibt es nur an
einem Ort.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 74 (hardened-172) — Sets: letzte Etappe des API-Umbaus

SIEBEN doppelte Routen entfernt (Liste, Detail, Anlegen, Ändern, Löschen,
Eigentümerwechsel, Haushaltsmitglieder); sie leben nur noch in
routes/api_v1/sets.ts. Frontend an zehn Stellen umgestellt.

**Verifikation gegen den gesicherten Vorher-Stand** (11 Fälle, jeweils Antwort
UND vollständiger Datenbankzustand): Liste, Detail, unbekanntes Set,
Haushaltsmitglieder, Menge ändern, Menge 0, unbekanntes Set ändern,
Eigentümerwechsel zum Unterkonto, Wechsel zu einem fremden Konto (abgelehnt),
Löschen vorhanden und unbekannt. **Alle schreibenden Fälle identisch.**

Einziger Unterschied: Die Liste nennt zusätzlich `count`. Nachgeprüft, dass die
Webapp `total` liest — das liefert die neue Route unverändert. Ein Feld MEHR,
keines fehlt.

**Bewusst NICHT zusammengelegt** (existiert je nur einmal, kann also nicht
auseinanderlaufen): add-stream und der CSV-Import samt Status, Abbruch und
Fortschritts-Strom (SSE statt einzelner Antwort), die drei Anleitungs-Routen und
/:setNumber/parts (Datei-Uploads), sowie info/:setNumber, export/csv und
export/rebrickable.

**Damit ist der Umbau abgeschlossen.** Über vier Etappen sind 30 doppelte
Routen verschwunden: 9 Erfassungen (70), 5 Minifiguren (72), 9 Teile (73),
7 Sets (74). Jede Etappe wurde vor UND nach dem Zusammenlegen gegen den
Vorher-Stand gemessen.

Tests: zwölf Gruppen umformuliert statt abgeschaltet. Die Paritätsprüfung sagt
jetzt durchgehend „dieselbe Route, mit Sitzung UND mit Token, liefert dasselbe"
— und eine Gegenprobe wird rot, falls eine der alten Zweitfassungen je
zurückkehrt.

**Eigene Falle dabei:** Beim Massen-Umstellen der Test-URLs traf mein Muster
auch die MOUNT-Pfade (`app.use('/api/sets', …)` wurde zu `/api/v1/sets`), was
sieben Testdateien auf einen Schlag rot färbte. Aufgefallen an einer 404, die
inhaltlich keinen Sinn ergab. MERKE: Bei solchen Ersetzungen Mount-Zeilen
ausdrücklich ausnehmen — sie sehen aus wie Aufrufe, sind aber das Gegenteil.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 75 (hardened-173) — Kaufpreis gelöscht, Kachel blieb stehen

**Marcos Screenshot:** Die verbliebene Erfassung zeigt 7.41 CHF, die Kachel
oben weiterhin 9.48 — den Preis der GELÖSCHTEN Zeile.

**Ursache.** Der Lösch-Weg der gemeinsamen Fabrik aktualisierte nur die MENGE
(parentQuantitySql). Preis und Zustand der Elternzeile blieben stehen. Wer die
neueste Erfassung löschte, behielt damit deren Preis in `sets.purchase_price` —
und daraus lesen Kachel, Galerie UND Finanzübersicht.

Der ÄNDERN-Weg macht es seit jeher richtig („es gilt der Wert der neuesten
Erfassung"); der LÖSCHEN-Weg hatte diese Regel nie. Wieder „dieselbe Regel fehlt
am zweiten Weg" — diesmal zwischen zwei Zweigen derselben Datei, also auch nach
dem Zusammenlegen der Routen noch möglich. Das Zusammenlegen beseitigt die
Doppelung ZWISCHEN den Clients, nicht die zwischen Ändern und Löschen.

Fix: Nach dem Löschen wird die jetzt neueste verbliebene Erfassung bestimmt und
ihr Preis samt Zustand in die Elternzeile geschrieben. Bleibt keine übrig, wird
nichts überschrieben — dann ist der Bestand ohnehin leer.

Am laufenden Server in Marcos Lage nachgestellt: vorher Kachel 9.48 bei
verbliebener Erfassung 7.41, nachher 7.41. Test
`test/acquisition-delete-refresh-db.test.js` prüft zusätzlich die Gegenrichtung
(eine ÄLTERE Erfassung löschen darf den Preis NICHT ändern) und den Fall ohne
verbliebene Erfassung. Gegenprobe bestanden.

553 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
