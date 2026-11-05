# Begründungen zu `public/js/02-detailfelder.js`

Die ausführlichen Kommentare aus `public/js/02-detailfelder.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="preisalarm-des-offenen-sets-laden-und-an"></a>
## Preisalarm des offenen Sets laden und anzeigen.

```text
Preisalarm des offenen Sets laden und anzeigen.

── Warum nur der Zustand „neu" im Dialog steht ─────────────────────────────

Der Server kann je Zustand einen Alarm — die Oberfläche bietet vorerst den
für NEU an, weil das der Fall ist, nach dem gefragt wurde. Die Trennung
steckt trotzdem schon im Server und in der Tabelle: Sie nachträglich
einzuziehen hiesse, bestehende Alarme zuordnen zu müssen, und das geht nicht
ohne Raten. Ein zweites Auswahlfeld hier ist dagegen eine Zeile.
```

<a id="fuer-welchen-zustand-der-alarm-gilt-neu"></a>
## Für WELCHEN Zustand der Alarm gilt — neu oder gebraucht.

```text
Für WELCHEN Zustand der Alarm gilt — neu oder gebraucht.

── Warum das jetzt eine Wahl ist und keine Konstante ───────────────────────

Hier stand `const ALARM_ZUSTAND = 'N'` mit der Begründung: „Die Oberfläche
bietet vorerst den für NEU an, weil das der Fall ist, nach dem gefragt
wurde. Ein zweites Auswahlfeld hier ist dagegen eine Zeile."

Server und Tabelle konnten es die ganze Zeit — `price_alerts` hat den
Zustand im Schlüssel. Neu und gebraucht liegen oft um ein Vielfaches
auseinander; wer ein gebrauchtes Exemplar sucht, hatte bisher keine
Möglichkeit, darauf zu warten.
```

<a id="alarmfeld"></a>
## `_alarmFeld`

```text
Welcher Alarmblock gerade gemeint ist: 'm' (Set-Detail) oder 'mk-m'
(Merkposten-Detail).

── Warum eine Modulvariable und kein Parameter ─────────────────────────────

Die Handler werden vom Ereignis-Dispatcher über data-click/data-change
gerufen und bekommen genau EIN Argument: die Setnummer. Ein zweites
hiesse, sie in data-arg zu kodieren und überall wieder zu zerlegen.

Eine Modulvariable ist hier gefahrlos, weil immer höchstens EIN Dialog
offen ist — beide setzen sie beim Öffnen. Stünden je zwei gleichzeitig
offen, wäre das falsch; dann gäbe es aber auch zwei gleiche IDs im
Dokument, und das ginge ohnehin schief.
```

<a id="der-lagerort-ein-auswahlfeld-das-auch-ne"></a>
## Der Lagerort: ein AUSWAHLFELD, das auch neue Werte annimmt.

```text
Der Lagerort: ein AUSWAHLFELD, das auch neue Werte annimmt.

── Marcos Vorgabe ─────────────────────────────────────────────────────────

„Das Feld Lagerort soll ein Auswahlfeld sein (analog den Feldern beim
Preisalarm), zusaetzlich sollen dort aber auch neue Werte erfasst werden
koennen."

── Warum die datalist das nicht war ───────────────────────────────────────

Hier stand ein `<input list="lagerorte">`. Das nimmt Getipptes an und kennt
die Vorschlaege — aber es SIEHT aus wie ein Textfeld: kein Pfeil, und in
Chrome klappt die Liste auf einen Klick nicht auf. Wer sie nicht kennt,
findet sie nicht. Die App hat dafuer laengst ein richtiges Aufklappfeld
(ui/screens/LagerortFeld.kt) — die Webapp zieht hiermit nach.

── Wie beides zusammengeht ────────────────────────────────────────────────

