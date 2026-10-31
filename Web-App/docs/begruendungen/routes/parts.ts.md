# Begründungen zu `routes/parts.ts`

Die ausführlichen Kommentare aus `routes/parts.ts`, wörtlich. Im Code steht je
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
── Zusammengelegt mit der v1-Fabrik (Nachtrag 73) ──────────────────────────

Neun Routen standen hier doppelt — Liste, manuelle Liste, Farben, Statistik,
BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen — je einmal für
die Sitzung der Webapp und einmal in routes/api_v1/parts.ts für den Token der
App. Sie sind entfernt; beide Clients rufen jetzt /api/v1/parts/…, weil
requireToken BEIDE Ausweise akzeptiert.

Vor dem Entfernen wurden ALLE Paare gegeneinander gemessen — Antwort UND
vollständiger Datenbankzustand, lesend wie schreibend (anlegen, ändern,
löschen, Haushaltskonto, Fehlerfälle). Ergebnis: identisch. Einziger
Unterschied: Die Liste nennt jetzt zusätzlich `page` und `page_size` — und
zwar den TATSÄCHLICH verwendeten Wert statt eines Echos der Anfrage. Das ist
mehr Information, keine andere Auswahl; beide Wege nutzen denselben Handler.

HIER GEBLIEBEN sind /categories, /import/csv und /export/csv: Die gibt es nur
an einem Ort und können nicht auseinanderlaufen.
```

<a id="get-categories-uids"></a>
## `uids`

```text
── Blickfeld statt eigener ID (Nachtrag 134) ─────────────────────────────

Hier stand `angemeldeteNutzerId(req)` — die eigene Konto-ID, ohne
`accounts`. Der ZWILLING dieser Route, /parts/colors, liest das Blickfeld
seit jeher (routes/api_v1/parts.ts:115 → scopeIds + parseScopeMode).

Zwei Filter ueber DERSELBEN Liste mit zwei verschiedenen Blickfeldern: Im
Haushalt zaehlte die Farbliste die Teile aller Konten, die Kategorienliste
nur die eigenen. Wer nach einer Kategorie filterte, bekam eine Liste, die
zu keiner der beiden Zahlen darueber passte.
```

<a id="resolvemanualpartpurchase"></a>
## `resolveManualPartPurchase`

```text
Preis/Stk, Kaufpreis und Zustand fuer ein manuell erfasstes Teil.

── Warum es das jetzt gibt ─────────────────────────────────────────────────
Bei den Minifiguren steht diese Rechnung EINMAL (resolveManualFigPurchase in
routes/minifigs.ts) und hat drei Aufrufer: Anlegen, Bearbeiten, CSV-Import.
Bei den Teilen stand sie an jeder Stelle neu — und die beiden Fassungen im
Anlegen und im CSV-Import sagten zweierlei:

 1. Preis/Stk. Der CSV-Import schrieb den MARKTPREIS in unit_price. Das Feld
    heisst „Preis/Stk" und bedeutet „was der Mensch bezahlt hat"; ohne Angabe
    in der Datei gehoert dort NULL hin, so wie beim Anlegen von Hand. Der
    Nachtrag-Job (jobs/purchasePriceBackfill.ts, backfillFromUnitPrice) liest
    unit_price ausdruecklich als „wurde beim Erfassen eingegeben" — ein
    importiertes Teil behauptete also eine Eingabe, die es nie gab.

 2. Kaufpreis ohne Marktpreis. Beim Anlegen wird bewusst 0 gespeichert statt
    NULL, sonst zeigt das Kaufpreis-Feld dauerhaft den „Marktpreis"-Platz-
    halter (siehe Kommentar unten im Anlegen-Zweig). Der CSV-Import schrieb
    NULL — dasselbe Teil sah je nach Erfassungsweg anders aus.

Beides faellt weg, sobald die Rechnung nur noch an einer Stelle steht.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Shared logic to add/update a single manual part. Used by both the
session-based web route (POST /api/parts) and the token-based API
(POST /api/v1/parts), so the behaviour (incl. Kaufpreis handling) is
implemented exactly once.

