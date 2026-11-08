# Begründungen zu `test/wunschliste-xml.test.js`

Die ausführlichen Kommentare aus `test/wunschliste-xml.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="wurzel"></a>
## `const WURZEL = path.join(__dirname, '..');`

```text
Die BrickLink-Wunschliste der Webapp wird maskiert.

── Der Befund, aus dem dieser Test kam ─────────────────────────────────────
Die Android-App hatte einen XML-Maskierer und wandte ihn auf alle drei
Textfelder an; die Webapp setzte dieselben Felder roh ein.

Bei einem MANUELL erfassten Teil tippt der Mensch die Nummer. Ein `&` darin
macht aus der Wunschliste eine Datei, die BrickLink nicht liest; ein `<`
kann Elemente einfuegen, die niemand geschrieben hat. Dass es nie auffiel,
liegt daran, dass Teilenummern meist harmlos sind — das Kennzeichen dieser
Fehlerart: Zwei Fassungen einer Regel fallen nicht auf, solange die Daten
zufaellig mitspielen.

── Was sich geaendert hat ──────────────────────────────────────────────────
Die App hat die Wunschliste nicht mehr: Marco hat die BrickLink-Funktion
aus dem Teile-Reiter entfernen lassen, und mit ihr fiel
BrickLinkWunschliste.kt weg. Die dritte Pruefung dieses Tests — „die App
maskiert dieselben Felder" — ist damit gegenstandslos und ENTFERNT statt
uebersprungen: Ein Test, der auf eine geloeschte Datei zeigt, stuerzt ab
oder schweigt, und beides ist schlechter als seine Abwesenheit.

Die Regel selbst bleibt und gilt weiter — fuer die Oberflaeche, die den
Export noch hat.

── Warum kein zweiter Escaper in der Webapp ────────────────────────────────
esc() ersetzt genau die fuenf Entitaeten, um die es geht (& < > " ').
Ein eigener XML-Maskierer daneben waere eine zweite Fassung derselben Regel.

── Zwei Umzuege am 20.10., und warum sie noetig waren ──────────────────────

1. Der XML-Aufbau liegt nicht mehr in js/08-init.js, sondern in
   js/19-bricklink-xml.js. Diese Datei greift NICHT auf das Dokument zu —
   deshalb kann test/bricklink-wanted-xml.test.js sie einlesen und das
   FORMAT pruefen (keine XML-Deklaration, Groessengrenze, keine erfundene
   Farbe). In js/08-init.js ging das nicht: Sie laedt die Teileliste und
   braucht dafuer `document`.

2. esc() liegt nicht mehr in js/00-escapen.js, sondern in js/00-escapen.js.
   Das ist die Folge aus 1.: Der Aufbau muss maskieren, js/00-escapen.js
   laesst sich aber ohne Dokument nicht laden (GEMESSEN: „document is not
   defined"). Die Wahl war, esc() zu KOPIEREN — also genau die zweite
   Fassung, die dieser Test verbietet — oder es dorthin zu legen, wo beide
   Seiten es erreichen. js/00-escapen.js reicht es weiter, jeder bestehende
   `import { esc } from './00-escapen.js'` gilt unveraendert.
```

<a id="core"></a>
## `const core = ohneKommentare(require('./helpers/sources').coreQuelle())`

```text
Der Server prueft die Werte (routes/api_v1/admin.ts) — hier kann heute
nichts Boesartiges ankommen. Der Punkt ist die Gleichbehandlung: In
derselben Zeile ging `data-arg` durch esc() und `value` nicht. Eine Zeile,
die dieselbe Regel zweimal verschieden anwendet, ist der Anfang der
naechsten Luecke.
coreQuelle() statt eines Dateinamens: Die Jobliste zog in Nachtrag 141 nach
js/01-monitor.js um. Ein Test, der den Ablageort nennt, wird davon grün,
dass sein Gegenstand weg ist — hier fiel er nur auf, weil er die Anzahl
der Treffer prüft und nicht bloß deren Form.
```