Ein `select` mit den bekannten Orten und einem letzten Eintrag „neuer Ort".
Wird der gewaehlt, erscheint das Textfeld daneben. Das Textfeld traegt die
urspruengliche Kennung und die urspruenglichen data-Attribute weiter — es
ist nach wie vor DAS Feld, das gespeichert wird. Eine Wahl aus der Liste
schreibt nur hinein und loest sein change-Ereignis aus; damit laeuft das
Speichern durch DENSELBEN Weg wie eine Eingabe von Hand, und es gibt keine
zweite Fassung der Speicherregel.
```

<a id="ort-neu-marke"></a>
## `ORT_NEU_MARKE`

```text
Wie der Eintrag „neuer Ort" erkannt wird.

Als data-Attribut und NICHT ueber einen abgemachten Wert: Jeder Wert, den
man sich ausdenkt, kann jemand als Lagerort eintippen — und ein
Steuerzeichen als Notloesung waere schlimmer, HTML ersetzt U+0000 beim
Einlesen durch U+FFFD, der Vergleich ginge still schief. Das Attribut kann
mit keinem Ortsnamen kollidieren.
```

<a id="lagerortgetippt"></a>
## `lagerortGetippt`

```text
Ein neuer Ort ist fertig getippt (das Feld wurde verlassen).

Gespeichert hat das change-Ereignis des Feldes selbst — hier wird nur die
Auswahl daneben nachgezogen, damit der neue Name darin steht und nicht
weiter „neuer Ort" angezeigt wird.

`this` ist das Feld: Die Delegation ruft den Handler mit dem Element als
Empfaenger auf (11-actions.js, fn.apply(el, args)). Ein data-self="1" waere
hier falsch — dasselbe Attribut gaelte auch fuer das change-Ereignis und
schoebe dem Speichern ein Argument unter.
```

<a id="zeigealarmmerker"></a>
## `zeigeAlarmMerker`

```text
Nur den Merker nachführen — OHNE das Eingabefeld anzufassen.

Getrennt von ladeAlarm(), und das ist der Kern der Entprellung: Während
getippt wird, darf die Antwort des Servers nicht ins Feld zurückschreiben.
Wer „249.90" tippt, hat nach der Ruhezeit hinter „249.9" vielleicht schon
die letzte Null gesetzt — ladeAlarm() machte daraus wieder „249.9" und
fräse dem Tippenden das Zeichen weg.
```

<a id="wechslealarmzustand"></a>
## `wechsleAlarmZustand`

```text
Auf den anderen Zustand umschalten.

LÄDT, speichert NICHT — und das ist der Punkt: Ein Wechsel ist die Frage
„was steht für gebraucht?", keine Eingabe. Würde hier gespeichert, legte
schon das Umschalten einen Alarm im neuen Zustand an (oder löschte ihn,
wenn das Feld leer ist). Eine noch laufende Ruhezeit wird verworfen, damit
nicht kurz darauf die Schwelle des ALTEN Zustands beim neuen landet.
```

<a id="alarmgetippt"></a>
## `alarmGetippt`

```text
Beim Tippen speichern — entprellt.

── Marcos Befund ───────────────────────────────────────────────────────────

„Der Preisalarm wird nicht gespeichert … soll gespeichert werden, wenn man
was einträgt. Analog dem Kaufpreis."

Bis hierher hing das Feld an `change`, also am Verlassen des Feldes. Wer
tippt und das Fenster schliesst, ohne vorher woanders hinzuklicken, verlor
die Eingabe.

── Warum die Werte JETZT festgehalten werden ───────────────────────────────

Der Zeitgeber feuert bis zu ALARM_RUHE später. Läse er die Felder erst
dann, wären sie womöglich gar nicht mehr da — das Detailfenster ist
inzwischen zu, G() liefert null, und die Eingabe wäre wieder verloren. Das
ist genau der Fehler, den diese Änderung beheben soll; deshalb steht hier
eine Kopie und kein zweiter Blick in den Baum.
```

<a id="sendealarm"></a>
## `sendeAlarm`

```text
Der eine Weg zum Server.

