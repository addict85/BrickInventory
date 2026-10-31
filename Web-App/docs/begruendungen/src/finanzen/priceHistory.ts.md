# Begründungen zu `src/finanzen/priceHistory.ts`

Die ausführlichen Kommentare aus `src/finanzen/priceHistory.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Preisverlauf eines Sets — die EINE Umsetzung für Webapp und Android-API.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Die Route /api/finance/price-history/:setNumber (Webapp) und
/api/v1/sets/:setNumber/price-history (Android) hatten je eine eigene
Fassung derselben Logik: dieselbe Abfrage auf price_history, dieselbe
Zustandsauflösung, dasselbe Voranstellen des Kaufpreises, dieselbe
Prozentrechnung — nur mit leicht abweichenden Details.

Genau diese Doppelung hat in diesem Projekt schon einmal Schaden angerichtet:
Beide Routen ermittelten den Zustand eigenständig, eine davon las den
globalen Standard statt des tatsächlichen Zustands, und die Folge war eine
angezeigte Entwicklung von „−32 %" bei unverändertem Preis. Die
Zustandsauflösung wurde daraufhin zu resolveSetCondition() zusammengeführt —
der Rest der Route blieb doppelt. Das holt diese Datei nach.

── Was geliefert wird ──────────────────────────────────────────────────────
Beide Zustände GETRENNT (history_new / history_used) statt einer
zusammengefalteten Reihe. Die Daten lagen immer schon so vor — price_history
führt condition als eigene Spalte —, sie wurden nur nie einzeln
ausgeliefert, weil es nur eine Linie zu zeichnen gab.
```

<a id="zustaendefuerverlauf"></a>
## `zustaendeFuerVerlauf`

```text
Welche Zustaende gehoeren ins Diagramm?

── Marcos Befund ───────────────────────────────────────────────────────────
„Das gezeigte Teil hat nur einen Kaufpreis mit dem Zustand gebraucht.
Trotzdem wird im Preisverlauf auch eine Linie mit 'neu' angezeigt. Es muss
mindestens ein Zustand unter Kaufpreis vorhanden sein, damit der
Preisverlauf des Zustandes angezeigt wird."

── Warum das hier steht und nicht zweimal daneben ──────────────────────────
Die Regel GAB es schon — fuer Sets, in getSetPriceHistory, mit ausfuehrlicher
Begruendung: An den Diagrammwerten haengen in der App auch „Tief",
„Aktuell" und „Hoch", und bei einem nur gebraucht vorhandenen Set standen
dort die Neupreise. Fuer manuell erfasste Teile und Minifiguren war
derselbe Aufbau eine Zeile weiter unten ohne diese Regel geschrieben
(manualPriceHistory) — dieselbe Regel an zwei Orten, und nur einer kannte
sie.

Jetzt kennt sie EINER, und beide fragen ihn.

@param belegt    Zustaende mit Erfassung — die Schluessel von by_condition.
@param rueckfall Was gilt, wenn es GAR KEINE Erfassung gibt. Sonst verschwaende
  der Verlauf ganz, und ein Gegenstand ohne erfassten Kaufpreis hat trotzdem
  einen Marktwert. Bei Sets ist das der Zustand des Bestandes; bei manuellen
  Teilen beide, weil es dort keinen dritten Ort gibt, der es besser wuesste.
```

<a id="getsetpricehistory-acqbycond"></a>
## `acqByCond`

```text
── Marktpreis und Entwicklung JE ZUSTAND ─────────────────────────────────

Eine Zeile erscheint nur, wenn für diesen Zustand auch eine Erfassung
existiert — sonst stünde dort ein Marktpreis ohne Bezugsgrösse, und die
Prozentangabe daneben wäre gegen nichts gerechnet.

Bezugsgrösse ist der mengengewichtete Kaufpreis DIESES Zustands, nicht der
des Sets insgesamt: Wer ein Exemplar neu und eines gebraucht gekauft hat,
will zwei getrennte Entwicklungen sehen, keine vermischte.
```

<a id="getsetpricehistory-zustaendefuerchart"></a>
## `zustaendeFuerChart`

