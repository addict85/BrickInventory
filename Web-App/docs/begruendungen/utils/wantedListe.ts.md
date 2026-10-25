# Begründungen zu `utils/wantedListe.ts`

Die ausführlichen Kommentare aus `utils/wantedListe.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „Ich möchte auch Bricklink-Wanted-Listen importieren können. Diese sollen
   dann als manuell erfasste Parts und Minifiguren oder sets importiert
   werden. Anbei habe ich dir ein XML. Bitte beachte dass im xml BL-IDs und
   nicht Rebrickable-IDs enthalten sind."

Und zur Reihenfolge: „Zuerst die restlichen … mit der Option diese über
Bricklink oder noch besser über Rebrickable versuchen aufzulösen."

── Was an Marcos Datei GEMESSEN wurde ──────────────────────────────────────

224 Posten, alle ITEMTYPE=P, alle CONDITION=X, alle MAXPRICE=-1.0000, alle
NOTIFY=N. 24 verschiedene BL-Farben. Die Teilenummern: 203 rein numerisch,
16 Ziffern+Buchstaben, 4 bedruckt (pb/pr), eine mit x-Präfix.

Sets und Minifiguren kommen in dieser Datei NICHT vor. Die Codes dafür (S
und M) stehen hier aus BrickLinks Artenliste, nicht aus Marcos Datei — das
ist der einzige Teil dieses Lesers, der sich an seinem Beispiel nicht
prüfen lässt, und er steht deshalb hier ausdrücklich.

── Warum über eine DATEI und nicht über die BrickLink-API ──────────────────

Marcos Frage vom 19.10.: „Kannst du auch prüfen ob es nicht eine api mit
bricklink gibt damit die wanted listen direkt gelesen und Importiert werden
können".

Geprüft, und die Antwort ist nein. Die BrickLink-Store-API
(api.bricklink.com/api/store/v1 — dieselbe, die clients/bricklink.ts für
Preise anspricht, mit denselben vier Zugangsdaten) führt Bestellungen,
Ladeninventar, Katalog, Preisführer, Farben, Kategorien, Feedback, Coupons,
Mitglied und Item-Mapping. WANTED-LISTEN SIND NICHT DABEI.

Drei unabhängige Belege, die in dieselbe Richtung zeigen: Keine der
verbreiteten Bibliotheken (Python, C#, Java, der Rust-Nachbau) kennt solche
Endpunkte; der API-Changelog nennt keine; und in BrickLinks Forum steht ein
Wunsch vom Dezember 2024, der genau sie fordert. Anbieter, die
„get_wanted_lists" bewerben, verlangen dafür eine SITZUNG mit dem
BrickLink-Login — das ist Abgreifen, nicht die API.

Die Prüfung hatte eine Grenze, und die gehört dazu: bricklink.com war aus
der Arbeitsumgebung gesperrt (getaddrinfo ENOTFOUND), die Doku-Seite selbst
liess sich also nicht öffnen. Das obige stützt sich auf übereinstimmende
Zweitquellen.

Darum bleibt der Weg, den Marco ohnehin geht: die Liste bei BrickLink als
XML herunterladen und hier einlesen. Wer diese Frage erneut stellt, möge
zuerst nachsehen, ob sich seit Oktober 2026 etwas geändert hat.

── Warum ohne XML-Bibliothek ───────────────────────────────────────────────

Eine Wanted-Liste ist flach: <INVENTORY> mit <ITEM>-Kindern, in jedem
höchstens ein Dutzend Textfelder, keine Attribute, keine Verschachtelung.
Dafür eine Abhängigkeit aufzunehmen wäre mehr, als die Sache trägt — anders
als bei den PDFs, wo das Messen ergeben hat, dass es ohne nicht geht.

Gelesen wird je ITEM-Block und NICHT über die ganze Datei: Sonst gewinnt
beim Zählen der erste Treffer, und aus 224 Posten würde einer. (Genau diese
Form hat in diesem Baum schon zweimal etwas falsch gemacht — siehe
seitenweiseLesen in utils/gutscheinPdfSchreiben.ts.)
```