Ein leeres Feld heisst LÖSCHEN, nicht „Schwelle 0": Die natürliche Geste,
einen Alarm loszuwerden, ist das Feld zu leeren — ein eigener Knopf daneben
wäre ein zweiter Weg für dieselbe Absicht.

Ein halber Anfang („-", "abc") ist keine Zahl und damit ein Löschen.
„249." dagegen NICHT: `parseFloat("249.")` ist 249 — das hatte ich zuerst
falsch behauptet und erst gemessen, als der Android-Lauf meinen Test dazu
rot meldete. Dieselbe Lesart wie in Alarmeingabe.zahl().

Der Grund für ALARM_RUHE ist damit ein anderer und ein besserer: Wer „249"
tippen will, tippt unterwegs „2" und „24". Ohne Ruhezeit stünde am Ende
eine Schwelle bei 2 — und die meldet sofort.
```

<a id="zeigeoffenealarme"></a>
## `zeigeOffeneAlarme`

```text
Beim Oeffnen zeigen, welche Alarme seit dem letzten Besuch ausgeloest haben.

── Warum die Webapp das auch tut ───────────────────────────────────────────

Die Android-App fragt stuendlich im Hintergrund nach und meldet es als
Benachrichtigung (alarm/PreisalarmWorker.kt). Ohne dieses Gegenstueck waere
der Preisalarm die erste Funktion, die in der App mehr kann als hier — und
genau das soll nicht passieren.

Ein Hintergrundlauf ist im Browser nicht das Gegenstueck: Eine
geschlossene Seite fragt nichts ab, und ein Service Worker mit Web-Push
waere derselbe schwere Apparat, den die App mit Firebase bewusst vermeidet.
Das ehrliche Gegenstueck ist: beim Oeffnen nachfragen.

── Die Marke kommt vom SERVER ──────────────────────────────────────────────

Dieselbe Begruendung wie in Alarmabholung.kt: Naehme die Seite ihre eigene
Uhr, entschiede die Gangabweichung zum Server darueber, ob eine Meldung
doppelt kommt oder ausfaellt.

Je Konto eine eigene Marke: An einem Rechner melden sich durchaus zwei
Leute an, und die Marke des einen darf die Meldungen des anderen nicht
verschlucken.
```

<a id="ladeortauswahl"></a>
## `ladeOrtAuswahl`

```text
Die Auswahlliste im Detailfenster — der VORRAT des Besitzers.

── Marcos Festlegung ───────────────────────────────────────────────────────

„Der Grossvater soll die Werte der Enkel für die entsprechenden Sets sehen
und wählen können."

Ein Lagerort ist ein Regal in einer Wohnung. Beim Set des Enkels gehören
die Regale des ENKELS zur Wahl — ein Set des Enkels in „Grossvaters Keller"
wäre eine Aussage über die falsche Wohnung.

Ohne `owners` (Einzelkonto, oder eine Zeile ohne Besitzerplakette) bleibt
der Parameter weg, und der Server antwortet mit der eigenen Liste. Genau
das ist dann auch richtig.

── Warum eine datalist und kein select ─────────────────────────────────────

Marco will beides: auswählen UND neue Werte gleich erfassen. Ein `select`
kann nur das erste, ein Textfeld nur das zweite. Eine `datalist` klappt auf
wie ein Auswahlfeld und nimmt trotzdem Getipptes an — und was getippt wird,
landet im Vorrat (setzeLagerort in src/bestand/lagerort.ts).
```

<a id="initstorageselects"></a>
## `initStorageSelects`

```text
Die Lagerort-Auswahlfelder füllen.

── Warum sie verborgen bleiben, solange es keine Orte gibt ────────────────

Ein Auswahlfeld mit genau einem Eintrag („Alle Lagerorte") beantwortet
nichts und steht trotzdem in der Filterzeile. Genau so verhält sich der
Kontofilter daneben, wenn es keine Unterkonten gibt — dieselbe Regel, weil
es dieselbe Art von Wahl ist.
```
