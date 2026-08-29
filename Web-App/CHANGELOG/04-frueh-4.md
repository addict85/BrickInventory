# Vor der Nummerierung, Teil 4

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Fix: Farbfilter im Teile-Reiter fand nichts

Jeder Klick auf eine Farbe endete in „Keine Teile gefunden". Die Ursache liegt
in der vorberechneten Zusammenfassung, die ich früher in dieser Sitzung
eingeführt habe:

```js
if (o.color) { cond.push(`color_id = $…`); params.push(parseInt(o.color)); }
```

Der Filter schickt den **Farbnamen** (`Black`), nicht die ID —
`parseInt('Black')` ergibt `NaN`, und die Bedingung traf auf nichts zu. Der
Live-Pfad darunter vergleicht seit jeher über `color_name`; nur der schnelle
Weg über die Zusammenfassung tat etwas anderes. Solange die Zusammenfassung noch
nicht aufgebaut war, funktionierte der Filter — deshalb fiel es erst jetzt auf.

**Behoben:** Beide Pfade filtern über `color_name`. Gegen die Datenbank geprüft:

```
ohne Filter → 2 Teile
Black       → 1
Red         → 1
Blue        → 0
```

Kurz hatte ich zusätzlich eine numerische ID als Alternative erlaubt — wieder
entfernt: Der Live-Pfad kann das nicht, und zwei Pfade mit unterschiedlichem
Verhalten waren ja gerade das Problem.
## Leer-Anzeige: Ziegel statt Puzzleteil

Das Puzzleteil-Emoji (🧩) hat mit LEGO nichts zu tun und passte nicht zur
Navigation. Die Leer-Anzeige zeigt jetzt dasselbe Ziegel-Symbol wie der Reiter
„Teile" — dieselbe SVG-Zeichnung aus `index.html`, nur grösser.

Ein Test hält beides fest: den Namensvergleich in der Zusammenfassung und das
Symbol in der Leer-Anzeige.

Stand: `tsc --noEmit` sauber, 42 Tests grün.

---
## Fix: `PARTS_ICON_SVG has already been declared` — Teile-Reiter tot

Mein Fehler von der letzten Runde, und ein folgenschwerer: Ich habe eine
Konstante `PARTS_ICON_SVG` in `03-parts.js` angelegt — **es gab sie bereits in
`02-gallery.js`**.

Alle `js/*.js` laufen im Browser in **einem** Gültigkeitsbereich. Eine zweite
`const`-Deklaration bricht die betroffene Datei sofort ab, und dann ist **keine**
ihrer Funktionen definiert. Daher die Folgefehler:

```
Uncaught SyntaxError: Identifier 'PARTS_ICON_SVG' has already been declared
Uncaught ReferenceError: loadParts is not defined
```

Der zweite führt von der Ursache weg — er ist nur die Folge des ersten.

**Behoben:** `03-parts.js` benutzt die vorhandene Konstante und skaliert sie für
die Leer-Anzeige (`partsIconLarge()`), statt eine zweite anzulegen. Die in
`02-gallery.js` ist auf `1em` ausgelegt, weil sie dort im Fliesstext steht.

### Damit das nicht wiederkommt

`test/dom-ids.test.js` liest die Skriptliste aus `index.html` in Ladereihenfolge
und meldet jede `const`/`let`/`class`-Deklaration, die in zwei Dateien vorkommt.
Aktuell: 13 Skripte, 50 Namen auf oberster Ebene, keine Kollision.

Diese Prüfung hätte den Fehler beim Schreiben gefangen. Sie kostet nichts und
deckt eine Fehlerklasse ab, die im Betrieb einen ganzen Reiter lahmlegt — genau
das, was du gesehen hast.

Stand: `tsc --noEmit` sauber, 76 Tests grün.

---
## Fix: Teile-Reiter lud gar nicht mehr — doppelte Deklaration

```
Uncaught SyntaxError: Identifier 'PARTS_ICON_SVG' has already been declared
Uncaught ReferenceError: loadParts is not defined
```

Mein Fehler aus der letzten Runde: `PARTS_ICON_SVG` war **längst in
02-gallery.js definiert** — und wird von `04-finance.js` und `06-minifigs.js`
mitbenutzt. Ich habe nicht danach gesucht und blind eine zweite Konstante in
`03-parts.js` angelegt.

Der Browser lädt alle Dateien in denselben globalen Bereich. Ein zweites
`const` bricht die betroffene Datei sofort ab — und dann ist **keine** ihrer
Funktionen definiert. Deshalb der Folgefehler `loadParts is not defined` und ein
komplett toter Teile-Reiter.

**Behoben:** Statt einer zweiten Konstante eine Funktion, die das vorhandene
SVG vergrössert:

```js
function partsIconLarge() {
  return PARTS_ICON_SVG.replace('width:1em;height:1em', 'width:56px;height:56px');
}
```

### Warum `node --check` das nicht gefunden hat

Ich prüfe nach jeder Änderung mit `node --check <datei>`. Jede Datei **für sich**
ist gültig — die Kollision entsteht erst beim gemeinsamen Laden. Genau diese
Lücke hat die Regression durchgelassen.

**Neuer Test** in `test/dom-ids.test.js`: Alle Skripte aus `index.html` werden in
Ladereihenfolge zu einem Programm verkettet und geparst. Gegenprobe gemacht —
mit künstlich eingebauter Doppel-Deklaration schlägt er mit exakt der gemeldeten
Meldung fehl, ohne sie ist er grün.

Damit ist eine ganze Fehlerklasse abgedeckt, nicht nur dieser eine Fall: doppelte
`const`/`let`/`class`-Deklarationen über Dateigrenzen hinweg.

Stand: `tsc --noEmit` sauber, 77 Tests grün.

---
## Fix: Kategorien zeigten nur „Unknown"

`parts.category_name` enthält die Rebrickable-Kategorie-**ID** als Text — oder
die Zeichenkette `'Unknown'`:

```js
const catName = p.part_cat_id ? String(p.part_cat_id) : 'Unknown';
```

Das eingebettete `part`-Objekt in `/sets/{id}/parts/` führt `part_cat_id`
**meist nicht** mit. Damit landete bei fast jedem Teil `'Unknown'` in der
Datenbank, der Join auf `rb_part_categories` griff nie, und die Filterliste
bestand aus einem einzigen Eintrag.

**Behoben ohne Datenänderung:** `rb_parts` stammt aus dem CSV-Sync und kennt
`part_cat_id` zu jeder Teilenummer. Die Kategorieliste löst jetzt darüber auf —
aus `'Unknown'` werden die echten Kategorien:

```
Kategorien:
  11 → Bricks (1)
  27 → Minifig Accessories (1)
Filter Kategorie 11 → 1 Teil
```

**Der Filter musste mit**, sonst wäre die Liste richtig und das Klicken
wirkungslos: Der Live-Pfad prüft zusätzlich über `EXISTS (SELECT 1 FROM
rb_parts …)`.

**Und die Zusammenfassung gibt den Fall ab.** Sie führt `category_name` so, wie
es gespeichert ist — eine eigene Auflösung dort hätte je nach Pfad andere
Ergebnisse geliefert. Genau dieser Fehler war beim Farbfilter eine Runde zuvor
die Ursache; deshalb weicht sie bei gesetztem Kategorie-Filter auf den Live-Pfad
aus, statt eine zweite Wahrheit zu erzeugen.

Ein Test hält alle drei Teile fest.

**Voraussetzung:** Der Rebrickable-CSV-Sync muss gelaufen sein, sonst ist
`rb_parts` leer und es bleibt bei „Unbekannt". Der Sync läuft täglich um 03:00
und ist im Monitoring sichtbar.

Stand: `tsc --noEmit` sauber, 58 Tests grün, Zusammenfassung 6/6.

---
## Nachtrag: Farbüberschriften waren noch englisch

Beim ersten Anlauf hatte ich die Gruppenüberschrift über den Kacheln nicht
erwischt — mein Suchmuster (`${esc(color)}`) passte nicht auf den tatsächlichen
Code (`${esc(g.color)}`), und statt nachzusehen habe ich die Meldung „Muster
nicht gefunden" einfach stehen lassen. Ergebnis: Filterliste auf Deutsch,
Überschrift daneben auf Englisch.

**Jetzt übersetzt:**

- Gruppenüberschrift im Teile-Reiter (`g.color`)
- Farbanzeige in den Finanzen (`04-finance.js`)
- Farbanzeige bei den Minifiguren (`06-minifigs.js`)

Die letzten beiden hatte ich beim ersten Mal gar nicht betrachtet.

**Damit das nicht wieder passiert**, prüft der Test jetzt nicht mehr einzelne
Fundstellen, sondern die Abwesenheit roher Anzeigen: In allen drei Dateien darf
kein `esc(x.color_name)` ohne `colorName()` davor stehen. Gegenprobe gemacht —
mit künstlich eingefügter roher Anzeige schlägt er an, im aktuellen Stand nicht.

Das ist die bessere Form: Eine Liste bekannter Stellen ist beim nächsten neuen
Anzeigeort wieder unvollständig; ein Verbot deckt auch die ab, die es noch nicht
gibt.

Stand: `tsc --noEmit` sauber, 75 Tests grün.

