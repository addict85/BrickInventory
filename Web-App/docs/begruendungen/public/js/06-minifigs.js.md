# Begründungen zu `public/js/06-minifigs.js`

Die ausführlichen Kommentare aus `public/js/06-minifigs.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="manuell-erfasste-figuren-haben-oben-eine"></a>
## Manuell erfasste Figuren haben oben eine eigene Sektion. Der Ausschluss

```text
Manuell erfasste Figuren haben oben eine eigene Sektion. Der Ausschluss
gehört auf den Server — clientseitig gefiltert könnte eine ganze Seite
wegfallen und die Liste bliebe scheinbar leer.
Fest 'set': Manuell erfasste Figuren haben ihren eigenen Bereich mit
editierbaren Karten (manual-figs-list) — in dieser Liste waeren sie
doppelt. Der Ausschluss gehoert auf den Server; clientseitig gefiltert
koennte eine ganze Seite wegfallen und die Liste bliebe scheinbar leer.

Hier stand `G('fig-source')?.value || 'set'`. Das Auswahlfeld daneben trug
GENAU EINE Option mit dem Wert "" und wurde von nirgends gefuellt — der
Ausdruck ergab also immer 'set', und sein change-Ereignis konnte nie
eintreten. Ein Bedienelement, das eine Wahl verspricht und keine anbietet,
ist raus (die Android-App zeigt an dieser Stelle ebenfalls keines).
```

<a id="s"></a>
## `s`

```text
Stats
Kennzahlen MIT dem Filter des Reiters — vorher lief die Abfrage ohne ihn
und ohne Blickfeld: Im Haushalt zeigte die Kachel die eigenen Zahlen,
während die Liste darunter alle Konten zeigte, und Umschalten änderte oben
nichts. Gezählt wird jetzt serverseitig über dieselbe Gruppierung wie die
Liste (utils/handlers.ts, getMinifigStats).
```

<a id="filterfigs"></a>
## `filterFigs`

```text
Suche und Quellenfilter liegen auf dem Server (getMinifigs kannte beide
schon). Hier wird deshalb neu GELADEN statt clientseitig gefiltert — sonst
durchsuchte der Filter nur die bereits geladene Seite.

BEIDE Listen des Reiters, nicht nur die aus Sets: Die manuell erfassten
Figuren stehen unter derselben Filterleiste (public/index.html begruendet
die Anordnung genau damit, test/tab-layout.test.js prueft sie). Vorher lief
nur loadMinifigs() — dieselbe Luecke, die Marco bei den Teilen gemeldet hat.
```

<a id="appendfigs"></a>
## `appendFigs`

```text
Hängt eine nachgeladene Seite an, statt die Liste neu zu bauen.

Vorher rief jede Folgeseite renderFigs(allFigsCache) auf — die komplette
Liste wurde per innerHTML ersetzt. Damit verschwinden ALLE <img>-Elemente aus
dem DOM, und der Browser bricht ihre laufenden Anfragen ab. Im Server-Log
schlug das als Dutzende „Client hat abgebrochen" auf, und Kacheln, deren Bild
es nie über eine Nachladerunde hinaus schaffte, blieben leer.

Die Galerie macht es seit ihrer Umstellung richtig (appendGallery); bei den
Minifiguren war es liegen geblieben.
```

<a id="ohne-die-spalten-quelle-und-papierkorb"></a>
## Ohne die Spalten „Quelle" und Papierkorb.

```text
Ohne die Spalten „Quelle" und Papierkorb.

Beide waren KONSTANT: renderFigs() bekommt ausschliesslich
`allFigsCache`, und der wird mit `source=set` geladen (figParams). Die
Quelle stand also in jeder Zeile auf „aus Set", und der Papierkorb —
`f.source==='manual' ? … : ''` — war in jeder Zeile leer. Zwei von
sieben Spalten, die etwas versprachen und nichts zeigten. Manuell
erfasste Figuren haben ihren eigenen Bereich mit editierbaren Karten.

Aufgefallen beim Uebertragen der Tabelle in die App: Was dort nachgebaut
wird, muss vorher stimmen.
```

<a id="condbadge"></a>
## `condBadge`

```text
Zustand nur bei manuell erfassten Minifiguren anzeigen (automatisch
hinzugefügte aus Sets haben keinen eigenen Zustand).
Eine Plakette je erfasstem Zustand — gemeinsame Fassung in
02-gallery.js. Die frühere Inline-Fassung hier trug dieselben
Farben noch einmal von Hand ein.
Zustand nur bei manuell erfassten — die Begruendung darueber gilt.
Die BESITZER-Plakette dagegen unbedingt: Sie beantwortet „wem
gehoert das?", und diese Frage stellt sich bei einer Figur aus dem
Set eines Kindes genauso wie bei einer selbst erfassten. Die
Galerie-Kachel daneben zeigt sie seit jeher.

