# Begründungen zu `routes/api_v1/acquisitions.ts`

Die ausführlichen Kommentare aus `routes/api_v1/acquisitions.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
/api/v1 — Kaufpreis-Erfassungen (acquisitions) für Sets, manuelle Teile
und manuelle Minifiguren.

Vorher existierte die PUT/DELETE-Logik dreimal fast identisch in
api_v1.ts — ein Bugfix (z. B. an der Latest-wins-Regel) musste dreimal
gepatcht werden. Jetzt beschreibt eine Config pro Ressource die
Unterschiede (Tabellen, Schlüsselspalten, Marktpreis-Fallback), die
Ablauflogik existiert genau einmal.

Verbesserungen gegenüber der alten Implementierung:
- Parent-Mengen werden atomar per UPDATE … (SELECT SUM …) RETURNING
  berechnet statt Read-Modify-Write in JS (Race-frei, ein Roundtrip weniger).
- condition === null bedeutet "keine Änderung" statt Coercion auf 'N'
  (ältere Android-Clients serialisieren nicht gesetzte Felder als null —
  das setzte bei jeder Mengen-Änderung den Zustand auf "Neu" zurück).
```

<a id="acqconfig"></a>
## Abschnitt

```text
Aufräumen, wenn nach dem Löschen KEINE Erfassung mehr übrig ist.

── Marcos Frage ──────────────────────────────────────────────────────────
„Gibt es noch ein Problem, wenn ein Kaufpreis entfernt wird, dass der
Eintrag noch sichtbar war?"

Ja, und zwar an mehreren Stellen. Die Mengen-Neuberechnung setzte sie auf 0
und liess die Elternzeile stehen. Nachgemessen mit einem einzelnen Konto
und zwei Sets, eines davon mit gelöschtem Kaufpreis:

  Galerie      beide Sets, das leere mit „Menge 0"
  Statistik    Sets=2 (das leere zählte mit), Einheiten=1
  Bewertung    das leere Set mit ×1 bewertet — 20 CHF, die es nicht gibt

Der letzte Punkt ist der schlimmste: `set.quantity || 1` in
src/finanzen/financeCalc.ts macht aus einer Menge von 0 eine 1. Als Schutz gegen
NULL gedacht, trifft es hier den echten Wert 0 — und das Portfolio wuchs um
ein Set, das niemand mehr besitzt.

Eine Menge von 0 ist auch kein Zustand, den jemand absichtlich herstellen
kann: Beide Mengenregler halten bei 1 (`min="1"` in der Webapp,
`if (qty > 1)` in der App). Sie entstand ausschliesslich hier. Deshalb wird
die Elternzeile jetzt entfernt, statt sie leer stehen zu lassen.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Antwort um das neu berechnete Zustands-Aggregat des Sets ergänzen.

Ohne das mussten die Clients die Regel „eine U-Erfassung macht das Set
gebraucht" selbst nachbilden — die Webapp tat das falsch (sie nahm die
Bedingung der zuletzt erfassten Position), die Android-App gar nicht, weshalb
die Galerie-Kachel bis zum nächsten Listen-Reload das alte Label behielt.
Jetzt liefert der Server den Wert mit, und die Clients schreiben ihn nur noch
in ihre Liste.
```

<a id="mengedesbestands"></a>
## `mengeDesBestands`

```text
Die Stueckzahl der Bestandszeile aus den Erfassungen — und zwar ueber
db/bestandsmenge.ts, die einzige Stelle, die sie schreibt.

Hier stand `cfg.parentQuantitySql`: je Elementart eine eigene Anweisung,
dreimal dieselbe Rechnung. Daneben gab es SIEBEN weitere Schreibstellen,
die die Spalte fortschrieben — und sie sind auseinandergelaufen (der Befund
steht in db/bestandsmenge.ts).
```

<a id="withsetaggregate-ownerreq"></a>
## `ownerReq`

```text
── Eigentümer wechseln ───────────────────────────────────────────────

Verschoben wird über den KAUFPREIS — dieselbe Regel wie in den
Session-Routen (routes/sets.ts, routes/parts.ts, routes/minifigs.ts).
Der Zweig FEHLTE hier zunächst ganz: Die Android-App schickte
owner_user_id an genau diese PUT-Routen, die Fabrik las aber nur
Menge, Preis und Zustand — die Anfrage lief als leeres Update durch
und antwortete success:true, ohne dass irgendetwas wanderte.

Absender aus der ZEILE, nicht aus dem Request (acquisitionMoveSource):
ein mitgeschickter from_user_id wird ignoriert. Läuft vor allen
anderen Feldern und beendet die Anfrage — Preis oder Datum derselben
Zeile im selben Aufruf zu ändern hiesse, sie zweimal zu suchen.
```