<a id="arten"></a>
## `ARTEN`

```text
BrickLinks Artencodes, soweit sie hier etwas bedeuten.

P, S und M sind die drei, die einen Platz im Bestand haben. B (Book),
G (Gear), C (Catalog), I (Instruction), O (Original Box) und U (Unsorted
Lot) führt diese Anwendung nicht — sie werden GEZÄHLT und gemeldet, nicht
stillschweigend verworfen: Wer eine Liste mit Zubehör hochlädt, soll lesen,
dass davon etwas liegengeblieben ist.
```

<a id="sicherheit"></a>
## Abschnitt

```text
Der Mensch hat sie in der Vorschau EINGETRAGEN.

Eine eigene Stufe und nicht 'zuordnung': Dort steht etwas, das im Katalog
nachgesehen wurde; hier steht, was Marco von Hand hingeschrieben hat.
Beide sind so gut wie ihre Quelle, aber sie haben verschiedene Quellen —
und der Bericht soll nicht behaupten, der Katalog habe geliefert, was
jemand getippt hat.
```

<a id="aufloesung"></a>
## Abschnitt

```text
Name und Farbwert zur Nummer — beide aus rb_colors.

Sie reisen MIT, statt spaeter nachgeschlagen zu werden: Der Anleger
schreibt `color_name` an die Zeile, und die Teileliste liest den Namen
von dort. Bis zum 19.10. wurden sie nicht uebergeben; der Hex-Wert fiel
in der Anzeige auf den Katalog zurueck, der NAME nicht. Marcos Befund:
ein Farbpunkt ohne Beschriftung.
```

<a id="loeselokalauf"></a>
## `loeseLokalAuf`

```text
Lokal auflösen — ohne jeden Abruf bei einem fremden Dienst.

── Die drei Stufen, und warum sie getrennt bleiben ─────────────────────────

1. `bl_zuordnung.bl_id = X` — jemand hat die abweichende Nummer eingetragen.
   Das ist eine Abbildung, kein Schluss.
2. `bl_zuordnung.rb_id = X AND bl_id IS NULL` — jemand hat nachgesehen und
   vermerkt: keine abweichende Nummer. Also ist die BL-Nummer die
   RB-Nummer. Auch das ist eine Abbildung (Migration 0037 erklärt diesen
   NULL-Wert ausdrücklich).
3. Die Nummer steht so im Rebrickable-Katalog. Das ist WAHRSCHEINLICH
   richtig — bei den meisten Teilen benutzen beide Dienste dieselbe Nummer
   —, aber es hat niemand nachgesehen. Es gibt Nummern, die bei BrickLink
   etwas anderes bezeichnen als bei Rebrickable.

Die drei zusammenzuwerfen wäre bequem und würde Stufe 3 wie eine Abbildung
aussehen lassen. Sie bleibt deshalb getrennt und wird in der Vorschau
einzeln gezählt — Marco entscheidet, ob er sie nimmt.

Die FARBE kommt aus rb_colors.bl_color_id. Das ist katalogweit gepflegt und
kennt keine Stufen: entweder die Zuordnung steht da oder nicht.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Die offenen Posten über Rebrickable auflösen.

── Marcos Vorgabe zur Reihenfolge ──────────────────────────────────────────

  „Zuerst die restlichen … mit der Option diese über Bricklink oder noch
   besser über Rebrickable versuchen aufzulösen."

„Noch besser über Rebrickable" ist nicht nur besser, sondern der einzige
DIREKTE Weg: BrickLink kennt keine Rebrickable-Nummern. Über BrickLink
ginge nur ein Umweg (Posten abfragen, Name und Alternativnummern holen, die
bei Rebrickable suchen) — zwei Sprünge mit je eigener Fehlerquelle. Deshalb
steht hier Rebrickable und nicht beides; käme der Umweg, wäre er eine
eigene Funktion und keine stillere Hälfte dieser.

── Nur die OFFENEN, und nur auf Verlangen ──────────────────────────────────

Jeder Abruf kostet aus Marcos Tageskontingent. Angefragt wird deshalb
ausschliesslich, was lokal nichts ergab — bei seiner Datei wären das die
Posten, die `loeseLokalAuf` offen lässt, nicht alle 224.

Teile allein: Für Figuren und Sets führt Rebrickable keine BrickLink-IDs in
external_ids (die Notiz steht in utils/bricklinkLink.ts: „Rebrickable hat
external_ids nur bei Parts"). Eine Abfrage dafür wäre ein Abruf, der nichts
finden KANN.
```

