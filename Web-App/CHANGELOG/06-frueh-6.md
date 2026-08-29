# Vor der Nummerierung, Teil 6

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachweis: Teilverschiebung kopiert, sie verschiebt nicht

Angefragt: Wird einer von mehreren Kaufpreisen umgehängt, sollen Set, Teile und
Minifiguren in **beiden** Konten existieren.

Das tut hardened-109 bereits — belegt war es aber nur für die Teile. Der
Datenbanktest prüft jetzt alle vier Tabellen (`sets`, `parts`, `minifigs`,
`instructions`) auf beiden Seiten, und zwar auf **genau eine** Zeile je Konto:
Doppelte Zeilen zählte die Teile-Zusammenfassung zweimal, denn die Menge steckt
in `sets.quantity`, nicht in der Zahl der Zeilen.

Zusätzlich hält ein Struktur-Test fest, dass im Teilfall beim Absender **nichts
gelöscht** wird — nur die Stückzahl sinkt. Das ist die Stelle, an der ein
späterer Umbau am leichtesten Schaden anrichtet: Ein `DELETE` aus dem
Vollständig-Zweig, versehentlich eine Ebene zu hoch gezogen, liesse den
Absender mit einem Exemplar ohne Teile zurück — und das fällt erst auf, wenn
jemand seine Teileliste durchsieht.

Zur Klarheit: Beim vollständigen Verschieben (letztes Exemplar) verschwindet
alles beim Absender, das bleibt unverändert.

Stand: 397 Tests, 0 Fehler, 0 übersprungen gegen echtes Postgres.

---
## Kontofilter: jedes Unterkonto einzeln — und er greift jetzt überall

### Ein Eintrag je Unterkonto

Die Auswahl führt jetzt **Alle Konten**, **Eigene** und dann jedes Unterkonto
**namentlich**. Der Sammelposten „Unterkonten" bleibt, erscheint aber nur ab
zwei Kindern — bei einem einzigen wäre er dasselbe wie dessen Name, also eine
Wahl ohne Unterschied.

Serverseitig reist dann die Konto-ID mit (`accounts=<id>`). `scopeIds()` prüft,
ob sie zum Haushalt gehört, und fällt sonst auf das ganze Blickfeld zurück:
**Der Filter ist eine Ansichtshilfe, kein Zugriffsweg.** Ein Test hält fest,
dass eine kontofremde ID nichts freischaltet und ein Unterkonto sich damit
nicht ins Geschwisterkonto sehen kann.

Die Optionen baut jetzt das Frontend (`initScopeSelects`), nicht mehr das
Markup — die Namen kennt erst der Server. Zeigt eine gespeicherte Wahl auf ein
inzwischen entkoppeltes Konto, fällt sie auf „Alle" zurück statt eine leere
Auswahl anzuzeigen.

### Gemeldet: der Filter griff bei manuellen Teilen und Minifiguren nicht

Zwei Ursachen, beide in der Webapp:

**1. Der Umschalter lud die falsche Liste neu.** Die Reiter Teile und
Minifiguren haben je **zwei** Listen — die aus Sets und die manuell erfassten,
die über einen eigenen Endpunkt lädt. `onScopeChange` rief für Teile nur
`loadParts()`; der manuelle Bereich darüber blieb stehen, wie er war. Jetzt
wird auch `loadManualParts()` gerufen (bei den Minifiguren erledigt das
`loadMinifigs()` bereits).

**2. Vier Bewertungsabfragen liefen ungefiltert.** Die Wertangaben neben den
manuellen Listen und die beiden Banner im Finanzreiter holten ihre Summen ohne
`accounts=`. Dadurch stand ein Zähler aus einem Blickfeld neben einer Summe aus
einem anderen — schlimmer als gar kein Filter, weil es nach einer stimmigen
Zahl aussieht. Wichtig dabei: Die Banner im Finanzreiter tragen den Filter der
**Finanzen**, die Angaben neben den Listen den ihres eigenen Reiters.

### Tests

Neu gegen echtes Postgres: einzelne Konto-IDs im Filter, die Abweisung einer
kontofremden ID, und dass `getManualParts`/`getManualMinifigs` unter dem Filter
nur die Einträge des gewählten Kontos liefern.

