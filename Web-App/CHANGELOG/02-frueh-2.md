# Vor der Nummerierung, Teil 2

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Korrektur: fehlender Import nach der Navigationsaufteilung

`AppNavigation.kt:234 — Unresolved reference 'authGraph'`

Die vier Graph-Funktionen liegen in `ch.brickinventoryapp.nav`, `AppNavigation.kt`
im Wurzelpaket `ch.brickinventoryapp`. Den Import dazwischen habe ich beim
Erzeugen schlicht vergessen — genau die Klasse Fehler, für die der Zuschnitt
gedacht war (Compilerfehler statt stiller Verhaltensänderung), nur eben eine,
die ich vorher hätte sehen können.

Ergänzt:

```kotlin
import ch.brickinventoryapp.nav.authGraph
import ch.brickinventoryapp.nav.collectionGraph
import ch.brickinventoryapp.nav.catalogGraph
import ch.brickinventoryapp.nav.toolsGraph
```

Gegenprobe: Alle vier in `nav/` definierten Funktionen werden in
`AppNavigation.kt` benutzt und sind jetzt alle importiert — keine weitere Lücke
dieser Art.

Die umgekehrte Richtung geprüft: Die nav-Dateien greifen auf `MainScaffold`
(Wurzelpaket), die Screens (`ui.screens`) und `Screen`/`AppUiState` (`ui`) zu.
Alle drei Pakete sind in jeder der vier Dateien per Wildcard importiert.

---
## Korrektur: doppelter Import in den nav-Dateien

`AuthGraph.kt:24 — Conflicting import: imported name 'AppUiState' is ambiguous`

Beim Erzeugen habe ich den Importblock aus `AppNavigation.kt` übernommen **und**
zusätzlich explizite Importe angehängt. `ch.brickinventoryapp.ui.AppUiState` kam
dadurch zweimal vor; Kotlin wertet einen doppelten expliziten Import desselben
Namens als Konflikt.

Entfernt: das jeweils zweite Vorkommen in allen vier Dateien. `AppUiState` bleibt
über `import ch.brickinventoryapp.ui.*` sichtbar, das in jeder Datei steht.

**Gegenprobe auf dieselbe Fehlerklasse:** Kein einziger Typname des Projekts
existiert in mehr als einem Paket — es gibt also keine echte Mehrdeutigkeit, die
über die Wildcard-Importe hereinkommen könnte. Nach dieser Bereinigung hat keine
der vier Dateien mehr einen doppelten Import.

---
## Korrektur: Inline-`<script>` blockiert nach dem CSP-Schluss

`Executing inline script violates 'script-src 'self' https://cdnjs.cloudflare.com'`

Bei der Handler-Umstellung habe ich ausschliesslich `on*="…"`-Attribute
gesucht — und die Skript**blöcke** nie angesehen. In `index.html` stand ein
`<script type="module">`, das PDF.js lädt und als `window.pdfjsLib`
bereitstellt. Eigene Fehlerklasse, gleiche Wirkung: Von `script-src` ohne
`'unsafe-inline'` wird das blockiert.

Der Block liegt jetzt in `public/js/pdfjs-boot.js` und ist als externe Datei von
`'self'` gedeckt. Endung bewusst `.js` und nicht `.mjs`: Der Versions-Bumper in
`scripts/bump-version.js` ersetzt `\.js\?v=` — bei `.mjs?v=` hätte er nicht
gegriffen und die Cache-Busting-Version wäre eingefroren.

**Mitgeprüft:** `worker-src 'self' blob:` ist in der CSP vorhanden. Ohne diese
Direktive wäre der PDF.js-Worker auf `default-src` zurückgefallen und der
nächste Fehler gewesen.

**Test.** Zwei Fälle ergänzt: kein `<script>` ohne `src` in `index.html`, und
`worker-src` muss gesetzt bleiben.

Die Meldungen `vendor.js:132` und `tabs:outgoing.message.ready` aus derselben
Konsole stammen von einer Browser-Erweiterung, nicht von der App.

---
## Preise: Rückfall von `sold` auf `stock`

`routes/bricklink.ts`, `utils/financeCalc.ts`

`sold` (verkauft, letzte sechs Monate) ist die ehrlichere Grundlage — aber für
selten gehandelte Artikel gibt es in sechs Monaten schlicht keinen Verkauf, und
BrickLink antwortet dann mit `avg_price = 0`. Ohne Rückfall stünde dort dauerhaft
kein Marktpreis. Bei einzelnen Teilen in seltenen Farben ist das der Normalfall.

`getPriceGuide()` ist jetzt ein Wrapper: erst `sold`, und nur wenn dort kein
brauchbarer Preis steht, `stock`. Das Ergebnis trägt `guide_used` (und bei
Rückfall `guide_fallback: true`), damit nachvollziehbar bleibt, woher der Wert
kommt. Die eigentliche Abfragelogik samt Gear-/Book-Kette liegt unverändert in
`getPriceGuideRaw()`.

Teile- und Minifiguren-Preise gehen nicht über `getPriceGuide()`, sondern rufen
`bricklinkRequest` direkt — dort ist derselbe Rückfall einzeln ergänzt.

Der bestehende Test wurde präzisiert: `guide_type: 'stock'` ist jetzt erlaubt,
aber **nur als Rückfall** (erkennbar am vorangestellten Spread). Als
Erstabfrage schlägt er weiterhin rot.

### Zu den 76.03 CHF bei 10290-1

Deine Screenshots legen etwas anderes nahe als fehlende Daten. BrickLink zeigt
für das Set:

| | Neu | Gebraucht |
|---|---|---|
| Verkauft (6 Mon.), Avg | **US$ 148.72** | US$ 97.23 |
| Aktuelle Angebote, Avg | US$ 175.54 | US$ 113.98 |

76.03 CHF sind bei rund 0.80 CHF/USD etwa **95 US$** — das liegt auf dem
Gebraucht-Verkaufspreis von 97.23, nicht auf irgendeinem Neu-Wert.

Es wird also weiterhin der **Gebraucht**-Preis angezeigt, obwohl das Set nur
eine Neu-Erfassung hat. Für „Neu, verkauft" gibt es bei diesem Set aber
Verkäufe (35 Stück) — der Wert wäre da.

Naheliegendste Erklärung: In `price_cache` steht noch ein alter Eintrag. Die
Zeile für Neu stammt aus der Zeit vor der Umstellung und trägt vermutlich
`avg_price = 0`; der Zustands-Fallback greift dann korrekt auf Gebraucht zurück.
Solange der Eintrag im TTL-Fenster liegt, wird nichts neu geholt.

```sql
DELETE FROM price_cache;
```

Danach holt der Preisjob mit der jetzigen Logik neu. Wenn danach immer noch 76
statt 148 dasteht, ist es kein Cache-Problem und ich schaue mir den Abruf
konkret an.

---
## Fix: Minifiguren-Bilder luden alle gleichzeitig

`public/js/06-minifigs.js`, `04-finance.js`, `08-init.js`

Die Thumbnail-Umstellung war bei den Minifiguren bereits drin — der Aufruf ist
identisch zu Teilen und Galerie. Das Problem lag woanders: **Drei der vier
`<img>`-Tags hatten kein `loading="lazy"`.**

Damit startet der Browser sämtliche Bilder einer Liste gleichzeitig und drängt
sie durch die rund sechs Verbindungen pro Host. Sie tröpfeln dann sichtbar
herein — genau das Bild, das du beschreibst. Teile und Galerie hatten das
Attribut, die Minifiguren-Ansicht nicht.

Ergänzt an allen drei Stellen (Tabellenzeile, beide Kachel-Varianten), dazu
`decoding="async"`.

**Dieselbe Lücke fand sich in zwei weiteren Ansichten:** beide Bildspalten in
`04-finance.js` und die 44-px-Vorschau in `08-init.js`.

