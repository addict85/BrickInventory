# Begründungen zu `utils/preisalarm.ts`

Die ausführlichen Kommentare aus `utils/preisalarm.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst.

── Warum es diesen Helfer gibt ─────────────────────────────────────────────

Die Zahl, auf die es ankommt, wird ohnehin geholt: Der Preislauf
(jobs/priceJob.ts) fragt die Marktpreise regelmässig ab und schreibt sie in
price_cache. Es fehlte nur der Schritt danach — nachsehen, ob jemand darauf
gewartet hat.

Diese Datei ist ein BLATT: Sie liest die Preise, entscheidet und verschickt.
Sie kennt weder Routen noch den Job, der sie aufruft — nur db, mailer und
fehlerTexte. Damit lässt sie sich auch ohne laufenden Job prüfen, und der
Job bleibt ein Job.

── Was hier ABSICHTLICH nicht steht ────────────────────────────────────────

Kein Blickfeld, kein Haushalt. Ein Alarm gehört genau EINEM Konto: Wer eine
Schwelle setzt, will selbst benachrichtigt werden, und das Elternkonto hat
nichts davon, die Wünsche seiner Kinder per Mail zu bekommen. Das ist der
einzige Ort im Projekt, an dem `user_id = $1` steht, ohne dass es ein
Versehen ist — deshalb steht es hier auch begründet.
```

<a id="alarmzeile"></a>
## `AlarmZeile`

```text
Eine Alarmzeile samt Empfänger — das, was pruefeSet() aus der Datenbank
bekommt.

Ausgeschrieben statt `any`: Hier stehen ein Geldbetrag, eine Richtung und
eine Mailadresse nebeneinander, und ein Vertauschen wäre an keiner Stelle
sichtbar. `schwelle` ist ausdrücklich `string | number`, weil der
Postgres-Treiber numeric als Zeichenkette liefert — genau deshalb steht
unten parseFloat und nicht Number().
```

<a id="setzealarm"></a>
## `setzeAlarm`

```text
Alarm setzen oder ändern.

Ein Konto hat je Set und Zustand höchstens EINEN Alarm (Primärschlüssel).
Zwei Schwellen in dieselbe Richtung wären ohnehin eine davon zu viel, und
„unter 200 UND über 400" ist eine Frage, die noch niemand gestellt hat —
käme sie, wäre sie ein zweiter Datensatz, nicht ein zweites Feld.

Der Merker `ausgeloest` wird beim Ändern ZURÜCKGESETZT: Eine neue Schwelle
ist eine neue Frage, und die soll beantwortet werden, auch wenn die alte
schon einmal gemeldet hat.
```

<a id="alarmmitname"></a>
## `AlarmMitName`

```text
ALLE Alarme eines Kontos — fuer die Uebersicht in beiden Oberflaechen.

── Marcos Frage vom 25.09. ─────────────────────────────────────────────────

  „Wie finde ich alle Preisalarme?"

Gar nicht, war die Antwort. Es gab nur alarmeFuer() zu EINEM Set — man sah
einen Alarm also nur, wenn man das Set schon gefunden hatte. Wer fuenfzig
setzt, hat keinen Ort, an dem sie zusammen stehen, und keinen, an dem er
sieht, welche noch scharf sind. Ein Alarm, den man nicht wiederfindet,
laesst sich weder pruefen noch abstellen.

── Warum der Name mitkommt ─────────────────────────────────────────────────

Eine Liste aus Setnummern ist keine Liste, die man lesen kann. `40820-1`
sagt niemandem etwas; „Up-Scaled Santa Minifigure" schon. Der LEFT JOIN und
nicht INNER: Ein Alarm auf ein Set, das der Katalog (noch) nicht kennt, darf
nicht aus der Uebersicht verschwinden — sonst fehlt genau die Zeile, die man
sucht, weil sie sich merkwuerdig verhaelt.

── Kein Blickfeld, kein Haushalt ───────────────────────────────────────────

Wie ueberall in dieser Datei: `user_id = $1`. Ein Alarm gehoert genau EINEM
Konto (Begruendung im Kopf der Datei). Die Uebersicht zeigt deshalb die
eigenen Alarme, nicht die der Unterkonten.
```

