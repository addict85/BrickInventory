# Begründungen zu `src/merkliste/wantedListe.ts`

Die ausführlichen Kommentare aus `src/merkliste/wantedListe.ts`, wörtlich. Im Code steht je
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
seitenweiseLesen in src/gutscheine/gutscheinPdfSchreiben.ts.)
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
src/einstellungen/settings.ts). In der Vorschau ist er noch nicht gefallen — deshalb
reist der Standard EINMAL je Bericht mit, nicht je Posten: Er ist je Konto
derselbe, und 224-mal dieselbe Zeichenkette waere eine Abschrift.

Warum nicht im Browser nachschlagen: Dort steht er nirgends verlaesslich
(initDefaultCondition in 01-core.js setzt nur die Formularfelder). Der
Server weiss ihn sicher; ein geratener Zustand in einer Vorschau waere
genau die Sorte Behauptung, die hier schon einmal falsch war.
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
beide Oberflächen als Balken zeigen (src/auftraege/importAuftrag.ts), und dieser
Balken trägt ein Kreuz. Ein Import, der das Kreuz nicht beachtet, hätte
einen Abbrechen-Knopf, der lügt.

Alle zehn Posten und nicht bei jedem: Die Frage ist eine Abfrage an die
Datenbank. Derselbe Takt wie beim CSV-Import (routes/sets.ts), und
dieselbe Zusage: Was schon angelegt ist, bleibt — Abbrechen nimmt nichts
zurück, es hört nur auf.
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