Nebenbei entfernt: In der Minifiguren-Kachel stand `thumbUrl(imgSrc)`, wobei
`imgSrc` bereits eine fertige Proxy-URL war. `thumbUrl()` reicht solche URLs
unverändert durch — der Aufruf war wirkungslos und nur verwirrend.

**Test.** `test/parts-paging.test.js` um einen Fall erweitert: Jedes dynamisch
erzeugte `<img>` in `public/js/0x-*.js` muss `loading="lazy"` tragen.
Platzhalter-SVGs sind ausgenommen. Damit fällt die nächste Ansicht ohne
verzögertes Laden beim Testlauf auf.

Stand: `tsc --noEmit` sauber, 85 Frontend-Tests grün.

---
## Fix: Android-App lud keine Daten — Zustand war eingefroren

**Fehlerbild:** Galerie und Finanzen zeigten dauerhaft den Ladeindikator, Teile
und Minifiguren „keine Einträge". Nur der Katalog funktionierte.

**Ursache — und es ist genau der Fehler, vor dem ich bei Punkt 9 gewarnt hatte.**

Beim Aufteilen von `AppNavigation.kt` habe ich `state` als Parameter an die
Graph-Funktionen durchgereicht:

```kotlin
collectionGraph(vm, navController, state, …)
```

Der `NavHost { … }`-Builder wird aber **nur einmal** ausgeführt — der Graph wird
danach von Navigation-Compose gehalten. Der übergebene Wert ist damit für immer
die Momentaufnahme vom ersten Frame: leere Listen, `isLoading = true`. Die Ziele
lasen anschliessend nie wieder etwas Neues.

Warum der Katalog lief: `CatalogScreen` liest seinen Zustand seit jeher
**innerhalb** des Ziels (`vm.catalogState.collectAsStateWithLifecycle()`) und
abonniert damit Änderungen. Genau das ist der Unterschied.

**Lösung:** `state` und `manDetailState` sind aus den Parameterlisten
verschwunden. Jedes Ziel liest den Zustand jetzt selbst:

```kotlin
composable(Screen.Gallery.route) {
    val state by vm.state.collectAsStateWithLifecycle()
    …
}
```

13 Ziele brauchten `state`, davon zwei zusätzlich `manDetailState`. Geprüft:
keine doppelte Deklaration im selben Block (der Katalog hatte bereits eine
eigene), Klammerbilanz in allen fünf Dateien ausgeglichen.

**Was ich daraus mitnehme:** Ich hatte dieses Fehlerbild wörtlich benannt — „eine
App, die baut, aber deren Ansicht bei bestimmten Zustandsänderungen nicht mehr
aktualisiert" — und dann die Variante gewählt, die es erzeugt. Die Begründung
damals war, dass explizite Parameter Compilerfehler produzieren statt stiller
Verhaltensänderungen. Das stimmt für fehlende Parameter; für einen Compose-State,
der ausserhalb der Recomposition gelesen wird, stimmt es nicht. Die Aufteilung
wäre besser gar nicht gemacht worden, als sie ohne laufende App zu machen.

---
## Preise: warum der sold→stock-Rückfall bisher nie greifen konnte

Der Rückfall in `getPriceGuide()` war seit zwei Runden drin — er lief nur nie
an. Der Grund liegt eine Ebene davor, in `fetchPrice()`:

```js
if (cached && parseFloat(cached.avg_price) === 0) {
  // … versucht den anderen ZUSTAND aus dem Cache
  return { …, no_price: true };     // ← gibt auf, OHNE neu zu fragen
}
```

Ein gecachter Null-Preis galt für das **volle TTL-Fenster** als endgültige
Antwort. Es wurde nie erneut abgefragt — und damit kam der sold→stock-Rückfall
nie zum Zug, denn der greift erst beim Abruf.

Schlimmer noch: Statt neu zu fragen, wich die Logik auf den **anderen Zustand**
aus. Für 10290-1 heisst das: Neu-Eintrag mit 0 im Cache, Gebraucht-Eintrag mit
Preis → angezeigt wird der Gebraucht-Preis. Das sind deine 76.03 CHF, die
umgerechnet auf dem Gebraucht-Verkaufspreis von US$ 97.23 liegen.

**Lösung:** Ein Eintrag ohne Preis bekommt ein eigenes, kürzeres Fenster
(`ZERO_PRICE_TTL_HOURS = 6`, bzw. das TTL, falls kleiner). Innerhalb dieser
sechs Stunden gilt er wie bisher; danach fällt er durch und löst einen
Neuabruf aus — und dort greift dann der Rückfall auf `stock`.

Kürzeres Fenster statt gar keinem, damit Artikel, die tatsächlich nirgends
gehandelt werden, ein paar Mal am Tag neu versucht werden und nicht bei jedem
Seitenaufruf.

Zusätzlich: `fetched_at` gehört jetzt zu `PRICE_CACHE_COLS`, sonst liesse sich
das Alter eines Eintrags gar nicht bewerten — auch nicht in der Vorlade-Map für
die Massenbewertung.

Verhalten geprüft:

```
Preis vorhanden, 20 h alt      → Cache gilt
0-Preis, 2 h alt               → Cache gilt (noch nicht neu fragen)
0-Preis, 8 h alt               → neu holen
0-Preis, TTL kürzer als 6 h    → neu holen
```

**Test.** `test/set-value.test.js` um einen Fall erweitert: `ZERO_PRICE_TTL_HOURS`
und `cacheUsable()` müssen existieren, ein alter 0-Eintrag muss durchfallen, und
ein vorhandener Preis muss **vor** jeder Ausweichlogik zurückgegeben werden.

Damit sollte auch ohne `DELETE FROM price_cache` innerhalb von sechs Stunden der
richtige Wert erscheinen. Wenn du nicht warten willst, geht das Leeren der
Tabelle weiterhin schneller.

---
## Drei Fehler aus dem Betrieb

### 1. „+" bei manuell erfassten Teilen machte aus 1 eine 11

`public/js/07-admin.js`, `05-settings.js`

Folgefehler meiner CSP-Umstellung, und ein systematischer: Der Dispatcher reicht
`data-arg` **immer als Zeichenkette** durch. Vorher stand im Markup
`onclick="manQtyChange(-1)"` — eine Zahl. Jetzt kommt `"1"` an, und
`parseInt(inp.value) + "1"` ergibt die Zeichenkette `"11"`.

Ich habe alle acht Handler durchgesehen, die vorher Zahlen bekamen. Zwei waren
tatsächlich kaputt:

- `manQtyChange(delta)` — rechnet mit dem Wert. Jetzt `parseInt(delta) || 0`.
- `toggleAdmin(uid, isAdmin)` — bildete `{is_admin: !isAdmin}`. **`!"0"` ist
  `false`**, weil jede nicht-leere Zeichenkette truthy ist. Das Umschalten der
  Admin-Rolle setzte damit *immer* auf „kein Admin". Jetzt explizit verglichen.

Die übrigen sechs (`acqDelete`, `acqSave`, `delInstr`, `delUser`, `openRpw`,
`openManDetail`) verwenden ihre IDs nur in URLs oder wandeln bereits selbst um —
dort ändert sich nichts.

### 2. Thumbnail auch in Detailansicht und Zoom

`public/js/01-core.js`, `07-admin.js`, `11-actions.js`, `06-minifigs.js`

Neu ist `fullUrl()` als Gegenstück zu `thumbUrl()`: entfernt `&thumb=1` aus
Proxy-URLs und den `_thumb`-Teil aus lokalen Pfaden. Verwendet in der
Set-Detailansicht, in der Detailansicht manuell erfasster Teile und im Zoom.