"Preis/Stk" (unit_price) doubles as the Kaufpreis baseline: if the user
enters a price it is used as both the current value override AND the
purchase-price baseline for the G&V calculation; if left empty, the
current BrickLink market price is used for both.
rawBody ist `any` — so kommt es von Express, und so nehmen es auch die
Validierer in src/infra/validate.ts entgegen. Der Gewinn liegt bei ihren
RUECKGABEN: V.colorId() gibt number, V.requireItemNumber() gibt string.
Ein `unknown` hier waere strenger, aber jeder Feldzugriff muesste dann
einzeln eingeengt werden, bevor der Validierer ihn ueberhaupt sieht.
```

<a id="addmanualpart"></a>
## `addManualPart`

```text
Ein Teil von Hand erfassen — mit Lagerort, wenn einer mitkommt.

── Warum der Lagerort NACH dem Erfassen geschrieben wird ───────────────────

Marcos Befund vom 24.09.: „Bei den manuell erfassten Teilen kann ich beim
Erfassen keinen Lagerort setzen." Dieselbe Luecke wie beim Set, und dieselbe
Antwort: setzeLagerort() ist die eine Stelle, die die Spalte schreibt —
Laengengrenze, Trimmen und der Eintrag im VORRAT (stelleOrteSicher) haengen
daran. Ein eigenes UPDATE in dieser Funktion waere die zweite Fassung
derselben Regel, und der neu getippte Ort fehlte danach in der Auswahlliste.

Der Rumpf hat zwei Ausgaenge — „added" und „updated" —, deshalb die Huelle:
Beide Wege sollen den Ort setzen, und zwar genau einmal.

GEPRUEFT wird vorher: Ein zu langer Name soll nicht erst das Teil anlegen
und dann absagen.
```

<a id="addmanualpartintern-lokal"></a>
## `lokal`

```text
── Erst der EIGENE Katalog, dann der fremde Dienst ─────────────────────

Hier stand nur der lookupPart()-Aufruf, und das war Marcos Befund vom
20.10.: „Wird jedes Teil bei Rebrickable abgefragt auch wenn es lokal
bereits vorhanden ist?" — ja, wurde es. GEMESSEN am laufenden Server
ging fuer Teil 3001 in Farbe 4 ein Abruf an
rebrickable.com/api/v3/lego/parts/, obwohl Name UND Farbbild im Katalog
standen. lookupPart macht zwei Abrufe (Teil, dann Farbbild), jeder durch
die Hintergrunddrossel mit 1,5 Sekunden Abstand: beim Import einer
Wanted-Liste mit 224 Posten elf Minuten Warten und 448 Abrufe aus dem
Tageskontingent, fuer Daten, die dalagen.

Der Import ist dabei nur der Auffaellige. Die Luecke war in DIESER
Funktion, und sie gilt fuer jeden Weg, der ohne Namen hereinkommt —
auch POST /api/v1/parts. Deshalb steht die Staffelung hier und nicht
in src/merkliste/wantedListe.ts.
```

<a id="addmanualpartintern-recond"></a>
## `reCond`

```text
Menge addieren UND eine Erfassung anlegen.

Vorher endete der Pfad hier: Ein erneut erfasstes Teil bekam keine neue
Zeile in part_acquisitions. Damit fehlte der Kaufpreis der zweiten
Erfassung, und ein abweichendes Erfassungsdatum ging verloren — genau
das gemeldete Verhalten. Der CSV-Import macht an dieser Stelle seit
jeher beides.
Die Menge wird NICHT hier fortgeschrieben: Die Erfassung unten ist die
Wahrheit, und seit Migration 0038 gibt es gar keine Spalte mehr, die
man fortschreiben koennte. Hier stand `quantity = quantity + $1`.
```

<a id="addmanualpartintern"></a>
## Abschnitt

```text
Preis/Stk, Kaufpreis und Zustand: eine Rechnung, eine Stelle
(resolveManualPartPurchase oben) — dieselbe, die der CSV-Import benutzt.

