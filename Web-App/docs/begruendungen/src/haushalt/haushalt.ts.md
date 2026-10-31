# Begründungen zu `src/haushalt/haushalt.ts`

Die ausführlichen Kommentare aus `src/haushalt/haushalt.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Haushalt — verknüpfte Konten.

── Wozu ────────────────────────────────────────────────────────────────────
Eine Familie verwaltet die Sammlung je Kind in einem eigenen Konto. Der
Hauptaccount eines Haushalts sieht alles zusammen und darf verschieben.

── Die eine Stelle, an der „wessen Daten?" beantwortet wird ────────────────
Alles andere im Projekt fragt `resolveHousehold()` und bekommt eine Liste
von Benutzer-IDs. Wer eigene Abfragen gegen account_links baut, bekommt
früher oder später eine andere Antwort als der Rest — bei der
Zustandsauflösung ist genau das passiert (fünf Fundorte, leicht verschieden).

── Drei Grenzen, die überall gelten ────────────────────────────────────────
1. NUR NACH UNTEN. Ein Konto sieht sich selbst und ALLE seine Nachfahren —
   nie sein Elternkonto und nie seine Geschwister. Ein Enkel sieht seinen
   Grossvater also nicht, der Grossvater aber den Enkel. Die Sicht ist
   dadurch immer ein Teilbaum mit dem betrachtenden Konto an der Spitze.
2. HÖCHSTENS EIN ELTERNKONTO. `UNIQUE (sub_user_id)` im Schema. Damit ist
   jeder Nachfahre über GENAU EINEN Weg erreichbar; eine Zeile taucht nie
   in zwei Teilbäumen desselben Zweigs auf.
3. LESEN WEIT, SCHREIBEN ENG. Der Haushalt erweitert das BLICKFELD. Ob
   jemand etwas ändern darf, beantwortet `canWriteFor()` — und zwar
   ausdrücklich, nicht als Nebenwirkung des Blickfelds.

── Warum es seit Nachtrag 173 mehrere Stufen sind ──────────────────────────
Vorher galt „nur eine Stufe": Ein Hauptkonto durfte nirgends Unterkonto sein
und umgekehrt. Das hielt die Auflösung auf zwei flache Abfragen, schloss
aber den Fall aus, für den der Haushalt gedacht ist — eine Familie über drei
Generationen. Jetzt löst eine rekursive Abfrage auf, mit Zyklusschutz über
den mitgeführten Pfad UND einer Tiefengrenze.

── Was sich dadurch NICHT geändert hat ─────────────────────────────────────
`scopeIds()` gibt nach wie vor eine ID-Liste zurück, und alle 57
Aufrufstellen fragen damit `user_id = ANY($1)`. Ob diese Liste aus einer
oder aus vier Stufen entsteht, sehen sie nicht — deshalb musste ausser
dieser Datei nichts angefasst werden.
```

<a id="haushalt-kanal"></a>
## `HAUSHALT_KANAL`

```text
═══════════════════════════════════════════════════════════════════════════
Das Blickfeld wird auf JEDER Anfrage gebraucht
═══════════════════════════════════════════════════════════════════════════

── Was gemessen wurde ──────────────────────────────────────────────────────

resolveHousehold() steht am Anfang praktisch jedes Lese-Endpunkts und macht
zwei Abfragen. Ueber die echten Routen gezaehlt:

    /api/v1/sets          5 Abfragen, davon 2 auf account_links
    /api/v1/parts         6 Abfragen, davon 2
    /api/v1/minifigs      5 Abfragen, davon 2
    /api/v1/stats         9 Abfragen, davon 2
    /api/v1/parts/stats   5 Abfragen, davon 2

Immer GENAU einmal je Anfrage — kein N+1, sondern ein fester Aufschlag:
0,438 ms je Aufruf (500 Aufrufe in 219 ms, lokaler Socket). Im Betrieb
liegt Postgres in einem eigenen Container, der Umlauf kostet dort mehr.

── Warum ein Gedaechtnis vertretbar ist ────────────────────────────────────

Ein Haushalt aendert sich, wenn jemand eine Einladung einloest oder eine
Verknuepfung loest — also alle paar Monate, nicht alle paar Sekunden.

── Warum NOTIFY und nicht nur eine kurze Frist ─────────────────────────────

Der Server laeuft im Cluster. Loest Worker A die Einladung ein, wuesste
Worker B ohne Signal bis zum Ablauf der Frist nichts davon — der Nutzer
klickt „einloesen" und sieht sein Unterkonto je nach Worker mal ja, mal
nein. Genau dafuer gibt es db/pgNotify.ts schon; hier wird es benutzt
statt die Frist so kurz zu waehlen, dass sie den Gewinn wieder auffrisst.

Die Frist bleibt als NETZ darunter: NOTIFY ist fluechtig (siehe pgNotify),
ein Worker ohne Verbindung im Moment des Signals bekommt es nie.

Jede Aenderung leert ALLES, nicht nur die betroffenen Konten. Eine
Verknuepfung beruehrt immer zwei Konten, das Loeschen eines Kontos raeumt
per ON DELETE CASCADE weitere Zeilen ab — und die Karte hat einen Eintrag
je aktivem Nutzer, ist also winzig. Gezielt zu leeren waere mehr Code mit
mehr Moeglichkeiten, einen Fall zu uebersehen.
```