Der Zoom nahm bisher `this.src` — also genau die verkleinerte Kachelfassung.
Jetzt bevorzugt er `data-orig` und schickt das Ergebnis zusätzlich durch
`fullUrl()`.

Nebenbei: In der Minifiguren-Kachel war `data-orig` **dieselbe** Thumb-URL wie
`src`. Der Fehler-Rückfall hätte damit exakt dieselbe Adresse erneut geholt.

### 3. Wiederholte 404 auf den Bild-Proxy

`server.ts`

`cdn.rebrickable.com/media/sets/fig-009434/108116.jpg` gibt es beim CDN nicht —
der Proxy reicht den 404 korrekt durch. Nur holte der Browser das Bild bei
jedem Seitenaufruf erneut, und jedes Mal ging ein Roundtrip zum CDN raus.

Neu merkt sich der Proxy 404- und 403-Antworten eine Stunde lang und beantwortet
weitere Versuche sofort. Eine Stunde, damit ein nachgereichtes Bild nicht
dauerhaft ausgesperrt bleibt.

Das fehlende Bild selbst ist ein Datenproblem: `image_url` in deiner Datenbank
zeigt für diese Minifigur auf einen Pfad unter `/media/sets/`, den Rebrickable
nicht (mehr) bedient.

### Tests

`test/parts-paging.test.js` um vier Fälle erweitert: `fullUrl()` muss existieren
und in Detailansicht wie Zoom verwendet werden, `data-orig` darf nicht mit `src`
identisch sein, der Negativ-Cache muss 404/403 merken, und die beiden Handler
müssen ihre Zeichenketten-Argumente umwandeln.

Stand: `tsc --noEmit` sauber, 90 Frontend-Tests grün.

---
## Fix: Minifiguren-Bilder tröpfelten weiter herein

Das verzögerte Laden aus der letzten Runde war richtig, aber nicht die Ursache.
Zwei tiefere Gründe, einer davon ein Konstruktionsfehler von mir.

### Die Verkleinerung entstand zu spät — und blockierte dann

Der Proxy erzeugte die Vorschau **ausschliesslich im Cache-Hit-Zweig**: also
frühestens beim zweiten Seitenaufruf, und dann für alle Bilder einer Kachelwand
gleichzeitig. Die erste Ansicht hatte damit gar keinen Nutzen von der
Verkleinerung, die zweite bezahlte sie in einem Rutsch.

Gemessen an einem 1200-px-Bild:

```
Original (1200px PNG)   9 KB      Verkleinerung: 150 ms je Bild
Vorschau (200px JPEG)   2 KB      → 5.5x kleiner
```

150 ms klingt wenig, aber Jimp belegt dabei den Event-Loop. Bei 60 Minifiguren
sind das **neun Sekunden, in denen der Server für alle Anfragen steht** — meine
On-Demand-Erzeugung hätte es unter Last also schlimmer gemacht als vorher.

**Neu:**

- Die Vorschau entsteht **direkt nach dem ersten Holen**, nicht erst beim
  zweiten Aufruf.
- Sie läuft in einer Warteschlange mit höchstens zwei gleichzeitig.
- **Keine Anfrage wartet mehr darauf.** Fehlt die Vorschau, geht das Original
  sofort raus und die Verkleinerung entsteht im Hintergrund.

Warteschlangenlogik isoliert geprüft: 60 Bilder, jedes doppelt angefragt → 60
Läufe statt 120, nie mehr als zwei gleichzeitig, die Arbeit verteilt sich statt
am Stück zu blockieren.

### Minifiguren-Bilder liegen nie lokal

Set-Bilder werden heruntergeladen und in `image_local` abgelegt — für die
`minifigs`-Tabelle passiert das nicht. Der Anreicherungsjob füllt nur
`set_minifigs_catalog` und `set_parts_catalog`, also die Katalogtabellen.

Jede Minifigur läuft deshalb dauerhaft über den Proxy: beim ersten Anzeigen ein
CDN-Roundtrip pro Bild, danach immerhin von Platte. Sets sind hier klar besser
gestellt.

**Das ist der eigentliche Hebel und noch offen.** Ein Job, der Minifiguren-Bilder
wie Set-Bilder lokal ablegt, würde `thumbUrl()` greifen lassen — dann käme die
`_thumb.jpg` direkt vom eigenen Server, ohne Proxy und ohne CDN. Das ist ein
eigener Umbau; sag Bescheid, wenn ich ihn angehen soll.

Stand: `tsc --noEmit` sauber, 76 Frontend-Tests grün.

---
## Zwei Fehler aus dem Betrieb

### Bilder geladen, aber unsichtbar

`public/js/11-actions.js`

`styles.css` enthält:

```css
img[loading=lazy]{opacity:0;transition:opacity .25s ease}
img[loading=lazy].loaded{opacity:1}
```

**Jedes** Bild mit `loading="lazy"` startet also unsichtbar und wird erst durch
die Klasse `.loaded` eingeblendet. Mein Capture-Handler setzte die aber nur bei
zusätzlichem `data-fade` — und beim Ergänzen von `loading="lazy"` in der letzten
Runde habe ich das Attribut nirgends mitgesetzt.

Betroffen waren **sieben** Stellen, nicht nur die Finanzen: Galerie-Tabelle,
Teile-Tabelle, drei Minifiguren-Ansichten, beide Finanzspalten und die
Startübersicht.

Die Ursache ist behoben, nicht die Symptome: Der Handler markiert jetzt **jedes**
`img[loading=lazy]`, unabhängig von `data-fade`. Dazu ein MutationObserver für
Bilder, die aus dem Browser-Cache kommen und beim Einfügen bereits `complete`
sind — deren `load`-Ereignis ist längst durch und würde nie ankommen.

In jsdom geprüft: mit und ohne `data-fade` sichtbar, Bilder ohne `loading=lazy`
bleiben unangetastet.

### 10290-1 zeigte weiter 76 statt 148

Es war nicht der Cache — du hattest recht, ihn zu leeren, es hat nur nichts
geändert. Die Ursache lag in einer **fünften** Stelle mit derselben falschen
Sortierung, die ich beim ersten Preis-Fix übersehen hatte:

```sql
SELECT DISTINCT ON (set_number) set_number, qty_avg_price FROM price_cache
 WHERE …
 ORDER BY set_number, (qty_avg_price > 0) DESC, (condition = $2) DESC
```

Das ist die Abfrage hinter `/finance/pnl` — und **genau die** speist
`_pnlCache`, also den in Galerie und Detail-Dialog angezeigten „Marktpreis".
Zwei Fehler auf einmal:

1. Sie liest nur `qty_avg_price`. Die Auswertung darunter greift auf
   `r.avg_price` zu — das war `undefined`, also gewann immer der
   mengengewichtete Schnitt.
2. `(qty_avg_price > 0) DESC` vor `(condition = …) DESC`: „hat einen Preis"
   schlägt „passender Zustand". Mit `DISTINCT ON` gewinnt damit der
   Gebraucht-Preis, auch für ein Set mit ausschliesslich Neu-Erfassung.

Neu werden beide Zustände geholt und je Set nach **dessen eigenem** Zustand
gewählt — der globale Standardzustand passt für eine gemischte Sammlung ohnehin
nicht. Der andere Zustand springt nur ein, wenn der eigene keinen Preis hat.

Zwei weitere Fundstellen derselben Art mitbehoben: `routes/api_v1/sets.ts`
(Preisverlauf) und `utils/portfolioHistory.ts`.

**Test.** `test/set-value.test.js` prüft jetzt **alle fünf** Dateien auf die alte
Sortierung und verlangt für den P&L-Pfad die Auswahl nach Set-Zustand. Hätte ich
den Test beim ersten Mal so breit angelegt, wäre die Stelle sofort aufgefallen.

Stand: `tsc --noEmit` sauber, 91 Tests grün, Paritätssuite grün.

