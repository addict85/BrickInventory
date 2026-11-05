# Begründungen zu `test/teileliste-bestand-db.test.js`

Die ausführlichen Kommentare aus `test/teileliste-bestand-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Kann ich das bauen?" — was der Bestandsabgleich zählt.

── Marcos Befund ───────────────────────────────────────────────────────────

„Ich besitze das Set 2x wie kann es dann sein, dass Teile fehlen?"

Weil die Stückzahl nirgends vorkam. Der Teile-Import legt je
(user_id, set_number) GENAU EINEN Satz Zeilen ab (src/katalog/partsImport.ts:
erst DELETE, dann INSERT mit `part.quantity`) — wie oft jemand das Set
besitzt, steht ausschliesslich in `sets.quantity`. Der Abgleich summierte
aber blank über `parts.quantity`. Wer ein Set zweimal hatte, sah den Inhalt
von einem.

── Warum mit DB ────────────────────────────────────────────────────────────

Die Aussage ist eine Aussage über eine ABFRAGE mit zwei Tabellen und einem
LEFT JOIN. Am Quelltext lässt sich prüfen, dass der JOIN dasteht — nicht,
dass er das Richtige rechnet. Vier Fälle, die alle in einer einzigen Antwort
zusammenkommen müssen:

  1. Ein Set, zweimal besessen  → Teile zählen doppelt.
  2. Ein Set, einmal besessen   → unverändert.
  3. Manuell erfasste Teile     → NIE multipliziert (sie hängen an keinem
                                   Set; `lose` ist genau diese Menge).
  4. Eine Teilezeile ohne Set   → zählt einfach, statt aus der Antwort zu
                                   fallen (deshalb LEFT und nicht INNER).

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="bedarf-und-bestand-werden-ueber-dieselbe"></a>
## `test('Bedarf und Bestand werden über dieselbe Nummer zusammengeführt',`

```text
Beide Seiten des Abgleichs benutzen DIESELBE Nummer.

── Marcos Frage ────────────────────────────────────────────────────────────

„Kann der Abgleich im Hintergrund nicht über die Rebrickable ID erfolgen,
die Anzeige aber weiterhin über die BrickLink ID?" — Ja. Und dass es das
vorher NICHT tat, war der zweite Grund für fehlende Teile.

Zusammengefasst wurde der Bedarf nach der BrickLink-Nummer, nachgefragt
wurde der Bestand mit der Rebrickable-Nummer. Mehrere Rebrickable-Teile
teilen sich regelmässig eine BrickLink-Nummer (Formvarianten). Für die
fielen zwei Zeilen zu einer zusammen: Bedarf addiert, gesucht aber nur nach
der Nummer, die zufällig zuerst kam.

`ohneKommentare()` ist hier keine Zierde: Der Erklärkommentar an der
geänderten Stelle zitiert die alte Fassung wörtlich. Ohne das Abstreifen
fände dieser Test sie und bliebe für immer grün — dieselbe Falle, die der
Helfer im Kopf beschreibt und die in dieser Sitzung schon einmal zugeschnappt
ist.
```

<a id="der-bestandsabgleich-liest-sein-blickfel"></a>
## `test('der Bestandsabgleich liest sein Blickfeld aus der eigenen Wahl',`

```text
Das Blickfeld des Abgleichs kommt aus DIESER Ansicht.

Bis hierher übernahm `plFuelleBestand()` stillschweigend den Kontofilter des
TEILE-Reiters (`scopeQuery('parts')`) — eine Einstellung, die woanders sitzt
und hier wirkt. Nach jeder Anmeldung steht sie ausserdem auf „Alle Konten",
womit der Abgleich entgegen Marcos Vorgabe („aber nur die eigenen Sets")
immer den ganzen Haushalt zählte.
```