<a id="nachfahren"></a>
## `nachfahren`

```text
Alle Nachfahren eines Kontos, mit ihrer Stufe — die eine rekursive Abfrage.

── Zwei Bremsen, und beide werden gebraucht ────────────────────────────────

`NOT (l.sub_user_id = ANY(b.pfad))` bricht einen Kreis ab. Dass es überhaupt
einen geben kann, ist nicht offensichtlich: `UNIQUE (sub_user_id)` erlaubt
A→B, B→C und C→A ohne Weiteres — jede der drei IDs steht genau einmal als
Unterkonto. Verhindert wird der Kreis beim Einlösen (`redeemInvite`); diese
Bremse ist das Netz darunter, für den Fall, dass Zeilen je auf anderem Weg
entstehen.

`b.tiefe < $2` ist die Reissleine dahinter (siehe MAX_STUFEN).

Ohne Kreis ist jeder Nachfahre über genau einen Weg erreichbar (Grenze 2 im
Kopf dieser Datei), deshalb steht jede ID genau einmal im Ergebnis — kein
DISTINCT nötig, und die Sortierung nach Stufe ergibt die Reihenfolge, in der
der Kontofilter sie anzeigt.
```

<a id="canwritefor"></a>
## `canWriteFor`

```text
Darf `actorId` Daten von `ownerId` ändern?

Eigene immer; fremde nur, wenn `ownerId` ein NACHFAHRE von `actorId` ist —
seit Nachtrag 173 also auch über mehrere Stufen. Ein Grossvater darf damit
beim Enkel schreiben, der Enkel beim Grossvater nicht.

── Warum hier nicht resolveHousehold() steht ───────────────────────────────

Die Menge ist dieselbe wie `memberIds` — „Lesen weit, Schreiben eng" heisst
in diesem Baum, dass ein Konto nie nach oben liest, sein Blickfeld also
genau sein Schreibbereich ist. Trotzdem wird hier FRISCH abgefragt:
resolveHousehold() merkt sich seine Antwort fünf Minuten. Für eine Ansicht
ist das richtig, für eine Rechteentscheidung nicht — nach einem `unlink()`
dürfte das frühere Hauptkonto sonst noch minutenlang in fremden Daten
schreiben. Lesen darf veralten, Schreiben nicht.
```

<a id="writableids"></a>
## `writableIds`

```text
IDs, für die `uid` SCHREIBEN darf — eigene plus ALLE Nachfahren.

── Warum das gebraucht wird (Nachtrag 45, Marcos Fehlerbericht) ────────────
„Wenn ich den Kaufpreis anpasse, wird er nicht gespeichert; in der Webapp
kommt Not found." Die Erfassungs-Routen suchten die Zeile mit
`WHERE id=$1 AND user_id=$2` und der EIGENEN Betrachter-ID. Gehört die
Erfassung einem Unterkonto — im Haushalt der Normalfall —, findet das
Hauptkonto sie nicht und bekommt 404, obwohl es sie sehen und ändern DARF.

Bewusst NICHT scopeIds(): Das ist das LESE-Blickfeld und enthält für ein
Unterkonto auch dessen Hauptkonto. Damit dürfte ein Unterkonto rückwärts
schreiben, und genau diese Asymmetrie („Lesen weit, Schreiben eng") ist eine
tragende Regel dieses Projekts. Die Menge hier ist deshalb absichtlich
kleiner als scopeIds() und deckt sich mit canWriteFor(): eigene ID immer,
fremde nur als bestätigtes Unterkonto.
```

<a id="householdmembers"></a>
## `householdMembers`

