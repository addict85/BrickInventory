# Begründungen zu `test/acquisition-delete-refresh-db.test.js`

Die ausführlichen Kommentare aus `test/acquisition-delete-refresh-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Erfassung löschen → Preis und Zustand der ANTWORT werden NEU bestimmt.

── Woher dieser Test kommt (Marcos Screenshot, Nachtrag 75) ────────────────
„Wenn ich in der Android-App einen Kaufpreis entferne, wird der Preis auf der
Detailseite nicht aktualisiert." Auf dem Bild: die verbliebene Erfassung
zeigt 7.41 CHF, die Kachel oben weiterhin 9.48 — den Preis der GELÖSCHTEN
Zeile.

Ursache: Der Lösch-Weg der gemeinsamen Fabrik aktualisierte nur die MENGE
(parentQuantitySql). Preis und Zustand blieben in der gespiegelten Spalte
sets.purchase_price stehen, aus der Kachel, Galerie und Finanzübersicht
lasen.

── Was Migration 0032 daran geändert hat ───────────────────────────────────
Die Spalte ist weg. Preis und Zustand stehen nur noch in set_acquisitions,
und die Antwort der Schreib-Endpunkte trägt das Aggregat daraus mit
(withSetAggregate → avg_purchase_price, condition). Genau diese Felder liest
die Kachel, also prüft dieser Test jetzt SIE statt der Spalte.

Das ist nicht derselbe Test mit anderen Worten: Vorher war die Frage „zieht
der Lösch-Weg die zweite Wahrheit nach?", jetzt ist sie „rechnet die Antwort
aus dem, was übrig ist?". Der Fehler von Nachtrag 75 kann in dieser Form
nicht mehr entstehen — dafür kann das Aggregat falsch rechnen, und das wäre
für Marco dasselbe Bild.

Teilschritt 0 unten ist deshalb neu: Er prüft mit ZWEI Erfassungen im
Bestand, dass der gezeigte Preis der mengengewichtete Mittelwert ist und
nicht der der neuesten Erfassung — also genau das, was die gelöschte Spalte
geführt hätte. Ohne ihn wäre jeder Teilschritt mit nur einer übrigen
Erfassung von „Mittelwert" und „neuester Wert" nicht zu unterscheiden.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `await aufbauen();`

```text
3. Letzte Erfassung löschen: Es bleibt keine übrig — und seit
   Nachtrag 84 auch keine Elternzeile mehr.

   Vorher stand hier „Ohne Erfassungen ist die Menge 0". Genau diese 0
   war Marcos Fund: Ein Set mit Menge 0 blieb in Galerie, Statistik und
   Bewertung sichtbar — und `quantity || 1` in src/finanzen/financeCalc.ts
   machte daraus beim Rechnen wieder eine 1. Eine Menge von 0 ist auch
   kein Zustand, den jemand herstellen kann: Beide Mengenregler halten
   bei 1. Sie entstand ausschliesslich hier, und jetzt gar nicht mehr.
```
