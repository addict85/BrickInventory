# Begründungen zu `test/price-currency-db.test.js`

Die ausführlichen Kommentare aus `test/price-currency-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Marktpreis der Detailansicht: Die Währung bestimmt der SERVER, nicht der
Client — gegen echte Route und Tabelle.

── Warum es diese Datei gibt (Marcos Fehlerbericht, Nachtrag 31) ───────────
Symptom: Die Android-App zeigte in der Detailansicht teilweise keinen
Marktpreis, während Finanzübersicht und Galerie-Kachel ihn zeigten.

Ursache-Kette, am laufenden Server nachgestellt:
  1. Die App speichert die Währung lokal (DataStore), Startwert "EUR" —
     übernommen vom Server erst beim ERSTEN Laden der Finanzübersicht.
  2. Die Detailansicht schickte diesen Wert als ?currency= mit.
  3. GET /api/v1/sets/:sn/price liess den Parameter GEWINNEN
     (`req.query.currency || getSetting(...)`).
  4. price_cache ist über set_number+condition+currency_code verschlüsselt:
     EUR-Anfrage traf den CHF-Cache nie → Live-Versuch (bis zu zwei
     BrickLink-Abrufe je Ansicht) → häufig no_price → leere Kachel.
  Finanzübersicht und Galerie fragen OHNE Parameter → Nutzereinstellung →
  Preis da. Identischer Nutzer, identisches Set: nur der Parameter
  unterschied no_price=true von avg_price=629.90.

Seit Nachtrag 31 ignoriert die Route den Parameter — wie es die
Schwester-Route /price-history aus demselben Grund immer tat. Damit sind
auch ALTE App-Fassungen geheilt, ohne Update.
```