<a id="wantedfortschritt"></a>
## `WantedFortschritt`

```text
Wie weit ist der Import? — für den Balken in der Oberfläche.

── Marcos Wunsch vom 20.10. ────────────────────────────────────────────────

„kannst du beim Import auch den Fortschritt mit einem Fortschrittsbalken
 anzeigen?"

Zwei Phasen, weil zwei verschiedene Dinge dauern — und die eine dauert
ungleich länger:

  rebrickable  Die offenen Nummern bei Rebrickable nachfragen. Jeder Abruf
               geht durch die Hintergrunddrossel: EINE Anfrage je 1,5
               Sekunden (utils/rateLimiter.ts). Fünfzig offene Posten sind
               also über eine Minute, in der ohne Balken nichts passiert.
  schreiben    Die Posten in den Bestand legen. Je Posten ein paar
               Abfragen, dazu beim ersten Mal die Katalogpflege.

`gesamt` ist die Zahl, die für DIESE Phase gilt — bei `rebrickable` die der
offenen Teile, bei `schreiben` die aller Posten. Ein gemeinsamer Nenner über
beide Phasen wäre eine Zahl, die niemand nachrechnen kann; zwei ehrliche
Abschnitte sind besser als ein geschätzter Balken.
```

<a id="postenergebnis"></a>
## `PostenErgebnis`

```text
Was aus einem Posten geworden ist.

── Warum hier Bild und Name mitreisen (Marcos Vorschau) ───────────────────

  „noch besser wäre wenn es beim Import die zu importierende Liste
   vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
   Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
   rebrickable ids ergänzen könnte"

Eine Vorschau, die nur Nummern zeigt, ist keine. Wer 224 Posten prüfen
soll, erkennt am BILD in einer Sekunde, dass Posten 57 der falsche Stein
ist — an „3001 → 3001, katalogtreffer" erkennt er es nie.

Die Beschreibung kommt aus den KATALOGEN dieses Baums, ohne jeden Abruf
(siehe beschreibePosten). Was dort fehlt, bleibt leer statt geraten.
```

<a id="postenergebnis-2"></a>
## Abschnitt

```text
Derselbe Grund als Kennung, für die Oberfläche.

`grund` ist ein deutscher Satz — richtig fürs Protokoll, falsch in einer
englischen Tabelle. Die Kennung lässt die Oberfläche den Text in der
Sprache des Betrachters setzen; `blFarbe` steht in der Zeile und kann
dort eingesetzt werden.

Ein Fehler beim Anlegen hat keine Kennung: Dort steht die Meldung der
Ausnahme, und die lässt sich nicht in Fälle einteilen.
```

<a id="korrektur"></a>
## `Korrektur`

