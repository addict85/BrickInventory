# Begründungen zu `src/teile/partsSummary.ts`

Die ausführlichen Kommentare aus `src/teile/partsSummary.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Vorberechnete Teile-Zusammenfassung.

── Warum ───────────────────────────────────────────────────────────────────
Die Teileansicht gruppiert 171'000 parts-Zeilen (380 Sets) nach
COALESCE(bl_part_number, part_number) und color_id. Diese Gruppierung lief
bei JEDEM Seitenaufruf komplett neu — auch nach der Umstellung auf
Endlos-Scroll, denn LIMIT kann erst nach dem GROUP BY greifen. Gemessen:

    Zähler                 100 ms
    Seitenabfrage          157 ms   → rund 600 ms pro Scroll-Schritt

Aus einer vorberechneten Tabelle mit passendem Index:

    Zähler                   7 ms
    Seitenabfrage            2 ms

Das Ergebnis ändert sich nur, wenn sich Teile oder Set-Mengen ändern — also
beim CSV-Import, beim Hinzufügen/Löschen eines Sets und bei manuellen
Teilen. Gelesen wird es dagegen bei jedem Scroll-Schritt.

── Warum ein Trigger und keine Aufrufe an den Schreibstellen ───────────────
Die naheliegende Variante wäre, an jeder schreibenden Stelle „Zusammenfassung
neu bauen" aufzurufen. Genau daran scheitern solche Caches aber: Eine
übersehene Stelle liefert still veraltete Daten, und man merkt es erst, wenn
jemand sich über falsche Zahlen wundert.

Deshalb hängt an `parts` und `sets` ein Statement-Trigger, der einen globalen
Zähler hochsetzt. Kein Code-Pfad kann daran vorbei — auch der CSV-Import
nicht, der mit gebündelten INSERTs arbeitet. Statement-Ebene statt Zeilenebene
ist wichtig: Ein Import mit 171'000 Zeilen löst so EINEN Bump aus, nicht
171'000.

Beim Lesen wird verglichen: Ist der globale Zähler grösser als der Stand, mit
dem die Zusammenfassung des Nutzers gebaut wurde, wird sie neu aufgebaut
(596 ms) — sonst direkt gelesen. Der Preis dafür ist, dass die Schreiboperation
eines Nutzers die Zusammenfassungen aller anderen entwertet. Bei einer
selbst gehosteten Installation mit wenigen Konten ist das der richtige Tausch
gegen die Sicherheit, nie veraltete Zahlen zu zeigen.
```

<a id="initpartssummary"></a>
## Abschnitt

```text
── Ein Zähler JE KONTO ─────────────────────────────────────────────────

Hier stand ein einziger globaler Zähler (Tabelle parts_version, eine
Zeile). Er war einfach, hatte aber einen Preis, der im Haushalt spürbar
wird: JEDE Änderung IRGENDEINES Kontos entwertete die Zusammenfassung
ALLER. Trägt ein Kind ein Teil nach, gilt die Zusammenfassung der Eltern
als veraltet — und die Kennzahlen (ensureFresh mit strict) weichen so
lange auf die Live-Abfrage aus, bis der Neuaufbau durch ist. Gemessen an
800 Sets / 60'000 Teilen: rund 300 ms Neuaufbau, ausgelöst durch eine
Änderung, die mit diesen Daten nichts zu tun hatte.

Jetzt zählt jede Zeile für ihr eigenes Konto. Die Zusammenfassung eines
Kontos wird nur noch entwertet, wenn dessen eigene Daten sich ändern.
```

<a id="initpartssummary-2"></a>
## Abschnitt

```text
── Warum drei Trigger statt einem ──────────────────────────────────────

Um zu wissen, WESSEN Daten sich geändert haben, braucht der Trigger die
betroffenen Zeilen — auf Statement-Ebene sind das die Übergangstabellen
(REFERENCING … TABLE). Die gibt es aber nur passend zur Operation: beim
INSERT nur NEW, beim DELETE nur OLD. Ein gemeinsamer Trigger für alle drei
Operationen kann sie deshalb nicht deklarieren — daher je einer.

FOR EACH STATEMENT bleibt: Ein CSV-Import mit gebündelten INSERTs kostet
einen Zähler-Update je Anweisung, nicht 171'000.
```

<a id="initpartssummary-3"></a>
## Abschnitt

```text
── Warum `set_acquisitions` dazugehoert ────────────────────────────────

Die Zusammenfassung speichert `total_quantity` = Teilemenge je Set x Zahl
der Exemplare DES SETS. Dieser zweite Faktor stand bis Migration 0036 in
`sets.quantity` — eine Mengenaenderung war also eine Aenderung an `sets`
und entwertete die Zusammenfassung ueber den Trigger dort.

Seit 0036 steht die Zahl in `set_acquisitions`. Ohne diesen Trigger
bliebe `total_quantity` nach einem Zukauf stehen, und zwar ohne dass
irgendetwas falsch AUSSIEHT — die Zahl ist plausibel, nur alt. Genau die
Sorte Fehler, die den Umzug der Spalte ueberhaupt noetig gemacht hat.
```

