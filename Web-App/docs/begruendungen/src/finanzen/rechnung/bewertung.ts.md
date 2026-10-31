# Begründungen zu `src/finanzen/rechnung/bewertung.ts`

Die ausführlichen Kommentare aus `src/finanzen/rechnung/bewertung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="loadmanualacquisitions"></a>
## `loadManualAcquisitions`

```text
Erfassungen manueller Teile bzw. Minifiguren, gruppiert nach Eintrag.

Eine Abfrage für den ganzen Bestand statt einer je Kachel — dasselbe Muster
wie applyManualCondition() in utils/handlers.ts.

@param {'part'|'fig'} kind
@returns Map key → Erfassungszeilen; key ist `nummer|farbe` bzw. `nummer`
```

<a id="computesetsvaluation"></a>
## Abschnitt

```text
Kaufpreis und Zustand stehen seit Migration 0032 NUR in den Erfassungen
(set_acquisitions), eine Zeile je Kauf. Der frühere Rückfall auf
s.purchase_price/s.condition ist weg: Die Migration hat für jede
Set-Zeile eine Erfassung nachgetragen und prüft das auch nach, und alle
drei Schreibwege (Erfassen, Mengenänderung, Verschieben) legen die
Erfassung in derselben Transaktion an. Ein Set ohne Erfassung kann es
also nicht mehr geben.
Name, Jahr und Bilder stehen seit Migration 0033 in set_catalog —
deshalb der ausgeschriebene JOIN.
Die Menge aus den Erfassungen (Migration 0036 hat s.quantity geloescht).
```

<a id="computesetsvaluation-fallbackcond"></a>
## `fallbackCond`

```text
── Preise NUR für die tatsächlich vorkommenden Zustände holen ───────────

Vorher wurde je Set genau ein Preis geholt, für den einen Zustand, den
effectiveCondition() ausgerechnet hat. Ein gemischtes Set braucht beide.
Ein reines Neu- oder Gebraucht-Set holt weiterhin nur einen Preis — die
Zahl der BrickLink-Abrufe steigt also ausschliesslich für gemischte Sets.
effectiveCondition() wertet nur noch acq_count/used_count aus; diese
Abfrage liefert sie nicht mit, also kommt hier 'N' heraus. Das zählt
ausschliesslich für ein Set ohne Erfassungen, und das gibt es seit
Migration 0032 nicht mehr (siehe Kommentar an der Abfrage oben).
```

<a id="computeminifigsvaluation-manualfigs"></a>
## `manualFigs`

```text
Kein defaultCondition mehr: Es stand hier ausschliesslich fuer den
Rueckfall, den effectiveCondition() jetzt richtig macht. Der Compiler hat
das gemeldet, sobald der Rueckfall weg war — ein Wert, den niemand mehr
liest, ist der beste Beleg dafuer, dass er nur den Fehler getragen hat.
── Spalten ausgeschrieben, kein SELECT * ───────────────────────────────

Name und Bild kommen seit Migration 0034 aus minifigs_catalog. Ein Stern
haette sie stillschweigend verloren — genau so ist der Lagerort einmal
aus der Set-Detailansicht verschwunden (siehe handlers/sets.ts).
```

<a id="computeminifigsvaluation-conds"></a>
## `conds`

```text
Der Zustand des STUECKS, nicht der Preisabfrage.

── Der Fehler, der hier stand ──────────────────────────────────────────
    const stored = (fig.condition === 'U') ? 'U' : defaultCondition;
mit defaultCondition = DEFAULT_PRICE_CONDITION, und das ist fest 'U'.
BEIDE Zweige ergaben also 'U' — eine Fallunterscheidung, die keine war.

NACHGEMESSEN mit drei manuell erfassten Teilen, alle als „Neu"
gespeichert, eines mit einer Gebraucht-Erfassung:
    /api/v1/parts/manual        3001:U  3002:N  3003:N   (richtig)
    /api/v1/finance/parts-valuation  3001:U  3002:U  3003:U
Die Android-App nimmt ihre Liste der manuellen Teile aus der BEWERTUNG
(PartsScreen.kt: financeState.partsValuation?.parts). Sie zeigte damit
„Gebraucht" an jedem Stueck ohne Kaufpreis-Erfassung — waehrend die
Webapp am selben Stueck „Neu" zeigte — und holte den Marktpreis als
Gebrauchtpreis.

── Kein gespeicherter Zustand mehr ──────────────────────────────────

Hier stand effectiveCondition(fig) und wurde als Rueckfall
weitergegeben. Beide Wege lesen seit Migration 0035 nur noch die
Erfassungen, und fuer jede manuelle Position garantiert die Migration
eine. Ohne Erfassung gilt „Neu“ — dieselbe Regel wie in
conditionFromAcquisitions() (src/bestand/gemeinsam.ts).
```

<a id="computeminifigsvaluation"></a>
## Abschnitt

```text
Keine BrickLink-Nummer hinterlegt: Marktpreis aus den einzelnen
BrickLink-Teilepreisen der Minifigur schätzen (Rebrickable→BrickLink-
Zuordnung existiert zuverlässig für Teile, nicht für Minifiguren).