Der Marktpreis wird dort mit dem AUFGELOESTEN Zustand geholt statt mit der
rohen Eingabe. Das ist derselbe Wert: Ohne Eingabe fiel
getCurrentPartMarketPrice bisher intern auf resolvePartCondition zurueck,
und die kennt beim Anlegen noch keine Erfassung — sie lieferte also
ebenfalls den Standardzustand des Kontos. Nur steht die Staffelung jetzt
sichtbar da, statt zweimal auf verschiedenen Wegen berechnet zu werden.
effectiveUnitPrice und effectivePurchasePrice werden hier NICHT mehr
ausgepackt: Sie waren fuer die Bestandszeile, und die traegt seit
Migration 0035 keinen Preis. Der Compiler hat die Stelle gemeldet, sobald
die Spalten weg waren — ein Wert, den niemand mehr liest, ist der beste
Beleg dafuer, dass er nur die Abschrift getragen hat.
```

<a id="addmanualpartintern-2"></a>
## Abschnitt

```text
── Beschreibung in den Katalog, Bestand in parts ───────────────────────

Seit Migration 0034 trennt sich beides: Name, Farbbezeichnung, Farbcode,
Kategorie und Bild gelten fuer ALLE Konten, der Bestand gilt fuer eines.

Der Katalog ZUERST: Faellt die Anfrage zwischen den beiden Anweisungen
aus, steht lieber eine Beschreibung ohne Bestand da (unsichtbar, weil
niemand das Teil hat) als ein Bestand ohne Beschreibung (eine Zeile ohne
Namen in der Teileliste).

Die beiden Upserts stehen in src/katalog/katalogPflege.ts — derselbe Schreiber
wie beim CSV-Import, beim Set-Import und beim Verschieben eines Sets.
```

<a id="addmanualpartintern-3"></a>
## Abschnitt

```text
Gibt es das Teil schon, hat das INSERT oben nichts getan (ON CONFLICT DO
NOTHING) — und das genuegt: Eine zweite Erfassung ist ein Zugang, kein
Fehler, und sie addiert sich von selbst, weil die Stückzahl die SUMME der
Erfassungen ist (Migration 0038). Hier stand dafuer ein eigenes
`UPDATE parts SET quantity = quantity + $1`.
Erfassung anlegen — analog zu Sets (recordAcquisition in routes/sets.ts).

Vorher entstand beim manuellen Anlegen KEINE Zeile in part_acquisitions:
Der Kaufpreis stand nur in der Stammtabelle, und Detailansicht wie
Zustandsregel arbeiten mit den Erfassungen. Ein frisch angelegtes Teil hatte
damit sichtbar keinen Kaufpreis.
```

<a id="updatemanualpart"></a>
## Abschnitt

```text
── Erst die Erfassungen, dann die Menge daraus ────────────────────────

