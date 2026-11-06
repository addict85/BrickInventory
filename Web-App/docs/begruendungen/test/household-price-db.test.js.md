# Begründungen zu `test/household-price-db.test.js`

Die ausführlichen Kommentare aus `test/household-price-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Marktpreis und Preisverlauf für HAUSHALTS-Sets — gegen echte Routen.

── Woher dieser Test kommt (Marcos Fehlerbericht, Nachtrag 33) ─────────────
Screenshot aus dem Betrieb: Set 42200-1 gehört dem Unterkonto, Marco (Haupt-
konto) öffnet die Detailansicht der App — Marktpreis „—", kein Preischart.
Finanzübersicht und Galerie-Kachel zeigten denselben Preis korrekt.

Ursache, am laufenden System nachgestellt: Die Detailroute nutzt scopeIds()
seit jeher, die PREISroute prüfte stur `user_id = eigene ID` → für jedes
fremde Haushalts-Set kam 404 „Set not found", BEVOR irgendeine Preislogik
lief. Und getSetPriceHistory() las Set und Erfassungen nur mit der
Betrachter-ID → by_condition leer, kein Kaufpreis-Punkt. Wieder das Muster
„Regel fehlt am zweiten Weg" — dieselbe Klasse wie requireAdmin (125) und
forgot-password (141). resolveSetCondition() konnte das Blickfeld immer
schon; es kam nur nie an.

Der gemeinsame Helfer ist bewusst der Fix-Ort (Marcos Wunsch: Webapp und
App teilen dieselbe Logik): src/finanzen/priceHistory.ts nimmt jetzt das Blickfeld,
ALLE sechs Aufrufer (Webapp + v1, Sets/Teile/Minifiguren) reichen
scopeIds() durch.
```
