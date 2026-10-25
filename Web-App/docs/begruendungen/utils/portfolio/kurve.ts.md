# Begründungen zu `utils/portfolio/kurve.ts`

Die ausführlichen Kommentare aus `utils/portfolio/kurve.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="rekonstruierekurve"></a>
## `rekonstruiereKurve`

```text
Die Kurve aus dem PREISVERLAUF je Set rekonstruieren.

── Warum dieser Weg (unverändert aus getPortfolioHistory) ──────────────────
Der Preisverlauf ist nicht kontogebunden, sondern global. Die Kurve entsteht
damit RÜCKWIRKEND und stimmt auch für die Zeit vor einer Haushaltsverknüpfung
— anders als die Schnappschüsse, die es nur ab dem Zeitpunkt gibt, an dem sie
geschrieben wurden.

── Warum eigene Datei (Nachtrag 135) ───────────────────────────────────────
Das ist der Kern von getPortfolioHistory() und mit Abstand sein grösster
Teil. Danebenzustehen hatte einen Preis: Wer einen Fehler in der
Achsenbeschriftung suchte, las erst durch zweihundert Zeilen
SQL-Rekonstruktion.

Gibt zurück, was die Rechnung darüber braucht: die Rohpunkte und — falls die
Auflösung unterwegs auf Monate umgestellt wurde — den geänderten Wert.
```

<a id="abschnitt"></a>
## Abschnitt

```text
── Kurve aus dem Preisverlauf JE SET rekonstruieren ──────────────────────

VORHER lud diese Stelle JEDE price_history-Zeile aller Sets in den
Node-Prozess und gruppierte sie in JavaScript. Gemessen mit 800 Sets und
einem Jahr Tageswerten (292 000 Zeilen): 1,2 bis 1,7 Sekunden und 35 bis
42 MB Heap — für dreizehn Punkte im Diagramm, bei jedem Aufruf.

Jetzt rechnet Postgres, und zwar mit DERSELBEN Regel, nicht mit einer
ähnlichen:

 1. `tageswerte` nimmt je Set und Tag genau EINEN Preis — den zuletzt
    aufgezeichneten, bei gleichem Zeitstempel den mit dem gesuchten
    Zustand. Das ist die Zeile, die in der alten Schleife als letzte in
    `buckets[tag].sets[set]` landete und damit gewann.
 2. `avg_price` zuerst, `qty_avg_price` als Ersatz — wie das alte
    `parseFloat(r.avg_price||0) || parseFloat(r.qty_avg_price||0)`.
 3. Die Fortschreibung (ein Set ohne neuen Wert behält seinen letzten
    Preis) steckt in der Differenzrechnung: Je Set wird nur die ÄNDERUNG
    zum Vortageswert gezählt, und die laufende Summe über die Tage ergibt
    denselben Gesamtwert wie das alte `carry`-Objekt. Ohne diesen Kniff
    wäre ein einfaches GROUP BY Tag zwar schnell, würde aber andere Zahlen
    liefern — Tage ohne Messwert fielen aus der Summe.

Ergebnis: eine Zeile je Tag statt einer je Set und Tag.
```
