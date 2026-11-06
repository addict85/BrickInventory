# Begründungen zu `public/js/13-acquisition-modals.js`

Die ausführlichen Kommentare aus `public/js/13-acquisition-modals.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="diese-708-zeilen-standen-in-js-07-admin"></a>
## Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt

```text
═══ Kaufpreis-Modal und Detailfenster für manuelle Einträge ════════════════

── Warum eigene Datei ────────────────────────────────────────

Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt
„Confirm-Dialog, Config-Export/Import, API-Tokens, Job-Status" nennt. Keines
der beiden Fenster hier ist Administration: Das eine erfasst Kaufpreise zu
einem Set, das andere zeigt Details zu manuell erfassten Teilen und
Minifiguren. Sie lagen dort, weil 07-admin.js über die Zeit die Datei war, in
die Neues fiel — 1492 Zeilen, benannt nach ihrer Geschichte.

Die Schnittstelle ist schmal und war es schon vorher: Drei Helfer kommen aus
07-admin.js herüber (confirmDelete, renderMarketRows, priceChartSVG), und
hinaus geht renderAcquisitionSummary. Genau das machte den Schnitt möglich,
ohne irgendetwas umzubauen.
```

<a id="acq-modal"></a>
## `acq-modal`

```text
HINWEIS: Hier stand eine ZWEITE, kürzere Fassung von closeAcqModal().
Als klassisches Skript war die doppelte Deklaration erlaubt — die spätere
(weiter unten, mit der vollständigen Rückkehr-Logik für _acqManItem UND
_acqModalSn) hat sie stillschweigend überschrieben. Die kurze Fassung war
also seit jeher toter Code und ist entfernt; im ES-Modul wäre sie ohnehin
ein harter Fehler ("Duplicate top-level function declarations").
```

<a id="eigentuemerwechsel-verschieben-genau-die"></a>
## Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.

```text
Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.
KEIN from_user_id: Den Absender ermittelt der Server aus der Zeile
selbst (acquisitionMoveSource). Hier stand der BETRACHTER — für die
Zeile eines Unterkontos suchte der Server sie damit unter dem falschen
Konto und antwortete 404, obwohl das Select den richtigen Eigentümer
längst anzeigte.
```

<a id="loadgallery"></a>
## `loadGallery`

```text
Kennzahlen, Galerie und Finanzen mitziehen.

Vorher aktualisierte diese Funktion nur die beiden Dialoge. Kaufpreis und
Menge einer Erfassung wirken aber auf die Galerie-Kachel (Preis-Badge) und
auf die Finanzauswertung — beide blieben auf dem alten Stand, bis der Reiter
neu geladen wurde. Dieselbe Ursache wie bei manQtySave() und in der
Android-App bei updateAcquisition().
restore wie beim Eigentümerwechsel: Auch ein Preis- oder Mengenwechsel im
Dialog darf die gescrollte Tiefe nicht kosten.
```

<a id="rawimgsrc"></a>
## `rawImgSrc`

```text
War: fullUrl(...) allein — bei einer CDN-Quelle ohne imgUrl()-Umwicklung
lädt der Browser direkt von Rebrickable, am Server vorbei. Das ist der
eigenständige Kaufpreis-Detail-Dialog für manuell erfasste Teile/
Minifiguren — ein anderer Ort als die Kachel-Zoom-Funktion in 03-parts.js/
06-minifigs.js, die bereits korrigiert wurde. Jetzt wie dort: über den
Server-Proxy, volle Auflösung ohne &thumb=1.
```

<a id="if-2"></a>
## `if`

```text
── Farbe (nur Teile) — ÄNDERBAR ────────────────────────────────────────

Marcos Bitte vom 19.10.: „Weiter möchte ich die Farbe nachträglich
anpassen können für den Fall dass diese nicht korrekt geladen wurde."

Hier stand die Farbe als Text, mit dem Kommentar „read-only". Die Bedingung
war dazu `item.color_name` — ausgerechnet ein Teil OHNE Farbbezeichnung,
also genau der Fall, der korrigiert werden muss, zeigte die Zeile gar
nicht an.

Die Auswahlliste ist dieselbe wie beim Erfassen (loadBrickColors, aus
/v1/parts/brick-colors). Sie wird NACH dem Zeichnen gefüllt: Der Abruf
geht übers Netz, und der Dialog soll nicht darauf warten — bis dahin
steht die heutige Farbe als einzige Möglichkeit da.
```

<a id="ladeortauswahl-2"></a>
## `ladeOrtAuswahl`

```text
── Lagerort ─────────────────────────────────────────────────────────────

