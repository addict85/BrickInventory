# Begründungen zu `public/js/03-parts.js`

Die ausführlichen Kommentare aus `public/js/03-parts.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="parts-page-size"></a>
## `PARTS_PAGE_SIZE`

```text
═══ TEILE-LISTE: SEITENWEISE MIT ENDLOS-SCROLL ═════════════════════════════

Vorher holte diese Ansicht in einem Zug JEDE Teil/Farb-Kombination der
Sammlung und baute daraus in einem Rutsch die komplette Kachelwand. An einem
Datensatz mit 380 Sets (171'000 parts-Zeilen) gemessen: 20,65 MB Nutzlast und
zehntausende DOM-Knoten pro Tabwechsel. Mit Seiten zu 100 sind es 0,03 MB und
100 Kacheln; nachgeladen wird erst beim Scrollen.

Muster wie im Katalog (09-catalog.js): Sentinel plus IntersectionObserver,
Scroll-Fallback, und ein Generationszähler, damit eine langsame Antwort einer
verworfenen Filterkombination nicht in eine neuere Liste hineinschreibt.

Die eine Stelle, die hier eigenes Nachdenken braucht: Die Kachelansicht
gruppiert nach Farbe mit Zwischenüberschrift, und eine Farbe kann über eine
Seitengrenze laufen. Der Server sortiert nach MIN(color_name), MIN(part_name),
die Seiten kommen also farbsortiert an — die neue Seite hängt ihre ersten
Karten deshalb in die BESTEHENDE letzte Gruppe ein, statt eine zweite
Überschrift derselben Farbe zu erzeugen. _partsLastColor merkt sich, welche
das war.
```

<a id="ersatzteilplakette"></a>
## `ersatzteilPlakette`

```text
Ersatzteil-Plakette. Sets enthalten ein Tütchen Ersatzteile; Rebrickable
kennzeichnet sie.

Der Text `parts.spare_tag` liegt seit jeher in beiden Sprachdateien —
gezeichnet hat ihn nie jemand. Der Grund stand im Feld selbst: `is_spare`
kam in vier Schreibweisen an, und die naheliegende Prüfung wäre falsch
gewesen, weil der Server "0" als ZEICHENKETTE lieferte und die in
JavaScript WAHR ist — jedes Teil wäre als Ersatzteil markiert worden.

Seit der Server die Schreibweisen an einer Stelle liest (istErsatzteil() in
src/infra/validate.ts), ist es ein echter Wahrheitswert und `p.is_spare` genügt.
```

<a id="teilefiltergeaendert"></a>
## `teileFilterGeaendert`

```text
Suchtext — und zwar fuer BEIDE Listen des Reiters.

Marcos Befund vom 20.10.: „Wenn ich im Filter z.b. nach 3001 suche passiert
nichts." Hier stand allein loadPartsData(), also nur die Wand der Set-Teile.
Die manuell erfassten Kacheln darueber blieben unberuehrt, obwohl die
Filterleiste ausdruecklich UEBER ihnen steht (public/index.html, geprueft in
test/tab-layout.test.js).

Eine Entprellung fuer beide: Zwei Zeitgeber auf demselben Feld waeren zwei
Stellen, an denen die naechste Liste vergessen wird.
```

<a id="teileansichtgeaendert"></a>
## `teileAnsichtGeaendert`

```text
Der Ansichtsumschalter — fuer BEIDE Listen des Reiters.

Marcos Befund vom 20.10.: „Wenn ich bei den Teilen auf Tabelle umschalte,
werden nur die Teile aus den Sets als Tabelle angezeigt. Die manuell
erfassten sind immer Kacheln." Hier stand allein loadPartsData() — derselbe
halbe Anschluss wie beim Suchtext darueber.

Neu GEZEICHNET, nicht neu geladen: Die Wand der Set-Teile braucht in der
Tabellenansicht andere Daten (`with_sets=1`, siehe partsQuery) und muss
deshalb neu abrufen. Die manuelle Liste braucht dieselben Daten in einer
anderen Form — ein zweiter Abruf waere nur Wartezeit.
```

<a id="rawcolor"></a>
## `rawColor`

```text
"Keine Farbe" ist NICHT 0.

Der Ausdruck lautete `parseInt(colorSel.value) || 0` — die leere Auswahl
ergab damit 0, und 0 ist bei Rebrickable die Farb-ID von SCHWARZ. Beide
Fälle kamen also als 0 am Server an, und der übersprang daraufhin die
Suche nach dem farbigen Teilebild (`if (colorId && colorId !== 0)`).
Ergebnis: Ein schwarz erfasstes Teil bekam das allgemeine, meist weisse
Bild — sichtbar beim Vergleich mit demselben Teil aus einem Set.

null statt 0 für "keine Farbe": Der Server erkennt daran den Unterschied
und legt weiterhin 0 in der Datenbank ab (Spaltenvorgabe), sucht das
Farbbild aber nur, wenn wirklich eine Farbe gewählt wurde.
```
