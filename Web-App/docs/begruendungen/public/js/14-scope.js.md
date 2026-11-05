# Begründungen zu `public/js/14-scope.js`

Die ausführlichen Kommentare aus `public/js/14-scope.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="dieser-abschnitt-lag-in-js-01-core-js-de"></a>
## Dieser Abschnitt lag in js/01-core.js. Deren Kopfzeile nennt als Inhalt

```text
═══ Kontofilter (Haushalt) — je Ansicht ═══════════════════════════════════

── Warum eigene Datei ───────────────────────────────────────

Dieser Abschnitt lag in js/01-core.js. Deren Kopfzeile nennt als Inhalt
„Utils, i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken"
— der Kontofilter ist nichts davon.

Er ist ausserdem der am klarsten abgegrenzte Teil der Datei: Er hängt an
KEINEM anderen Modul, sondern nur am localStorage. Das macht ihn zum
natürlichen ersten Schnitt.
```

<a id="ein-hauptkonto-kann-je-ansicht-zwischen"></a>
## Ein Hauptkonto kann je Ansicht zwischen Alle / Eigene / Unterkonten

```text
Ein Hauptkonto kann je Ansicht zwischen Alle / Eigene / Unterkonten
umschalten. Die Wahl gilt PRO ANSICHT: Wer in der Galerie den ganzen
Haushalt sieht, will in den Finanzen womöglich nur die eigenen Zahlen.

Gefiltert wird am Server (`accounts=`) — clientseitig liesse sich zwar eine
Kachelwand aussieben, aber weder die Gesamtzahl darunter noch die Bewertung
im Finanzreiter.

Die Wahl überlebt einen Neuladen (localStorage). Bewusst nicht auf dem
Server gespeichert: Es ist eine Ansichtseinstellung wie „Kachel oder
Tabelle", keine Eigenschaft des Kontos — und am Telefon will man sie
womöglich anders als am Rechner.
```

<a id="resetscopemodes"></a>
## `resetScopeModes`

```text
Kontofilter aller Ansichten zurücksetzen — bei jeder ANMELDUNG.

── Warum (Marcos Wunsch) ──────────────────────────────────────
Der Filter liegt bewusst im localStorage: Er ist eine Ansichtseinstellung
wie „Kachel oder Tabelle", und am Telefon will man sie womöglich anders als
am Rechner. Genau das machte ihn aber auch zu einer Falle — er überlebte
Abmelden und Anmelden, und wer zuletzt auf ein einzelnes Konto gefiltert
hatte, sah nach dem nächsten Login wieder nur dessen Sets, ohne dass etwas
darauf hinwies. Das war schwer als Filter zu erkennen; es sah aus, als sei
die halbe Sammlung weg.

Deshalb: Beim Anmelden gilt IMMER „Alle Konten". Innerhalb einer Sitzung
bleibt eine getroffene Wahl erhalten — auch über einen Seitenneuaufbau (F5)
hinweg, denn dabei wird nicht neu angemeldet.
```

<a id="der-lagerortfilter-ist-derselbe-gegensta"></a>
## Der Lagerortfilter ist derselbe Gegenstand wie der Kontofilter: eine Wahl je

```text
═══ Lagerortfilter — je Ansicht, genau wie der Kontofilter ═══════════════════

── Warum in DIESER Datei ───────────────────────────────────────────────────

Der Lagerortfilter ist derselbe Gegenstand wie der Kontofilter: eine Wahl je
Ansicht, die als Anfrageparameter mitreist und am Server in die Abfrage
eingeht. Er teilt sogar die Begründungen — gefiltert wird am Server, weil
sich die Gesamtzahl darunter clientseitig nicht aussieben lässt, und die
Wahl wird beim Anmelden zurückgesetzt, weil sie sonst wie eine verschwundene
Sammlung aussieht.

Zwei Dateien für dieselbe Sache hätten zwei Fassungen dieser Regeln
bedeutet, und eine davon wäre irgendwann die ältere.
```
