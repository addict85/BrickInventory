# Begründungen zu `routes/minifigs.ts`

Die ausführlichen Kommentare aus `routes/minifigs.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
── Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts ──

Marcos Vorgabe (Nachtrag 70): „Können die beiden Apps nicht die gleichen APIs
nutzen (mit unterschiedlichen Authentifizierungsarten), damit die Logik nur
einmal implementiert werden muss und das Verhalten immer gleich ist?"

Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
den Token der App. Aus dieser Doppelung stammen nachweislich sechs der
letzten Fehlermeldungen — Kaufpreis, Menge, Löschen, Erfassungen im Haushalt,
Preisauffüllung, und zuletzt zwei verschiedene Marktpreise für denselben
Vorgang (18.90 gegen 12.55).

Möglich wurde der Schnitt, weil requireToken in routes/api_v1/middleware.ts
BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER Bearer-Token. Es brauchte
also keine neue Schicht, nur das Entfernen der Zweitfassung. Die Webapp ruft
jetzt /api/v1/... — dieselbe Adresse wie die App.
```

<a id="router"></a>
## `router`

```text
── Zusammengelegt mit der v1-Fabrik (Nachtrag 72) ──────────────────────────

Fünf Routen standen hier doppelt — GET /, GET /manual, POST /, PUT und
DELETE /:figNumber — je einmal für die Sitzung der Webapp und einmal in
routes/api_v1/minifigs.ts für den Token der App. Sie sind entfernt; beide
Clients rufen jetzt /api/v1/minifigs/…, weil requireToken BEIDE Ausweise
akzeptiert (Sitzungs-Cookie ODER Bearer-Token).

Vor dem Entfernen wurden alle fünf Paare gegeneinander gemessen (Antwort UND
Wirkung auf die Datenbank) — sie waren identisch.

HIER GEBLIEBEN sind /stats, /export/csv und /import/csv: Die gibt es nur an
einem Ort, sie können also gar nicht auseinanderlaufen. Sie zu verschieben
wäre Umzug ohne Gewinn.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Fällt keine BrickLink-Minifigur-Nummer vor, wird der Marktpreis stattdessen
aus den einzelnen BrickLink-Teilepreisen der Minifigur zusammengesetzt
(Rebrickable liefert die Teile-Zusammensetzung + für Teile existiert eine
zuverlässige Rebrickable→BrickLink-Zuordnung, anders als bei Minifiguren).

── Der Zustand geht mit ────────────────────────────────────────────────────
Die Schätzung lief bisher fest mit DEFAULT_PRICE_CONDITION und lieferte
damit EINEN Wert, egal ob die Figur neu oder gebraucht geführt wird. Für
Figuren MIT BrickLink-Nummer war der Zustand längst berücksichtigt — genau
die ohne Nummer, also der Fall, in dem diese Funktion überhaupt greift,
fielen durch. Eine gebraucht erfasste Figur bekam den Neupreis ihrer Teile.

Die Teilepreise selbst kennen den Zustand (fetchPartPrice fragt BrickLink je
Zustand ab und fällt bei leerem Price Guide auf den anderen zurück) — er
muss nur durchgereicht werden.

@param {'N'|'U'} condition Zustand, in dem die Teile bepreist werden.
```

<a id="resolvemanualfigpurchase"></a>
## `resolveManualFigPurchase`

```text
Shared logic to add/update a single manual minifig. Used by both the
session-based web route (POST /api/minifigs) and the token-based API
(POST /api/v1/minifigs), so the behaviour is implemented exactly once.

"Preis/Stk" (unit_price) doubles as the Kaufpreis baseline: if the user
enters a price it is used as both the current value override AND the
purchase-price baseline for the G&V calculation; if left empty, the
current BrickLink market price is used for both.
Gemeinsame Preis-/Zustandsableitung für manuelle Minifiguren — identisch
beim Einzel-Hinzufügen (addManualFig) und beim CSV-Import:
 • Preis: eingegebener Preis/Stk, sonst aktueller Marktpreis. Ist die Figur
   bei BrickLink nicht (gültig) auffindbar, wird der Preis über die
   Einzelteile geschätzt (getCurrentFigMarketPrice → estimateFigPriceFromParts).
 • Zustand: N/U falls angegeben, sonst der Standard-Zustand des Nutzers.
```