```text
Mitglieder mit Namen — für die Kontoauswahl und die Besitzer-Plaketten.

Enthält seit Nachtrag 173 den GANZEN Teilbaum, nicht nur die direkten
Unterkonten: Marcos Festlegung ist, dass der Kontofilter jedes nach unten
verknüpfte Konto einzeln anbietet und immer nur dieses eine Konto meint —
nie dessen Unterkonten mit. Ein Enkel, der im Filter fehlte, wäre sonst
ausser über „Alle Konten" gar nicht einzeln zu sehen.

`tiefe` ist nur für die Einrückung da (0 = eigenes Konto, 1 = Kind, 2 =
Enkel). Ohne sie stünden Kind und Enkel gleichrangig untereinander, und die
Liste sagte nicht mehr, wer zu wem gehört.
```

<a id="createinvite-id"></a>
## `id`

```text
Absagen kommen als CODE zurueck, nicht als Satz (Nachtrag 130): Dieser
Helfer weiss nicht, welche Sprache der Anfragende sieht — die Route weiss
es, weil sie den Request hat.

── Und sie heissen `fehler`, nicht `code` (Nachtrag 167) ─────────────────

Der Erfolgsfall dieser Funktion liefert selbst ein Feld `code` — den
EINLADUNGSCODE. Die Absage hiess frueher ebenfalls `code`, und die Route
entschied mit `if (r.code)`, ob etwas schiefging. Damit war JEDE
erfolgreiche Einladung ein Fehler: Der Zufallstoken ging als Fehlercode in
fehlerText(), stand dort in keiner Tabelle, und der Aufruf endete mit
„Cannot read properties of undefined (reading 'de')" — HTTP 500.

Marco hat das aus dem Betrieb gemeldet. Die Funktion hat seit dem Umbau
kein einziges Mal funktioniert; die Tests pruefen die beiden Rueckgaben
einzeln und kamen an der Entscheidung der Route nie vorbei.
```

<a id="redeeminvite"></a>
## `redeemInvite`

```text
Einladungscode einlösen — das einlösende Konto wird Unterkonto.

Der Code wird ATOMAR entwertet (UPDATE … WHERE used_at IS NULL … RETURNING),
damit zwei gleichzeitige Versuche nicht beide durchkommen. Erst danach wird
geprüft, ob die Verknüpfung überhaupt zulässig ist — schlägt eine Prüfung
fehl, wird der Code wieder freigegeben, sonst wäre er für den zweiten,
richtigen Versuch verbraucht.
```

<a id="redeeminvite-2"></a>
## Abschnitt

```text
── Kein Kreis ────────────────────────────────────────────────────────────

Die einzige Grenze, die von „nur eine Stufe" uebrig ist (Nachtrag 173).
Wuerde ein Konto seinen eigenen Nachfahren als Elternkonto annehmen,
entstuende A→B→…→A. `UNIQUE (sub_user_id)` faengt das NICHT: In einem
Kreis steht jede ID genau einmal als Unterkonto. Die Aufloesung liefe
dann bis zur Tiefengrenze und gaebe eine Mitgliederliste, in der jedes
Konto jedes andere sieht — das Gegenteil von „Enkel sehen ihren
Grossvater nicht".
```

<a id="redeeminvite-einziehend"></a>
## `einziehend`

```text
── Währung muss übereinstimmen — im GANZEN einziehenden Teilbaum ─────────

Die Haushaltssicht summiert Beträge. Zwei Konten mit CHF und EUR ergäben
eine Summe aus zwei Währungen — kommentarlos falsch, und niemand sähe es
der Zahl an. Lieber hier ablehnen als später falsch rechnen.

Seit Nachtrag 173 zieht ein Konto seine eigenen Unterkonten MIT ein. Nur
die beiden unmittelbar Beteiligten zu vergleichen, reichte damit nicht
mehr: Ein Enkel mit CHF wäre über einen Vater mit EUR unbemerkt in die
Summe des Grossvaters gewandert.
```

<a id="unlink"></a>
## `unlink`