<a id="rebuild-lock"></a>
## `lock`

```text
Sperre über die Datenbank, nicht nur über die In-Memory-Map
(_rebuilding) weiter unten.

Der Server läuft im Cluster-Modus mit mehreren Worker-Prozessen
(server.ts, cluster.fork()) — jeder Worker hat seine EIGENE
_rebuilding-Map, die nur INNERHALB desselben Prozesses vor
Mehrfachläufen schützt. Fragen zwei Worker nahezu gleichzeitig für
DENSELBEN Nutzer an (z. B. Webapp und Android-App, oder mehrere
gleichzeitige Tabs), konnte jeder Worker unabhängig DELETE+INSERT
ausführen. Unter READ COMMITTED blockiert der DELETE des zweiten
Workers auf den Zeilen-Sperren des ersten; sobald der erste committet,
sieht der zweite dessen bereits committete Zeilen NICHT mehr als Teil
seines ursprünglichen Scans (die neuen Zeilen kamen NACH Beginn seines
DELETE hinzu) — er löscht sie nicht mit, versucht aber trotzdem, seine
eigenen (identischen) Zeilen einzufügen. Genau das verletzt den
Primärschlüssel: "duplicate key value violates unique constraint
parts_summary_pkey".

pg_try_advisory_xact_lock ist prozessübergreifend (liegt in der
Datenbank, nicht im Node-Prozess) und wird beim COMMIT/ROLLBACK der
Transaktion automatisch freigegeben. Namensraum 77, um nicht mit den
bestehenden Sperren in server.ts (99999999), jobs/partsCatalogEnrich.ts
(42) oder clients/brickset.ts (11223344) zu kollidieren.
```

<a id="ensurefresh"></a>
## `ensureFresh`

```text
Ist die Zusammenfassung für diesen Nutzer benutzbar?

WICHTIG: Diese Funktion baut NICHT mehr im Request auf. Vorher tat sie genau
das — und weil ein Trigger die Version bei jeder Änderung an `parts` hochsetzt
(CSV-Import, Set hinzufügen, Katalog-Anreicherung), zahlte der nächste Aufruf
des Teile-Reiters den vollen Neuaufbau. Gemessen an 380 Sets waren das rund
drei Sekunden, in denen die Kachelwand leer blieb. Dass manuell erfasste Teile
sofort erschienen, passte dazu: die laufen über eine eigene Abfrage ohne
Zusammenfassung.

Jetzt gilt:
  • aktuell            → true, sofort
  • veraltet, aber da  → true, sofort MIT den alten Zahlen; der Neuaufbau
                         läuft im Hintergrund und greift ab der nächsten
                         Anfrage. Die Abweichung betrifft höchstens einen
                         Seitenaufruf direkt nach einer Änderung.
  • gar nicht vorhanden→ false; der Aufrufer nimmt die Live-Abfrage (langsamer,
                         aber korrekt), der Aufbau läuft im Hintergrund an.
```

<a id="ensurefresh-ids"></a>
## `ids`

```text
── Haushalt: je Konto prüfen, alle müssen mitspielen ─────────────────────

Die Tabelle ist je Konto aufgebaut (Schlüssel user_id, part_key, color_id);
gelesen wird sie für den Haushalt mit user_id = ANY(...) und über part_key
verdichtet. Frisch ist die Sicht nur, wenn sie es für JEDES beteiligte
Konto ist — „zwei von drei sind aktuell" ergäbe eine Summe aus zwei
frischen und einem alten Bestand, und der Zahl sieht man das nicht an.

Fehlende Konten werden im Hintergrund aufgebaut; bis dahin nimmt der
Aufrufer den Live-Pfad.
```

<a id="ensurefresh-2"></a>
## Abschnitt

```text
strict: Nur ein AKTUELLER Stand zählt.

Für Listen sind veraltete Zahlen unkritisch — sie stimmen einen
Seitenaufruf später. Für Kennzahlen ist das anders: Webapp und
Android-App fragen dieselbe Statistik über zwei Endpunkte ab, und
während eines Neuaufbaus las der eine aus der Zusammenfassung und der
andere live. Die Paritätsprüfung hat genau das aufgedeckt. Mit strict
weichen beide gemeinsam auf die Live-Abfrage aus, bis der Neuaufbau
durch ist — kurz langsamer, dafür überall dieselbe Zahl.
```