<a id="alarmmitname-2"></a>
## Abschnitt

```text
Gibt es zu diesem Set eine Detailansicht?

Ein Alarm braucht das Set NICHT: `setzeAlarm()` schreibt ohne jede
Pruefung, und wer ein Set spaeter aus der Sammlung entfernt, behaelt
seinen Alarm. Die Uebersicht macht die Zeile deshalb nur dann anklickbar,
wenn es einen Detaildialog dazu gibt — sonst fuehrte der Klick auf
`GET /v1/sets/:nummer` und endete in einer Fehlermeldung.

── Warum das BLICKFELD und nicht `user_id` (Nachtrag 139) ────────────────

Marcos Befund: „Das Bild in der Android-App ist sichtbar aber die
Eintraege in den Preisalarme sind nicht klickbar."

Die erste Fassung verband auf `s.user_id = a.user_id` — also streng das
eigene Konto. `GET /v1/sets/:nummer` fragt aber ueber `scopeIds()`, das
heisst ueber das ganze Blickfeld: eigenes Konto UND Haushalt. Ein Set,
das einem Unterkonto gehoert, hat also sehr wohl eine Detailansicht —
die Zeile war trotzdem tot.

Die Regel lautet deshalb nicht mehr „gehoert mir", sondern „laesst sich
oeffnen", und sie benutzt dieselbe Quelle wie die Route, die geoeffnet
wird. Zwei Antworten auf dieselbe Frage waeren genau das, was hier
auseinandergelaufen ist.
```

<a id="allealarme"></a>
## Abschnitt

```text
Der zweite LEFT JOIN geht auf das Set im Blickfeld. Er liefert das Bild,
das die Galerie zeigt; der Katalog springt ein, wenn es das Set dort gar
nicht gibt — und das ist bei einem Preisalarm der haeufige Fall.

DISTINCT ON, weil die Verbindung jetzt mehrere Zeilen treffen KANN:
`sets` ist ueber (user_id, set_number) eindeutig, aber im Haushalt
koennen zwei Konten dasselbe Set haben. Ohne das erschiene der Alarm
zweimal — ein Fehler, den die erste Fassung nicht haben konnte und der
mit der Erweiterung auf das Blickfeld neu entsteht.

Sortiert wurde nach `image_local` NULLS LAST, damit die Zeile MIT
heruntergeladenem Bild gewinnt statt einer beliebigen. Seit Migration
0033 kommt das Bild aus set_catalog und ist fuer alle Haushaltszeilen
derselbe Wert — die Sortierung entscheidet damit nichts mehr, und `s.id`
dahinter macht die Auswahl weiterhin vorhersagbar. Stehen bleibt sie,
weil sie nichts kostet und die Absicht benennt.
```

<a id="ausgeloesteseit"></a>
## `ausgeloesteSeit`

```text
Was seit einem Zeitpunkt ausgelöst hat — für die Abholung durch die Clients.

── Warum die App fragt und der Server nicht schiebt ────────────────────────

Die Alternative wäre echtes Push (Firebase). Das hiesse: ein Google-Projekt,
eine Konfigurationsdatei im Baum, und jede Meldung — welches Set, welcher
Preis — liefe über fremde Server. Für eine selbstgehostete Sammlung ist das
eine schwere Abhängigkeit für eine leichte Nachricht.

Und sie kauft hier fast nichts: Der Preislauf läuft stündlich
(price_job_interval_minutes, Vorgabe 60). Eine Meldung kann gar nicht
schneller entstehen, als ein stündliches Nachfragen sie abholt.

── Warum `now` mit zurückkommt ─────────────────────────────────────────────

Der Aufrufer merkt sich, bis wann er schon gefragt hat, und schickt das
beim nächsten Mal als `seit`. Nähme er dafür seine EIGENE Uhr, entschiede
die Gangabweichung zwischen Telefon und Server darüber, ob eine Meldung
doppelt kommt (Telefonuhr geht nach) oder verloren geht (sie geht vor).
Beides fiele niemandem als Uhrenproblem auf.

Deshalb liefert der Server den Zeitpunkt, den der Klient beim nächsten Mal
einsetzen soll — aus derselben Uhr, aus der auch `zuletzt_am` stammt.

── Ohne `seit` kommt NICHTS ────────────────────────────────────────────────

Eine frisch installierte App soll nicht mit Meldungen über Kursschwellen
von vor drei Wochen aufschlagen. Der erste Aufruf setzt nur die Marke.
```