```text
Eine Korrektur aus der Vorschau.

── Warum der INDEX und nicht die Nummer ────────────────────────────────────

Eine Wanted-Liste darf denselben Posten zweimal enthalten (Marcos Datei hat
3001 in 24 Farben, und BrickLink hindert niemanden daran, ihn in derselben
Farbe zweimal aufzuführen). Ein Schlüssel aus Art, Nummer und Farbe träfe
dann zwei Zeilen, und die Korrektur landete auf der falschen — oder auf
beiden.

Der Index ist eindeutig, weil der Leser die Datei in einer festen Reihen-
folge zerlegt (leseWantedListe geht Posten für Posten durch). Damit er
nicht ins Leere zeigt, wenn zwischen Vorschau und Schreiben eine ANDERE
Datei gewählt wurde, reisen Art und Nummer als Gegenprobe mit: Stimmen sie
nicht, wird die Korrektur abgewiesen statt angewandt.
```

<a id="korrektur-2"></a>
## Abschnitt

```text
Die Werte AUS DER DATEI, von Hand geändert — Marcos Wunsch vom 21.10.:
„Alle Spalten sollen bearbeitbar sein in der Vorschau, damit der Inhalt
vor dem Import korrigiert werden kann."

Bis dahin liessen sich nur Nummer und Farbe ändern. Das waren die beiden
Felder, die der Import AUFLÖST — die übrigen standen in der Datei und
galten als gesetzt. Wer sich bei der Menge vertippt oder den Preis erst
nachträglich kennt, musste die Datei ändern und neu einlesen.

Nicht dabei sind Bild, Name und die BrickLink-Nummer selbst:
  - Bild und Name stehen im KATALOG und gelten für alle Konten. Sie aus
    einem Import-Dialog zu überschreiben wäre Katalogpflege an der
    falschen Stelle; dafür gibt es den Detaildialog.
  - Die BrickLink-Nummer ist die Quellangabe und zugleich die Gegenprobe
    (`blId` oben). Sie zu ändern hiesse „ich meine ein anderes Teil" —
    und genau dafür ist `rbId` da, die zusätzlich die Zuordnung merkt.

`undefined` heisst „nicht angefasst", wie bei rbId/rbFarbe.
```

<a id="wantedbericht"></a>
## Abschnitt

```text
Der Standardzustand des Kontos — fuer die Vorschau.

── Marcos Bitte vom 20.10. ───────────────────────────────────────────────

  „ja, bitte die Zustandsspalte noch in die Vorschau"

Je Posten steht der Zustand AUS DER DATEI (`zustand`), und der ist bei
CONDITION=X und bei fehlender Angabe null — dann gilt der Standard des
Kontos. Die Vorschau soll aber zeigen, was ANGELEGT wird, nicht was in der
Datei steht.

Aufgeloest wird der Zustand erst beim Schreiben (zustandFuerPreis in
utils/settings.ts). In der Vorschau ist er noch nicht gefallen — deshalb
reist der Standard EINMAL je Bericht mit, nicht je Posten: Er ist je Konto
derselbe, und 224-mal dieselbe Zeichenkette waere eine Abschrift.

Warum nicht im Browser nachschlagen: Dort steht er nirgends verlaesslich
(initDefaultCondition in 01-core.js setzt nur die Formularfelder). Der
Server weiss ihn sicher; ein geratener Zustand in einer Vorschau waere
genau die Sorte Behauptung, die hier schon einmal falsch war.
```

<a id="beschreibeposten"></a>
## `beschreibePosten`

