# Begründungen zu `test/anleitungen-herkunft-db.test.js`

Die ausführlichen Kommentare aus `test/anleitungen-herkunft-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Papierkorb steht nur an SELBST hochgeladenen Anleitungen.

── Marcos Befund ───────────────────────────────────────────────────────────
„Im Detail Dialog der Sets erscheint bei den Anleitungen ein Papierkorb. Der
Papierkorb soll nur bei den manuell hochgeladenen Anleitungen erscheinen.
Bei den Benutzer unabhängigen welche automatisch importiert wurden soll kein
Papierkorb angezeigt werden."

── Was der Server liefert und was daran fehlte ─────────────────────────────
getSet()/getSets() legen ZWEI Tabellen zu einer Liste zusammen:

  shared_instructions — die automatische Suche (Rebrickable, Brickset, BDP,
                        BrickInstructions). Gilt fuer alle Konten.
  instructions        — was ein Konto selbst hochgeladen hat.

Loeschen laesst sich nur die zweite: DELETE /api/v1/sets/:sn/instructions/:id
sucht ausschliesslich in `instructions` (routes/sets.ts).

Die Android-App entschied ueber den Papierkorb an `id != null` — in der
Annahme, automatisch importierte Anleitungen haetten keine Kennung. Dieser
Test misst, dass die Annahme falsch war: BEIDE Zeilen bringen eine `id` mit,
und die Zaehler laufen unabhaengig voneinander. Ein Klick auf den Papierkorb
einer geteilten Anleitung konnte deshalb die gleichnamige EIGENE Anleitung
treffen.

── Was hier geprueft wird ──────────────────────────────────────────────────
 1. FUNKTIONAL: getSet() markiert jede Zeile mit `is_manual` — false fuer die
    geteilte, true fuer die hochgeladene. Dasselbe fuer getSets(), weil die
    Galerie-Kachel aus derselben Liste zaehlt.
 2. GEGENPROBE ZUR ALTEN REGEL: `id != null` trifft auf beide zu, taugt also
    nicht. Wird das gemessen und nicht behauptet, faellt der Test auf, falls
    jemand die alte Regel zurueckholt.
 3. AM QUELLTEXT: Beide Oberflaechen haengen den Knopf an `is_manual` und
    nicht mehr an einem eigenen Pfadvergleich. Die Regel soll an einer
    Stelle stehen — dem Server.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
```