<a id="ausgeloesteseit-jetztrow"></a>
## `jetztRow`

```text
── Mikrosekunden gegen Millisekunden: der Grund fuer zwei rote Laeufe ───

Postgres speichert MIKROsekunden, JavaScript kennt nur MILLIsekunden.
Gemessen:

    Postgres  : 2026-09-19 20:33:04.996699+00
    JavaScript: 2026-09-19T20:33:04.996Z

Der Zeitpunkt, den diese Funktion zurueckgibt, geht als ISO-Text zum
Klienten — drei Nachkommastellen — und kommt so zurueck. Er ist damit
KLEINER als der Wert in der Datenbank, und eine Meldung aus derselben
Millisekunde erfuellt `zuletzt_am > marke` weiterhin. Sie kommt ein
zweites Mal.

Das war kein Randfall: CI-Laeufe 208 und 211/212 sind daran gescheitert
und liessen sich lokal nicht nachstellen — auf dem Laeufer liegen
Schreiben und Lesen dichter beieinander. Der Fehler traf nicht nur den
Test, sondern jeden Klienten.

── Behoben wird es an EINER Stelle, dem Vergleich ───────────────────────

Der erste Entwurf rechnete an drei Stellen auf Millisekunden: hier beim
Lesen, unten beim Vergleich und beim Schreiben des Merkers. Die
Gegenprobe hat gezeigt, dass nur der VERGLEICH etwas bewirkt — die
beiden anderen liessen sich zurueckdrehen, ohne dass ein Test rot wurde.

Sie sind deshalb draussen. Eine Zeile, deren Wirkung sich nicht zeigen
laesst, sieht beim naechsten Lesen aus wie eine Vorsichtsmassnahme und
ist in Wahrheit Ballast.

Der Vergleich kuerzt die SPALTE und nicht nur den neuen Wert, weil
Zeilen, die vor dieser Aenderung geschrieben wurden, noch Mikrosekunden
tragen — Marcos laufende Datenbank ist voll davon. Das kostet die
Indexnutzung auf zuletzt_am; bei hoechstens zwei Zeilen je Konto und Set
ist das kein Preis.
```

<a id="versender"></a>
## `Versender`

```text
Alle Alarme zu EINEM Set prüfen und bei Übergang benachrichtigen.

── Die Hysterese ───────────────────────────────────────────────────────────

Gemeldet wird der ÜBERGANG, nicht der Zustand. Bleibt der Preis unter der
Schwelle, bleibt es bei der einen Meldung; steigt er darüber und fällt
später wieder, meldet der Alarm erneut. Eine Sperrfrist („höchstens einmal
pro Woche") wäre die naheliegende und die falsche Antwort: Sie verschluckt
genau das zweite Unterschreiten, das wieder interessant ist.

── Warum der Versand einen Fehler nicht weiterreicht ───────────────────────

Diese Funktion läuft IM PREISLAUF. Ein nicht erreichbarer SMTP-Server darf
den Lauf nicht abbrechen — die Preise sind dann trotzdem geholt. Der Fehler
wird gemeldet (meldeUndWeiter), und der Merker bleibt ungesetzt: Beim
nächsten Lauf wird es erneut versucht.

@returns wie viele Benachrichtigungen verschickt wurden
```

<a id="standardversand"></a>
## `standardVersand`