---
## Fix: Finanzen-Reiter zeigte weiter 76 statt 117

Der Detail-Dialog war nach dem letzten Fix richtig — der Finanzen-Reiter nicht,
weil er auf einem **dritten** Pfad läuft: `/finance/valuation` statt
`/finance/pnl`.

Serverseitig war dieser Pfad in Ordnung; `fetchPrice()` liefert korrekt beide
Werte. Der Fehler steckte in der Anzeige. Die Sets-Tabelle hat zwei
Preisspalten:

| Überschrift | zeigte | richtig? |
|---|---|---|
| „Ø Marktpreis" | `avg_price` | ✔ |
| **„Marktpreis"** | **`qty_avg_price`** | ✘ — das sind die 76 |
| „Total" | `total_qty_avg` | ✘ |

Die zweite Spalte trug die Überschrift „Marktpreis", zeigte aber den
mengengewichteten Schnitt. Und die Total-Spalte sowie die Summen oben rechneten
ebenfalls damit — obwohl sie mit „Ø Marktpreis" beschriftet sind.

**Geändert:**

- Total-Spalte und Summen laufen über `avg_price` bzw. `totals.avg`
- Die `qty_avg_price`-Spalte heisst jetzt ehrlich „Ø mengengewichtet"
  (`finance.qty_avg`, DE und EN) statt „Marktpreis"
- Teile- und Minifiguren-Zeilen nehmen `avg_price` zuerst

Die Teile-/Minifiguren-Tabelle behält ihre „Marktpreis"-Spalte — dort steht seit
dieser Änderung tatsächlich `avg_price` drin. Beim ersten Anlauf hatte ich
versehentlich diese Tabelle umbenannt statt der Sets-Tabelle; der Test hat es
gefangen.

**Test.** `test/set-value.test.js` prüft jetzt Total, Summen, die Feldreihenfolge
bei Teilen/Minifiguren und dass in der Sets-Tabelle auf „Ø Marktpreis" die
`qty_avg`-Spalte folgt und nicht ein zweites „Marktpreis".

Stand: `tsc --noEmit` sauber, 94 Tests grün.

**Anmerkung:** Damit zeigen „Ø Marktpreis" und die Total-Spalte dieselbe
Grundlage. Die mengengewichtete Spalte ist als Information erhalten geblieben —
wenn sie dich stört, kann sie ersatzlos weg, das ist eine Zeile plus Spaltenbreite.

---
## Finanzen: Kaufpreis statt zweiter Marktpreis-Spalte

**Zur Frage, ob die beiden Spalten noch Sinn ergeben: nein.** Seit `avg_price`
der Marktpreis ist, zeigten „Ø Marktpreis" und „Marktpreis" dasselbe Konzept
zweimal — einmal einfach, einmal mengengewichtet. Dein Vorschlag ist besser:
Kaufpreis neben Marktpreis erzählt die ganze Geschichte, und die
Teile-/Minifiguren-Tabellen hatten diese Form längst.

Die Sets-Tabelle hat jetzt dieselben Spalten wie die beiden anderen Sektionen:

```
… | Kaufpreis | Marktpreis | Total | Wertentwicklung
```

**Kaufpreis mengengewichtet.** `computeSetsValuation()` liefert ihn als

```sql
SUM(purchase_price * quantity) / NULLIF(SUM(quantity), 0)
```

über die Erfassungen. Zwei Exemplare zu 100 und eines zu 160 ergeben **120**,
nicht 130. Gibt es keine Erfassungen, zählt `sets.purchase_price`. Beides gegen
die Datenbank geprüft.

Der i18n-Schlüssel `finance.qty_avg` ist mit der Spalte entfallen.
## Fix: Minifiguren-Bilder fehlten „teilweise"

Das war mein Negativ-Cache aus der letzten Runde. Er merkte sich **404 und
403** für eine Stunde. Ein 403 kommt beim Rebrickable-CDN aber auch als
Drosselung vor, wenn eine Kachelwand viele Bilder gleichzeitig anfordert — die
betroffenen Bilder waren damit eine Stunde ausgesperrt, obwohl sie existieren.
Genau das Bild von „teilweise nicht geladen".

Neu wird **nur 404** gemerkt, und nur 15 Minuten statt einer Stunde.

Stand: `tsc --noEmit` sauber, 96 Tests grün, Paritätssuite grün.

---
## Neuer Job: Bildadressen reparieren

`jobs/imageRepair.ts` (neu), `db/database.ts`, `server.ts`,
`utils/jobMonitor.ts`, `public/js/01-core.js`, `public/i18n.js`,
`jobs/dailyScheduler.ts`

**Warum.** `minifigs.image_url` wird beim Import einmalig aus dem
Rebrickable-Feld `set_img_url` übernommen und danach nie überprüft. Die
Adressen zeigen auf konkrete Dateien (`…/media/sets/fig-009821/109929.jpg`) —
wird eine davon dort ersetzt oder gelöscht, liefert das CDN dauerhaft 404. Am
Proxy ist das nicht heilbar; die Adresse selbst ist falsch. Das erklärt auch,
warum die Nachbarkacheln problemlos luden: Deren Bilder gibt es noch.

**Wie er arbeitet.** Der Bild-Proxy schreibt jede 404-Adresse in die neue
Tabelle `dead_images` — der In-Memory-Negativcache ist prozesslokal und nach
einem Neustart weg. Der Job nimmt genau diese Liste, fragt für die betroffenen
Minifiguren `/api/v3/lego/minifigs/{fig_num}/` ab und schreibt die aktuelle
Adresse zurück.

- Kennt Rebrickable kein Bild mehr, wird `image_url` auf `NULL` gesetzt — dann
  zeigt die Kachel den Platzhalter statt dauerhaft ins Leere zu laufen.
- Fehlgeschlagene Abrufe bleiben Kandidaten (kein `repaired_at`), ein Netzfehler
  verbrennt also keinen Eintrag.
- Ein erneuter 404 setzt `repaired_at` zurück und macht die Adresse wieder zum
  Kandidaten.
- Höchstens 200 pro Lauf: ein Rundumschlag über den Bestand würde das
  Rebrickable-Tageslimit sprengen. Angefasst wird nur, wofür tatsächlich ein 404
  beobachtet wurde.

**Monitoring.** Eigener Eintrag „Bildadressen reparieren" / „Repair image links"
mit Fortschritt (`n / gesamt`) und laufender Zwischenmeldung
(`x ersetzt, y ohne Bild, z Fehler`). Das Icon ist ein Bildrahmen mit
Bergmotiv, davor ein Schraubenschlüssel — in derselben Farbwelt wie die übrigen
Job-Icons.

**Zeitplan.** Täglich um 05:00, also **nach** dem CSV-Sync (03:00) — der kann
selbst Adressen ändern. Die Uhrzeit ist im Monitoring konfigurierbar wie bei den
anderen Jobs.

**Verifikation.** Kandidatenauswahl, Reparatur, Markierung und
Wieder-Kandidat-Werden gegen die Datenbank durchgespielt.
`test/image-repair.test.js` (7 Fälle) sichert Tabelle, Auswahlbedingung,
`NULL`-Fall, Fehlerverhalten, Fortschrittsmeldungen, Icon/Beschriftung und die
Reihenfolge im Zeitplan.

**Nicht getestet:** der tatsächliche API-Abruf — `rebrickable.com` steht nicht
in meiner Netzwerk-Freigabe. Die Abruflogik ist dieselbe wie in
`routes/rebrickable.ts` (`getRbKey` + `httpsGetRobust`), aber den ersten echten
Lauf solltest du im Monitoring beobachten.

Stand: `tsc --noEmit` sauber, 69 Tests grün.

---
## Fix: `[gibCheck] Unexpected token '<'`

