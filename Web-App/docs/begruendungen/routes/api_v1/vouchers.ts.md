# Begründungen zu `routes/api_v1/vouchers.ts`

Die ausführlichen Kommentare aus `routes/api_v1/vouchers.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
/api/v1/vouchers — LEGO-Geschenkkarten im eigenen Profil.

── Marcos Vorgabe zur Architektur ──────────────────────────────────────────

  „Bitte die Login jeweils nur 1x im Backend bauen. Beide Apps sollen die
   gleichen Services des Backends verwenden."

Deshalb gibt es diese Datei EINMAL und keine Schwester unter routes/. Das
geht auf, weil requireToken aus ./middleware beides annimmt: das
Sitzungs-Cookie der Webapp UND den Bearer-Token der Android-App. Die Webapp
ruft /api/v1 ohnehin schon an gut fuenfzig Stellen an; dies ist keine
Ausnahme, sondern der Normalfall des Baums.

── Warum Gutscheine strenger behandelt werden als alles andere ─────────────

Ueberall sonst im Baum gilt das Haushalts-Blickfeld: Der Grossvater sieht
die Sets der Enkel, scopeIds() uebersetzt das. HIER NICHT.

Nummer und PIN sind alles, was zum Einloesen noetig ist. Wer sie sieht, kann
den Gutschein ausgeben — unabhaengig davon, wem er gehoert. Das ist etwas
anderes als zu sehen, WELCHE Sets jemand besitzt. Deshalb:

  • kein scopeIds — nur der Eigentuemer, auch nicht der Haushalt,
  • kein Admin-Durchgriff,
  • die PDF-Datei liegt unter data/vouchers/ und NICHT unter data/uploads/,
    weil der dortige Ausliefer-Weg (serveDataFile in server.ts) genau die
    beiden Ausnahmen kennt, die hier nicht gelten sollen.

Jede Abfrage traegt deshalb `user_id = $…` im WHERE, und zwar auch dort, wo
schon ueber die id gefiltert wird. Das ist keine doppelte Arbeit, sondern
der Unterschied zwischen „nicht gefunden" und „fremder Gutschein geliefert".
```

<a id="fueraussen"></a>
## `fuerAussen`

```text
Eine Zeile fuer die Oberflaechen aufbereiten.

`amount` kommt als Zeichenkette aus dem Treiber (NUMERIC wird nicht
automatisch zu einer Zahl, weil nicht jedes NUMERIC in einen double passt).
Beide Apps rechnen damit, also wird hier EINMAL umgewandelt statt zweimal
in den Oberflaechen — und `hat_pdf` gesagt, statt den Dateipfad
herauszugeben: Der Pfad geht niemanden etwas an, die Frage „gibt es ein
PDF" schon.
```

<a id="pruefewerte"></a>
## Abschnitt

```text
Auch die Null faellt durch: Ein Gutschein ueber 0 ist keiner, und ein
leeres Feld wird von Number() zur Null — ohne diese Grenze haette ein
vergessenes Feld stillschweigend einen Gutschein ueber nichts angelegt.

EINE Ausnahme, und sie kommt nicht aus der Eingabe: Eine ABGEFRAGTE Null
ist eine Auskunft — die Karte ist aufgebraucht (siehe die Guthaben-Route
unten, die `amount = 0` schreibt). Wer danach die PIN korrigiert, schickt
keinen Betrag mit; dann wird der gespeicherte uebernommen, und ohne diese
Ausnahme waere eine leergekaufte Karte nicht mehr aenderbar. Ein von Hand
eingetippte 0 faellt weiterhin durch.
```

<a id="stapelanlegen"></a>
## `stapelAnlegen`

```text
Mehrere Gutscheine aus EINEM PDF anlegen — der Stapelfall von
POST /vouchers/pdf.

Marcos Vorgabe aus Stueck 3: „Das PDF soll auch wieder importiert werden
koennen (mehrere Seiten in einem PDF ergeben mehrere Gutschein-Eintraege)."
Das stand bis zum 15.10. in einer eigenen Route mit eigenem Knopf; seit
Marcos Durchsicht der Seite gibt es EIN Dateifeld, und der Server
entscheidet. Die Antwort hat die Form der CSV-Importe
(added/updated/errors/results), die beide Oberflaechen schon auswerten.

── Warum ON CONFLICT DO UPDATE und nicht DO NOTHING ──────────────────────

Der Betrag ist genau das, was sich aendert: Ein Gutschein, von dem etwas
abgebucht wurde, soll beim Wiedereinlesen den NEUEREN Stand tragen. Mit DO
NOTHING waere der Import auf einem Konto, das die Karten schon kennt,
wirkungslos — und genau dann braucht man ihn.

Die PIN zieht nur mit, wenn die Datei eine hat (COALESCE): Ein Sammel-PDF
ohne PIN darf eine gespeicherte nicht loeschen.

── Was hier NICHT geschieht ──────────────────────────────────────────────

Die Datei wird nicht gespeichert: Ein Sammel-PDF ist die Sicherung, nicht
die Karte. Jede Seite als eigene Datei abzulegen hiesse, dasselbe Dokument
zwanzigmal zu speichern.

Und die Felder des Formulars (number, pin, amount, currency) werden NICHT
angewandt. Sie beschreiben EINEN Gutschein; auf einen Stapel von zwanzig
passen sie nicht, und „der erste bekommt sie" waere geraten. Das PDF
entscheidet.
```