```text
Der Versand als PARAMETER, nicht als Import im Rumpf.

── Warum (beim Schreiben des Tests gemerkt) ────────────────────────────────

Der erste Entwurf holte sendMail über ein spätes `require()`. Im Test liess
sich das nicht ersetzen: TypeScript übersetzt `export { sendMail }` zu einem
GETTER auf dem Modulobjekt, und eine Zuweisung darauf verpufft lautlos — der
Test lief gegen den echten Versand und zählte null Meldungen, ohne dass
irgendwo ein Fehler stand.

Das ist nicht nur ein Testproblem: Eine Funktion, deren Aussenwirkung sich
nicht austauschen lässt, ist eine, die man nur im Betrieb prüfen kann.
```

<a id="verschicke"></a>
## `verschicke`

```text
Die Mail. Getrennt, damit pruefeSet() über das WANN entscheidet, nicht über
das WIE.

Die GESTALTUNG steht seit dem 25.09. in utils/mailer.ts (baueAlarmMail) —
dort, wo auch die Bestätigungs- und die Reset-Mail entstehen. Marcos
Vorgabe: „Kannst du die Mail noch etwas schöner gestalten analog der E-Mail
Bestätigen Mail?" Sie war die einzige ohne Hülle.

Hier bleibt, was diese Datei weiss und der Mailer nicht: welcher Alarm für
welches Konto gerissen ist, in welcher Sprache dieses Konto liest und in
welcher Währung die Schwelle gesetzt wurde.

Der Name aus dem Katalog kommt über einen eigenen kleinen Zugriff. Er ist
optional: Ein Set, das rb_sets nicht kennt, trägt in der Mail seine Nummer —
dieselbe Regel wie in der Merkliste.
```

<a id="buildpreisalarmecsv"></a>
## `buildPreisalarmeCsv`

```text
Die Preisalarme EINES Kontos als CSV — für den ZIP-Export.

── Warum eine eigene Datei und keine Spalten an sets.csv ───────────────────

So entschieden, und der Grund steht in der Tabelle selbst: Ein Alarm hängt
an (Set, Zustand) und braucht das Set NICHT zu besitzen — die Notiz an
alleAlarme() sagt es ausdrücklich („Ein Alarm braucht das Set nicht").
Genau das ist der häufige Fall: Man setzt eine Schwelle auf ein Set, das man
kaufen WILL. Als Spalten an sets.csv fielen diese Alarme stillschweigend
heraus, weil es dort keine Zeile für sie gibt.

Dasselbe gilt gegenüber merkliste.csv: Ein Alarm kann auf einem Merkposten
sitzen, muss aber nicht. Die drei Tabellen treffen sich über
(user_id, set_number, condition), ohne dass eine die andere kennen muss
(siehe die Notiz in utils/merkliste.ts) — und genau so bleiben sie auch im
Export getrennt.

── Fünf Spalten, und was BEWUSST fehlt ─────────────────────────────────────

Drin: set_number, condition, richtung, schwelle, currency_code — die Frage,
die der Alarm stellt.

Draussen: `ausgeloest`, `zuletzt_am`, `zuletzt_preis`. Das ist Laufzeit­
zustand, keine Angabe des Nutzers — es sagt, was der Job zuletzt gesehen
hat. Dieselbe Entscheidung wie beim Konfigurations-Export, der
`job_monitor_*` und die Sync-Marker ausnimmt („transiente Laufzeit-Zustände
nicht mit exportieren", routes/settings.ts). Mit exportiert hätte es zwei
Wirkungen, beide falsch: Ein `ausgeloest = true` aus der Datei unterdrückte
die erste Meldung nach dem Wiederherstellen, und ein alter `zuletzt_preis`
stünde in der Übersicht als aktueller Stand.

── Ein Konto, nicht das Blickfeld ──────────────────────────────────────────

`user_id = $1`. Ein Alarm gehört ausdrücklich EINEM Konto und kennt kein
Blickfeld — die Begründung steht an der Route („Das Elternkonto hat nichts
davon, die Wünsche seiner Kinder per Mail zu bekommen"). Ein Export über
scopeIds() wäre hier also nicht bloss weit, sondern falsch.
```
