# Begründungen zu `public/js/13-manuell-detail.js`

Die ausführlichen Kommentare aus `public/js/13-manuell-detail.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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