<a id="addmanualfigintern"></a>
## Abschnitt

```text
Preis und Zustand nicht mehr an die Bestandszeile (Migration 0035) — sie
stehen in der Erfassung, die recordAcquisitionForDay() gleich darunter
anlegt.
Menge 0: Sie entsteht aus der Erfassung, die recordAcquisitionForDay()
weiter unten anlegt (utils/bestandsmenge.ts).
Ohne bl_fig_number: Die BrickLink-Nummer steht seit Migration 0037 in
bl_zuordnung, einmal je Figur und ohne Konto. Eingegeben wird sie
weiterhin hier — sie landet nur woanders.
Ohne Menge — siehe addManualPart in routes/parts.ts (Migration 0038).
```

<a id="updatemanualfig"></a>
## Abschnitt

```text
acqs.length === 0 wird MIT abgedeckt.

Vorher lautete die Bedingung `delta > 0 && acqs.length > 0`: Ohne eine
einzige bestehende Erfassung passierte beim Erhöhen gar nichts — die
Menge stieg, die Erfassungsliste blieb leer. Heute legen zwar alle
Anlagepfade eine erste Zeile an, sodass der Fall selten ist; er tritt
aber bei Altbeständen aus der Zeit davor auf, und dann fehlt jede
Rückmeldung. Ohne bestehende Erfassung ist eine neue anzulegen genau
das Richtige — derselbe Zweig wie "neueste Erfassung ist nicht von
heute".
```

<a id="updatemanualfig-cond"></a>
## `cond`

```text
Aufstocken der heutigen Zeile ODER eine neue anlegen — beides
erledigt recordAcquisitionForDay (utils/acquisitions.ts). Die
Tagesprüfung stand hier von Hand und galt nur an dieser Stelle.

existing.bl_fig_number statt newBlNum: newBlNum wird erst NACH
diesem Block per let deklariert — der Zugriff hier lief in die
Temporal Dead Zone (ReferenceError, vom try verschluckt), sodass
die Delta-Erfassung stillschweigend ausblieb.
── Zustand ZUERST bestimmen, dann den Preis dazu holen (Nachtrag 147) ──

Marcos Befund: Zwei heute erfasste Einträge derselben Figur, einer
„Neu", einer „Gebraucht" — beide Kaufpreise CHF 2.18, obwohl die
Marktpreise 2.18 (Neu) und 2.20 (Gebraucht) sind.

Der Preis wurde hier OHNE Zustand geholt; der Zustand entstand erst
zwei Zeilen darunter. getCurrentFigMarketPrice() leitet dann einen
Zustand aus den vorhandenen Erfassungen ab — beim Anlegen der
zweiten Zeile gab es aber nur die erste, also kam deren Preis heraus.

Nachtrag 146 hat dasselbe für das BEARBEITEN behoben. Das ERFASSEN
hatte ich dabei übersehen; es sind zwei getrennte Wege.
Beim Erfassen gibt es keine Zustandseingabe — dieselbe Staffelung wie
beim Bearbeiten, nur ohne den ersten Schritt (utils/settings.ts).
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
── Warum das Datum hier eine eigene Geschichte hat ──────────────────

parseCsvDate statt roher Zeichenkette (siehe test/csv-date.test.js):
Postgres liest bei DateStyle MDY "01.02.2026" als 2. Januar, nicht als
1. Februar — stillschweigend, ohne Fehler. Ab Tag 13 bricht es ab und
die Erfassung geht verloren.

Der Fehler war bekannt und fuer Sets und Teile behoben; DIESER dritte
Aufrufer hat die Behebung nie bekommen. Seit Nachtrag 144 liest die
Zeile darueber alle fuenf Felder aus csvGemeinsameFelder — es gibt
keinen dritten Aufrufer mehr, der etwas verpassen koennte.
```