Stand: `tsc --noEmit` sauber, 398 Tests, 0 Fehler, 0 übersprungen.

---
## Haushalt: die letzten Endpunkte für die Android-App

Damit die App alles erreichen kann, was die Webapp seit hardened-101 kann:

* `GET /api/v1/sets/household-members` — Konten für Kontofilter, Kontoauswahl
  und Verschieben. Steht **vor** `/sets/:setNumber`: Express probiert der Reihe
  nach, und der Platzhalter würde „household-members" sonst als Setnummer lesen.
* `POST /api/v1/sets/:sn/move` — ganzes Set oder einzelne Kaufpreise
  (`acquisition_ids`), über dieselbe Umsetzung wie die Webapp-Route.
* `owner_user_id` an `POST /api/v1/sets`, `/parts` und `/minifigs` — Erfassen
  für ein Unterkonto. Ohne Angabe bleibt es beim eigenen Konto;
  `resolveWriteTarget()` prüft die Richtung, nicht bloss die Mitgliedschaft im
  Blickfeld.

Alle vier in der Inventur auf `paritaet` gestellt.

Stand: `tsc --noEmit` sauber, 398 Tests, 0 Fehler, 0 übersprungen gegen echtes
Postgres.

---
## Verschieben nur noch über den Kaufpreis

Der Verschieben-Kasten im Set-Dialog ist entfernt — in Webapp und App. Bestand
wandert ausschliesslich über die **Eigentümer-Auswahl je Kaufpreis-Zeile**. Wer
ein ganzes Set verschieben will, ändert jede Zeile einzeln.

Der Grund ist nicht Bequemlichkeit, sondern Ehrlichkeit der Anzeige: Ein Set
mit drei Erfassungen sind drei Käufe, und im Haushalt können sie verschiedenen
Kindern gehören. „Das Set verschieben" verdeckt, was tatsächlich wandert — beim
Ändern jeder Zeile sieht man, wie viele es sind.

**Die Regel hängt am Server, nicht an der Oberfläche.**
`POST /api/sets/:sn/move` (und die v1-Route) antwortet ohne `acquisition_ids`
mit 400. Ein Klient, der die Oberfläche umgeht, bekommt keine Ausnahme. Der
Helfer `moveSetBetweenAccounts()` bleibt unverändert — er konnte den Teilfall
schon immer, jetzt ist er der einzige Fall.

**Manuelle Teile und Minifiguren können es jetzt auch.** Bisher liessen sie
sich gar nicht zwischen Konten verschieben; die Regel „nur über den Kaufpreis"
gilt für alle drei Arten, also brauchen sie denselben Weg.
`moveManualAcquisition()` in `utils/setMove.ts` ist die Umsetzung — deutlich
einfacher als bei Sets, weil ein manuell erfasstes Teil keinen Inhalt hat:
keine Unterteile, keine Minifiguren, keine Anleitungen. Es wandern nur Menge
und Erfassung, letztere durch `recordAcquisitionForDay()`, damit im Zielkonto
keine zwei Zeilen desselben Tages entstehen. Bleiben dem Absender Exemplare,
sinkt nur die Stückzahl; geht das letzte, verschwindet seine Stammzeile — eine
Zeile mit Menge 0 ist bei einem manuellen Eintrag kein Bestand, sondern
Ballast.

Angebunden an `PUT /parts/:partNumber/:colorId/acquisitions/:id` und
`PUT /minifigs/:figNumber/acquisitions/:id` über `owner_user_id`, genau wie bei
Sets. Läuft vor allen anderen Feldern und beendet die Anfrage: Preis oder Datum
derselben Zeile im selben Aufruf zu ändern hiesse, sie zweimal zu suchen —
einmal beim Absender, einmal beim Empfänger, wo sie womöglich schon mit einer
Tageszeile verschmolzen ist.

**Nebenwirkung:** Beide Erfassungslisten (Teile und Minifiguren) liefern jetzt
das Blickfeld statt nur des eigenen Kontos und je Zeile `owner_user_id` — sonst
wüsste die Auswahl nicht, worauf sie steht. Webapp und `/api/v1` gleichermassen.