Marcos Befund vom 24.09.: „Auf dem Detail Dialog der manuell erfassten
Teile ist der Lagerort nicht ersichtlich. Auf dem Detaildialog der manuell
erfassten Minifiguren ist das Lagerort nicht ersichtlich." Er vermutete
es auch in der Webapp — zu Recht: Die Zeile gab es nur im Dialog der Teile
AUS SETS (setitem-storage) und im Set-Detail.

Dasselbe Bedienelement und derselbe Speicherweg wie dort; nur die Adresse
haengt am Typ. Die Auswahlliste gehoert dem BESITZER des Eintrags, nicht
dem Betrachter — im Haushalt zeigt der manuelle Bereich die Eintraege
aller Konten.
```

<a id="preisverlauf-wie-im-set-detail-beide-zus"></a>
## Preisverlauf — wie im Set-Detail, beide Zustände in einem Diagramm.

```text
Preisverlauf — wie im Set-Detail, beide Zustände in einem Diagramm.

Die Verlaufstabellen für Teile und Figuren sind neu (db/migrations/0003);
vorher speicherte der Cache nur den zuletzt abgerufenen Preis. Das
Diagramm bleibt deshalb eine Weile leer, bis genug Punkte gesammelt sind —
das ist erwartet und kein Fehler.
Marktpreis je Zustand — oberhalb des Diagramms, wie im Set-Detail.
```

<a id="fuellefarbwahl"></a>
## `fuelleFarbwahl`

```text
Die Auswahlliste der Farben im Detaildialog füllen.

Getrennt vom Zeichnen, weil /v1/parts/brick-colors beim ERSTEN Mal über das
Netz geht (Rebrickable, danach im Modul gehalten). Der Dialog steht
derweil schon offen und zeigt die heutige Farbe.

Schlägt der Abruf fehl, bleibt die eine Möglichkeit stehen: eine Liste mit
nur der aktuellen Farbe ändert nichts — besser als eine leere Liste, in der
die Farbe des Teils gar nicht mehr vorkommt.
```

<a id="speichereteilfarbe"></a>
## `speichereTeilFarbe`

```text
Die Farbe eines manuell erfassten Teils ändern.

Was dabei in der Datenbank passiert — Umziehen oder Zusammenlegen, und was
mit den Erfassungen geschieht — steht an einer Stelle:
src/teile/teilFarbeAendern.ts.

Danach wird der Dialog mit der NEUEN Farbe neu geöffnet. Die Farbe ist Teil
der Kennung des Eintrags (Adresse: /parts/:nr/:farbe); ohne das zeigte der
offene Dialog weiter auf eine Zeile, die es nicht mehr gibt, und der
nächste Klick darin ginge ins Leere.
```

<a id="acqurl2"></a>
## `acqUrl2`

```text
Erfassungsliste IMMER neu laden — in beide Richtungen.

── Was vorher falsch war ─────────────────────────────────────────────────
Hier stand `if (qty > prevQty)`, also nur beim Erhöhen. Das erzeugte zwei
Fehlerbilder, die wie zwei verschiedene Fehler aussahen:

  • Menge REDUZIEREN: Der Server entfernt (bzw. verkleinert) die heutige
    Erfassung per LIFO — die Anzeige lud aber nie neu und zeigte den
    gelöschten Eintrag weiter an.

  • Menge ERHÖHEN: prevQty kam aus manualPartsCache/manualFigsCache und
    wurde bei Teilen NUR über part_number gesucht — ohne color_id. Bei
    einem Teil in mehreren Farben traf das die falsche Zeile; fand es gar
    nichts (Teil nicht in der geladenen Seite der paginierten Liste), fiel
    der Ausdruck auf inp.value zurück. Das ist zu diesem Zeitpunkt aber
    bereits der NEUE Wert, weil manQtyChange() ihn vor dem Aufruf setzt —
    `qty > prevQty` war damit `qty > qty`, also falsch, und es wurde
    ebenfalls nicht nachgeladen.

prevQty ist ersatzlos entfallen: Ein GET auf die Erfassungen kostet nichts
und die Antwort ist die einzige verlässliche Quelle dafür, was jetzt in der
Datenbank steht. Eine Bedingung, die raten muss, ob sich etwas geändert
hat, ist hier schlicht die falsche Konstruktion.
```
