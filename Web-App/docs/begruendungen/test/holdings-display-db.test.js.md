# Begründungen zu `test/holdings-display-db.test.js`

Die ausführlichen Kommentare aus `test/holdings-display-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Diagramm und Besitzer-Label folgen dem TATSÄCHLICHEN Bestand.

── Marcos zwei Befunde ─────────────────────────────────────────────────────
1. „Das Diagramm sollte nur den Wert der eingetragenen Status anzeigen. In
   diesem Fall ist nur ein gebrauchtes. Somit sollte der Verlauf von Neu
   nicht angezeigt werden."
2. „Ich habe den Kaufpreis für den Marco gelöscht. Somit sollte auch das
   Label auf der Kachel von Marco nicht mehr angezeigt werden."

── Was dahinter steckte ────────────────────────────────────────────────────
Zu 1: Die Regel „nur Zustände, die auch im Bestand liegen" gab es bereits —
für `by_condition`. Der Diagramm-Aufbau stand im selben Modul ein paar
Zeilen davor und kannte sie nicht; er nahm immer beide Reihen. Dieselbe
Regel, zwei Stellen, eine davon vergessen. Es hing mehr daran als die
Legende: In der App speisen sich „Tief", „Aktuell" und „Hoch" aus den
Diagrammwerten, standen also auf den NEU-Preisen, während die Zeile darüber
korrekt den Gebrauchtpreis auswies.

Zu 2: Beim Löschen der letzten Erfassung setzt `parentQuantitySql` die Menge
auf 0 und lässt die sets-Zeile stehen (bewusst — 0 ist ein gültiger Zustand,
etwa über den Mengenregler). `array_agg(DISTINCT s.user_id)` nahm sie
trotzdem mit, und das Konto stand weiter als Besitzer auf der Kachel.

Beide Fixes liegen auf dem SERVER und wirken damit in Webapp und App
zugleich.
```

<a id="stelle"></a>
## `await erfasse(db, hauptId, SN, 2);`

```text
Ohne diese Gegenrichtung wäre der Test auch grün, wenn das Label ganz
verschwände.
„Wieder ein Exemplar halten" heisst seit Migration 0036: eine
Erfassung anlegen. Hier stand `UPDATE sets SET quantity=2` — die
Spalte gibt es nicht mehr, und das war auch vorher schon die falsche
Richtung: Die Menge war ein Spiegel der Erfassungen.
```