**Tests.** Zwei Struktur-Prüfungen (400 ohne `acquisition_ids`, kein
Verschieben-Kasten mehr in Markup und JS; manuelle Arten über denselben Helfer
mit 403 ohne Schreibrecht) und eine gegen die Datenbank, die den 400er
tatsächlich abholt.

Stand: `tsc --noEmit` sauber, 401 Tests, 0 Fehler, 0 übersprungen gegen echtes
Postgres.

---
## Kaufpreis-Dialog breiter

Seit der Eigentümer-Spalte hat die Tabelle sechs Spalten — Menge, Datum,
Zustand, Preis, Eigentümer, Löschen. Bei den bisherigen 560px lag darüber ein
waagerechter Rollbalken, und ein Dialog, in dem man seitwärts scrollen muss, um
den Löschknopf zu sehen, ist eine Falle.

Jetzt 780px, dazu eine eigene Klasse `.acq-wide`, die etwas Innenabstand
wegnimmt und die Zellen enger setzt — der Platz gehört der Tabelle. Preis- und
Mengenfeld sind ein paar Pixel schmaler.

Der Rollbalken (`.tw{overflow-x:auto}`) bleibt als Rückfall für schmale
Telefone. Dort hilft keine Breite mehr, und die Alternative wäre, Spalten zu
verstecken — was bei einer Tabelle zum Bearbeiten schlechter ist als scrollen.

Gilt für beide Dialoge: Sets und manuelle Einträge teilen sich dieses Fenster.


---

# Review-Reihe hardened-115 bis 125

Elf Durchgänge über Security, Architektur, Performance und
Benutzerfreundlichkeit, ursprünglich in CHANGELOG-hardened-115.md gesammelt.
Hierher überführt, als die Datei bei zehn Nachträgen angekommen war: Ein
Changelog, der nur noch angehängt wird, liest irgendwann niemand mehr — und
die Punkte sind abgeschlossen und verifiziert (zuletzt 428 Tests gegen echtes
Postgres 16).

Die Reihenfolge ist chronologisch, nicht nach Wichtigkeit. Wer nur die
Sicherheitspunkte sucht: Nachtrag 3 (Sitzungen überlebten den
Passwortwechsel), Nachtrag 9 (Anleitungen im Haushalt) und Punkt 27 (jedes
Konto konnte den Preis-Cache leeren).
## Review hardened-115 — Eigentümerwechsel, Build-Artefakte, Mengensperre, CSP

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (407 Tests, 0 Fehler, 0 übersprungen).

---

### 1. Eigentümerwechsel griff die falsche Zeile (Webapp) — Fehler

`utils/household.ts`, `routes/sets.ts`, `routes/parts.ts`, `routes/minifigs.ts`,
`public/js/07-admin.js`

Beide Kaufpreis-Dialoge schickten `from_user_id = _acqOwnerId` mit — und das ist
die Dialog-Ebene, also der **Betrachter**. Der Eigentümer der einzelnen Zeile
stand in `a.owner_user_id`, wurde aber nur zum Vorauswählen des Selects benutzt.

Folge im Haushalt: Zog das Hauptkonto eine Zeile, die einem Unterkonto gehört,
zu sich, kam beim Server `from = to = Hauptkonto` an — und der Zweig
`if (from === to) return res.json({ success: true, unchanged: true })` antwortete
mit **Erfolg, ohne dass irgendetwas wanderte**. Kein Fehler, keine Meldung, die
Zeile blieb liegen. Die Android-App war nicht betroffen (`acq.ownerUserId`).

Neu: `acquisitionMoveSource(actorId, kind, acqId)` in `utils/household.ts`
ermittelt den Absender aus der **Zeile**; ein mitgeschicktes `from_user_id` wird
ignoriert. Die Richtungsprüfung bleibt (`canWriteFor`) — eine fremde Zeile
antwortet 403, eine nicht existierende 404. Die Webapp schickt `from_user_id`
gar nicht mehr.

Der Server ist damit die einzige Stelle, die weiss, wem eine Erfassung gehört —
ein Dialog kann die Frage nicht mehr falsch beantworten.

### 2. Eigentümerwechsel über die App war ein stiller No-op — Fehler

`routes/api_v1/acquisitions.ts`