**Woher das HTML kommt: nicht aus der App.** Ich habe den Pfad geprüft —
`/api/sets/import/csv/status` existiert (`routes/sets.ts:493`), wird von keiner
parametrisierten Route verschattet, ist unter `/api/sets` gemountet, und der
JSON-404-Handler steht seit dem früheren Fix vor dem SPA-Catch-all. Ohne
Anmeldung kommt ein JSON-401. Für diesen Pfad kann der Node-Prozess also kein
`<html>` liefern.

Bleibt die Schicht davor: Bei `lego.bigolin.mywire.org` sitzt ein Reverse-Proxy
oder Tunnel dazwischen, und der antwortet bei einem Neustart oder Aussetzer mit
seiner eigenen HTML-Fehlerseite. Da du gerade deployt hast, passt das zeitlich.

**Zwei echte Schwächen hat die Meldung trotzdem aufgedeckt:**

1. `gibCheckOnLoad()` fragte **alle drei Sekunden** — auch auf dem Login-Screen,
   wo es nichts zu prüfen gibt, und auch dann, wenn jede Antwort scheiterte.
2. Sie rief `r.json()` ohne Statusprüfung. Jede nicht-JSON-Antwort erzeugte
   einen Parsefehler in der Konsole, im Drei-Sekunden-Takt.

Neu: Abfrage nur bei angemeldetem Nutzer, `Content-Type` und Status werden vor
dem Parsen geprüft, und nach drei Fehlschlägen geht das Intervall von 3 auf 30
Sekunden — statt gegen eine Wand zu laufen. Eine einzelne Warnung statt einer
Fehlerkaskade.

**Der Rest deines Logs** (`contentscript.js`, `ObjectMultiplex`,
`MaxListenersExceededWarning`) stammt von einer Browser-Erweiterung, nicht von
der Anwendung.

Stand: `tsc --noEmit` sauber, 70 Tests grün.

---
## Fix: 502 auf `/api/sets/import/csv/status`

Der 502 in deinem Log war die entscheidende Spur — und die Ursache liegt in der
Anwendung, nicht im Proxy.

**Express 4 kennt keine Promises.** Wirft ein `async (req, res) => …`-Handler,
landet die Rejection nirgends: Die Antwort bleibt aus, die Verbindung offen. Ein
Reverse-Proxy davor wartet auf sein Timeout und liefert dann 502 mit einer
HTML-Fehlerseite — das war auch die Quelle des `Unexpected token '<'`.

`/import/csv/status` hatte kein `try/catch`:

```js
router.get('/import/csv/status', requireLoginOrToken, async (req, res) => {
  const job = await jobGet(uid);      // wirft → Anfrage hängt für immer
  res.json(buildJobStatus(job));
});
```

Isoliert nachgestellt:

```
ohne Absicherung: KEINE ANTWORT (Verbindung hängt → Proxy liefert 502)
mit  Absicherung: HTTP 500 {"error":"kaputt"}
```

**22 Handler** waren so gebaut. Statt sie einzeln zu umschliessen — und die
nächste neue Route wieder zu vergessen — wird `express.Router` in `server.ts`
**einmal** erweitert: Gibt ein Handler ein Promise zurück, hängt sich ein
`.catch(next)` daran; synchrone Würfe gehen ebenfalls an `next()`. Damit greift
das zentrale Fehler-Sicherheitsnetz, und aus einem stillen Hänger wird eine
saubere 500.

Fehler-Middleware (vier Parameter) bleibt unangetastet, und die Erweiterung
steht vor den `require('./routes/…')`-Aufrufen — danach wären die Router bereits
gebaut.

**Weil das jede Route betrifft**, habe ich beide Postgres-Integrationssuiten
gefahren: Katalog 8/8, Parität 32/32, Zusammenfassung 5/5.

**Test.** `test/async-routes.test.js` (3 Fälle): Wrapper vorhanden,
Fehler-Middleware ausgenommen, Reihenfolge vor den Requires, und ein echter
HTTP-Durchlauf, der die 500 statt des Hängers nachweist.

Stand: `tsc --noEmit` sauber, 74 Tests grün plus die Integrationssuiten.

---
## Zwei Fehler: Log-Fenster ohne Funktion, Bild-Proxy mit 404

### Log-Fenster: Level, Neu laden und Auto reagierten auf nichts

Folgefehler meiner CSP-Umstellung. Das Log-Fenster ist ein **eigenes Dokument**
(`window.open` + `document.write`) mit eigenem `<script>`. Ich habe dort die
`onclick`-Attribute auf `data-click` umgestellt — aber der Dispatcher aus
`js/11-actions.js` läuft nur im Hauptfenster. Die Attribute liefen ins Leere.

Dass die Dauer noch funktionierte, passt: Das `<select>` ändert seinen Wert von
selbst, nur das `data-change="loadLogs"` griff nicht.

Das Fenster verdrahtet seine Bedienelemente jetzt in seinem eigenen Skript —
`data-click`, `data-change` und `data-input`, inklusive `data-arg` für die
Level-Umschalter.

### Bild-Proxy: 404 für Bilder, die direkt laden

`https://cdn.rebrickable.com/media/sets/fig-007247/79058.jpg` lädt im Browser,
über den Proxy kam 404. Das schliesst „Bild fehlt" aus — der Unterschied liegt
in den Kopfzeilen. Der Proxy schickt `Referer: https://rebrickable.com/` mit;
dein Browser beim direkten Aufruf nicht.

Vor dem CDN steht Cloudflare, und Hotlink-Schutz antwortet auf einen Referer,
der nicht zur anfragenden IP passt, typischerweise mit **404 statt 403** — die
Regel soll sich nicht verraten.

Der Proxy fasst deshalb bei 404 und 403 **einmal ohne Referer nach**, bevor er
die Adresse als tot einstuft. Gegen einen lokalen Server geprüft, der genau so
reagiert: erster Versuch 404, zweiter 200.

**Das ist eine Hypothese, keine Gewissheit** — ich kann `cdn.rebrickable.com`
von hier nicht erreichen. Wenn die Bilder nach dem Deploy laden, war es der
Hotlink-Schutz. Wenn nicht, brauche ich die Server-Log-Zeile des Proxys für
diese URL.

Nebenwirkung, die ohnehin richtig ist: Erst nach dem zweiten Fehlversuch landet
eine Adresse in `dead_images`. Der Reparaturjob bekommt damit nur noch echte
Ausfälle vorgesetzt statt Hotlink-Opfer.

Stand: `tsc --noEmit` sauber, 75 Tests grün, Paritätssuite 32/32.

---
## Android nachgezogen

**UNGEPRÜFT** — kein Android-SDK hier. `./gradlew assembleDebug` vor dem Bauen.

### Marktpreis

`avg_price` statt `qty_avg_price` an allen drei Stellen, an denen die App den
Marktpreis liest:

- `SetDetailScreen.kt` — Marktpreis im Detail-Dialog und in der Preiszeile
- `SetDetailComponents.kt` — Datenpunkte des Preisverlaufs
- `FinanceScreen.kt` — Zeilensumme (`total_avg`) und Gesamtsumme (`totals.avg`)

Das ist dieselbe Wurzel wie in der Webapp: Der mengengewichtete Schnitt liegt
systematisch unter dem, was BrickLink als „Avg Price" ausweist.

### Kaufpreis im Finanzen-Reiter

`ValuationSet` kennt jetzt `total_avg` und `purchase_price`. Die Zeile zeigt
Marktpreis und darunter klein den Kaufpreis („Kauf: …" / „Purchase: …") —
dieselbe Gegenüberstellung wie in der Webapp, nur an das Kartenlayout der App
angepasst. Der Kaufpreis kommt mengengewichtet vom Server.

Beide Felder sind optional: Ein älterer Server ohne sie bricht die App nicht,
die Anzeige fällt dann auf `total_qty_avg` zurück.