```text
Zu jedem aufgelösten Posten Name, Bild und Farbbezeichnung holen.

── Woraus, und was NICHT ───────────────────────────────────────────────────

Aus den Katalogen dieses Baums, in DREI Abfragen für die ganze Liste (eine
je Art) — nicht eine je Posten. Marcos Datei hat 224 Zeilen; 224 Abfragen
wären eine Vorschau, auf die man wartet.

Je Art zwei Quellen, in dieser Reihenfolge:

  Teile    part_catalog / part_color_catalog  (hier gepflegt, mit Bild je
           Teil UND Farbe), sonst rb_parts    (aus dem CSV-Abgleich)
  Figuren  minifigs_catalog,                  sonst nichts
  Sets     set_catalog,                       sonst rb_sets

Kein Abruf bei Rebrickable oder BrickLink: Die Vorschau soll SOFORT da sein
und auch ohne Netz etwas zeigen. Was der Katalog nicht kennt, bleibt leer —
eine leere Zelle ist eine ehrliche Auskunft, ein geratener Name nicht.

Das Farbbild haengt an Teil UND Farbe (ein roter 2x4 sieht anders aus als
ein blauer, siehe merkeTeilFarbe); gibt es keines fuer diese Farbe, faellt
es auf das allgemeine Teilebild zurueck.

── Auch fuer die OFFENEN Posten, und warum das trotzdem ehrlich ist ───────

Ein Posten ohne Rebrickable-Nummer wird unter seiner BRICKLINK-Nummer
nachgesehen. Das ist keine Abbildung und wird auch nicht als eine
ausgegeben: `geraten: true` sagt es, die Zeile bleibt `offen`, und ihr
Grund bleibt stehen.

Es ist aber genau die Auskunft, die Marco zum Entscheiden braucht. Steht in
der Zeile „9999 — (nichts bekannt)", kann er nur raten; steht dort
„9999 — Brick 2 x 2 (Name unter der BrickLink-Nummer gefunden)", sieht er,
worum es geht und kann die Nummer eintragen. Die Information
wegzuwerfen, weil sie nicht aus einer Abbildung stammt, hilft niemandem —
sie muss nur als das dastehen, was sie ist.
```

<a id="wendekorrekturenan"></a>
## `wendeKorrekturenAn`

```text
Die Korrekturen aus der Vorschau auf die Auflösung legen.

Jede wird GEGENGEPRÜFT: Art und BrickLink-Nummer am angegebenen Index
müssen passen. Sonst wurde zwischen Vorschau und Schreiben eine andere
Datei gewählt, und die Korrektur würde auf einen fremden Posten wirken —
lautlos, denn beide Zahlen sähen plausibel aus.

Eine abgewiesene Korrektur wird GEMELDET, nicht übergangen (siehe
`korrekturenAbgewiesen` im Bericht).
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
Eine Wanted-Liste einlesen — als Vorschau oder wirklich.

── Warum die Vorschau derselbe Weg ist ─────────────────────────────────────

Sie liest, löst auf und zählt genau wie der Ernstfall; nur das Schreiben
bleibt aus. Zwei getrennte Wege hätten auseinanderlaufen können — und dann
verspräche die Vorschau etwas, das der Import nicht tut. Das ist die Sorte
Fehler, die niemand sieht, weil beide Zahlen plausibel aussehen.

── Was angelegt wird, und warum es HEREINGEGEBEN wird ──────────────────────

„als manuell erfasste Parts und Minifiguren oder sets" — also über
addManualPart(), addManualFig() und addSet(), die drei Wege, die auch das
Formular benutzt. Kein eigenes INSERT: Dort hängen Lagerort, Preisregel,
Katalognachtrag und die Erfassungszeile dran, und jede Abschrift davon
verliert etwas (die Begründung steht an addManualPart).

Nur: addManualPart und addManualFig liegen in routes/. Mein erster Entwurf
holte sie mit require('../routes/parts') hierher — und test/schichten.test.js
hat das abgewiesen: „Neue Abhaengigkeit von einer Fachdatei auf eine ROUTE.
Die Funktion gehoert in die Schicht, die sie braucht — sonst zieht jeder
Nutzer den HTTP-Apparat mit."

Die Ausnahmeliste dieses Tests ist LEER, und das ist ein erarbeiteter Stand
(der Kommentar dort sagt, dass zwei von acht Einträgen nur wegen eines
Fehlers in der Regel dastanden). Der erste neue Eintrag wäre ein
Rückschritt — also ist die Abhängigkeit umgedreht: Die ROUTE kennt die
Routen und gibt die drei Anleger herein. Diese Datei kennt nur ihre Form.

── MAXPRICE IST der Kaufpreis — Marcos Entscheidung vom 21.10. ─────────────

  „Kannst du bei der Bricklink-Wanted-Listen xml-Import das Attribut:
   <MAXPRICE>0.8578</MAXPRICE> auf den Kaufpreis mappen. Der Betrag
   entspricht der Währung in den Einstellungen des Users."

Hier stand das Gegenteil, und zwar begründet: „MAXPRICE ist eine SUCHGRENZE
(„bis so viel würde ich zahlen"), kein bezahlter Preis. Als Kaufpreis
übernommen stünde in der Finanzansicht ein Betrag, den niemand ausgegeben
hat."

Das war eine Annahme über Marcos Arbeitsweise, keine Tatsache über das
Format — und sie stimmte nicht. Er trägt dort den bezahlten Preis ein. Wer
die Daten führt, bestimmt ihre Bedeutung; die alte Begründung steht hier,
damit der Nächste sie nicht erneut herleitet.

── Was dabei NICHT geprüft werden kann ─────────────────────────────────────

Die WÄHRUNG. Eine BrickLink-Wanted-Liste führt keine, und der Wert reist
als blosse Zahl. Übernommen wird er deshalb in der Währung des Kontos
(`currency` in den Einstellungen) — so, wie Marco es gesagt hat. Eine
Umrechnung gibt es nicht und kann es nicht geben: Es ist nicht bekannt, aus
welcher Währung umzurechnen wäre.

Unverändert bleibt, was der Leser schon tut: `-1.0000` und `0` sind KEIN
Preis und werden null (leseWantedListe, `preisRoh > 0`). Marcos erste Datei
trug in allen 224 Posten `-1.0000`; für solche Listen holt weiterhin der
Marktpreis den Wert. Steht ein Preis da, entfällt dieser Abruf — ein Posten
weniger, der auf BrickLink warten muss.
```