JE ZUSTAND: Die Teilepreise werden im Zustand DIESER Erfassung
geholt. Vorher lief die Schätzung fest im Standardzustand und galt
für beide — eine gebraucht erfasste Figur bekam den Neupreis ihrer
Teile, und zwei Zeilen mit verschiedenen Zuständen zeigten
denselben Marktpreis.
Frueher ein spaetes require('../routes/minifigs') — noetig, weil ein
Top-Level-Import auf eine ROUTE hier einen Zyklus ergeben haette.
Seit die Schaetzung in src/finanzen/marketPrice.ts steht, ist der Umweg weg.
```

<a id="computeminifigsvaluation-hascost"></a>
## `hasCost`

```text
── Kaufpreis: aus den Erfassungen, 0 wenn keiner bekannt ────────────

Hier stand acqPurchase != null || fig.purchase_price != null mit dem
Vermerk „0 zählt als erfasst“. Die Spalte purchase_price war der
ANZEIGEWERT der Stammzeile und nie NULL (src/finanzen/preisRegel.ts: der
eingegebene Preis, sonst der Marktpreis, sonst 0) — hasCost war damit
fuer jede manuelle Position wahr.

Genau das bleibt, nur ohne zweite Spalte: Migration 0035 garantiert
eine Erfassung, also ist hasCost weiter wahr, und der Anzeigewert wird
hier gebildet statt gespeichert.
```

<a id="computepartsvaluation-conds"></a>
## `conds`

```text
Der Zustand des STUECKS, nicht der Preisabfrage.

── Der Fehler, der hier stand ──────────────────────────────────────────
    const stored = (part.condition === 'U') ? 'U' : defaultCondition;
mit defaultCondition = DEFAULT_PRICE_CONDITION, und das ist fest 'U'.
BEIDE Zweige ergaben also 'U' — eine Fallunterscheidung, die keine war.

NACHGEMESSEN mit drei manuell erfassten Teilen, alle als „Neu"
gespeichert, eines mit einer Gebraucht-Erfassung:
    /api/v1/parts/manual        3001:U  3002:N  3003:N   (richtig)
    /api/v1/finance/parts-valuation  3001:U  3002:U  3003:U
Die Android-App nimmt ihre Liste der manuellen Teile aus der BEWERTUNG
(PartsScreen.kt: financeState.partsValuation?.parts). Sie zeigte damit
„Gebraucht" an jedem Stueck ohne Kaufpreis-Erfassung — waehrend die
Webapp am selben Stueck „Neu" zeigte — und holte den Marktpreis als
Gebrauchtpreis.

── Kein gespeicherter Zustand mehr ──────────────────────────────────

Hier stand effectiveCondition(part) und wurde als Rueckfall
weitergegeben. Beide Wege lesen seit Migration 0035 nur noch die
Erfassungen, und fuer jede manuelle Position garantiert die Migration
eine. Ohne Erfassung gilt „Neu“ — dieselbe Regel wie in
conditionFromAcquisitions() (src/bestand/gemeinsam.ts).
```

<a id="computepartsvaluation"></a>
## Abschnitt

```text
user_id gehoert in die Antwort, obwohl die Kachel keine Kontonummer
zeigt: withOwnerNames() weiter unten macht daraus `owners`, und ohne
das Feld tut es gar nichts (`r.user_id == null` -> Zeile unveraendert).

NACHGEMESSEN in einem Haushalt aus zwei Konten:
  Figuren-Bewertung: user_id 2/3, owners gesetzt
  Teile-Bewertung:   weder das eine noch das andere
Die Android-App zeichnet auf der manuellen Teile-Kachel
OwnerBadges(part.owners) — die Plakette blieb dort immer leer, waehrend
sie auf der Figuren-Kachel erschien. Die Absicht stand im Code, der
Wert kam nie an.
```

<a id="computepartsvaluation-2"></a>
## Abschnitt

```text
`condition` faellt aus der Huelle weg.

Es trug die PREIS-Vorgabe ('U'), stand aber direkt neben dem `condition`
JE STUECK, das den Zustand des Stuecks meint — genau die Verwechslung, aus
der der Fehler oben entstanden ist. NACHGESEHEN, wer es liest: die Webapp
nicht (04-finance.js und 06-minifigs.js nehmen nur `parts` und
`total_value`), die App nicht (PartsValuationResponse kennt das Feld gar
nicht). Die Figuren-Bewertung hat es noch nie zurueckgegeben — beide sind
damit gleich geformt.

Die SETS-Bewertung behaelt ihres: ValuationResponse der App deklariert es.
```