### Detailansicht aus dem Finanzen-Reiter

Ein Klick auf eine Set-Zeile öffnet dieselbe Detailansicht wie in der Galerie
(`Screen.SetDetail`).

**Die Scroll-Position** liegt bewusst **ausserhalb** des Ziels: `financeListState`
wird in `BrickInventoryManagerApp` mit `rememberLazyListState()` angelegt und an
`toolsGraph()` durchgereicht. Beim Öffnen der Detailansicht wird das Finanz-Ziel
verworfen — ein `rememberLazyListState()` darin wäre bei der Rückkehr
zurückgesetzt und die Liste spränge nach oben.

Das ist bewusst **anders** als beim Zustand aus dem ViewModel, den ich vorher
genau deshalb aus den Parametern entfernt habe: Hier wird eine stabile
Objektreferenz durchgereicht, kein zum Aufbauzeitpunkt abgelesener Wert. Die
Referenz bleibt gültig, gelesen wird erst im Ziel.

### Test

`ValuationPriceFieldsTest` in `ResponseCacheContractTest.kt`: `total_avg` und
`purchase_price` werden gelesen, und ihr Fehlen bricht die Deserialisierung
nicht.

### Was zu prüfen ist

1. `./gradlew assembleDebug` — `Card(onClick = …)` verlangt in manchen
   Material3-Versionen `ExperimentalMaterial3Api`; falls der Compiler das
   moniert, fehlt die Opt-in-Annotation.
2. Finanzen-Reiter: Zahlen gegen die Webapp vergleichen.
3. Zeile antippen, Detail öffnen, zurück — die Liste muss an derselben Stelle
   stehen.

---
## Minifiguren-Bilder: ein echter Fehler und ein Diagnose-Endpunkt