<a id="anleger"></a>
## `Anleger`

```text
Die drei Anleger, die der Import braucht.

Als Schnittstelle und nicht als Einfuhr: So kennt diese Datei nur die FORM
(„etwas, das ein Teil anlegt") und nicht den Ort. Die Route steckt die
echten Funktionen hinein; ein Test könnte Zähler hineinstecken.

Die Reihenfolge der Parameter folgt den echten Funktionen, damit das
Hereingeben eine Zuweisung bleibt und keine Übersetzung: addManualPart und
addManualFig nehmen (uid, body), addSet nimmt die Setnummer zuerst — daher
die eigene Form für `set`.
```

<a id="importierewantedliste"></a>
## Abschnitt

```text
Eine eingetragene Rebrickable-Nummer MERKEN.

Hereingegeben und nicht hier gerufen — dieselbe Begründung wie beim
Anleger, nur milder: merkeBlNummer liegt unter utils/ und wäre von hier
aus erreichbar. Sie als Rückruf zu nehmen hält diese Funktion aber
schreibfrei bis auf den Anleger, und ein Test kann zählen, was gemerkt
wurde, ohne eine Datenbank dafür zu brauchen.

Nur beim ECHTEN Import, nie in der Vorschau: Eine Vorschau, die etwas
speichert, ist keine.
```

<a id="importierewantedliste-2"></a>
## Abschnitt

```text
Wie weit es ist — für den Balken in der Oberfläche (siehe
WantedFortschritt). Wird SYNCHRON gerufen und darf nichts werfen; der
Aufrufer schreibt damit eine Zeile in seinen Strom.

Hereingegeben und nicht hier geschrieben, aus demselben Grund wie beim
Anleger: Diese Funktion kennt keine HTTP-Antwort, und ein Test kann die
Meldungen einsammeln, ohne eine Leitung dafür zu brauchen.
```

<a id="importierewantedliste-3"></a>
## Abschnitt