```text
Verknüpfung lösen — von BEIDEN Seiten erlaubt.

Das Elternkonto entfernt ein Unterkonto (subId gesetzt), das Unterkonto
löst sich selbst (subId leer). Ein Unterkonto, das nicht mehr mitmachen
will, wäre sonst auf das Wohlwollen des Elternkontos angewiesen.

── Nur die EIGENEN Verknüpfungen (Nachtrag 173) ───────────────────────────
Die Abfrage trifft `main_user_id = $1 AND sub_user_id = $2`, also nur eine
Kante, die am aufrufenden Konto selbst hängt. Ein Grossvater kann seinen
Enkel damit NICHT herauslösen, obwohl er ihn sieht — die Kante gehört
seinem Kind. Will er den Zweig los, löst er sein Kind; der Enkel geht mit.
Das ist die einzige Lesart, bei der niemand eine Verknüpfung auflösen kann,
der er nie zugestimmt hat.

Daten bleiben, wo sie sind. Bereits verschobene Sets bleiben verschoben —
sie gehören dem Zielkonto, nicht dem Haushalt.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Die IDs, mit denen gearbeitet wird — für Abfragen der Form
`user_id = ANY($1)`.

── Der Filter ──────────────────────────────────────────────────────────────
Ein Hauptkonto kann JE ANSICHT zwischen Alle / Eigene / Unterkonten
umschalten. Der Wert reist als Anfrageparameter mit (`accounts=`) und wird
genau hier in Konto-IDs übersetzt — deshalb kennt ihn jede Zahl derselben
Antwort automatisch: Liste, Gesamtzahl, Kennzahlen und Summen entstehen aus
derselben ID-Liste.

Das ist der Grund, warum der Filter am Server hängt und nicht in der
Oberfläche gefiltert wird: Eine Kachelwand liesse sich clientseitig
aussieben, die Gesamtzahl darunter und die Bewertung im Finanzreiter nicht.

Für ein Konto OHNE Unterkonten ist der Filter wirkungslos — es sieht sich
selbst, egal was gefragt wird.

Diese Liste ist zugleich der SCHREIBBEREICH: Der Hauptaccount darf in den
Daten seiner Unterkonten schreiben (so festgelegt), ein Unterkonto nur in
seinen eigenen. `canWriteFor()` bleibt trotzdem, für den Fall, dass ein
Zielkonto AUSDRÜCKLICH benannt wird (Erfassen mit Kontoauswahl,
Verschieben) — dort genügt „steht in der Liste" nicht, dort muss die
Richtung stimmen.
```

<a id="blickfeldeingabe"></a>
## `BlickfeldEingabe`

```text
Das BLICKFELD — wessen Daten gerechnet werden.

── Warum der Typ hier steht (Nachtrag 172) ─────────────────────────────────

Er stand DREIMAL im Baum, unter demselben Namen, mit ZWEI Bedeutungen:

  src/teile/abfragen.ts   type Blickfeld = number | number[]
  src/sets/abfragen.ts    type Blickfeld = number | number[]
  utils/finance/…           type Blickfeld = number[]

Beide Fassungen waren richtig — nur beschrieben sie verschiedene Momente:
Vor `asIds()` darf es eine einzelne ID oder eine Liste sein, danach ist es
immer eine Liste. Derselbe Name fuer beides heisst, dass eine Signatur nicht
mehr sagt, in welchem der beiden Momente sie steht.

Jetzt zwei Namen an einer Stelle — dort, wo `asIds()` lebt, das zwischen
ihnen uebersetzt.
```

<a id="resolvewritetarget"></a>
## `resolveWriteTarget`

```text
Zielkonto für eine Erfassung bestimmen.

Ohne Angabe das eigene Konto — so verhält sich alles wie vor der
Haushaltssicht. Mit Angabe nur, wenn der Anfragende dafür schreiben darf:
`canWriteFor()` prüft die RICHTUNG (Hauptkonto → eigenes Unterkonto), nicht
bloss die Mitgliedschaft im Blickfeld. Ein Unterkonto darf also nicht ins
Nachbarkonto schreiben, auch wenn beide im selben Haushalt sind.

Stand zuerst nur in routes/sets.ts. Teile und Minifiguren brauchen dieselbe
Auflösung — und drei Kopien einer Rechteprüfung sind die Sorte Doppelung,
bei der irgendwann eine davon grosszügiger ist als die anderen.

@returns die Ziel-ID, oder null wenn nicht erlaubt (Aufrufer antwortet 403)
```

<a id="acquisitionmovesource"></a>
## `acquisitionMoveSource`

```text
Absender eines Eigentümerwechsels aus der ERFASSUNGSZEILE ermitteln.

Beim Umhängen eines Kaufpreises ist die Zeilen-ID eindeutig — wem sie
gehört, weiss die Datenbank besser als jeder Dialog. Die Webapp schickte
hier den BETRACHTER als from_user_id mit (die Zeilen-Eigentümer standen nur
im Select der Anzeige): Zog das Hauptkonto die Zeile eines Unterkontos zu
sich, suchte der Server sie unter dem falschen Konto und antwortete 404.
Deshalb ermittelt der Server den Absender jetzt selbst; ein mitgeschickter
from_user_id wird ignoriert.

Geprüft wird ausschliesslich die Schreib-Richtung (`canWriteFor`): eigene
Zeile immer, fremde nur als Hauptkonto für ein eigenes Unterkonto. Eine
Zeile ausserhalb dieser Menge antwortet 403 — nicht 404, denn ob es sie
gibt, geht den Anfragenden dann nichts an.

@throws mit e.status 404 (Zeile existiert nicht) oder 403 (keine Richtung)
```