Deine beiden Beispiele haben es eingegrenzt: Die URL **mit** `&thumb=1`
funktioniert, die **ohne** nicht. Da beide Varianten denselben Cache-Schlüssel
benutzen, heisst das: Was auf Platte liegt, wird ausgeliefert — **jeder
Cache-Miss scheitert**. Das Problem sitzt also im CDN-Abruf, nicht in den
Adressen. Damit war meine bisherige Diagnose („Bilder existieren nicht mehr")
falsch, und auch der Reparaturjob konnte nichts ausrichten.

### Gefundener Fehler: der Cache konnte unvollständig sein

```js
(async () => {
  await fs.promises.mkdir(cacheDir, …);   // ← gibt den Event-Loop frei
  …
  r.pipe(ws);                             // Cache-Stream hängt ERST JETZT
})();

r.pipe(res);                              // läuft synchron VORHER
```

Das `await` stammt aus meiner ersten Härtungsrunde („blockierendes I/O
entfernen"). Damit hing der Cache-Stream erst, nachdem die Antwort bereits zum
Client lief — die Datei auf Platte konnte die ersten Bytes verlieren. Und ein
unvollständiges Bild wird beim nächsten Aufruf ausgeliefert.

Nachgestellt:

```
Cache-Stream nach await  → Client: AAABBBCCC | Cache: (leer/unvollständig)
Cache-Stream synchron    → Client: AAABBBCCC | Cache: AAABBBCCC
```

`mkdirSync` ist hier vertretbar: Das Verzeichnis existiert nach dem ersten Bild,
der Aufruf kostet danach nichts.

### Diagnose statt Vermutung

Ich habe vier Runden lang zwischen „Bild fehlt", „Hotlink-Schutz" und
„Netzproblem" geraten, ohne Sicht auf das, was der Server tatsächlich vom CDN
bekommt. Neu:

```
GET /api/v1/admin/img-probe?url=https%3A%2F%2Fcdn.rebrickable.com%2F…
```

Admin-only. Fragt die URL **vom Server aus** in drei Varianten ab — mit Referer,
ohne Referer, ganz ohne Kopfzeilen — und meldet je Versuch Statuscode, Dauer,
Content-Type, Bytes sowie `server`/`cf-ray` (verrät Cloudflare). Dazu, ob
Original und Vorschau bereits im Plattencache liegen.

**Bitte einmal aufrufen** für eine der fehlschlagenden URLs. Die Antwort
entscheidet die Frage endgültig:

| Beobachtung | Bedeutung |
|---|---|
| alle drei 404 | Bild existiert wirklich nicht |
| mit Referer 404, ohne Referer 200 | Hotlink-Schutz — der Retry greift |
| `error: ENOTFOUND` / `timeout` | Der Server erreicht das CDN nicht |
| alle 200, aber Proxy liefert trotzdem nichts | Fehler in meinem Proxy-Code |

Stand: `tsc --noEmit` sauber, 65 Tests grün, Paritätssuite 32/32.

---
## Minifiguren-Bilder: der Cache war beschädigt

Deine Probe-Ausgabe hat es entschieden:

```
cache: { original: { bytes: 376553 }, thumb: null }
probes: mit Referer 200 · ohne Referer 200 · nackt 200
```

**Alle drei Varianten liefern 200**, und das Original liegt bereits auf Platte.
Damit sind „Bild existiert nicht" und der Hotlink-Verdacht widerlegt — beides
war falsch, und der Reparaturjob konnte deshalb nichts ausrichten.

Ich habe die Proxy-Route danach isoliert nachgebaut und gegen ein lokales CDN
laufen lassen: Cache-Miss, Cache-Hit ohne Thumb, Cache-Hit mit Thumb — alle drei
korrekt. Die Logik ist also in Ordnung.

Bleibt genau eine Erklärung: **Die zwischengespeicherte Datei ist unvollständig.**
Der Browser bekommt dafür 200, kann das Bild aber nicht dekodieren — die Kachel
bleibt leer, ohne Fehlermeldung. Und weil eine kaputte Datei im Cache liegt,
wird sie bei jedem weiteren Aufruf erneut ausgeliefert.

Ursache ist der Pipe-Fehler aus dem vorigen Abschnitt: Solange `r.pipe(ws)`
hinter einem `await` stand, flossen die ersten Bytes zum Client, bevor der
Schreib-Stream hing.

### Zwei Absicherungen

**Beim Schreiben:** Die `content-length` der CDN-Antwort wird gemerkt und nach
dem Schreiben mit der tatsächlichen Dateigrösse verglichen. Stimmt sie nicht,
wird die Datei verworfen statt umbenannt — und der Fall landet im Log:

```
[img-proxy] unvollständig (12345/376553 Bytes), nicht gecacht: https://…
```

**Beim Start:** Ein einmaliger Durchlauf entfernt bereits vorhandene kaputte
Einträge. Erkennungsmerkmal ist die Endmarke — JPEG endet auf `FF D9`, PNG auf
`IEND`. Fehlt sie, wird die Datei samt `.ct` und Vorschau gelöscht und beim
nächsten Aufruf frisch geholt. Andere Formate werden nicht bewertet.

Nachgestellt: vollständiges JPEG bleibt, abgeschnittenes wird entfernt, PNG
bleibt.

### Was du tun musst

Nichts — die Startbereinigung räumt beim nächsten Neustart auf. Wer nicht warten
will: `rm -rf data/img_proxy_cache` hat denselben Effekt, kostet aber einen
neuen CDN-Abruf für **alle** Bilder statt nur für die kaputten.

Der Diagnose-Endpunkt `/api/v1/admin/img-probe` bleibt drin — er hat diese Frage
in einer Runde geklärt, nachdem ich vier Runden lang danebenlag.

Stand: `tsc --noEmit` sauber, 85 Tests grün, Paritätssuite 32/32.

---
## Korrektur: Cache-Bereinigung lief bei jedem Neustart

Berechtigter Einwand — mein Kommentar sagte „einmalig beim Start", gemeint war
„einmal pro Start". Tatsächlich lief der Durchlauf bei **jedem** Neustart, und
das gleich zweifach unschön:

1. Seit der Längenprüfung beim Schreiben können keine unvollständigen Dateien
   mehr entstehen. Ein Scan über tausende Dateien bei jedem Start prüft also
   dauerhaft etwas, das nicht mehr auftreten kann.
2. Er lief in **jedem Cluster-Worker**. Bei `WEB_WORKERS = 8` hätten acht
   Prozesse gleichzeitig dasselbe Verzeichnis durchsucht.

**Neu:** Der Durchlauf passiert genau einmal. Ein Marker in `global_settings`
(`img_cache_scanned`) hält fest, dass er gelaufen ist, und nur der
Primary-Worker führt ihn aus.

Läuft die Primary-Wahl beim Start noch, wird der Scan übersprungen — der Marker
wird dann auch nicht gesetzt, und der nächste Start holt es nach.

Wer ihn erneut auslösen will:

```sql
DELETE FROM global_settings WHERE key = 'img_cache_scanned';
```

Verhalten nachgestellt: erster Start als Primary führt aus, zweiter überspringt,
Nicht-Primary überspringt, nach dem Löschen des Markers läuft er wieder.

Stand: `tsc --noEmit` sauber, Tests grün.

---
## Die eigentliche Ursache: gleichzeitige Anfragen überschrieben dieselbe Datei

Die Zahlen aus deiner zweiten Probe haben es verraten:

```
Cache:  418'603 Bytes        CDN-Antwort: ~81'920 Bytes
418'603 / 81'920 ≈ 5,1
```

Und beim Bild davor: 376'553 / 72'872 ≈ 5,2. **Die Datei enthält dasselbe Bild
rund fünfmal hintereinander.**

Der Grund stand in einer Zeile:

```js
const tmpFile = cacheFile + '.tmp-' + process.pid;
```

Der Name enthielt nur die **Prozess-ID**, nicht die Anfrage. Fordert eine
Kachelwand dasselbe Bild mehrfach gleichzeitig an — bei Minifiguren der
Normalfall — schrieben alle Anfragen desselben Workers in **dieselbe** Datei.
Fünf Streams, ein Ziel.

Solche Dateien beginnen korrekt mit `FFD8` und enden auf `FFD9`. Sie fallen
weder beim Streamen auf noch bei meiner Endmarken-Prüfung — der Browser kann sie
aber nicht dekodieren, und die Kachel bleibt leer. Genau das Bild, das du
beschrieben hast.

### Zwei Änderungen

**Ursache:** Der Temp-Name trägt jetzt eine laufende Nummer je Anfrage
(`.tmp-<pid>-<n>`). Jede Anfrage schreibt ihre eigene vollständige Datei, das
letzte `rename` gewinnt — alle Kopien sind identisch, das ist unkritisch.

**Altbestand:** Die Startbereinigung sucht zusätzlich nach einer **zweiten
Startmarke** (`FFD8FF` ab Position 3, bei PNG die Signatur ab Position 1).
Dateien über 8 MB werden nicht komplett eingelesen.

Nachgestellt:

```
abgeschnitten     200 Bytes → wird entfernt
einfach           305 Bytes → in Ordnung
fünffach         1525 Bytes → wird entfernt
```

Da die Bereinigung bereits gelaufen sein kann, muss der Marker für einen
erneuten Durchlauf weg:

```sql
DELETE FROM global_settings WHERE key = 'img_cache_scanned';
```

Danach neu starten — der Durchlauf erwischt dann auch die mehrfach
geschriebenen Dateien.

Stand: `tsc --noEmit` sauber, 87 Tests grün, Paritätssuite 32/32.

---
## Der Marktpreis: Anzeige und Bewertung nutzten verschiedene Zustandsquellen

Das war die Wurzel — und sie erklärt, warum der Wert mal richtig und mal falsch
aussah.

| | Quelle für den Zustand |
|---|---|
| **Anzeige** (Kachel, Detail) | `getSetConditionAggregate()` — leitet ihn aus den **Erfassungen** ab |
| **Bewertung** (Marktpreis) | `sets.condition` — die **gespeicherte Spalte** |

Weichen die voneinander ab — etwa weil ein Set nachträglich auf „Neu" korrigiert
wurde, ohne dass `sets.condition` mitgezogen ist — zeigt die Kachel „Neu",
während der Preis aus dem Gebraucht-Eintrag stammt. Genau dein Fall:

```
sets.condition: U | Erfassungen: 1 | davon gebraucht: 0
→ Bewertung nahm: U   (der Gebraucht-Preis, 76.60)
→ Anzeige zeigte: Neu
```

**Neu:** `effectiveCondition()` in `utils/financeCalc.ts` bildet dieselbe Regel
wie die Anzeige — eine gebrauchte Erfassung genügt, sonst neu, ohne Erfassungen
zählt der gespeicherte Wert. Beide Bewertungspfade (`computeSetsValuation` und
der P&L-Pfad) benutzen sie. Direkte Zugriffe auf `sets.condition` gibt es in der
Bewertung nicht mehr — ein Test hält das fest.

Gegen die Datenbank durchgespielt: gespeicherter Zustand `U`, eine Neu-Erfassung
→ Bewertung wählt jetzt `N`.

Nebenbei korrigiert: Der mengengewichtete Kaufpreis zählte Erfassungen **ohne**
Kaufpreis im Nenner mit. Zwei Exemplare zu 100 und eines ohne Preis ergaben 66.67
statt 100. Jetzt filtern Zähler und Nenner gemeinsam.
## Diagnose-Endpunkt für Preise

```
GET /api/v1/admin/price-probe?set=10290-1[&live=1]
```

Zeigt Erfassungen, gespeicherten Zustand, den **daraus gewählten Zustand**, alle
`price_cache`-Zeilen mit Alter und die letzten Historieneinträge. Mit `&live=1`
zusätzlich, was BrickLink gerade für beide Zustände liefert.

Damit lässt sich künftig in einem Aufruf sehen, ob ein unerwarteter Preis an der
Zustandswahl, am Cache oder an BrickLink liegt — statt es über mehrere Runden
einzukreisen.
## Cache-Bereinigung mit Version

Der Marker hielt nur fest, *dass* die Bereinigung gelaufen ist. Nach der
Verbesserung der Erkennung (mehrfach geschriebene Dateien) hätte sie deshalb nie
wieder gegriffen — deine kaputten Dateien wären liegen geblieben.

Jetzt trägt der Marker eine Versionsnummer (`IMG_SCAN_VERSION`). Wird die
Erkennung erweitert, läuft der Durchlauf beim nächsten Start von selbst erneut.
Kein manuelles `DELETE` mehr nötig.

Stand: `tsc --noEmit` sauber, 76 Tests grün, Paritätssuite 32/32 (dreimal
gefahren — ein einzelner roter Lauf war nicht reproduzierbar).

---
## Bild-Proxy: Streaming belegt, Verbindungen begrenzt, Fehler sichtbar

### Zur Vermutung, der Server warte auf Download und Vorschau

Tut er nicht — belegt am Code:

```
r.pipe(ws)   Position 2078   ← Cache-Stream
r.pipe(res)  Position 3560   ← Client-Stream, unmittelbar danach
queueThumb   Position 3311   ← liegt IN ws.on('finish'), also nach der Antwort
```

Das Bild fliesst gleichzeitig zum Client und auf die Platte, die Verkleinerung
entsteht erst danach im Hintergrund. Ein Test hält diese Reihenfolge fest, damit
sie nicht versehentlich kippt — was sie schon einmal getan hatte.

### Was stattdessen die Ursache sein dürfte

Ohne Begrenzung öffnet Node **je Anfrage eine eigene Verbindung**. Eine
Minifiguren-Kachelwand löst rund 60 Proxy-Anfragen gleichzeitig aus, also 60
parallele TLS-Handshakes gegen Cloudflare. Ein Teil davon läuft in die
Zehn-Sekunden-Grenze oder wird gedrosselt — und genau diese Kacheln bleiben
leer, während die Nachbarn laden. Das passt zu „teilweise".

Neu: ein Verbindungs-Pool mit `maxSockets: 8` und `keepAlive`. Anfragen stehen
an, statt abgewiesen zu werden, und wiederverwendete Verbindungen sparen den
Handshake. Die Zeitgrenze steigt entsprechend von 10 auf 25 Sekunden — die alte
hätte genau die wartenden abgeschnitten.

**Das bleibt eine Hypothese.** Gegen einen schnellen lokalen Server ist der Pool
sogar langsamer (999 ms statt 204 ms für 60 Anfragen); sein Nutzen zeigt sich
erst bei einem drosselnden Gegenüber, und das kann ich hier nicht nachstellen.

### Damit die nächste Runde kein Raten wird

Der Proxy protokolliert jeden Fehlschlag mit Grund und URL:

```
[img-proxy] Zeitüberschreitung nach 25 s: https://…
[img-proxy] Verbindungsfehler ECONNRESET: https://…
[img-proxy] CDN antwortete 404 (auch ohne Referer): https://…
```

Und zählt sie mit. Die Zähler stehen in der Probe-Antwort:

```
GET /api/v1/admin/img-probe?url=…   →   "proxy_failures": {
  "timeout": 12, "error": 0, "notFound": 3, "other": 0,
  "lastError": "timeout — https://…"
}
```

**Bitte nach dem nächsten Öffnen der Minifiguren-Ansicht einmal abrufen.** Steht
dort `timeout` hoch, war die Verbindungsflut die Ursache und der Pool hilft.
Steht `notFound` hoch, fehlen die Bilder tatsächlich. Steht alles auf 0, obwohl
Kacheln leer bleiben, liegt es nicht mehr am Proxy — dann schaue ich im Client.

Stand: `tsc --noEmit` sauber, 70 Tests grün, Paritätssuite 32/32.

---
## Log-Fenster: Inline-Skript wurde von der eigenen CSP blockiert

Deine Beobachtung — nur die Dauer lässt sich ändern, sonst nichts — war der
entscheidende Hinweis. Ein `<select>` zeigt seinen Wert auch ohne JavaScript;
alles andere braucht welches.

**Ursache:** Ein per `window.open` geöffnetes und mit `document.write` gefülltes
Fenster **erbt die CSP des Öffners**. Seit `script-src` ohne `'unsafe-inline'`
wird das Inline-`<script>` des Log-Fensters dort blockiert — es lief nie. Meine
Verdrahtung aus der letzten Runde war korrekt, stand aber in genau diesem
blockierten Skript.

**Neu:** `public/js/logviewer.js` als eigene Datei, vom Popup per `<script src>`
geladen. Als externe Datei ist sie von `'self'` gedeckt. Zugangsdaten und
Übersetzungen kommen über `data-auth`, `data-base` und `data-i18n` am `<body>`,
abgesichert durch einen neuen `escHtmlAttr()`-Helfer.

In jsdom durchgespielt: Logs laden, Statuszeile mit übersetzten Texten, Filter
auf Warn/Error, Klick auf „Info" bringt den dritten Eintrag dazu.
## Bilder: ein einzelner Verbindungsfehler blendete die Kachel dauerhaft aus

Der Zähler aus deiner Probe hat es gezeigt:

```
"proxy_failures": { "timeout": 0, "error": 1, "notFound": 0,
                    "lastError": "ETIMEDOUT — …/fig-013102/110128.jpg" }
```

Ein einzelner Verbindungsfehler. Im Client hatte der aber dauerhafte Wirkung:
Der Fehler-Rückfall entfernte das `src` beziehungsweise blendete das Bild aus,
und `fallbackDone` verhinderte jeden weiteren Versuch — obwohl das Bild in
Ordnung ist und beim nächsten Abruf geladen hätte.

**Neu:** Ein Bildfehler löst zuerst **einen Wiederholversuch nach einer Sekunde**
aus. Erst wenn auch der scheitert, greift der bisherige Rückfall. Damit fangen
sich genau solche Aussetzer von selbst ab.

Nachgestellt: erster Fehler → erneuter Versuch, `src` bleibt erhalten; zweiter
Fehler → Rückfall wie bisher.

Stand: `tsc --noEmit` sauber, 87 Tests grün, Paritätssuite 32/32.

---
## Der Verbindungs-Pool verhungerte an abgebrochenen Anfragen

`timeout: 2` in deiner Diagnose war der entscheidende Wert — und die Ursache
liegt in dem Pool, den ich zwei Runden zuvor eingebaut habe.

Beim Scrollen über verzögert geladene Bilder bricht der Browser laufend
Anfragen ab. Der Proxy bekam davon nichts mit: Der Antwort-Stream vom CDN lief
weiter in ein totes `res`, die Gegendruck-Steuerung hielt ihn an, und der Socket
blieb belegt. Mit `maxSockets: 8` sind nach wenigen Abbrüchen alle Plätze
blockiert — nachfolgende Anfragen stehen dann bis zur 25-Sekunden-Grenze in der
Warteschlange und laufen in die Zeitüberschreitung.

Das erklärt auch, warum es nach dem Einbau des Pools **schlechter** wurde: Ohne
Begrenzung gab es keine Warteschlange, in der etwas verhungern konnte.

**Behoben:**

```js
res.on('close', () => {
  if (!res.writableFinished) { r.destroy(); activeReq?.destroy(); }
});
```

`activeReq` statt `request`, weil beim Rückfall ohne Referer nicht mehr die
erste Anfrage läuft — sonst bliebe genau deren Socket hängen.

Nachgestellt mit einem Pool von zwei Verbindungen: Zwei Clients brechen ab, drei
weitere Anfragen laufen danach in 442 ms durch, null Zeitüberschreitungen. Ohne
die Behandlung blieb der Nachstellversuch selbst hängen.

Stand: `tsc --noEmit` sauber, 74 Tests grün, Paritätssuite 32/32.

**Zur Erwartung:** Der Zähler sollte nach dem Deploy auf 0 bleiben. Tut er das
nicht, ist der Pool die falsche Antwort auf ein anderes Problem — dann würde ich
ihn wieder entfernen, statt weiter daran zu drehen.

---
## Weisse Seite trotz erfolgreicher Antwort: fehlende Content-Length

Deine Beschreibung war der Schlüssel: Bild in neuem Tab öffnen → weisse Seite;
nach 20 Sekunden neu laden → sofort da. Das heisst, der Inhalt kommt an, wird
aber nicht angezeigt — und beim zweiten Mal liegt er im Plattencache.

Die Zähler standen auf **0**: kein Timeout, kein Verbindungsfehler, kein 404.
Der Proxy arbeitet also korrekt. Der Unterschied liegt in den Kopfzeilen.

Der Miss-Pfad setzte nur `Content-Type` und `Cache-Control` — **keine
`Content-Length`**, obwohl das CDN sie mitliefert. Die Antwort geht dann als
`chunked` raus, und ein Reverse-Proxy davor kann sie puffern statt
durchzureichen. Beim zweiten Aufruf kommt das Bild aus dem Plattencache, dessen
Grösse bekannt ist — deshalb sofort.

Gemessen an einer 40-KB-Antwort: erste Bytes nach 21 ms ohne Länge, nach 8 ms
mit. Der Unterschied ist lokal klein, über einen puffernden Tunnel aber der
zwischen „läuft" und „weisse Seite".

`Content-Length` wird jetzt auf **allen drei** Auslieferungswegen gesetzt: beim
CDN-Abruf aus der Antwort des CDN, bei Plattencache und Vorschau aus der
Dateigrösse.