```text
── Diagrammdaten: nur die Zustände, die auch im Bestand liegen ───────────

Marcos Befund: „Das Diagramm sollte nur den Wert der eingetragenen Status
anzeigen. In diesem Fall ist nur ein gebrauchtes. Somit sollte der Verlauf
von Neu nicht angezeigt werden."

Die Regel gab es bereits — zwei Blöcke weiter oben, für `by_condition`:
Eine Zeile erscheint nur, wenn für diesen Zustand eine Erfassung existiert.
Der Diagramm-Aufbau stand davor und kannte sie nicht; er nahm immer beide
Reihen. Dieselbe Regel, zwei Stellen, eine davon vergessen — deshalb steht
der Aufbau jetzt HIER, hinter der Stelle, die weiss, was im Bestand liegt.

Es hing mehr daran als die Legende: In der App speisen sich „Tief",
„Aktuell" und „Hoch" aus den Diagrammwerten. Bei einem nur gebraucht
vorhandenen Set standen dort die Neupreise (3.94 / 7.99 / 7.99), obwohl
die Zeile darüber korrekt CHF 3.94 auswies.

Ohne JEDE Erfassung (Set ohne erfassten Kaufpreis) bleibt der Zustand des
Bestandes übrig — sonst verschwände der Verlauf ganz, und ein Set ohne
Kaufpreis hat trotzdem einen Marktwert.
```

<a id="manualseries"></a>
## `manualSeries`

```text
Dieselbe Antwortform wie oben für Sets — und aus demselben Grund hier und
nicht in einer Routendatei: Die Android-API braucht sie jetzt ebenfalls
(/api/v1/parts/:nummer/:farbe/price-history und
/api/v1/minifigs/:nummer/price-history), und der Set-Verlauf ist genau daran
schon einmal auseinandergelaufen — zwei Fassungen derselben Abfrage, die
den Zustand unterschiedlich auflösten, Ergebnis „−32 %" bei unverändertem
Preis.

Die Verlaufstabellen sind neu (db/migrations/0003): part_price_cache und
minifig_price_cache speicherten über ihr UNIQUE nur den zuletzt abgerufenen
Preis. Die Migration hat den Cache-Stand als ersten Punkt übernommen, alles
Weitere entsteht mit jedem Abruf. Ein Diagramm braucht zwei Punkte — kurz
nach dem Einspielen ist die Antwort deshalb erwartungsgemäss dünn.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Gemeinsamer Aufbau für beide Arten.

`uid` ist ein BLICKFELD (scopeIds), keine einzelne Kennung: Im Haushalt
gehört ein manuell erfasstes Teil oft dem Unterkonto, und die Kaufpreise
daraus bestimmen sowohl die Kaufpreis-Zeile als auch die Prozentangabe.
Der Typ stand hier auf `number` — aufgefallen ist es nicht, weil alle
Aufrufer über ein spätes require() kommen und TypeScript dort nichts prüft.
```

<a id="getpartpricehistory-blnummer"></a>
## `blNummer`

```text
── Zwei Schlüsselräume, die man nicht mischen darf (Nachtrag 143) ────────

Marcos Befund: Auf der Finanzseite steht für ein Teil ein Marktpreis, im
Detailfenster ein „—".

`part_price_cache` und `part_price_history` werden von fetchPartPrice()
geschrieben — und zwar unter der BRICKLINK-Teilenummer und der
BRICKLINK-Farbnummer (resolveBlPartNumber / resolveBlColorId). BrickLink
antwortet auf Rebrickable-Nummern mit 404, deshalb wird vor dem Abruf
übersetzt, und der Cache erbt diesen Schlüssel.

Hier kamen die REBRICKABLE-Werte an und liefen ungeprüft in die Abfrage.
Für Teile ohne Zuordnung stimmen beide zufällig überein — für alle anderen
fand die Abfrage nichts.

Die Erfassungen (part_acquisitions) tragen dagegen die
Rebrickable-Nummer, denn so hat der Benutzer sie eingegeben. Deshalb
werden unten BEIDE Schlüssel gebraucht, nicht einer für alles.

── Nachtrag: BEIDE Nummern, nicht nur die BrickLink-Nummer ───────────────
Der Satz oben stimmte fuer die Farbe, fuer die NUMMER nicht:
fetchPartPrice uebersetzte nur die Farbe und nahm die Teilenummer so, wie
der Aufrufer sie mitbrachte. Von drei Aufrufern brachten zwei die
BrickLink-Nummer mit und einer (getCurrentPartMarketPrice, also die
Teileansicht) die Rebrickable-Nummer. In part_price_cache und
part_price_history stehen deshalb ALTE Zeilen unter beiden Nummern.

fetchPartPrice uebersetzt jetzt oben und schreibt nur noch unter der
BrickLink-Nummer. Damit die bereits vorhandenen Punkte nicht aus dem
Diagramm verschwinden, wird hier unter beiden gesucht — dieselbe Loesung
wie bei den Minifiguren.
```

