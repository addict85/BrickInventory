# Begründungen zu `src/merkliste/wantedAufloesung.ts`

Die ausführlichen Kommentare aus `src/merkliste/wantedAufloesung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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
external_ids (die Notiz steht in src/katalog/bricklinkLink.ts: „Rebrickable hat
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
               Sekunden (src/katalog/rateLimiter.ts). Fünfzig offene Posten sind
               also über eine Minute, in der ohne Balken nichts passiert.
  schreiben    Die Posten in den Bestand legen. Je Posten ein paar
               Abfragen, dazu beim ersten Mal die Katalogpflege.

`gesamt` ist die Zahl, die für DIESE Phase gilt — bei `rebrickable` die der
offenen Teile, bei `schreiben` die aller Posten. Ein gemeinsamer Nenner über
beide Phasen wäre eine Zahl, die niemand nachrechnen kann; zwei ehrliche
Abschnitte sind besser als ein geschätzter Balken.
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