```text
„Soll ich aufhören?" — alle zehn Posten gefragt.

Der Fortschritt steht seit dem 20.10. auch im Auftragsdatensatz, den
beide Oberflächen als Balken zeigen (utils/importAuftrag.ts), und dieser
Balken trägt ein Kreuz. Ein Import, der das Kreuz nicht beachtet, hätte
einen Abbrechen-Knopf, der lügt.

Alle zehn Posten und nicht bei jedem: Die Frage ist eine Abfrage an die
Datenbank. Derselbe Takt wie beim CSV-Import (routes/sets.ts), und
dieselbe Zusage: Was schon angelegt ist, bleibt — Abbrechen nimmt nichts
zurück, es hört nur auf.
```

<a id="importierewantedliste-grund"></a>
## `grund`

```text
── Eine Farbe, die sich nicht abbilden laesst, wird NICHT erfunden ────

Marcos Befund vom 19.10.: „Die Farbe wurde nicht immer uebernommen und
die Teile sind nun mehrfach vorhanden (bsp 3001)."

Hier stand `color_id: a.rbFarbe ?? 0`. Die 0 ist bei Rebrickable aber
SCHWARZ und nicht „keine Farbe" — die Warnung steht woertlich in
routes/parts.ts („fuer die Bildsuche fatal: 0 ist bei Rebrickable
SCHWARZ"). Ein Posten mit unbekannter Farbe landete damit als
schwarzes Teil im Bestand, NEBEN demselben Teil in seiner richtigen
Farbe. Das ist das Doppelte, das Marco sieht.

NACHGESTELLT: Liste mit 3001 in BL-Farbe 5 (abbildbar) und BL-Farbe 85
(nicht abbildbar) ergab zwei Zeilen, color_id 4 und color_id 0.

Der Bericht wusste es die ganze Zeit — `farbeOffen` zaehlt genau diese
Posten — und schrieb sie trotzdem. Jetzt bleiben sie OFFEN, mit Grund.
Damit fehlt der Posten im Bestand, statt falsch darin zu stehen; die
Vorschau (Stufe 3) gibt Marco die Gelegenheit, die Farbe zu setzen.
── Der Grund kommt ZWEIMAL: als Satz und als Kennung ─────────────────

Der Satz ist für das Protokoll und für jeden Aufrufer, der nur lesen
will. Die Kennung ist für die Oberfläche: Sie zeigt den Grund in der
Sprache des Betrachters, und ein deutscher Satz in einer englischen
Tabelle ist genau das, was dabei herauskam, bevor es sie gab (am
laufenden Server gesehen: „open / BrickLink-Farbe 85 ist im Katalog
keiner Rebrickable-Farbe zugeordnet" zwischen lauter englischen
Spalten).

Dieselbe Teilung wie bei utils/fehlerTexte.ts: EINE Entscheidung, zwei
Sprachen am Rand.
```

<a id="importierewantedliste-4"></a>
## Abschnitt