<a id="getminifigpricehistory"></a>
## `getMinifigPriceHistory`

```text
Preisverlauf einer manuell erfassten Minifigur (ohne Farbe).

── Derselbe Fehler wie bei den Teilen, hier nie behoben ────────────────────
Für Teile ist er in Nachtrag 143 beschrieben und behoben: Preise stehen
unter der BrickLink-Nummer, Erfassungen unter der des Benutzers. Für
Minifiguren stand hier EIN Schlüssel für beides, und der Kommentar an
manualPriceHistory behauptete ausdrücklich, das gehe in Ordnung.

Es geht nicht: getCurrentFigMarketPrice versucht `[blFigNumber, figNumber]`
der Reihe nach, und fetchMinifigPrice legt Cache und Verlauf unter der
Nummer ab, mit der der Abruf geklappt hat. Trägt die Figur eine eigene
bl_fig_number, stehen die Preise dort — gesucht wurde unter der Nummer des
Benutzers.

Sichtbar genau wie bei den Teilen: In der Finanzliste steht ein Marktpreis,
im Detailfenster ein „—", und das Diagramm bleibt leer.

Abgefragt werden deshalb BEIDE Nummern. Nicht nur die BrickLink-Nummer: Der
Schätzpfad über die Einzelteile (estimateFigPriceFromParts) schreibt
ausdrücklich unter der Nummer des Benutzers, und ältere Zeilen stammen aus
der Zeit vor der bl_fig_number. Beide Töpfe gehören zur selben Figur.
```

<a id="preisnummernfuerfigur"></a>
## `preisNummernFuerFigur`

```text
Unter welchen Nummern können die Preise dieser Figur liegen?

Die eigene und, falls hinterlegt, die BrickLink-Nummer.
Doppelte fallen weg — meist sind beide gleich, dann bleibt es bei einer.

Das BLICKFELD ist hier entfallen, und das ist keine Vereinfachung, sondern
eine Richtigstellung: Die Nummer stand bis Migration 0037 je Konto an der
Bestandszeile, also musste die Abfrage alle Konten des Haushalts ansehen.
Jetzt haengt sie an der FIGUR und gilt fuer alle — es gibt nichts mehr zu
sammeln.
```

<a id="purgealtepreise"></a>
## `purgeAltePreise`

```text
Alte Preis-Zeilen entfernen.

Die Tabelle wuchs unbegrenzt: Bei 800 Sets und einem Eintrag je Tag sind das
rund 292 000 Zeilen und 40 MB im Jahr — und die Portfolio-Kurve liest für den
Zeitraum „Max" jede davon. Ein Jahresschnitt hält die Kurve vollständig
(Tageswerte gibt es nur so lange, wie der Preis-Job läuft) und die Auswertung
bezahlbar.

PRICE_HISTORY_KEEP_DAYS steuert die Aufbewahrung, 0 schaltet das Aufräumen
ab.

Die frühere Ausnahme für die Portfolio-Schnappschüsse ist entfallen: Es gibt
sie nicht mehr (Nachtrag 82). Alte Zeilen aus der Zeit davor räumt die
Aufbewahrungsfrist damit von selbst weg.

@returns Anzahl entfernter Zeilen
```