Hier stand `UPDATE parts SET quantity=$1` VOR dem Angleichen der
Erfassungen, und das Angleichen lag in einem try/catch, das seinen
Fehler verschluckte („so a missing table never breaks qty save").
Scheiterte es, standen Menge und Erfassungen dauerhaft verschieden da —
lautlos.

Jetzt ist die Reihenfolge umgekehrt und das Verschlucken weg: Geht das
Angleichen schief, hat sich NICHTS geaendert, und der Fehler wird
gemeldet. Die Spalte schreibt mengeNeuRechnen() danach aus den
Erfassungen (db/bestandsmenge.ts).
```

<a id="updatemanualpart-2"></a>
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

<a id="updatemanualpart-cond"></a>
## `cond`

```text
Aufstocken der heutigen Zeile ODER eine neue anlegen — beides
erledigt recordAcquisitionForDay (src/bestand/acquisitions.ts). Vorher
stand die Tagesprüfung hier von Hand (`isToday_`) und galt nur an
dieser einen Stelle; jetzt gilt sie überall gleich.
Der Preis wird UNTEN geholt — erst muss der Zustand feststehen
(Nachtrag 147, dieselbe Lücke wie bei den Minifiguren).
Zustand der neuen Erfassung folgt dem Teil selbst (bzw. dem
User-Default), nicht hartkodiert 'N' — sonst bekäme ein als
"Gebraucht" geführtes Teil bei jeder Mengen-Erhöhung eine
"Neu"-Erfassung. Der Standard-Zustand kommt aus src/konto/settings.ts;
lazy require wegen des Zyklus parts↔sets.
Beim Erfassen gibt es keine Zustandseingabe — dieselbe Staffelung wie
beim Bearbeiten, nur ohne den ersten Schritt (src/konto/settings.ts).
```

<a id="updatemanualpart-3"></a>
## Abschnitt

```text
── In die NEUESTE Erfassung, nicht an die Bestandszeile ──────────────

Hier stand `UPDATE parts SET unit_price=$1, purchase_price=$2`. Die
beiden Spalten hat Migration 0035 geloescht; der Preis gehoert je Kauf
in die Erfassung. Geaendert wird die neueste — das ist die, die alle
Leseabfragen als „der Preis dieses Teils" anzeigen.

purchasePrice wird gar nicht mehr ausgepackt: Er war der ANZEIGEWERT
(nie NULL, 0 heisst „nichts bekannt"), und den bildet jetzt die
Leseabfrage mit COALESCE(..., 0). In der Erfassung bedeutet 0 „fuer
null Franken gekauft" — deshalb NULLIF.
```

<a id="parts-csv-sql"></a>
## `PARTS_CSV_SQL`

```text
Shared logic to build the Teile CSV export content (manuell erfasst only).
Used by both the standalone CSV download and the combined ZIP export in settings.js.

── EINE Abfrage statt einer je Teil (Nachtrag 134) ──────────────────────────

Hier stand `for (const p of parts) { await db.all(...) }` — bei 2000 manuell
erfassten Teilen also 2001 Abfragen fuer einen Export. Die beiden
ZWILLINGSFUNKTIONEN sind laengst umgestellt: buildFigsCsv (routes/minifigs.ts,
FIGS_CSV_SQL) und buildSetsCsv (src/sets/setService.ts, SETS_CSV_SQL). Ihre
Kommentare beschreiben genau diesen Umbau; die Teile blieben als einzige
zurueck. Wieder eine Regel, die an zwei von drei Stellen gilt.

── Der Rueckfall auf die Stammzeile ist weg ─────────────────────────────────

Hier stand je Spalte ein `CASE WHEN a.id IS NULL THEN p.<spalte>` und
darunter eine zweite, vollstaendige Abfrage fuer den Fall, dass
part_acquisitions ganz fehlt. Beides griff auf p.unit_price und p.condition
zu, und die hat Migration 0035 geloescht.

Gebraucht wird der Rueckfall auch nicht mehr: 0035 traegt fuer jede manuelle
Position eine Erfassung nach und prueft danach nach, dass keine ohne
geblieben ist. Der LEFT JOIN bleibt trotzdem — loescht jemand die letzte
Erfassung, entfernt cleanupWhenEmpty() die Bestandszeile mit, aber ein
Export soll an einer unerwarteten Lage nicht ganz ausfallen.
```

<a id="getpartacquisitions"></a>
## `getPartAcquisitions`

```text
Erfassungen eines Teils — fuer den Kaufpreis-Dialog.

`uid` ist eine LISTE (das Blickfeld, siehe Kommentar unten), nicht eine ID:
Das SQL fragt `user_id = ANY($1)`. Und `colorId` kommt als ZEICHENKETTE
herein — der einzige Aufrufer ist routes/api_v1/acquisitions.ts und reicht
`req.params.colorId` durch, also einen Express-Pfadparameter. Deshalb bleibt
das parseInt hier stehen; es ist tragend, nicht Zierde.
```

<a id="getpartacquisitions-2"></a>
## Abschnitt

```text
uid ist hier das BLICKFELD (Liste): Im Haushalt können die Kaufpreise
eines Teils mehreren Konten gehören, und je Zeile kommt der Eigentümer
mit — sonst wüsste die Auswahl im Dialog nicht, worauf sie steht.
── Kein Rueckfall auf die Stammzeile mehr ──────────────────────────────

Hier stand COALESCE(a.unit_price, p.unit_price, p.purchase_price) und
dazu ein LEFT JOIN auf parts. Beide Spalten hat Migration 0035 geloescht
— und der Rueckfall war ohnehin verkehrt herum: Er liess eine Erfassung
OHNE Preis den Preis der Stammzeile anzeigen, also den der NEUESTEN
Erfassung. Im Kaufpreis-Dialog stand damit an einer leeren Zeile ein
Betrag, der zu einer anderen Zeile gehoert.

Jetzt zeigt die Erfassung, was in ihr steht. Leer heisst leer.
```
