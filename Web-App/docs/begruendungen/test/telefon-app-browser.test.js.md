# Begründungen zu `test/telefon-app-browser.test.js`

Die ausführlichen Kommentare aus `test/telefon-app-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die App am Telefon (390 × 844, mobile) — gemessen in Chrome am echten
Server mit den echten Stylesheets.

  - Erster Tab-Halt (Dokumentreihenfolge) ist der Sprunglink „Zum Inhalt“, mit Fokus sichtbar;
    Enter setzt den Fokus auf <main>. Je Reiter ist genau eine h1 sichtbar
    (der Seitentitel; vorher war die einzige h1 der Markenname).
  - In jedem Reiter ist jedes sichtbare Bedienelement mindestens 44 × 44 px
    und jeder Text mindestens 12 px groß.
  - Teile und Minifiguren: Am Telefon nennt „Sammlung“ in der Leiste die
    offene Ansicht („Teile“); am Rechner wie am Telefon wechselt der
    Umschalter auf der Seite, die Leiste hat nur „Sammlung“.
  - Teile: ein Raster; jede Farbe beginnt mit einer Überschrift über die
    volle Breite (seit 30.10., UX-Prüfung), ihre Teile stehen darunter in
    einer Reihe; die Filter liegen hinter dem Knopf „Filter“ und sind
    geöffnet gleich breit.
  - Merkliste: Nummer, Zustand, „Auf die Merkliste“ und CSV sind gleich
    hoch und stehen am Rechner auf einer Linie.
  - Set-Detail: „Löschen“ steht hinter „Weitere Aktionen“; die Felder des
    Preisalarms stehen unter der Beschriftung über (fast) die volle Breite,
    Zustand und Richtung in einer Zeile, der Preis mit sichtbarer
    Beschriftung „Grenzpreis“ in der zweiten, jedes mindestens 44 px hoch.
  - Während die Teile laden, steht ein Skelett aus zwölf Kacheln
    (role="status") da; Dialoge und Reiter blenden ein, ausser bei
    prefers-reduced-motion: reduce.
  - Einstellungen: Es steht genau ein Abschnitt da, die Leiste darüber in
    einer Zeile ohne die Seite zu verbreitern; ein Klick wechselt ihn, und
    die Wahl bleibt im Browser.
  - Diagramme: Jede Beschriftung im Wertdiagramm (Finanzen) und im
    Preisverlauf (Set-Ansicht) ist mindestens 11 px groß, und jedes
    Diagramm hat role="img" mit einer Zusammenfassung als aria-label.

Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
Voraussetzung: Test-DB via TEST_DATABASE_URL.
```
