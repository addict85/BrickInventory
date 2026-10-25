# Begründungen zu `utils/bricklinkLink.ts`

Die ausführlichen Kommentare aus `utils/bricklinkLink.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
BrickLink-Katalog-Links für Set-Nummern.

── Das Problem ─────────────────────────────────────────────────────────────
Der Katalog steht auf Rebrickable-Daten (rb_sets.set_num, Format "75192-1").
Die Detailansicht hat daraus bisher direkt einen Link gebaut:

    catalogitem.page?S=75192-1#T=S

Für echte Sets stimmt das — Rebrickable und BrickLink verwenden dort
dieselbe Nummer. Falsch wird es bei allem, was BrickLink NICHT als Set
führt: Gear, Bücher und Nicht-Katalogware. Dort ist sowohl der Parameter
falsch (S= statt G= bzw. B=) als auch die Nummer, weil BrickLink bei diesen
Typen keinen "-1"-Suffix vergibt. Der Link landete auf "item not found".

── Woher die richtige Information kommt ────────────────────────────────────
Nicht von Rebrickable: deren API führt external_ids ausschliesslich bei
PARTS (Changelog 2017-09-14), nicht bei Sets, und die CSV-Downloads haben
überhaupt keine BrickLink-Spalte. Es gibt also weder einzeln noch gebündelt
einen Weg, Rebrickable nach der BL-ID eines Sets zu fragen.

Die Information liegt bereits lokal: clients/bricklink.ts ermittelt beim
Preisabruf per Fallback-Kette (set → gear → book) den tatsächlichen Typ und
schreibt ihn nach catalog_cache.bl_type. Diese Tabelle ist die Quelle hier.

── Warum "bulked" hier Datenbank heisst, nicht API ─────────────────────────
Die BrickLink-Store-API hat keinen Sammelendpunkt für Katalogartikel — nur
GET /items/{type}/{no}, einzeln, bei ~1 Anfrage/Sekunde Drosselung. Ein
"gebündelter Abruf" gegen BrickLink existiert schlicht nicht.
Bündelbar ist dafür der Teil, der die Latenz verursacht: resolveMany() löst
eine ganze Katalogseite mit EINER SQL-Abfrage auf, ganz ohne API-Aufruf.
Nur wirklich unbekannte Nummern gehen einzeln und im Hintergrund an
BrickLink (siehe jobs/blTypeBackfill.js).
```

<a id="withvariant"></a>
## `withVariant`

```text
── Die Schreibweise kommt aus utils/setNummer.ts ───────────────────────────

Hier stand sie eigenstaendig, mit einer DRITTEN Fassung des Tests:
`/-\d+$/.test(n)` statt `includes('-')`. Sie ist mir beim Zusammenfuehren der
24 anderen Fundstellen durchgerutscht, weil meine Suche nur nach
`.includes('-') ?` sah — die Regel dort ist jetzt weiter gefasst.

Die beiden Fassungen stimmen auf jeder echten Nummer ueberein und gehen erst
bei einem Bindestrich OHNE Ziffernanhang auseinander:

    Eingabe     includes('-')   /-\d+$/
    10179       10179-1         10179-1
    fig-000123  fig-000123      fig-000123
    10179-a     10179-a         10179-a-1   <- verschieden

NACHGESEHEN im gemeinsamen Pruefkorpus (shared/setnummer-korpus.json): keine
einzige Nummer dieser Art. Deshalb gilt hier ab jetzt dieselbe Fassung wie
ueberall sonst.
```

<a id="searchurl"></a>
## `searchUrl`

```text
Rückfallebene, wenn der Artikel nicht eindeutig bestimmbar ist.

Der wichtigste Fall sind Sammelminifiguren: Rebrickable führt sie als Sets
(71021-1), BrickLink als eigenen Item-Typ MINIFIG mit einer völlig anderen
Nummer (col325). Diese Zuordnung gibt es in keiner der beiden Datenquellen —
Rebrickable hat external_ids nur bei Parts. Ein Deep-Link ist hier also
grundsätzlich nicht konstruierbar, eine Suche schon.
```

<a id="resolveviaapi"></a>
## `resolveViaApi`

```text
Auflösung eines noch unbekannten Typs gegen die BrickLink-API und Ablage in
catalog_cache. Bewusst dieselbe Fallback-Kette wie beim Preisabruf in
clients/bricklink.ts (set → gear → book → NONE), nur über /items statt
/items/.../price — das ist die günstigere Abfrage, wenn nur der Typ zählt.

Wird ausschliesslich für EINZELNE, tatsächlich geöffnete Detailseiten
aufgerufen, nie für Listen: Bei ~1 erlaubten Anfrage/Sekunde wäre ein
Durchlauf über den gesamten Katalog (>27'000 Sets) mehr als sieben Stunden
Dauerlast — und die grosse Mehrheit davon ist ohnehin ein gewöhnliches Set.
Das Ergebnis wird dauerhaft gecacht, jede Nummer kostet also genau einmal.
```