```text
── Eine NACHGESCHLAGENE Nummer wird GEMERKT ──────────────────────

Marcos Bitte war „rebrickable ids ergänzen" — und wer sie einmal
eingetragen hat, soll sie beim nächsten Import nicht wieder
eintippen. Gemerkt wird in bl_zuordnung; dort liest loeseLokalAuf
sie als Stufe 1 ('zuordnung') wieder, also als Abbildung und nicht
als Vermutung.

── Warum 'rebrickable' dazugehört (Marcos Frage vom 20.10.) ──────

  „wenn das gleiche xml-File 2x importiere sollte der 2. Lauf massiv
   schneller sein korrekt?" … „Wieso wird das Mapping BL zu Rebr.
   nicht gespeichert?"

Hier stand allein 'korrigiert', begründet mit: „Die anderen Stufen
kommen schon von dort oder aus dem Katalog." Das trifft auf drei der
vier anderen zu — 'zuordnung' und 'gleich_vermerkt' stehen schon in
bl_zuordnung, 'katalogtreffer' ist wirklich geraten. Auf
'rebrickable' trifft KEINES von beidem zu: Sie steht nirgends, und
sie ist nicht geraten. Die Stufe ist beim Aufzählen schlicht unter
„die anderen" gefallen.

GEMESSEN: dieselbe Datei zweimal importiert, mit einem Zähler auf
dem Rebrickable-Client. Lauf 1 zwei Abrufe, Lauf 2 noch EINER —
`blTeilZuRb 98765`, obwohl die Antwort beim ersten Mal schon dastand.
bl_zuordnung war nach beiden Läufen leer. Bei einer Liste mit 224
Posten kostet jeder weitere Lauf dieselben 1,5 Sekunden je Posten
mit abweichender Nummer, und jedes Mal aus dem Tageskontingent.

Dass es eine Abbildung ist und keine Vermutung, steht an blTeilZuRb
selbst: „Jeder Treffer muss in seinen external_ids.BrickLink die
GESUCHTE Nummer tragen" — nachgeschlagen und gegengeprüft, nur von
Rebrickable statt von Hand.

NICHT gemerkt wird weiterhin ein Posten, den auch Rebrickable nicht
auflösen konnte: Er steht gar nicht hier (er ist 'offen' und wird
nie angelegt), und ein „nachgesehen, nichts gefunden" kennt
bl_zuordnung nicht — die Tabelle führt Abbildungen, keine
Fehlanzeigen. Diese Posten kosten jeden Lauf erneut einen Abruf.

Ein Fehlschlag hier bricht den Import nicht ab: Der Posten steht im
Bestand, und das ist die Hauptsache. Die Notiz ist Bequemlichkeit.
```

<a id="importierewantedliste-beschreibung"></a>
## `beschreibung`

```text
── Name und Bild an die Posten — IMMER, nicht nur in der Vorschau ───────

── Marcos Befund vom 21.10. ──────────────────────────────────────────────

  „Nach dem XML-Import verschwinden die Bilder im Importdialog. vor und
   während dem Import sind diese sichtbar."

Hier stand der Aufruf WEIT OBEN und nur für die Vorschau, begründet mit:
„Beim echten Import sieht sie niemand, und drei Abfragen über 224 Posten
umsonst zu machen wäre eine Verzögerung ohne Gegenwert."

Die Annahme war falsch. Der Dialog bleibt nach dem Schreiben offen und
zeichnet dieselbe Tabelle mit der ANTWORT neu (zeichneTabelle in
public/js/18-wanted-xml.js). Wer dort hinsieht, sieht also sehr wohl
etwas — und seit es diese Regel gab, sah er leere Zellen. GEMESSEN:

    VORSCHAU   : {"name":"Brick 2 x 4","bild":"https://…/3001-rot.png"}
    NACH IMPORT: {}

Nicht nur das Bild fehlte, auch der Name; auf Marcos Bildschirmfoto ist
die Spalte NAME über alle 24 Zeilen leer.

── Warum NACH der Schleife und nicht davor ──────────────────────────────

Davor wären die eben angelegten Teile noch nicht im Katalog: merkeTeil()
und merkeTeilFarbe() schreiben Name und Bild erst beim Anlegen (über
addManualPart). Ein Aufruf vorher zeigte für genau die Posten nichts, um
die es beim Import geht. Hier stehen sie drin.

Die drei Abfragen sind drei für die GANZE Liste, nicht drei je Posten —
darauf ist beschreibePosten gebaut, und test/wanted-liste-vorschau-db
prüft es eigens („macht nicht eine Abfrage je Posten").

Bei einem Abbruch trägt `bericht.posten` weniger Zeilen als `auf`; die
Zuordnung über den Index gilt trotzdem, weil die Schleife von vorne
zählt und nur früher aufhört.
```
