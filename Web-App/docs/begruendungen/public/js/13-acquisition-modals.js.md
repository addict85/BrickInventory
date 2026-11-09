# Begründungen zu `public/js/13-acquisition-modals.js`

Die ausführlichen Kommentare aus `public/js/13-acquisition-modals.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="diese-708-zeilen-standen-in-js-07-admin"></a>
## Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt

```text
═══ Kaufpreis-Modal und Detailfenster für manuelle Einträge ════════════════

── Warum eigene Datei ────────────────────────────────────────

Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt
„Confirm-Dialog, Config-Export/Import, API-Tokens, Job-Status" nennt. Keines
der beiden Fenster hier ist Administration: Das eine erfasst Kaufpreise zu
einem Set, das andere zeigt Details zu manuell erfassten Teilen und
Minifiguren. Sie lagen dort, weil 07-admin.js über die Zeit die Datei war, in
die Neues fiel — 1492 Zeilen, benannt nach ihrer Geschichte.

Die Schnittstelle ist schmal und war es schon vorher: Drei Helfer kommen aus
07-admin.js herüber (confirmDelete, renderMarketRows, priceChartSVG), und
hinaus geht renderAcquisitionSummary. Genau das machte den Schnitt möglich,
ohne irgendetwas umzubauen.
```

<a id="acq-modal"></a>
## `acq-modal`

```text
HINWEIS: Hier stand eine ZWEITE, kürzere Fassung von closeAcqModal().
Als klassisches Skript war die doppelte Deklaration erlaubt — die spätere
(weiter unten, mit der vollständigen Rückkehr-Logik für _acqManItem UND
_acqModalSn) hat sie stillschweigend überschrieben. Die kurze Fassung war
also seit jeher toter Code und ist entfernt; im ES-Modul wäre sie ohnehin
ein harter Fehler ("Duplicate top-level function declarations").
```

<a id="eigentuemerwechsel-verschieben-genau-die"></a>
## Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.

```text
Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.
KEIN from_user_id: Den Absender ermittelt der Server aus der Zeile
selbst (acquisitionMoveSource). Hier stand der BETRACHTER — für die
Zeile eines Unterkontos suchte der Server sie damit unter dem falschen
Konto und antwortete 404, obwohl das Select den richtigen Eigentümer
längst anzeigte.
```

<a id="loadgallery"></a>
## `loadGallery`

```text
Kennzahlen, Galerie und Finanzen mitziehen.

Vorher aktualisierte diese Funktion nur die beiden Dialoge. Kaufpreis und
Menge einer Erfassung wirken aber auf die Galerie-Kachel (Preis-Badge) und
auf die Finanzauswertung — beide blieben auf dem alten Stand, bis der Reiter
neu geladen wurde. Dieselbe Ursache wie bei manQtySave() und in der
Android-App bei updateAcquisition().
restore wie beim Eigentümerwechsel: Auch ein Preis- oder Mengenwechsel im
Dialog darf die gescrollte Tiefe nicht kosten.
```
