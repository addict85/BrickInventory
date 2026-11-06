# Begründungen zu `src/verwaltung/datenexport.ts`

Die ausführlichen Kommentare aus `src/verwaltung/datenexport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="get-export-data"></a>
## Abschnitt

```text
merkliste.csv kam dazu (Marcos Liste, Stueck 1): „Merklisten sollen
ebenfalls analog den anderen Seiten exportiert und importiert werden."
Im SELBEN Archiv und nicht als eigene Route — die drei einzelnen
/export/csv-Routen sind in diesem Baum ausdruecklich ENTFERNT worden
(„Kein Aufrufer; die Webapp exportiert ueber /api/settings/export/data",
siehe routes/parts.ts und routes/minifigs.ts). Eine neue einzelne Route
hiesse, diese Entscheidung rueckgaengig zu machen.
preisalarme.csv kam dazu (Marcos Liste, Stueck 2): „Preisalarme sollen in
den bestehenden Exporten und Importen ergaenzt werden (in allen)."

In ALLEN heisst hier: in diesem Archiv. Die beiden anderen Exporte des
Baums koennen sie nicht tragen, und das ist kein Versaeumnis:

  * /api/v1/settings/export ist die KONFIGURATION (Schluessel, Grenzen,
    Job-Zeiten). Ein Preisalarm ist eine Angabe ueber ein Set, kein
    Einstellungswert — er stuende dort als zweite Wahrheit neben dieser
    Datei, und der Import dort arbeitet mit einer Whitelist von
    Schluesselnamen, in die eine Tabelle nicht passt.
  * /api/v1/sets/export/rebrickable schreibt das Listenformat einer
    FREMDEN Firma („Set Number,Quantity"). Eine zusaetzliche Spalte
    macht die Datei bei Rebrickable unbrauchbar.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Hier stand `await db.run('DELETE FROM price_cache')` ────────────────

Ohne Admin-Prüfung, denn der Router trägt nur requireLogin. Jedes Konto —
auch ein Unterkonto im Haushalt — konnte damit eine Ein-Zeilen-Datei
({"user_settings":{"currency":"CHF"}}) hochladen und den Preis-Cache der
GANZEN Installation leeren. Beliebig oft. Der nächste Bewertungslauf holt
dann alle Preise neu bei BrickLink, und deren Tageskontingent ist endlich.

Genau diese Lücke ist in routes/finance.ts schon einmal geschlossen
worden (POST /refresh trägt seitdem requireAdmin, mit einer Notiz über
das verbrannte Kontingent). Dieser Weg wurde übersehen — er sieht ja
auch nicht nach „Cache leeren" aus.

Ersatzlos gestrichen statt hinter isAdmin geschoben: price_cache ist über
set_number, condition UND currency_code verschlüsselt. Einträge in der
alten Währung stören nicht, sie passen einfach nicht mehr auf die
Abfrage, und für die neue Währung wird ohnehin frisch geholt. Das Leeren
war also von Anfang an ohne Wirkung auf die Richtigkeit — nur mit einer
auf das Kontingent. Wer den Cache wirklich leeren will, hat dafür
POST /api/finance/refresh (Admin).
```