<a id="post-vouchers-pdf"></a>
## `post-/vouchers/pdf`

```text
── POST /api/v1/vouchers/pdf — aus dem PDF anlegen ─────────────────────────

EIN Weg fuer beide Apps und fuer beide Ausgaenge. Die Felder number, pin,
amount und currency duerfen MITGESCHICKT werden; was mitkommt, gewinnt
gegen das Ausgelesene. Damit deckt dieselbe Route vier Faelle ab:

  1. Alles ausgelesen           → Gutschein wird angelegt.
  2. Teilweise ausgelesen       → der Nutzer ergaenzt und schickt die Datei
                                  samt seiner Werte noch einmal.
  3. Nichts ausgelesen          → 422 mit dem, was gefunden wurde (also
                                  nichts), und die Oberflaeche zeigt das
                                  Formular mit leeren Feldern.
  4. MEHRERE Gutscheine im PDF  → alle werden angelegt bzw. aktualisiert,
                                  die Antwort traegt `mehrere`.

── Der vierte Fall kam dazu, weil Marco ihn verlangt hat ──────────────────

  „Die Funktionalitaet des blau umrandeten Buttons soll in den gruen
   umrandeten integriert werden. (Wenn ein PDF mit mehreren Seiten
   selektiert wird, sollen mehrere Gutscheine erfasst werden)"

Dafuer gab es bis hierher eine zweite Route (POST /vouchers/import/pdf) und
einen zweiten Knopf. An DIESER Stelle stand mein Kommentar, warum das
getrennt gehoert: Die Einzelroute habe einen festen Vertrag (422 mit
`gelesen`), und eine Route, die manchmal einen und manchmal zwanzig anlegt,
weiche ihn auf.

Der Einwand war nicht falsch, aber er hat das Falsche gewogen. Fuer den
Menschen davor sind es nicht zwei Vorgaenge, sondern einer: „ich habe ein
PDF, mach etwas damit". Zwei Dateifelder nebeneinander zwingen ihn, vorher
zu wissen, wie viele Gutscheine in seiner Datei stehen — das weiss der
SERVER, und zwar genauer. Der Vertrag bleibt ausserdem unberuehrt: Bei
EINEM Gutschein antwortet die Route Zeichen fuer Zeichen wie vorher, und
`mehrere` kommt nur dazu, wenn es wirklich mehrere sind.

Die Datei wird ERST GESPEICHERT, WENN DIE ZEILE STEHT. Andersherum bliebe
nach jedem misslungenen Versuch eine Datei liegen, die niemandem gehoert
und die niemand je wieder loescht.
```

<a id="post-vouchers-pdf-seiten"></a>
## `seiten`

```text
── Zuerst die Frage: Wie viele Gutscheine stehen in dieser Datei? ─────

Seitenweise gelesen, weil ein Sammel-PDF je Seite einen Gutschein
traegt. Erst ab ZWEI ist es ein Stapel; bei einem bleibt alles wie
bisher — samt dem 422-Vertrag, auf dem beide Formulare stehen.

Ein kaputtes PDF faellt hier NICHT durch: Das Auslesen darf scheitern,
dann ist es eben kein Stapel, und der Einzelweg unten sagt mit seinem
422, was er lesen konnte (naemlich nichts). Zwei Absagen fuer dieselbe
kaputte Datei waeren eine zu viel.
```

<a id="post-vouchers-pdf-istpdf"></a>
## `istPdf`