**Zum Kategorie-Filter im Screenshot** („Unknown 688"): Das ist der Stand vor
dem Fix aus der vorigen Runde. Nach dem Deploy braucht es zusätzlich einen
gelaufenen Rebrickable-CSV-Sync, damit `rb_parts` gefüllt ist — sonst bleibt es
bei einem Eintrag.

---
## Fix: Kaufpreis fehlte bei CSV-importierten Sets

Deine Erwartung ist richtig: Ohne manuell erfassten Preis muss der Kaufpreis
beim Anlegen dem damaligen Marktpreis entsprechen. Eine spätere Abweichung ist
die Wertentwicklung — beim Import darf sie nicht entstehen.

**Ursache.** Der CSV-Import fragt zuerst den Preis-Cache ab. Ist das Set dort
noch nicht drin — bei neu importierten Sets die Regel — folgt ein
BrickLink-Abruf, und der scheitert bei vielen Sets am Tageskontingent. Die
Erfassung entstand dann **ohne** Kaufpreis. Später füllte der Preis-Job den
Cache, ab da zeigte die Ansicht einen Marktpreis — der Kaufpreis blieb leer.

### Zwei Änderungen

**1. Beim Import: Historie als letzter Rückfall.** Reihenfolge jetzt
Preis-Cache im passenden Zustand → BrickLink → `price_history`. Der zuletzt
bekannte Preis ist eine bessere Grundlage als gar keiner.

**2. Nachtrag für alles, was trotzdem leer bleibt.** `purchasePriceBackfill.ts`
gab es bereits, hatte aber eine Lücke: `backfillSets()` betrachtet nur Sets mit
`purchase_price IS NULL` und zieht deren Erfassungen mit. Bekam die **Set-Zeile**
beim Import einen Preis, die **Erfassung** aber nicht, blieb sie dauerhaft leer
— genau dein Fall.

Neu findet `backfillAcquisitions()` alle preislosen Erfassungen unabhängig von
der Set-Zeile. Zwei Punkte dabei:

- Der Zustand der **Erfassung** bestimmt den Preis, nicht der des Sets. Ein
  gebraucht erfasstes Exemplar bekommt den Gebrauchtpreis, auch wenn das Set als
  neu geführt wird. Geprüft: bei Neu 80 / Gebraucht 44 im Cache liefert eine
  Gebraucht-Erfassung **44**.
- `sets.purchase_price` wird nur gesetzt, wo noch nichts steht — ein gepflegter
  Wert wird nicht überschrieben.

Der Job läuft 45 Sekunden nach dem Serverstart und pausiert 1,5 Sekunden je
Abruf, um das BrickLink-Kontingent zu schonen. Bei vielen betroffenen Sets
dauert das entsprechend; er nimmt beim nächsten Start das Verbleibende.

**Was er nicht anfasst:** Erfassungen mit einem Preis — auch nicht mit `0`.
Sollte bei dir irgendwo eine `0` statt `NULL` stehen, bleibt sie; dann bräuchte
es eine eigene Entscheidung, ob `0` „kostenlos" oder „unbekannt" heisst.

Stand: `tsc --noEmit` sauber, 77 Tests grün, Paritätssuite 32/32.

---
## Antwort: Währung in price_cache

Ja, sie ist vorhanden — `currency_code` ist Teil des Schlüssels, und alle
Preisabfragen filtern darauf:

```sql
SELECT avg_price FROM price_cache
 WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 …
```

Dasselbe in `part_price_cache` und `minifig_price_cache`. Preise verschiedener
Währungen liegen also nebeneinander und werden nicht verwechselt.
## Fix: CSV-Import las das Datum amerikanisch

Bestätigt und nachgestellt:

```
new Date('05.03.2026')  →  2026-05-03     (3. Mai statt 5. März)
```

JavaScript liest punktgetrennte Daten als MM.DD.YYYY; Postgres tut unter
DateStyle MDY dasselbe. Beide Importe — Sets und Teile — übernahmen den Wert
roh mit einem blossen `.trim()`.

Zwei Folgen: Bei Tagen bis 12 wurden Tag und Monat **stillschweigend
vertauscht**, bei Tagen darüber scheiterte der Import.

**Neu:** `parseCsvDate()` in `utils/csvExport.ts`, von beiden Importen benutzt.

| Eingabe | Ergebnis |
|---|---|
| `05.03.2026` | `2026-03-05` (5. März) |
| `05/03/2026` | `2026-03-05` |
| `31.12.2025` | `2025-12-31` |
| `05.03.26` | `2026-03-05` |
| `2026-03-05` | unverändert (eigenes Exportformat) |
| `31.02.2026` | `null` |
| `29.02.2025` | `null` (kein Schaltjahr) |
| `29.02.2024` | `2024-02-29` |

Zwei Entscheidungen dabei:

**Punkt und Schrägstrich gelten immer als Tag zuerst.** Eine Umdeutung nach
Plausibilität („13 kann kein Monat sein, also drehen") wäre gefährlich: Sie
träfe bei `05.03.` die falsche Wahl und wäre nicht vorhersehbar. ISO bleibt ISO,
weil der eigene Export so aussieht.

**Unmögliche Daten werden abgelehnt statt verschoben.** Eine Prüfung auf 1–31
allein liesse den 31. Februar durch, und `Date` rollt ihn still in den März — aus
einem Tippfehler würde ein falsches, aber plausibel aussehendes Datum. Die
Gegenprobe über ein echtes `Date` fängt das ab.

**Bereits importierte Daten sind nicht rückwirkend korrigiert.** Das liesse sich
auch nicht sicher tun: Ob `2026-05-03` ursprünglich der 3. Mai oder ein
verdrehter 5. März war, steht nirgends. Bei betroffenen Sets hilft nur ein
erneuter Import oder Nachtragen von Hand.

Stand: `tsc --noEmit` sauber, 38 Tests grün, Paritätssuite 32/32.

---
## Fix: „API-Endpunkt nicht gefunden" beim Setzen eines fremden Passworts

Der Dialog in den Einstellungen ruft seit jeher

```
PUT /api/auth/users/:id/password
```

auf — **die Route gab es nicht.** In `routes/auth.ts` standen nur
`/change-password`, `/forgot-password` und `/reset-password`, dazu
`PUT /users/:id/admin` und `DELETE /users/:id`. Der Fehler war also kein
Zufall, sondern eine schlicht nie gebaute Gegenstelle.

**Neu angelegt**, mit vier bewussten Entscheidungen:

**Nur Administratoren** (`requireAdmin`) — wie bei den benachbarten
Nutzerrouten.

**Das eigene Konto ist ausgenommen.** Hier wird kein aktuelles Passwort
verlangt, denn ein Administrator kennt es nicht. Für sich selbst führt der Weg
über `/change-password`, wo das alte geprüft wird. Ohne diese Ausnahme genügte
eine übernommene Sitzung, um das eigene Passwort ohne Kenntnis des alten zu
ändern und den rechtmässigen Besitzer auszusperren.

**Offene Zugänge werden geschlossen** — Sitzungen und API-Token des betroffenen
Kontos. Ein zurückgesetztes Passwort, bei dem alte Zugänge weiterlaufen, wäre
nur halb zurückgesetzt.

**Die Session-Tabelle wird vorher geprüft.** Sie legt der Session-Store zur
Laufzeit an und steht nicht im Schema — ein blindes `DELETE` bräche den Vorgang
ab, obwohl das Passwort längst gesetzt ist.

Gegen die Datenbank geprüft: Das neue Passwort gilt, das alte nicht mehr, ein
unbekannter Nutzer ergibt 404 statt stillem Erfolg.

**Nebenbei:** `test/api-inventory.test.js` hat die neue Route sofort als
unklassifiziert gemeldet — genau wofür er da ist. Eingeordnet als `nur-web`:
Die Android-App hat keine Nutzerverwaltung.

Stand: `tsc --noEmit` sauber, 46 Tests grün, Paritätssuite 32/32.

---
## Fix: Farbdropdown im Formular „Teil erfassen"

`renderColorDropdown()` in `06-minifigs.js` zeigte den rohen Rebrickable-Namen
sowohl im sichtbaren Text als auch im `data-name`-Attribut. Nur der sichtbare
Text ist jetzt übersetzt — `data-name` bleibt englisch, weil er beim Speichern
als `parts.color_name` übernommen wird und für BrickLink-Abgleiche gebraucht
wird. Dieselbe Funktion wie bei Filter und Anzeige im Teile-Reiter.

Ein Test prüft beides: übersetzter Text, unveränderter `data-name`.

Stand: `tsc --noEmit` sauber, 37 Tests grün.
## Zum Kaufpreis-/Marktpreis-Unterschied (Tower Bridge, CHF 216.24 vs 135.11)

Hier möchte ich ehrlich sein, statt eine weitere ungeprüfte Theorie zu liefern
— das habe ich in dieser Sitzung beim Bild-Proxy zu oft getan.

**Was ich geprüft habe:** Der komplette Preispfad für einen neu importierten
Satz sieht korrekt aus — Zustand wird vor der Preisermittlung bestimmt,
`getCurrentMarketPrice()` bekommt ihn als Parameter, die Abfrage bevorzugt den
angefragten Zustand. Kein struktureller Fehler, den ich am Code finden konnte.

**Was ich nicht ausschliessen kann, ohne deine Daten zu sehen:**

1. **`buildSetsCsv()` exportiert den historischen Kaufpreis unverändert** —
   absichtlich, damit eine Migration ihn 1:1 wiederherstellt. Stammt deine CSV
   aus einem Export der alten Instanz, ist 216.24 kein neu berechneter
   Marktpreis, sondern der damals gespeicherte Wert. Die Abweichung zu 135.11
   wäre dann echte Wertentwicklung seit der ursprünglichen Erfassung — keine
   Fehlfunktion.
2. **Deine CSV könnte den Kaufpreis explizit enthalten haben** — dann ist
   216.24 dein eingetragener Preis, nicht der Marktpreis, und eine Abweichung
   ist von Anfang an erwartet.
3. **Echte Marktpreis-Schwankung.** Bei einem grossen, möglicherweise
   auslaufenden Set können BrickLink-Gebraucht-Durchschnittspreise innerhalb
   von Tagen spürbar wandern.

**Um das zu entscheiden, statt weiter zu raten:**

```
GET /api/v1/admin/price-probe?set=10214-1&live=1
```

Das zeigt: die Erfassung mit ihrem gespeicherten Preis und Zustand, alle
`price_cache`-Zeilen mit Alter, und mit `live=1` zusätzlich, was BrickLink
gerade für beide Zustände liefert. Zusätzlich wäre hilfreich: der Inhalt der
`purchase_price`-Spalte in der CSV-Zeile für 10214-1 — war sie leer oder stand
dort ein Wert?

Damit lässt sich in einem Schritt entscheiden, ob hier überhaupt etwas zu
reparieren ist, und falls ja, was genau.

---
## Gefunden: die eigentliche Ursache des Preisunterschieds

Deine CSV-Zeile hat es entschieden: `10214-1,1,,U,01.08.2026` — Kaufpreis leer,
Zustand `U`. Kein manueller Preis, keine Migration mit historischem Wert. Genau
der Fall, den du erwartet hattest: Marktpreis und Kaufpreis hätten
übereinstimmen müssen.

### Der Mechanismus

Beim Anlegen eines **neuen** Sets existiert weder die `sets`-Zeile noch die
`set_acquisitions`-Zeile — beide werden erst geschrieben, nachdem der Kaufpreis
ermittelt wurde:

```
getCurrentMarketPrice(setNumber, userId, 'U')
  → refreshPriceForSet(setNumber, userId)
      → conditionsNeededFor(setNumber, userId)     // liest set_acquisitions + sets
          → BEIDE noch leer → fällt auf 'N' zurück
      → holt und cacht NUR den Neupreis
  → Preisabfrage bevorzugt 'U', findet aber nur den gerade gecachten
    Neupreis → weicht darauf aus
→ 216.24 (Neupreis) landet als Kaufpreis, obwohl „Gebraucht" gewählt war
```

Wenig später — beim Anzeigen des Marktpreises, wenn die Erfassung längst
existiert — sieht `conditionsNeededFor()` die `U`-Erfassung, holt jetzt korrekt
den Gebrauchtpreis (135.11), und die Anzeige stimmt. Der bereits gespeicherte
Kaufpreis bleibt aber auf dem einmal falsch geholten Neupreis stehen. Genau das
Bild aus deinem Screenshot.

### Behoben

`conditionsNeededFor()` und `refreshPriceForSet()` nehmen jetzt einen
**Hinweis-Parameter**. Beim Anlegen wird der gewählte Zustand mitgegeben, auch
wenn die Zeile noch nicht existiert:

```
ohne Hinweis (altes Verhalten)   → ['N']   — bekommt den Neupreis
mit Hinweis "U" (neues Verhalten) → ['U']  — bekommt den Gebrauchtpreis
```

`getCurrentMarketPrice()` reicht den angefragten Zustand jetzt als Hinweis
durch. Die zweite Aufrufstelle (Hintergrund-Anreicherung) brauchte keine
Änderung — sie läuft erst, nachdem die Erfassung bereits existiert.

### Nebenbei behoben: der 500er der Preis-Probe

`SELECT … added_at FROM set_acquisitions` — die Spalte heisst `created_at`.
Jede Probe endete deshalb in „Interner Serverfehler". Zusätzlich war die
Erklärung zur Zustandswahl in der Probe seit der `effectiveCondition`-Umstellung
veraltet und hätte fälschlich auf `sets.condition` verwiesen; sie zeigt jetzt
dieselbe Regel wie die tatsächliche Bewertung.

**Test.** Der Hinweis-Mechanismus ist nachgestellt: ohne Hinweis `['N']`, mit
Hinweis `['U']`. Die Probe ist gegen die korrekte Spalte und die aktuelle Regel
geprüft.

### Was du jetzt tun kannst

Für **neu** importierte Sets greift der Fix sofort. Für Tower Bridge und
ähnlich betroffene bereits importierte Sets: Kaufpreis im Detail-Dialog leeren
und speichern — das holt ihn über denselben, jetzt korrekten Weg neu.

Stand: `tsc --noEmit` sauber, 61 Tests grün, Paritätssuite 32/32.

---
## 10283-1: Daten sind konsistent — aber ein echter Bug daneben gefunden

**Zu deinem Probe-Ergebnis:** Kaufpreis 162.4163, Cache für `N` 162.4163, live
`N` 162.4163 — alle drei stimmen exakt überein. Zum Zeitpunkt der Probe zeigte
die Datenbank für dieses Set **keine Abweichung**. Vermutlich hat sich das
zwischen deinem Blick auf die Anzeige und dem Ausführen der Probe durch einen
zwischenzeitlichen Preis-Abgleich von selbst angeglichen.

**Beim genauen Nachsehen des Pfads, der die „Marktpreis"-Anzeige speist, ist mir
aber ein echter, unabhängiger Fehler aufgefallen** — er passt genau zum
gemeldeten Symptom und tritt bei anderen Sets auf:

`computePnl()` in `utils/financeCalc.ts` — speist `/finance/pnl` und damit den
Marktpreis in Galerie-Kachel **und** Detail-Dialog — selektierte in seiner
SQL-Abfrage **kein** `acq_count`/`used_count`:

```sql
SELECT s.set_number, …, s.condition, COALESCE(a.total_price / …, s.purchase_price)
FROM sets s LEFT JOIN (…) a ON …
```

`effectiveCondition(set)` braucht aber genau diese beiden Felder:

```js
const acqCount = parseInt(set?.acq_count) || 0;   // fehlte im SELECT → immer NaN → 0
const usedCount = parseInt(set?.used_count) || 0; // fehlte im SELECT → immer NaN → 0
if (usedCount > 0) return 'U';
if (acqCount > 0)  return 'N';
return set?.condition === 'U' ? 'U' : 'N';         // ← dieser Zweig lief IMMER
```

Ohne die Felder war `acqCount` immer `0`, `usedCount` immer `0` — die Funktion
fiel **ausnahmslos** auf `sets.condition` zurück, egal was die Erfassungen
tatsächlich sagten. `computeSetsValuation()` (der Finanzen-Reiter) hatte genau
diesen Fehler schon behoben; `computePnl()` (Galerie und Detail-Dialog) nicht.
**Zwei Wahrheiten für denselben Zustand — je nachdem, welcher der beiden Pfade
gerade angezeigt wird.**

Betroffen sind Sets, bei denen `sets.condition` veraltet ist oder gemischte
Erfassungen vorliegen (etwa 1× Neu, 1× Gebraucht). Für ein frisch importiertes
Set mit nur einer Erfassung — wie 10283-1 — stimmt der Fallback zufällig meist
mit dem tatsächlichen Zustand überein, deshalb kein durchgehender Fehler.

**Nachgestellt:** Set mit `sets.condition='N'` (veraltet), tatsächlich 1× Neu +
1× Gebraucht erfasst:

```
sets.condition (veraltet)  : N
computePnl condition       : U    (vorher hätte es N geliefert)
computePnl current_price   : 95   (vorher 160 — der Neupreis)
```

**Behoben:** Dieselbe Unterabfrage liefert jetzt `acq_count` und `used_count`
mit, genau wie bei `computeSetsValuation()`.

Stand: `tsc --noEmit` sauber, 57 Tests grün, Paritätssuite 32/32.

**Für 10283-1 selbst:** Da die Daten laut Probe bereits übereinstimmen, dürfte
sich nichts sichtbar ändern. Falls dir nach diesem Deploy irgendwo — auch bei
anderen Sets — weiterhin ein abweichender Marktpreis auffällt, wäre die Probe
für genau **dieses** Set der nächste Schritt.

---
## Gefunden: warum der Graph einen Abfall zeigt, den es nie gab

Dein Screenshot zeigt es genau: Kaufpreis 162.42, Marktpreis 162.42,
Entwicklung 0.0% — und trotzdem ein deutlicher Abfall im „Preisverlauf", beide
Punkte am selben Tag (1.8.2026).

**Ursache**, in `routes/finance.ts`:

```js
const condition = DEFAULT_PRICE_CONDITION;   // fest 'U'
```

Der Graph nahm den **globalen** Standardzustand (`'U'`, Gebraucht) statt des
**tatsächlichen** Zustands dieses Sets. Dein NASA Space Shuttle Discovery ist
als „Neu" geführt. Sobald für denselben Tag sowohl ein Neu- als auch ein
Gebraucht-Preis im Verlauf standen — was bei einem frischen Import mit
anschliessendem Preis-Abgleich der Normalfall ist —, bevorzugte die
Graph-Abfrage den Gebraucht-Preis für den Verlaufspunkt, während der zuerst
eingefügte Punkt (dein tatsächlicher Kaufpreis, korrekt „Neu") unverändert
blieb. Zwei Punkte, zwei Zustände, ein irreführender Abfall — der reale Preis
hat sich nie bewegt.

**Behoben:** Der Zustand wird jetzt aus den Erfassungen dieses Sets abgeleitet
— dieselbe Regel wie überall sonst (eine gebrauchte Erfassung gewinnt, sonst
Neu, ohne Erfassungen der gespeicherte Wert).

Nachgestellt mit deinem Fall (Set als Neu geführt, Neu-Preis 162.42 und
Gebraucht-Preis 110.48 am selben Tag im Verlauf):

```
aufgelöster Zustand (Fix)      : N
vorher (DEFAULT_PRICE_CONDITION): U  (fest, unabhängig vom Set)
Verlaufspunkt heute (Fix)      : 162.42  (vorher wäre 110.48 gezeigt worden)
```

Das ist die **vierte** Stelle mit demselben Grundproblem in dieser Sitzung —
nach `computeSetsValuation`, `getCurrentMarketPrice` und `computePnl`. Jede
zeigte den Zustand eines Sets über einen eigenen, leicht abweichenden Weg, und
jede mussten einzeln gefunden werden, weil sie unabhängig voneinander
entstanden sind.

Stand: `tsc --noEmit` sauber, 64 Tests grün, Paritätssuite 32/32.

**Für dein Space-Shuttle-Set** sollte der Graph nach dem Deploy eine gerade
Linie zeigen, keinen Abfall — die zugrunde liegenden Preise haben sich ja
nicht verändert, nur die falsche Abfrage hat sie falsch zusammengesetzt.

---
## Android-App: derselbe Fehler, zwei weitere Fundorte — jetzt zusammengefasst

Dein Screenshot der App zeigt es exakt: Marktpreis 110.48 CHF, Kaufpreis 162.42
CHF, „-32.0 %". Beide Zahlen stammen 1:1 aus dem Preis-Cache deines Sets (siehe
letzte Probe) — nur dass 110.48 der **Gebraucht**-Preis ist, während das Set
als „Neu" geführt wird.

**Ursache — dieselbe Zeile wie beim Webapp-Graphen, zweimal:**

```
routes/api_v1/sets.ts
  /sets/:setNumber/price          → fetchPrice(sn, DEFAULT_PRICE_CONDITION, …)
  /sets/:setNumber/price-history  → const condition = DEFAULT_PRICE_CONDITION;
```

`DEFAULT_PRICE_CONDITION` ist fest `'U'`. Beide Android-Endpunkte nahmen damit
unabhängig vom tatsächlichen Zustand deines Sets immer den Gebraucht-Preis.
Und dein Webapp-Graph aus der letzten Meldung zeigte weiterhin denselben
Abfall, weil er noch den alten Serverstand befragt hat — dein Fix aus der
letzten Runde war korrekt, nur noch nicht bei dir angekommen.

### Genug Fundorte — jetzt eine einzige Funktion

Das war der **fünfte** Fundort desselben Grundfehlers in dieser Sitzung:
`computeSetsValuation`, `getCurrentMarketPrice`, `computePnl`, die
Webapp-Verlaufsroute, jetzt die Android-API. Fünf eigene, leicht
unterschiedliche Fassungen derselben Regel zu pflegen ist selbst das Risiko —
deshalb jetzt `resolveSetCondition(uid, setNumber)` in `utils/financeCalc.ts`
als **einzige** Zustandsauflösung für Aufrufer, die nicht schon einen
batch-geladenen Datensatz mit `acq_count`/`used_count` in der Hand haben:

- `routes/api_v1/sets.ts` — beide Android-Routen (`/price`, `/price-history`)
- `routes/finance.ts` — die Webapp-Verlaufsroute (ersetzt die Inline-Fassung
  aus der letzten Runde)

`computeSetsValuation()` und `computePnl()` behalten ihre eigene, batch-
optimierte Variante (`effectiveCondition()` auf einer bereits per JOIN
geladenen Zeile) — das ist bewusst so, eine Einzelabfrage pro Set wäre dort
ein Performance-Rückschritt bei vielen Sets auf einmal.

Gegen die Datenbank nachgestellt, mit deinem exakten Fall:

```
aufgelöster Zustand (Fix) → N
/price liefert jetzt      → 162.4163   (vorher 110.481)
```

**Test.** Beide Android-Routen benutzen den Helfer, keine direkte
`DEFAULT_PRICE_CONDITION`-Verwendung mehr an diesen Stellen, und ein Test
zählt die Verwendungsstellen — künftig sollte niemand mehr eine sechste eigene
Fassung daneben schreiben, ohne dass ein Test anschlägt.

Stand: `tsc --noEmit` sauber, 76 Tests grün, Paritätssuite 32/32.

**Für dein Set:** Nach dem Deploy sollte sowohl die Webapp (Graph als gerade
Linie) als auch die Android-App (Marktpreis = Kaufpreis, 0 % Entwicklung) den
Space Shuttle korrekt zeigen. Falls die Webapp danach immer noch den Abfall
zeigt, prüfe bitte zuerst, ob der neue Stand tatsächlich läuft (Skript-Version
in den Browser-Entwicklertools, siehe `?v=` an den `.js`-Dateien).

---
## Android: Galerie-Kacheln teilweise ohne Bild — dieselbe Fehlerklasse wie beim Server

**Ursache:** Der `OkHttpClient` hinter Coil (`imageOkHttpClient`) ist eine
**einzige, app-weite Instanz** — dieselbe für Katalog, Galerie, Finanzen,
Minifiguren. Er war eng gedrosselt:

```kotlin
.dispatcher(Dispatcher().apply {
    maxRequests = 6
    maxRequestsPerHost = 3
})
```

Bewusst so gewählt, laut Kommentar im Code: Der Katalog lädt bis zu 60
CDN-Bilder pro Seite, und auf langsamen Verbindungen sättigten die Downloads
mit den OkHttp-Standardwerten (5/64) die Leitung, sodass API-Aufrufe in
Timeouts liefen.

**Das Problem:** Diese für den Katalog gedachte Drosselung galt für die ganze
App — auch für die Galerie. Bei einer Kachelwand mit mehr als drei
gleichzeitigen Bildanfragen an denselben Host standen die übrigen in einer
Warteschlange. Scrollt man daran vorbei, bricht Coil die wartende Anfrage ab —
die Kachel bleibt **dauerhaft** leer, nicht nur vorübergehend.

Das ist exakt dieselbe Fehlerklasse, die in dieser Sitzung schon einmal beim
serverseitigen Bild-Proxy für Aufregung gesorgt hat: eine zu enge
Nebenläufigkeits-Begrenzung lässt spät dran kommende Anfragen verhungern statt
sie nur zu verzögern.

**Behoben:** `maxRequestsPerHost` von 3 auf 6, `maxRequests` von 6 auf 12 — noch
deutlich unter den OkHttp-Standardwerten, die Drosselung für den Katalog auf
langsamen Verbindungen bleibt also erhalten, nur nicht mehr eng genug, um die
Galerie zu verhungern.

**Test.** Liest die Werte aus `AppModule.kt` und verlangt `maxRequestsPerHost
>= 6` sowie `maxRequests` im Bereich `[perHost, 32]` — eng genug, um weiterhin
als bewusste Drosselung zu gelten, nicht mehr eng genug, um eine übliche
Kachelwand zu verhungern.

**Das ist eine begründete Hypothese, keine bestätigte Diagnose** — ich kann
Android hier nicht ausführen und habe keinen Log-Zugriff auf dein Gerät. Die
Konstruktion (eine geteilte, eng gedrosselte Verbindung für die ganze App)
erklärt „teilweise nicht geladen" plausibel, aber es gibt noch eine
Alternative: Manche Sets haben schlicht noch kein `image_local` (der
Hintergrundlauf hat sie noch nicht heruntergeladen) und ihr `image_url` zeigt
auf eine beim CDN nicht mehr vorhandene Datei — dieselbe Ursache wie bei den
Minifiguren vor einigen Runden.

**Zur Unterscheidung, falls es nach dem Update weiterhin auftritt:** Bleiben
dieselben Kacheln bei jedem Öffnen leer (auch nach Zurückscrollen und erneutem
Warten), ist es die zweite Ursache — fehlendes Bild. Werden es bei jedem
Öffnen der Galerie andere, wechselnde Kacheln, spricht das für die
Nebenläufigkeit — dann wäre der nächste Schritt, `maxRequestsPerHost` probeweise
weiter zu erhöhen oder den Katalog auf einen eigenen, separat gedrosselten
Client umzustellen, statt die ganze App zu teilen.

Stand Webapp/Server unverändert von der vorigen Runde. Android-seitig
ungeprüft wie immer — kein SDK hier; Klammerbilanz in `AppModule.kt` stimmt.

---
## Android-Galerie: Bild erscheint erst beim Öffnen des Sets — jetzt mit Wiederholversuch

Dein Screenshot war der entscheidende Hinweis, den ich vorher nicht hatte: **fast
alle** Kacheln blieben leer (nur die erste zeigte ein Bild), und dein Zusatz —
das Bild erscheint, sobald man das Set öffnet — schliesst meine vorige
Vermutung aus. Wären die Bilder tatsächlich fehlend oder dauerhaft
unerreichbar, würde das Öffnen des Sets nichts ändern; es lädt exakt dieselbe
Adresse. Zeigt das Set-Detail sie trotzdem sofort, war die Adresse die ganze
Zeit gültig — nur der **erste** Ladeversuch in der Kachelwand ist gescheitert,
und Coil versucht eine fehlgeschlagene Anfrage nicht von sich aus erneut.

Das ist dieselbe Situation wie bei den `<img>`-Elementen der Webapp weiter oben
in dieser Sitzung: ein einzelner, transienter Fehlschlag (Zeitüberschreitung,
abgebrochene Verbindung) sollte nicht die Kachel dauerhaft leer lassen.

**Behoben in `GalleryScreen.kt`:** Ein Ladefehler löst jetzt **genau einen**
Wiederholversuch nach einer Sekunde aus:

```kotlin
var retryNonce by remember(set.setNumber, imageUrl) { mutableIntStateOf(0) }
…
onState = { st ->
    if (st is AsyncImagePainter.State.Error && retryNonce == 0) {
        retryScope.launch { delay(1000); retryNonce = 1 }
    }
}
```

`retryNonce` fliesst als `setParameter("retry", …)` in die Anfrage ein — ein
neues, für Coil unterscheidbares Objekt, das nicht mit dem fehlgeschlagenen
Vorgänger verwechselt wird, obwohl dieselbe Bildadresse angefragt wird.

**Zur vorigen Runde:** Die Warteschlangen-Verbreiterung
(`maxRequestsPerHost`) bleibt bestehen — sie senkt, wie viele Anfragen
überhaupt in eine solche Situation geraten. Der Wiederholversuch fängt jetzt
zusätzlich ab, was trotzdem einmal schiefgeht. Beides zusammen sollte
belastbarer sein als jede der beiden Massnahmen allein.

**Test.** Liest `GalleryScreen.kt` und prüft alle vier Bestandteile: der
Zähler ist an Set und Bildadresse gebunden, der Wiederholversuch ist auf genau
einmal begrenzt, die Anfrage trägt ein unterscheidbares Merkmal, und die
Verzögerung ist vorhanden. Alle vier Prüfungen laufen nachweislich gegen den
tatsächlichen Code durch (ausserhalb von Gradle nachgestellt, da hier kein
Android-Toolchain verfügbar ist).

**Was das nicht abdeckt:** Bricht der ZWEITE Versuch ebenfalls ab, bleibt die
Kachel leer — bewusst begrenzt auf einen Versuch, damit eine wirklich
unerreichbare Adresse nicht endlos neu angefragt wird. Bleibt eine bestimmte
Kachel auch nach dieser Änderung dauerhaft leer, während andere sich erholen,
wäre das ein Hinweis auf eine tatsächlich tote Bildadresse bei genau diesem
Set — dann bräuchte es die Diagnose, die für die Minifiguren schon existiert.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer, Klammerbilanz
und Testlogik gegen den Quellcode verifiziert.

---
## Android-Galerie, dritter Anlauf: Bildanfragen sahen aus wie kein Browser

Dein „genau gleiches Verhalten" nach zwei Versuchen war die entscheidende
Information. Weder die breitere Warteschlange (Runde 1) noch der
Wiederholversuch (Runde 2) hatten irgendeine Wirkung — und das spricht **gegen**
einen transienten Fehler (Zeitüberschreitung, Überlastung) und **für** eine
**dauerhafte** Ablehnung, die bei jedem Versuch neu zuschlägt. Ein
Wiederholversuch kann eine solche Ablehnung naturgemäss nicht beheben, egal wie
oft man es versucht.

**Die wahrscheinlichste dauerhafte Ablehnung dieser Art:** OkHttps
Standard-`User-Agent` (`okhttp/4.x`) identifiziert die Anfrage eindeutig als
Nicht-Browser-Client. Vor Rebrickables CDN steht Cloudflare — das war schon
beim serverseitigen Bild-Proxy dieser Sitzung das Thema. Cloudflare kann
Anfragen ohne glaubwürdige Browser-Kennung dauerhaft blockieren oder mit einer
HTML-Challenge statt des Bildes beantworten, die Coil nicht als Bild entpacken
kann.

Das erklärt auch, warum ausgerechnet die **erste** Kachel funktionierte: Sie
zeigte vermutlich das einzige Set, dessen Bild bereits lokal auf deinem Server
liegt (`image_local`, heruntergeladen vom Hintergrundlauf) — dieser Weg geht nie
über die Rebrickable-CDN und war nie betroffen. Alle anderen, noch nicht lokal
vorliegenden Bilder, fragen die Android-App direkt vom Gerät bei Rebrickable
an — und genau die blieben leer.

**Behoben:** Ein Interceptor am Bild-Client sendet jetzt für Anfragen an
**fremde** Hosts (nicht den eigenen Server) dieselben Kopfzeilen, die sich beim
Server-Proxy bereits bewährt haben — Chrome-User-Agent, `Referer:
https://rebrickable.com/`, passender `Accept`-Header. Anfragen an den eigenen
Server bleiben unverändert.

```kotlin
val isOwnServer = host == "localhost" ||
    NetworkPolicy.isSameOrigin(req.url, prefs.serverUrlState.value ?: "")
if (isOwnServer) chain.proceed(req)
else chain.proceed(req.newBuilder().header("User-Agent", …).header("Referer", …).build())
```

Die Unterscheidung nutzt dieselbe `NetworkPolicy.isSameOrigin()`-Prüfung wie der
bestehende Token-Interceptor, damit die Browser-Kennung nicht versehentlich an
den eigenen Server geht (dort unnötig, aber harmlos gewesen wäre).

**Test.** Prüft, dass die Kopfzeilen gesetzt werden, dass die
Server/Fremd-Unterscheidung existiert, und dass die Drosselung aus der
vorigen Runde nicht verloren gegangen ist. Alle vier Teilprüfungen laufen
nachweislich gegen den tatsächlichen Code durch.

**Ehrlich zur Unsicherheit:** Auch das ist eine Hypothese, keine bestätigte
Diagnose — ich kann von hier aus nicht sehen, was Cloudflare deinem Gerät
tatsächlich antwortet. Sie ist aber die einzige der drei bisherigen Theorien,
die erklärt, warum die ersten beiden Massnahmen wirkungslos blieben. Bleibt das
Verhalten danach unverändert, brauche ich als Nächstes eine Möglichkeit, die
tatsächliche HTTP-Antwort zu sehen — am ehesten über die Logcat-Ausgabe beim
Öffnen der Galerie (`adb logcat` nach Fehlern von Coil oder OkHttp gefiltert),
oder testweise dieselbe Bildadresse direkt im Handy-Browser geöffnet: Lädt sie
dort, während sie in der App leer bleibt, bestätigt das die
Client-Erkennungs-These; bleibt sie auch im Browser leer, ist das Bild selbst
betroffen und wir sind wieder beim Reparaturmechanismus der Minifiguren.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer.

---
## Selbst verursacht: „Failed to create image decoder with message 'unimplemented'"

Das ist mein eigener Fehler aus der letzten Änderung — und zum Glück eindeutig
zu erklären.

Der `Accept`-Header, den ich für die Cloudflare-Umgehung ergänzt hatte, enthielt
`image/avif`:

```
Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8
```

Damit meldet der Client dem CDN: „Ich kann AVIF verarbeiten." Rebrickable /
Cloudflare antwortete daraufhin vermutlich mit einer **AVIF**-Datei statt des
gewohnten JPEG. Android übernimmt das Dekodieren nativer Bildformate über
`ImageDecoder` — und nicht jedes Gerät hat trotz ausreichender API-Stufe
tatsächlich einen AV1-Decoder verbaut. Genau das erzeugt „Failed to create
image decoder with message 'unimplemented'" statt eines angezeigten Bildes.
Die von mir zuvor selbst hinzugefügte Kopfzeile hat also ein neues Problem
erzeugt, während sie das ursprüngliche vermutlich löste.

**Behoben:** `image/avif` aus dem Accept-Header entfernt.

```
Accept: image/webp,image/apng,image/*,*/*;q=0.8
```

WebP bleibt drin — es wird auf jedem von dieser App unterstützten
Android-Gerät zuverlässig über Skia dekodiert, anders als AVIF.

**Test.** Verlangt jetzt explizit, dass `image/avif` **nicht** mehr im
Accept-Header steht, dass weiterhin ein Accept-Header mit WebP gesetzt ist, und
dass User-Agent, Referer sowie die Server/Fremd-Unterscheidung aus der letzten
Runde erhalten geblieben sind.

Bei dieser Testprüfung selbst ist mir dieselbe Falle wie mehrfach zuvor in
dieser Sitzung passiert: Mein Erklärkommentar nennt „image/avif" wörtlich, und
ein naives Herausschneiden aller Zeilen ab `//` hätte ausserdem `https://` in
den Kopfzeilen-Werten falsch abgeschnitten. Beides korrigiert — nur ganze
Kommentarzeilen werden ausgeblendet, keine Teilzeilen ab dem ersten `//`. Alle
sechs Teilprüfungen laufen jetzt nachweislich gegen den tatsächlichen Code
durch.

**Bitte nach dem Deploy sowohl bestätigen, dass der Absturz weg ist, als auch,
ob die Galerie-Bilder jetzt tatsächlich laden** — es ist möglich, dass die
Kopfzeilen-Änderung an sich richtig war und nur dieses eine Format zu weit
ging.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer.

---
## Umgesetzt: alle Bilder über den Server, nicht direkt vom Gerät

Dein Grundsatz ist genau richtig — und er löst rückblickend die Ursache hinter
den letzten drei Runden auf: Warteschlangen-Enge, Wiederholversuch,
Browser-Kennung gegen Cloudflare, AVIF-Absturz. Jede dieser Massnahmen
behandelte ein **Symptom** des direkten Gerät-zu-CDN-Zugriffs, keine davon die
**Ursache**. Diese Runde behebt die Ursache: kein Bildschirm lädt mehr eine
rohe CDN-Adresse direkt vom Gerät.

### Der gemeinsame Helfer

`util/ImageUrls.kt`, neu — spiegelt exakt `thumbUrl()`/`imgUrl()` aus der
Webapp:

```
resolveThumbUrl(serverUrl, imageLocal, imageUrl)   // Kachel/Liste, 200px
resolveFullUrl(serverUrl, imageLocal, imageUrl)    // Detail/Zoom, Originalgrösse
```

Lokal abgelegtes Bild (`imageLocal`) hat Vorrang und geht direkt über
`express.static`; jede CDN-Adresse läuft über `/api/img-proxy` — mit `&thumb=1`
für Kacheln.

### Wo überall umgestellt

Galerie, Set-Detail (Vorschau **und** Zoom getrennt aufgelöst), Teile-Bildschirm
(zwei Stellen), Finanzen (Sets, Teile, Minifiguren), Minifiguren-Bildschirm
(zwei Stellen), Katalog-Übersicht, Katalog-Detail, Barcode-Scan-Ergebnis — neun
Bildschirme, zwölf Fundstellen.

**Dabei zwei weitere, bisher unentdeckte Bugs mitbehoben**, unabhängig vom
eigentlichen Umbau:

- Finanzen-Minifiguren-Zeile zeigte `fig.imageUrl` komplett unverarbeitet — kein
  `image_local`, kein Server-Präfix, nichts.
- Barcode-Scan-Ergebnisvorschau hatte dieselbe Lücke wie die übrigen
  Bildschirme vor dieser Runde.

### Eine bewusste Ausnahme — und ein Fehler, den ich dabei selbst gemacht und
wieder korrigiert habe

`PartsListScreen.kt` bekommt seine `part.imageUrl` bereits **vollständig
aufgelöst** von `PartsListFeature.kt` — die löst image_local/Server-Proxy schon
beim Laden auf, bevor ein `PlPart`-Objekt entsteht. Mein erster Versuch hat
`resolveThumbUrl()` versehentlich AUCH dort angewendet — das hätte eine bereits
proxy-gewickelte Adresse ein zweites Mal eingewickelt (`/api/img-proxy?url=<url-
codierter Proxy-Aufruf>`), ein defekter Doppel-Wrap. Beim Nachprüfen, ob dieses
Muster genau EINMAL pro Aufrufkette gilt, ist mir das aufgefallen, und ich habe
es zurückgenommen, bevor es ausgeliefert wurde.

Das war eine Lehre daraus, denselben Patch elf Mal an strukturell ähnlich
aussehenden Stellen anzuwenden, ohne bei jeder zu prüfen, ob die Daten dort
wirklich roh sind. Der Katalog behandelt seinerseits Bilder ausserhalb des
eigenen Bestands (kein `image_local` möglich) — dort greift ausschliesslich der
Proxy-Pfad, korrekt.

### Test

`NoDirectCdnAccessTest.kt`, neu, drei Prüfungen:

1. Jeder der acht betroffenen Bildschirme muss `resolveThumbUrl()` oder
   `resolveFullUrl()` tatsächlich aufrufen.
2. Der gemeinsame Helfer muss `image_local` bevorzugen und CDN-Adressen über
   `/api/img-proxy` schicken.
3. `PartsListScreen.kt` darf **keinen** der beiden Resolver aufrufen — sonst
   entstünde der Doppel-Wrap erneut.

Alle drei Prüfungen sind vor der Auslieferung ausserhalb von Gradle gegen den
tatsächlichen Code durchgerechnet worden (kein Android-SDK hier verfügbar).

### Folge für den Server

Der Server bekommt jetzt spürbar mehr Bildanfragen — auch für den Katalog mit
bis zu 60 Bildern pro Seite, den die Webapp selbst direkt im Browser lädt.
Das ist die bewusste Kehrseite deines Grundsatzes: ein einzelner,
kontrollierbarer Zugriffspunkt statt vieler Geräte, die einzeln mit
Rebrickable/Cloudflare verhandeln müssen — bezahlt mit mehr Last auf dem
eigenen Server. Die Proxy-Route ist aus den vorigen Runden bereits gehärtet
(Negativ-Cache, Referer-Rückfall, Entpacken, keine künstliche
Nebenläufigkeits-Grenze mehr), sollte das also tragen.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer — kein SDK
verfügbar; Klammerbilanz in allen zehn geänderten/neuen Dateien geprüft, alle
Testprüfungen gegen den tatsächlichen Code nachgerechnet.

---
## Drei Punkte: Compile-Fehler, PartsListScreen-Frage, Preisverlauf-Graph

### 1. Compile-Fehler `Unresolved reference 'serverUrl'`

Mein eigener Fehler aus der letzten Runde: Ich habe `resolveFullUrl(serverUrl, …)`
in `CatalogDetailScreen.kt` eingebaut, ohne zu prüfen, ob die Funktion
`serverUrl` überhaupt als Parameter kennt — tat sie nicht. Behoben:

- `serverUrl: String` zur Signatur von `CatalogDetailScreen()` ergänzt
- den einzigen Aufrufer (`nav/CatalogGraph.kt`) mit `serverUrl =
  state.serverUrl` versorgt

Ich habe diesmal **alle zwölf** heute geänderten Android-Dateien auf
Klammer-/Parenthesen-Gleichgewicht geprüft, nicht nur die zuletzt bearbeitete
— derselbe Fehler sollte nicht an einer übersehenen Stelle nochmal auftreten.

### 2. Bezieht `PartsListScreen.kt` seine Bilder korrekt?

Ja. Es läuft über einen anderen, aber ebenfalls korrekten Weg:
`ui/PartsListFeature.kt` löst `part.imageUrl` bereits **vollständig** auf
(`image_local` bevorzugt, sonst `/api/img-proxy?url=…`), bevor das
`PlPart`-Objekt entsteht. `PartsListScreen.kt` bekommt damit nie eine rohe
CDN-Adresse zu Gesicht — es muss nichts mehr auflösen. Genau deshalb hatte ich
letzte Runde meinen ersten Versuch, dort zusätzlich `resolveThumbUrl()`
einzubauen, wieder zurückgenommen: Das hätte die bereits aufgelöste Adresse ein
zweites Mal in den Proxy gewickelt.

### 3. Preisverlauf-Graph — der eigentliche Fund dieser Runde

**Die 110.48-vs-162.42-Abweichung ist eine Deployment-Frage, kein neuer Fehler.**
Ich habe die Server-Logik erneut exakt gegen deinen Fall durchgerechnet:

```
resolveSetCondition() → N
fetchPrice() mit diesem Zustand → 162.4163
DEFAULT_PRICE_CONDITION ist U → falscher Weg liefert 110.481
```

Der zweite Wert trifft exakt deine Beobachtung — das ist der **alte**,
inzwischen ersetzte Pfad. Die Android-App ruft ausschliesslich
`/api/v1/sets/{setNumber}/price` auf, und diese Route benutzt seit mehreren
Runden bereits `resolveSetCondition()`. Wenn du weiterhin 110.48 siehst, läuft
der Server-Teil des Pakets noch auf einem älteren Stand — bitte einmal
gegenprüfen, ob der zuletzt gepackte `brickinventory-manager`-Ordner tatsächlich
neu aufgespielt wurde.

**Der Preisverlauf-Graph dagegen war ein echter, bisher unentdeckter Fehler —
und erklärt, warum er trotz korrekter Zustandsauflösung falsch blieb:**

```js
// public/js/07-admin.js, sparklineSVG()
const vals = data.map(d=>d.qty_avg_price||d.total||0);
```

Die Sparkline zeichnete `qty_avg_price`, nicht `avg_price` — eine **andere**
Preisspalte desselben, längst korrekt aufgelösten Zustands.
`qty_avg_price` kann für einen Tag fehlen oder 0 sein, während `avg_price`
vorhanden ist. Nachgestellt:

```
vorher (qty_avg_price zuerst): [162.4163, 0]        ← Absturz auf 0
jetzt  (avg_price zuerst)    : [162.4163, 162.4163]  ← korrekt konstant
```

Das erklärt den dramatischen, aber falschen Abfall, den du über mehrere Runden
gemeldet hast — er hatte nichts mit der Zustandsauflösung zu tun, die ich immer
wieder repariert hatte, sondern mit einer Preisspalte, die die Grafik nie hätte
verwenden sollen.

**Android hatte genau diese Stelle (`SetDetailComponents.kt`) längst richtig**
— `avgPrice ?: qtyAvgPrice` stand dort schon aus einer früheren Runde. Nur die
Webapp hatte den entsprechenden Fix nie bekommen. Jetzt:

```js
const vals = data.map(d=>d.avg_price||d.qty_avg_price||d.total||0);
```

**Test.** `test/set-condition-aggregate.test.js` verlangt jetzt genau diese
Reihenfolge und verbietet die alte. `CatalogUsesLocalImagesTest.kt` prüft
zusätzlich, dass `serverUrl` sowohl in der Signatur als auch am Aufrufer
vorhanden ist — Regressionsschutz gegen genau den Compile-Fehler von oben.

Stand: `tsc --noEmit` sauber, 55 Tests grün, Paritätssuite 32/32. Android
ungeprüft wie immer, aber alle Testprüfungen und Klammerbilanzen gegen den
tatsächlichen Code nachgerechnet.

---
## Nochmal derselbe Fehler — diesmal an der Kachel, nicht am Bildschirm

`CatalogSetCard()` (die einzelne Kachel im Katalog-Raster) kannte `serverUrl`
ebenso wenig wie `CatalogDetailScreen()` letzte Runde. Behoben:

- `serverUrl: String` zur Signatur von `CatalogSetCard()` ergänzt
- den einzigen Aufruf in `CatalogScreen.kt` mit `serverUrl` versorgt

### Diesmal systematisch statt punktuell geprüft

Nachdem derselbe Fehler zweimal hintereinander aufgetreten ist, habe ich eine
generische Prüfung geschrieben, die **jede** Funktion in den acht betroffenen
Bildschirmen findet, die `resolveThumbUrl()`/`resolveFullUrl()` mit `serverUrl`
aufruft, und verlangt, dass **dieselbe** Funktion `serverUrl` auch selbst als
Parameter führt — nicht nur irgendeine umgebende Datei.

**Beim Schreiben dieser Prüfung ist mir prompt derselbe Fehler unterlaufen, den
ich beheben wollte:** Meine erste Fassung hielt lokale, eingerückte
Hilfsfunktionen (`fmtDate` in `SetDetailScreen.kt`, `fmtPrice` in
`FinanceScreen.kt` — beide innerhalb eines Composable-Körpers definiert, keine
eigenen Bildschirme) fälschlich für den umschliessenden Aufrufer und meldete
sie als Fehler, obwohl beide Bildschirme korrekt sind. Korrigiert, indem nur
Funktionsdefinitionen auf Spalte 0 als eigener Gültigkeitsbereich zählen —
lokale, eingerückte `fun`-Deklarationen nicht.

Und beim Zählen der Klammerbilanz meines eigenen Tests bin ich auf eine
Klammer in einem Erklärkommentar gestossen (`"fun NAME(...) {"` als
Beispieltext), die meine grobe Zählmethode verwirrte, obwohl der Kotlin-Code
korrekt war — entfernt, damit die Prüfung beim nächsten Mal ohne Umweg
vertrauenswürdig ist.

Gegenprobe gemacht: mit künstlich entferntem `serverUrl`-Parameter an
`CatalogSetCard` schlägt die Prüfung an; im aktuellen Stand nicht.

Stand: Android ungeprüft wie immer, aber jede der acht betroffenen Dateien
einzeln gegen die neue, korrigierte Prüflogik nachgerechnet — alle bestehen.

---
## Gefunden: warum die Galerie trotz Server-Bezug weiterhin leere Kacheln zeigt

Deine Frage nach einem Caching-Problem war der richtige Anstoss — sie hat mich
zur Webapp-Logik zurückgeführt, statt eine vierte Theorie über Cloudflare oder
Nebenläufigkeit zu bauen.

**Die tatsächliche Ursache:** Nach einem CSV-Import legt der Server
Original-Bilder sofort ab (`image_local` wird gesetzt), erzeugt die
zugehörigen `_thumb.jpg`-Vorschaudateien aber **nachträglich**, in einer
eigenen, strikt sequenziellen Warteschlange (`server.ts`, „Generate missing
thumbnails" — ein Bild nach dem anderen, mit kleinen Pausen). Bei 371 frisch
importierten Sets kann diese Warteschlange eine Weile brauchen, um
durchzulaufen.

Fragt eine Kachel in dieser Zeit die Vorschau an, antwortet der Server mit
**404** — die Datei existiert schlicht noch nicht. Mein vorheriger
Wiederholversuch (letzte Runde) fragte danach dieselbe, weiterhin fehlende
Datei ein zweites Mal an — dieselbe 404, keine Besserung. Das erklärt, warum
weder die Warteschlangen-Verbreiterung noch der Wiederholversuch noch die
Browser-Kennung geholfen haben: Keines davon adressierte eine tatsächlich
**fehlende Datei**.

**Die Webapp hat dieses Problem nie gehabt**, weil sie einen zweistufigen
Rückfall besitzt (`public/js/11-actions.js`): Schlägt ein Bild zweimal fehl,
wechselt sie auf `data-orig` — die **volle Auflösung**, die immer existiert,
sobald `image_local` gesetzt ist. Genau das hat Android gefehlt.

### Behoben

Neuer, wiederverwendbarer Helfer `rememberTileImageWithFallback()` in
`util/ImageUrls.kt`: Bei einem Ladefehler wechselt die angefragte Adresse
sofort von der Vorschau auf die volle Auflösung — kein sinnloser
Wiederholversuch derselben fehlenden Datei mehr.

```kotlin
val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)
…
onState = { st -> if (st is AsyncImagePainter.State.Error) onImageError() }
```

In `GalleryScreen.kt` eingebaut, der bisherige (wirkungslose)
Wiederholversuch vollständig entfernt.

Nachgestellt: Vorschau fehlgeschlagen → Adresse wechselt von
`…_thumb.jpg` auf `….jpg` (Originalgrösse), exakt das Verhalten der Webapp.

**Test.** Zwei Prüfungen: Der Helfer wechselt tatsächlich auf `resolveFullUrl()`
im Fehlerfall, und `GalleryScreen.kt` benutzt ihn — der alte Mechanismus darf
nicht mehr vorkommen. Beide gegen den tatsächlichen Code nachgerechnet.

**Was ich bewusst NICHT angefasst habe:** Die serverseitige
Thumbnail-Warteschlange bleibt sequenziell. Mit dem Rückfall braucht es das
auch nicht mehr zwingend — die App zeigt jetzt einfach übergangsweise die volle
Auflösung, bis der Thumb nachgezogen ist, und heilt sich von selbst. Sollte dir
das zu langsam sein (grosse Bilder auf einer Kachelwand bis die Thumbs
nachkommen), wäre eine Parallelisierung der Warteschlange der nächste, separate
Schritt.

**Nicht auf andere Bildschirme übertragen:** Parts-, Minifig-, Finanz- und
Katalog-Kacheln nutzen weiterhin nur `resolveThumbUrl()` ohne Rückfall — sie
haben denselben, noch offenen Fehler. Ich habe mich auf die konkret gemeldete
Galerie beschränkt; sag Bescheid, wenn ich den Rückfall auf die übrigen
Bildschirme ausweiten soll.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer, aber Logik
ausserhalb von Gradle nachgestellt und alle Testprüfungen gegen den
tatsächlichen Code verifiziert.

---
## Die tatsächliche Ursache: der Client hat die Antwort des Servers ignoriert

Deine Rückfrage war entscheidend — „auch nach vollständigem Neustart" passt
nicht zu „Zeit muss verstreichen, bis die Warteschlange nachzieht". Das hat
mich zurück zum Server geführt, und dort lag die eigentliche Wurzel.

**Der Server trifft die Thumb-Entscheidung längst selbst.**
`utils/images.ts`, `resolveImageLocal()`, existiert schon lange:

```js
// Liefert den _thumb.jpg-Pfad, falls das Thumbnail existiert — sonst das Original.
return exists ? thumbPath : localPath;
```

Mit eigenem Existenz-Cache (10 Minuten für „existiert nicht"). Das ist bereits
korrekt und wird für **jede** `image_local`-Antwort angewendet, auch für die,
die an Android geht.

**Der Fehler:** Androids `resolveThumbUrl()` hat diese bereits richtige
Antwort ignoriert und **selbst nochmal geraten**. Lieferte der Server den
Original-Pfad (weil die Vorschau fehlte), baute die App daraus ihren **eigenen**
`_thumb.jpg`-Pfad — denselben, von dem der Server soeben festgestellt hatte,
dass es ihn nicht gibt:

```
Server prüft:     /images/sets/10283-1_thumb.jpg  → existiert nicht
Server liefert:   /images/sets/10283-1.jpg          (Original, korrekt!)
App ignoriert das und rät:
                  /images/sets/10283-1_thumb.jpg  → 404, garantiert
```

Das erklärt „auch nach vollständigem Neustart": Es ging nie um verstrichene
Zeit oder einen kalten Start. Der Server hatte die richtige Antwort die ganze
Zeit parat — der Client hat sie weggeworfen und erneut die falsche Adresse
zusammengebaut. Kein Zeitablauf der Welt behebt das.

**Behoben:** `imageLocal` wird jetzt unverändert übernommen — kein
Rateversuch mehr. Die tote `toThumbPath()`-Funktion vollständig entfernt,
nicht nur ungenutzt gelassen.

```kotlin
imageLocal != null -> "$base$imageLocal"   // unverändert, wie vom Server entschieden
```

Nachgestellt:

```
Server liefert Thumb    : …_thumb.jpg  → App übernimmt …_thumb.jpg
Server liefert Original : ….jpg        → App übernimmt ….jpg (nicht mehr geraten)
```

**Test.** Prüft, dass `imageLocal` unverändert weitergereicht wird, dass
`toThumbPath()` an keiner Stelle mehr aufgerufen wird, und dass die Funktion
selbst nicht mehr existiert.

**Beim Schreiben des Tests** ist mir zweimal derselbe blinde Fleck begegnet —
ein Erklärkommentar, der den Funktionsnamen selbst nannte, und ein
Such-String, der eine unpaarige Klammer als Text enthielt. Beides hätte meine
eigene Klammerprüfung verfälscht; beide korrigiert.

**Der Rückfall-Mechanismus aus der letzten Runde bleibt bestehen**, ist für
lokale Bilder jetzt aber meist wirkungslos (beide Pfade liefern nach diesem
Fix dieselbe, bereits korrekte Adresse) — er bleibt für CDN-Bilder über den
Proxy relevant, wo Vorschau und volle Auflösung weiterhin unterschiedliche
Anfragen sind.

Stand: Server unverändert (die Logik war dort schon korrekt). Android
ungeprüft wie immer, Logik ausserhalb von Gradle nachgestellt.

---
## Teile, Minifiguren, Katalog auf dasselbe Muster umgestellt

Auf Wunsch alle drei angeglichen: Sie nutzten `resolveThumbUrl()` bereits
korrekt (kein Rateversuch mehr, seit dem letzten Fix), aber noch ohne den
Rückfall-Mechanismus, den die Galerie inzwischen hat. Jetzt einheitlich:

| Datei | Kacheln | Vorher | Jetzt |
|---|---|---|---|
| `PartsScreen.kt` | `ManualPartTile`, `PartCard` | `resolveThumbUrl()` | `rememberTileImageWithFallback()` |
| `MinifigsScreen.kt` | `ManualFigTile`, `MinifigCard` | `resolveThumbUrl()` | `rememberTileImageWithFallback()` |
| `CatalogScreen.kt` | `CatalogSetCard` | `resolveThumbUrl()` | `rememberTileImageWithFallback()` |

Fünf Kachel-Funktionen, alle nach demselben Schema: Schlägt das Laden fehl,
wechselt die Adresse von der Vorschau auf die volle Auflösung — kein
sinnloser zweiter Versuch derselben Datei mehr.

`CatalogDetailScreen.kt` bleibt unverändert: Sie fordert bereits die volle
Auflösung direkt an (kein Vorschaubild, kein Zoom-Wechsel), ein
Rückfall-Mechanismus hätte dort nichts, worauf er zurückfallen könnte.

### Ein Nebeneffekt, der mir beim Umbau aufgefallen ist

Der generische Regressionstest aus einer früheren Runde sucht nach direkten
`resolveThumbUrl(serverUrl`/`resolveFullUrl(serverUrl`-Aufrufen, um zu prüfen,
ob die umschliessende Funktion `serverUrl` selbst kennt. Da diese drei Dateien
jetzt `rememberTileImageWithFallback(serverUrl` aufrufen statt der
Einzel-Funktionen, wäre der Test für sie stillschweigend wirkungslos geworden
— er hätte einfach nichts mehr zu prüfen gehabt, ohne das zu melden. Das
Suchmuster ist entsprechend erweitert; alle dreizehn betroffenen
Funktionsdefinitionen sind erneut einzeln gegen den tatsächlichen Code
nachgerechnet, nicht nur die drei neuen.

**Test.** Neue Prüfung verlangt die erwartete Anzahl Verwendungen von
`rememberTileImageWithFallback()` je Datei (2, 2, 1) und dass kein direkter
`resolveThumbUrl()`-Aufruf mehr übrig ist.

### Zur Webapp-Frage

Nein — die Webapp verlässt sich nicht auf die bereits korrekte
Server-Antwort. `thumbUrl()` in `public/js/01-core.js` rät clientseitig
genau wie Androids alte Fassung; sie funktioniert nur wegen des
zweistufigen Rückfalls auf `data-orig`. Die Android-Lösung ist damit
strenger als die Webapp, nicht bloss ein Nachbau davon.

Stand: Server unverändert. Android ungeprüft wie immer; alle fünf
geänderten Dateien auf Klammerbilanz geprüft, alle Testerwartungen einzeln
gegen den tatsächlichen Code nachgerechnet.

---
## Webapp jetzt auf denselben Stand wie Android — `thumbUrl()` rät nicht mehr

Auf deinen Vorschlag hin dieselbe Bereinigung, die Android schon hat, jetzt
auch in der Webapp: `thumbUrl()` in `public/js/01-core.js` konstruierte aus
**jedem** lokalen Pfad seine eigene `_thumb.jpg`-Adresse — unabhängig davon,
ob der Server diese Vorschau bereits als existent bestätigt hatte oder nicht.

```js
// vorher
function thumbUrl(src) {
  ...
  return src.replace(new RegExp('\.'+ext+'$'), '_thumb.jpg');   // ← Rateversuch
}

// jetzt
function thumbUrl(src) {
  return src;   // unverändert — image_local ist bereits die richtige Adresse
}
```

`utils/images.ts` (`resolveImageLocal()`) prüft die Existenz serverseitig
längst und liefert je nachdem den Thumb- oder den Original-Pfad — genau wie
in der Android-Erklärung von eben. Der zweistufige Rückfall in
`public/js/11-actions.js` (Wiederholversuch, dann `data-orig`) hat diesen
Fehler bisher nur **maskiert**, nicht behoben — er sprang bei jedem falschen
Ratevorgang ein und liess die Ursache unbemerkt.

**Bewusst unverändert gelassen:**

- `imgUrl()` — wickelt CDN-Adressen weiterhin in `/api/img-proxy`, das ist
  weiterhin richtig client-seitig gesteuert (der Proxy-Cache hat keine
  serverseitige Vorab-Entscheidung wie `image_local`).
- `fullUrl()` — entfernt weiterhin ein vorhandenes `_thumb`-Suffix für Zoom
  und Detailansicht; das bleibt nötig, falls `image_local` selbst auf die
  Thumb-Datei zeigt.
- Der zweistufige Rückfall in `11-actions.js` bleibt bestehen — er fängt
  jetzt echte, transiente Netzwerkfehler ab, nicht mehr einen strukturellen
  Ratefehler.

Nachgestellt, alle vier Fälle:

```
Server lieferte Thumb    → unverändert übernommen
Server lieferte Original → unverändert übernommen (vorher: geraten, 404)
CDN-Adresse              → weiterhin korrekt über den Proxy
Zoom auf Server-Thumb    → weiterhin korrekt auf Originalgrösse zurückgerechnet
```

**Test.** `thumbUrl()` muss eine reine Durchreiche sein, keine
`_thumb.jpg`-Konstruktion mehr im Code.

Damit laden Webapp und Android-App Bilder jetzt nach demselben Prinzip:
Der Server entscheidet, welche Datei ausgeliefert wird — kein Client rät mehr
selbst.

Stand: `tsc --noEmit` sauber, 70 Tests grün.

---
## Compile-Fehler: `onState` und `error` schliessen sich in Coil gegenseitig aus

Mein eigener Fehler beim Umbau von `CatalogScreen.kt` auf den
Rückfall-Mechanismus: Coils `AsyncImage` hat zwei **getrennte**
Überladungsfamilien — eine mit `error`/`placeholder`/`fallback`/`onError` (für
einen Platzhalter-Painter), eine mit `transform`/`onState` (für den vollen
Zustand). Mit `imageLoader` **und** `error` gesetzt blieb nur die
Painter-Familie übrig — die kennt kein `onState`.

`CatalogSetCard` war die einzige der fünf umgestellten Kacheln mit einem
Logo-Platzhalter (`error = painterResource(...)`); die anderen vier
(`GalleryScreen`, `PartsScreen` ×2, `MinifigsScreen` ×2) setzen kein `error`
und durften deshalb bei `onState` bleiben — nur dort war es falsch.

**Behoben:** `onError = { onThumbError() }` statt `onState { if (… is Error) … }`
— derselbe Zweck, aber der zur Painter-Familie passende Parametername.

**Test.** Verlangt, dass `CatalogSetCard` `error` und `onError` zusammen
benutzt, kein `onState` mehr enthält, während die anderen vier Kacheln
weiterhin `onState` verwenden.

Beim Schreiben dieses Tests ist mir wieder ein unpaariges Klammerzeichen in
einem Such-String begegnet (`"onState = { st ->"` — genau der abgesuchte
Textausschnitt braucht diese offene Klammer, unvermeidbar). Anstatt den
String zu verbiegen, habe ich meine eigene Klammerprüfung robuster gemacht:
Sie entfernt jetzt Zeichenketten und Kommentare, bevor sie zählt, und bestätigt
für alle fünf heute geänderten Dateien ein sauberes Ergebnis.

Stand: Android ungeprüft wie immer, aber jetzt mit einer klammerbewussten statt
naiven Prüfung nachverfolgt.

---
## Fix: `duplicate key value violates unique constraint "parts_summary_pkey"`

**Ursache: Cluster-Modus.** Der Server läuft in Produktion mit mehreren
Worker-Prozessen (`server.ts`, `cluster.fork()`). Der bestehende Schutz gegen
doppelte Neuaufbauten — eine `_rebuilding`-Map — lebt **im Speicher eines
einzelnen Node-Prozesses** und weiss nichts von den anderen Workern.

Fragen zwei Worker fast gleichzeitig für **denselben Nutzer** an (z. B.
Webapp und Android-App kurz nacheinander, oder mehrere offene Tabs), können
beide unabhängig voneinander einen Neuaufbau starten:

```
Worker A: DELETE FROM parts_summary WHERE user_id=X   (nimmt Zeilensperren)
Worker B: DELETE FROM parts_summary WHERE user_id=X   (blockiert auf A)
Worker A: INSERT … (neue Zeilen) … COMMIT
Worker B: (entblockt) — sieht As neue Zeilen NICHT als Teil seines
          ursprünglichen Scans (sie kamen NACH dessen Beginn hinzu),
          löscht sie also nicht mit
Worker B: INSERT … dieselben Zeilen erneut … → doppelter Primärschlüssel
```

Das ist Standard-Verhalten unter PostgreSQLs READ-COMMITTED-Isolation, kein
Fehler in der Abfrage selbst — die `GROUP BY`-Logik kann für sich genommen
keine Duplikate erzeugen, das Problem entsteht ausschliesslich durch die
zwei nicht koordinierten, gleichzeitigen Transaktionen.

**Behoben:** Eine Datenbank-Sperre statt einer Speicher-Sperre —
`pg_try_advisory_xact_lock(77, userId)`, transaktionsgebunden, automatisch
freigegeben bei COMMIT/ROLLBACK, prozessübergreifend wirksam (dasselbe
Muster wie bereits in `jobs/partsCatalogEnrich.ts`, `server.ts`,
`routes/brickset.ts` — Namensraum 77, um mit deren 42 / 99999999 / 11223344
nicht zu kollidieren). Bekommt ein Worker die Sperre nicht (ein anderer baut
gerade für denselben Nutzer), bricht er sauber ab — kein Fehler, kein
Retry nötig, das Ergebnis des anderen Workers gilt gleich mit.

Nachgestellt: zwei parallele `rebuild()`-Aufrufe für denselben Nutzer,
genau das Szenario zweier Cluster-Worker:

```
Aufruf 1 : fulfilled
Aufruf 2 : fulfilled
Zeilen in parts_summary: 50   (korrekt, kein Fehler)
```

**Test.** Verlangt, dass die Sperre prozessübergreifend ist (nicht die
In-Memory-Map), dass ohne sie abgebrochen wird, und dass sie **vor** dem
DELETE erworben wird — sonst wäre sie wirkungslos.

Stand: `tsc --noEmit` sauber, 43 Tests grün, Paritätssuite 32/32.

---
## Dein Logcat zeigt einen blinden Fleck — nicht das eigentliche Problem

Danke für das Log. Es zeigt jede API-Anfrage (`/api/v1/sets`, `/stats`,
`/settings`) sauber protokolliert — aber **keine einzige Bildanfrage**. Das
liesse sich als „es werden gar keine Bilder angefragt" lesen, wäre aber die
falsche Schlussfolgerung.

**Der Grund:** Der HTTP-Logging-Interceptor hing nur am API-Client:

```kotlin
if (isApiClient && BuildConfig.DEBUG) {
    addInterceptor(HttpLoggingInterceptor()...)
}
```

Der Bild-Client (`isApiClient = false`, von Coil für Galerie, Teile,
Minifiguren, Katalog benutzt) hatte **nie** einen Logging-Interceptor — mit
oder ohne meine Fixes der letzten Runden. Das Fehlen von Bildanfragen im Log
ist also keine Erkenntnis über das eigentliche Problem, sondern eine Lücke in
der Beobachtbarkeit selbst. Ohne diese Lücke zu schliessen, hätte auch ein
zehntes Logcat nichts über Bilder verraten.

**Behoben:** Beide Clients protokollieren jetzt im Debug-Build gleichermassen.
`isApiClient` bleibt für seinen ursprünglichen Zweck erhalten (die
`localhost:3000`-Umschreibung auf die echte Server-Adresse) — nur die
Protokollierung war unnötig daran gekoppelt.

**Das behebt das Bildproblem nicht** — es macht es nur sichtbar. Magst du
dasselbe Logcat noch einmal aufnehmen (App schliessen, neu öffnen, Galerie
öffnen), sollte darin jetzt auch stehen, was mit den Bildanfragen tatsächlich
passiert: ob sie überhaupt gestellt werden, an welche Adresse, und mit
welchem Ergebnis. Das ist die Information, die ich für den nächsten Schritt
brauche, statt weiter zu raten.

**Test.** Verlangt, dass beide Clients im Debug-Build protokollieren und dass
`isApiClient` für die URL-Umschreibung erhalten bleibt.

Stand: Android ungeprüft wie immer, alle drei Testprüfungen gegen den
tatsächlichen Code nachgerechnet.

---