Die Android-App schickt `owner_user_id` an die v1-PUT-Routen. Die gemeinsame
Fabrik dort las aber nur Menge, Preis und Zustand: Die Anfrage lief als **leeres
Update** durch und antwortete `success: true`. Der Wechsel sah in der App aus wie
erledigt (die Liste lud neu), tatsächlich bewegte sich nichts.

Neu: derselbe Eigentümer-Zweig wie in den Session-Routen, für alle drei Arten,
über dieselbe Umsetzung (`utils/setMove.ts`) und mit demselben Sperrschlüssel —
Webapp- und App-Verschiebungen desselben Bestands warten damit aufeinander.

### 3. Rund 60 veraltete Build-Artefakte im Quellbaum

Ein `node scripts/build-ts.js` **ohne** `--outdir` hatte die `.js` wieder neben
ihre Quellen geschrieben (`server.js`, `db/`, `jobs/`, `routes/`, `utils/`).
Sie waren nachweislich alt: `utils/setMove.js` fehlte, der Lauf lag also vor
hardened-109.

Das ist mehr als Unordnung: `server.ts` lädt Module per `require()` ohne Endung,
und Node nimmt eine vorhandene `.js` vor der `.ts` — `npm run dev` konnte
stillschweigend veralteten Code ausführen. Dateien entfernt;
`test/build-tooling.test.js` lässt keine `.js` mehr neben den Quellen zu.

### 4. Mengenänderung lief ohne Sperre und verschluckte Fehler

`routes/sets.ts`

`updateSet()` setzte `sets.quantity` und rief danach
`adjustAcquisitionsToQuantity(…).catch(() => {})` — zwei lose Statements, ohne
Transaktion, ohne Advisory-Lock, mit verschlucktem Fehler. Scheiterte der zweite
Schritt, blieb die Menge erhöht, während die Erfassungen auf dem alten Stand
standen: genau der Drift, gegen den es `utils/txLock.ts` gibt, nur ohne jede
Logzeile. Alle anderen Schreibwege am Bestand laufen längst unter der Sperre.

Neu: beides in **einer** gesperrten Transaktion. Damit der Netzaufruf nicht in
der offenen Transaktion hängt, ist die Preisermittlung als
`priceForNewAcquisition()` herausgezogen und läuft **vor** der Sperre — dasselbe
Muster wie in `routes/api_v1/acquisitions.ts`. Reihenfolge (Cache → BrickLink →
Historie) und Ergebnis unverändert, gegen echtes Postgres nachgestellt:
Erhöhung legt die Tageszeile an, Reduktion bleibt LIFO.

### 5. CSP: `img-src` ohne fremde Hosts

`server.ts`

`img-src` trug ein pauschales `https:` mit der Begründung, Set-Bilder kämen
direkt von den CDNs. Seit hardened-69 stimmt das nicht mehr: `imgUrl()` schickt
jede absolute Adresse durch `/api/img-proxy`, und alle Bilder verlangen
Anmeldung. Die Erlaubnis blieb nur stehen — und ein eingeschleustes
`<img src="https://fremd/?daten">` ist eine Anfrage nach draussen, auch ohne
ausführbares Skript. Genau den Kanal schliesst `connect-src 'self'` auf der
anderen Seite. Jetzt `img-src 'self' data: blob:`, per Test festgehalten.

### 6. Aufräumen (Android)

`ui/screens/PartsScreen.kt`: `ManualItemCard` entfernt — die Composable wurde
nirgends mehr aufgerufen (seit die Kacheln über `ManualItemComposables.kt`
laufen) und trug den gemeldeten ungenutzten `purchasePrice`.

---

### Offen

**Google Fonts kommen weiterhin von `fonts.googleapis.com`** (`public/index.html`).
Das ist die letzte Fremdquelle, nachdem qrcodejs genau deswegen nach
`public/vendor/` gezogen ist. Im reinen LAN-/Offline-Betrieb fällt die Typografie
auf Systemschriften zurück. Selbst hosten würde zusätzlich `style-src` und
`font-src` auf `'self'` bringen — dafür müssen die Schriftdateien einmal
heruntergeladen und ins Repo gelegt werden.