<a id="withsetaggregate-newdate"></a>
## `_newDate`

```text
Kaufdatum ändern — pro Tag, Element und Konto genau EIN Eintrag
(Nachtrag 70).

Diese Fähigkeit hatten bisher NUR die Webapp-Routen. Beim
Zusammenlegen wäre sie fast verlorengegangen: Die Fabrik kannte das
Feld `date` gar nicht, und die App schickt es nicht — aufgefallen ist
es allein daran, dass ein bestehender Test den gemeinsamen Prüfer
verlangte. Genau dafür sind solche Tests da.

Geprüft wird mit demselben Helfer wie beim Anlegen
(src/bestand/acquisitions.ts), damit Anlegen und Bearbeiten nicht
auseinanderlaufen können.
```

<a id="withsetaggregate"></a>
## Abschnitt

```text
Preis und Zustand der Elternzeile NEU bestimmen (Nachtrag 75,
Marcos Fund: „Kaufpreis entfernt, die Kachel zeigt ihn weiter").

Der Lösch-Weg aktualisierte bisher NUR die Menge. Wer die neueste
Erfassung löschte, liess damit deren Preis in der Elternzeile stehen
— sichtbar in der Kachel oben, in der Galerie und in der
Finanzübersicht, die alle aus sets.purchase_price lesen. Auf Marcos
Screenshot: Erfassung 7.41, Kachel weiterhin 9.48 (der Preis der
gelöschten Zeile).

Dieselbe Regel wie beim Ändern: Es gilt der Wert der jetzt NEUESTEN
verbliebenen Erfassung. Bleibt keine übrig, wird nichts überschrieben
— dann ist ohnehin der ganze Bestand weg.
```

<a id="get-sets-setnumber-acquisitions"></a>
## Abschnitt

```text
Keine Spiegelung mehr — und zwar nicht aus Versehen.

Hier standen SETS_PREIS_SQL und SETS_ZUSTAND_SQL, und davor stand an
derselben Stelle zweimal `null`. Beide Zustände waren falsch, und zwar
dasselbe Problem von zwei Seiten:

  Nachtrag 51 (Marco): „Der Preis oben in der Kachel wird nicht
    angepasst" — der Android-Weg spiegelte nicht, die Webapp schon.
    Erfassung 107, Kachel weiter 108.
  Nachtrag 75 (Marco): „Kaufpreis entfernt, die Kachel zeigt ihn weiter"
    — Erfassung 7.41, Kachel 9.48.

Beide Male war die Ursache, dass Kaufpreis und Zustand an ZWEI Orten
standen. Mit Migration 0032 gibt es nur noch einen: set_acquisitions.
Damit kann die Kachel gar nicht mehr abweichen, und die Spiegelung hat
kein Ziel mehr. Teile und Minifiguren sind mit Migration 0035
nachgezogen — jetzt gilt es fuer alle drei Elementarten.
```

<a id="get-parts-partnumber-colorid-acquisitions"></a>
## Abschnitt

```text
── cond MITGEBEN (Nachtrag 146) ──────────────────────────────────────────

Der Aufrufer reicht den Zustand DIESER Zeile durch (siehe oben, Nachtrag
68). Die Sets-Fassung nimmt ihn seit jeher; Teile und Minifiguren liessen
ihn fallen und leiteten stattdessen einen Zustand aus ALLEN Erfassungen
des Eintrags ab.

Marcos Befund: „Wenn ich bei der Minifigur einen zweiten Preis mit anderem
Zustand erfasse, wird der Marktpreis dieses Zustands nicht angezeigt. Der
Preis ist ebenfalls identisch, wenn ich das Feld leer lasse."

Genau das: Eine Gebraucht-Zeile bekam den Preis, der aus dem
Sammelzustand des Eintrags fiel — und ein Marktpreis für „Gebraucht"
wurde nie ermittelt, also blieb die Zeile im Detailfenster leer.
```

<a id="get-minifigs-fignumber-acquisitions"></a>
## Abschnitt

```text
cond mitgeben — siehe die Begründung bei den Teilen (Nachtrag 146).
Die BL-Nummer-Abfrage steht in src/katalog/blZuordnung.ts — sie wird auch vom
Kaufpreis-Nachtrag gebraucht (jobs/purchasePriceBackfill.ts).

Sie steht in einer eigenen Zeile und nicht im Aufruf: So ist sichtbar,
dass `cond` als letztes Argument ankommt. Genau das prueft
test/acquisition-condition-price-db.test.js, und zwar mit einem Abstand
von hoechstens 400 Zeichen — der Erklaertext gehoert deshalb hierher,
vor die Eigenschaft, nicht in ihren Rumpf.
```