```text
Scheitert das Auslesen (kaputtes PDF, Scan, fremdes Format), ist das
kein Fehler der Anfrage — es bleibt bei dem, was der Nutzer mitschickt.
Ist das ueberhaupt ein PDF? Multer prueft den gemeldeten Medientyp, und
der ist eine BEHAUPTUNG des Klienten — eine Textdatei mit
`application/pdf` kommt hier an. Die ersten fuenf Zeichen sagen es
sicher.

GEMESSEN, nicht angenommen: `werteAusPdf` wirft bei einer solchen Datei
NICHT, es liest sie bloss leer. Mein erster Entwurf hing die Absage an
einen Fehler, der nie kommt, und der Lauf meldete
„kein_gutschein_im_pdf" statt „pdf_unlesbar" — richtig im Status,
falsch im Satz.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Die beiden Sammelwege stehen VOR den :id-Wegen ──────────────────────────

Express nimmt die ERSTE Route, die passt. Stand `/vouchers/export/pdf`
hinter `/vouchers/:id/pdf`, fing `:id` das Wort „export", Number('export')
ergab NaN, und die Antwort war 400 „id_ungueltig". GEMESSEN, nicht
ueberlegt: Genau so ist der erste Lauf von
test/gutscheine-export-import-db.test.js gescheitert.

Eine Ziffernpruefung in der :id-Route waere die andere Loesung. Die
Reihenfolge ist die bessere: Sie gilt fuer jeden weiteren Sammelweg, der
hier einmal dazukommt, ohne dass jemand daran denken muss.
```

<a id="get-vouchers-export-pdf"></a>
## `get-/vouchers/export/pdf`

```text
Marcos Vorgabe: „Wenn alle Gutscheine exportiert werden sollen, ein PDF
erstellen mit allen Gutscheinen."

Die Arbeit steckt in src/gutscheine/gutscheinPdfSchreiben.ts; diese Route tut, was
eine Route tun soll: eigene Zeilen holen, Dateien dazulegen, ausliefern.

── Warum die Befunde in einen Kopf und nicht in den Rumpf ─────────────────

Der Rumpf IST das PDF. Welche Gutscheine ersetzt wurden, welche unveraendert
durchgingen und warum, steht deshalb als Kopfzeile `X-Gutschein-Befunde`
dabei — die Oberflaeche liest sie und sagt es dem Nutzer. Ein zweiter Aufruf
nur fuer die Befunde hiesse, alles zweimal zu rechnen.

Nur eigene Gutscheine (`user_id = $1`), kein Blickfeld: Dieselbe Regel wie im
ganzen Gutschein-Teil — die Karten liegen unter data/vouchers/<user>/ und
sind AUSSCHLIESSLICH ueber die eigene Route erreichbar (die Begruendung steht
in Migration 0026).
```

<a id="post-vouchers-id-guthaben"></a>
## `post-/vouchers/:id/guthaben`

```text
── POST /api/v1/vouchers/:id/guthaben — das Guthaben bei LEGO abfragen ─────

── Marcos Vorgaben ─────────────────────────────────────────────────────────

  „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
   abgefragt und gespeichert werden kann?"

  „Wichtig das Ausgabeland soll in den Einstellungen bei den Gutscheinen
   fuer alle erfasst werden koennen (wie in der Prototyp-App). Der
   Zurueckgemeldete Betrag soll im Feld Betrag gespeichert werden."

── EINE Route, auch fuer „alle abfragen" ───────────────────────────────────

Es gibt keinen zweiten Endpunkt, der alle Karten durchgeht. Das ist keine
Sparsamkeit, sondern die Folge von Marcos Grenze: hoechstens ein Aufruf je
30 Sekunden ueber ALLE Benutzer. Eine Sammelroute muesste diese Wartezeit
INNERHALB einer HTTP-Anfrage absitzen — bei fuenf Karten gut zwei Minuten,
mit einer offenen Verbindung und einer Antwort, die niemand mehr abholt,
wenn der Browser vorher aufgibt.

Stattdessen taktet die Oberflaeche: Sie ruft diese Route je Karte auf, und
wenn sie 429 bekommt, wartet sie die gemeldeten `wartenSek` ab. Die Grenze
bleibt dabei dort, wo sie hingehoert — auf dem Server
(src/gutscheine/gutscheinGuthabenSchranke.ts). Ein Client, der sich nicht taktet,
bekommt 429 und sonst nichts.

── Was NICHT gespeichert wird ──────────────────────────────────────────────

Der formatierte Text der Gegenseite („CHF 250.00") geht in die Antwort,
aber in keine Spalte: Er ist in der Sprache und Schreibweise des
Ausgabelandes, und die Anzeige formatiert selbst (fmtN). Gespeichert werden
Betrag, Waehrung und der Zeitpunkt — nicht mehr.
```

<a id="post-vouchers-id-guthaben-grund"></a>
## `grund`

```text
Ein Fehler der Gegenseite ist KEIN Serverfehler: Der Mensch, der
gerade auf den Knopf gedrueckt hat, soll lesen, was los war —
handleRouteError machte daraus ein nichtssagendes 500.

verdecke() noch einmal, obwohl die fremden Texte es schon durchlaufen
haben: Hier kommen auch Fehler durch, die NICHT aus
gutscheinGuthaben.ts stammen (ein Netzfehler des Treibers etwa), und
die Zusicherung „die PIN steht in keinem Protokoll" soll an der
Stelle gelten, an der der Text die Anwendung verlaesst.
```