---
## Nachtrag — die beiden offenen Punkte

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (411 Tests, 0 Fehler, 0 übersprungen).

### 7. Google Fonts sind weg — die Oberfläche lädt von keinem Fremdhost mehr

`public/vendor/fonts/`, `public/index.html`, `server.ts`

Die Schriften liegen jetzt im Haus: vier woff2 unter
`public/vendor/fonts/files/` plus `fonts.css` und beide OFL-Lizenztexte,
genau wie qrcodejs unter `vendor/qrcode/`. Bezogen als variable Schnitte über
`npm pack @fontsource-variable/plus-jakarta-sans @fontsource-variable/jetbrains-mono` —
eine Datei je Familie deckt den ganzen Gewichtsbereich ab, statt fünf
Einzelgewichten für Jakarta und zwei für Mono. Latein und Latein-erweitert,
zusammen rund 104 KB; die -ext-Datei lädt der Browser nur, wenn ein Zeichen
daraus vorkommt.

Die Familien sind bewusst ohne den Zusatz „Variable“ deklariert — `styles.css`
(`--font`, `--mono`) bleibt dadurch unverändert. In `index.html` ersetzt ein
`preload` der beiden Latein-Dateien die früheren `preconnect`-Zeilen; die
Cache-Busting-Versionierung greift automatisch, weil `scripts/bump-version.js`
alle `.css?v=`-Referenzen umschreibt.

`style-src` und `font-src` stehen damit auf `'self'`. Zusammen mit dem
`img-src`-Fix oben erlaubt die CSP jetzt **keinen einzigen fremden Host** mehr.
Zwei Tests halten das fest: kein ladendes Element mit fremdem Host in
`index.html` (ein `<a href>` zu rebrickable/brickset bleibt erlaubt — ein
Verweis holt nichts nach), und die in `fonts.css` referenzierten Dateien müssen
existieren.

### 8. Stille Schreibfehler auf den Bestandstabellen

Die „~20“ aus dem ersten Review waren eine gefilterte Teilmenge; im Baum stehen
217 `.catch(() => {})`. Die pauschal zu entfernen wäre falsch — die meisten
sitzen auf Bild-Caches, Aufräumschritten und Fremd-APIs, wo Weiterlaufen
richtig ist. Sortiert nach Schadensklasse:

**Fehler durchreichen** — Zustands- und Preis-Spiegelungen in `sets.ts`,
`parts.ts`, `minifigs.ts`, auch die Stellen *innerhalb* von Transaktionen. Dort
ist ein verschluckter Fehler besonders teuer: Postgres bricht beim ersten
Fehler ab, alle folgenden Statements laufen ins Leere — und der Aufrufer bekommt
trotzdem `success: true`.

**Datenintegrität** — das Löschen der Kaufpreis-Historie nach dem Löschen eines
manuellen Teils oder einer Minifigur, in allen vier Routen (Session und v1).
Verschluckt hiess: Stammzeile weg, Erfassungen bleiben. Finanzsummen und
Portfoliokurve lesen die *Erfassungen* — ein gelöschtes Teil hätte dort
dauerhaft weitergezählt, und zwar unsichtbar, weil keine Ansicht verwaiste
Erfassungen zeigt. Nachgestellt gegen echtes Postgres: Erfassungen sind nach dem
Löschen weg.

**Loggen statt schweigen** — neuer Helfer `logAndContinue(kontext)` in
`utils/httpError.ts` für Schritte, die tatsächlich weiterlaufen sollen:
Bild-Cache-Pflege, Brickset-Metadaten beim Import, CSV-Kaufdatum, Einzelzeilen
des Minifiguren-Imports, die beiden Backfill-Jobs. Begründung im Helfer: Ein
leerer Catch sagt „darf scheitern“ *und* „niemand erfährt davon“. Das erste ist
oft richtig, das zweite fast nie — ein Job, der bei jeder Zeile scheitert, sah
im Log genauso aus wie einer, der sauber durchläuft.

Ein Test hält den Zustand: Auf `sets`, `parts`, `minifigs`, den drei
Erfassungstabellen und `instructions` ist ein leerer Catch nicht mehr erlaubt —
entweder durchreichen oder `logAndContinue()`. Anderswo bleibt er zulässig.

---