Sie stand hier INNERHALB der manual-Bedingung — und diese Liste
laedt ausschliesslich `source=set` (figParams). Die Plakette war
also unerreichbar. Ohne Haushalt ist `owners` leer und
ownerBadges() liefert '' — im Einzelkonto aendert sich nichts.
```

<a id="preisherkunfthinweis"></a>
## `preisHerkunftHinweis`

```text
Der Hinweis, wenn der Kaufpreis aus dem ANDEREN Zustand stammt.

── Warum es ihn gibt ────────────────────────────────────────
Marcos zwei Befunde waren zwei Seiten derselben Tatsache: BrickLink fuehrt
zu vielen Teilen und Figuren nur EINEN Zustand.

  „Der Zustand hat keinen Einfluss auf den Preis"   → der Rueckfall war unsichtbar
  „Teilweise wird der Kaufpreis nicht geladen"      → ohne Rueckfall blieb es leer

Seine Entscheidung: uebernehmen und kennzeichnen. Der Server sagt in
`price_from_condition`, aus welchem Zustand der Wert stammt; hier steht der
Satz dazu.

EIN Helfer fuer beide Erfassungen: Teile und Figuren hatten denselben
Erfolgsblock in zwei Kopien, und in diesem Baum ist schon mehrfach eine
Regel nur in einer davon nachgezogen worden.
```

<a id="manuellquery"></a>
## `manuellQuery`

```text
Abfrageteil für die MANUELL erfassten Listen: Kontofilter und Suchtext.

── Warum nicht scopeQuery() allein (Marcos Befund vom 20.10.) ──────────────

„Wenn ich im Filter z.b. nach 3001 suche passiert nichts."

Hier stand `scopeQuery('parts')` — nur der Kontofilter. Der Suchtext ging
über partsParams() (03-parts.js) ausschliesslich an die Set-Teile-Wand, und
die manuellen Kacheln blieben unberührt. public/index.html stellt die
Filterleiste aber über den manuellen Bereich und begründet das dort
ausdrücklich damit, dass der Filter auf BEIDE Listen wirkt.

Gefiltert wird am Server (die Begründung steht in 14-scope.js beim
Lagerortfilter), deshalb reist der Text als Abfrageparameter mit — und
deshalb muss jeder Weg, der eine dieser Listen neu lädt, hier vorbei.

EIN Helfer für Teile und Figuren: Dieselbe Lücke bestand in beiden Reitern,
und zwei Fassungen wären zwei Stellen, an denen der nächste Filter vergessen
wird.
```

<a id="manuelletabelle"></a>
## `manuelleTabelle`

```text
Die manuell erfassten Posten als TABELLE — Teile und Figuren.

── Marcos Befund vom 20.10. ────────────────────────────────────────────────

  „Wenn ich bei den Teilen auf Tabelle umschalte, werden nur die Teile aus
   den Sets als Tabelle angezeigt. Die manuell erfassten sind immer
   Kacheln."

Das stimmte, und zwar doppelt: renderManualParts() zeichnete unbedingt
`man-grid`, und der Umschalter hing allein an loadPartsData() — derselbe
halbe Anschluss wie beim Suchtext (siehe teileFilterGeaendert in
public/js/03-parts.js und test/manuelle-listen-filter-db.test.js). Die
Filterleiste MIT dem Umschalter steht ueber beiden Listen; was dort
eingestellt wird, gilt fuer beide.

── EIN Bauer fuer Teile und Figuren ────────────────────────────────────────

Dieselbe Luecke bestand in beiden Reitern (figs-view rief renderFigsAll(),
also nur die Figuren aus Sets). Zwei Fassungen waeren zwei Stellen, an denen
die naechste Spalte vergisst, dass es die andere Liste gibt — genau die
Begruendung, die schon an manuellQuery() oben steht.

── Was die Tabelle zeigt ───────────────────────────────────────────────────

Alles, was auch auf der Kachel steht, und den Lagerort dazu: Beide
Abfragen liefern ihn langst (`lo.name AS storage`), die Kachel hat nur
keinen Platz dafuer. Eine Tabelle ist der Ort, an dem eine solche Spalte
etwas nutzt — Marco hat den Lagerort am selben Tag zum Thema gemacht.

Die Handlungen sind dieselben wie auf der Kachel — Zeile klicken oeffnet das
Detail, der Papierkorb loescht. Eine Ansicht darf nicht koennen, was die
andere nicht kann; der Satz steht so schon an partsTableRow()
(public/js/03-parts.js), und dort steht auch, dass in diesem Projekt genau
daran mehrfach etwas auseinandergelaufen ist.
```
