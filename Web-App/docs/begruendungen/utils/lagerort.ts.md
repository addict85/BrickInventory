# Begründungen zu `utils/lagerort.ts`

Die ausführlichen Kommentare aus `utils/lagerort.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Lagerort — wo liegt das eigentlich?

── Warum es diesen Helfer gibt ─────────────────────────────────────────────

Der Lagerort hängt an ZWEI Tabellen (`sets` und `parts`), und die drei
Dinge, die man damit tut — setzen, auflisten, räumen — sind für beide
dieselben. Stünden sie in den jeweiligen Routen, gäbe es jede Regel zweimal:
die Längenbegrenzung, das Trimmen, die Gleichsetzung von leer und NULL. Bei
solchen Paaren läuft erfahrungsgemäss eine der beiden Fassungen irgendwann
auseinander — im Baum ist das mehrfach passiert (siehe die Begründung an
utils/handlers/shared.ts).

── Die Orte kommen jetzt aus einer TABELLE — und warum das früher anders war

Hier stand: „Ein Lagerort ist ein Name, den sich jemand ausdenkt. Er hat
keine Eigenschaften und keinen Lebenslauf. Die Liste der Orte IST die Liste
der belegten Orte." Das war für den Anfang richtig und hat sich als zu eng
erwiesen. Marcos Vorgabe:

  „Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man
   auch gleich neue Auswahlwerte erfassen kann. Die Werte sollen pro User
   verwaltet werden können und sollen in den Einstellungen bearbeitbar
   sein."

Eine abgeleitete Liste kann drei Dinge nicht, die alle drei verlangt sind:
einen Ort ANLEGEN, bevor etwas darin liegt; ihn UMBENENNEN, ohne jedes Set
einzeln anzufassen; ihn LÖSCHEN. Deshalb `storage_locations` (Migration
0020) — der Vorrat.

── Die Zuordnung ist eine ID — und hier stand das Gegenteil ────────────────

Bis Migration 0031 stand hier: „Die Zuordnung bleibt der freie Text in
`sets.storage` / `parts.storage`. Eine Fremdschlüssel-ID hätte jede
bestehende Zeile umschreiben müssen und jede Abfrage um einen JOIN erweitert
— für einen Namen, der ohnehin eindeutig ist."

Der letzte Halbsatz war der Fehler: Eindeutig ist der Name im VORRAT, und
zwar ohne Rücksicht auf Gross-/Kleinschreibung (`lower(name)`). Am Bestand
stand dagegen die getippte Schreibweise, zeichengenau verglichen. Damit
konnte am Set ein Name stehen, den der Vorrat nicht führt — und dann wanderte
er beim Umbenennen nicht mit, und das Löschen hielt den Ort für leer.
Nachgestellt, nicht vermutet; der Ablauf steht in der Migration.

Die beiden Kosten von damals sind geblieben und bezahlt: Die bestehenden
Zuordnungen wurden auf Marcos Ansage weggeworfen statt nachgefüllt, und die
Abfragen, die den Ort ANZEIGEN, tragen jetzt einen LEFT JOIN auf den Vorrat.

[lagerorte] zählt weiter, was WIRKLICH belegt ist; [orteVon] sagt, was zur
Wahl steht. Beides wird gebraucht, und es ist nicht dasselbe.
```

<a id="tabellen"></a>
## `TABELLEN`

```text
Die drei Tabellen mit einem Lagerort — Whitelist, damit nie ein
 Request-Wert in den Tabellennamen gerät.

 Die Minifigur kam am 24.09. dazu (Migration 0024). 0018 hatte sie
 uebersehen: „Ein Set liegt in einer Schachtel, lose Teile liegen in einer
 Kiste. Beide Fragen sind dieselbe Frage" — die Figur ist dieselbe Frage
 zum dritten Mal. Alles, was ueber diese Liste laeuft (Umbenennen,
 Loeschen, Zaehlen), nimmt sie damit von selbst mit; genau darum steht sie
 hier und nicht dreimal einzeln.
```

<a id="setzelagerort"></a>
## `setzeLagerort`

```text
Lagerort setzen — für die Zeilen EINES Kontos.

`besitzerIds` kommt von writableIds()/resolveWriteTarget(): Wer schreiben
darf, entscheidet src/haushalt/haushalt.ts, nicht diese Funktion. Sie bekommt die
fertige Menge und fragt nicht nach.

@returns wie viele Zeilen betroffen waren (0 = es gibt nichts zu setzen)
```

<a id="setzelagerort-setzen"></a>
## `setzen`

```text
── Die Zuordnung ist seit Migration 0031 eine ID ────────────────────────

Aufgelöst wird sie in einer Unterabfrage je ZEILE und nicht einmal
vorher. Das hat einen Grund, der im Haushalt sichtbar wird: Derselbe
Name kann in zwei Konten liegen, und jedes hat seine eigene Zeile im
Vorrat (ein Regal ist ein Regal in EINER Wohnung, Migration 0020). Die
Unterabfrage greift über `l.user_id = t.user_id` genau die des
Besitzers — eine vorher aufgelöste ID träfe für das zweite Konto die
falsche Wohnung.

`lower(...)`: Der Vorrat ist ohne Rücksicht auf Gross-/Kleinschreibung
eindeutig. Genau hier lag der Fehler des alten Entwurfs — er schrieb die
GETIPPTE Schreibweise an den Bestand, und die musste nicht die des
Vorrats sein (nachgestellt in der Migration).

Dieselbe Anweisung leert auch: Mit `ort = null` ist `lower($2)` NULL, die
Unterabfrage findet nichts und setzt NULL. Eine zweite Anweisung dafür
wäre eine zweite Stelle, die stimmen muss.
```

<a id="setzelagerort-2"></a>
## Abschnitt

```text
── Anlegen und Zuordnen gehören zusammen ────────────────────────────────

Ein Name, den es im Vorrat noch nicht gibt, kommt hinein — das ist Marcos
„man kann auch gleich neue Auswahlwerte erfassen". Mit dem Namen als
Zuordnung ging das NACH dem UPDATE, mit der ID muss es davor stehen: Ohne
Zeile im Vorrat gibt es keine ID, und die Unterabfrage setzte NULL.

Die Reihenfolge kostet eine Eigenschaft, die der alte Weg nebenbei hatte —
„ein Ort, der keiner Zeile zugeordnet werden konnte, hinterlässt keinen
Eintrag im Vorrat". Deshalb beides in EINER Transaktion mit Rücknahme,
wenn keine Zeile getroffen wurde. Sonst legte jedes Setzen auf ein
fremdes Set einen Ort an, den niemand bestellt hat.
── Nur in die Konten, die auch wirklich eine Zeile halten ──────────────

Marcos Befund: „Wenn ich in den Filtern nach einem Account filtere,
erscheinen die falschen Lagerorte im Filter und in den Sets ist keiner
gesetzt."

NACHGEMESSEN, Hauptkonto mit einem Unterkonto, das Set gehört dem
Hauptkonto, Ort „Estrich" darauf gesetzt:

    Vorrat Hauptkonto                : ['Estrich']
    Vorrat Unterkonto                : ['Estrich']   ← falsch
    Sets des Unterkontos MIT Lagerort: 0

Hier stand `SELECT id, $2 FROM users WHERE id = ANY($1)` — der Ort entstand
in JEDEM Konto, in das der Aufrufer schreiben darf. Bei einem Haushalt mit
drei Unterkonten legt ein einziges Setzen also vier Vorratszeilen an, von
denen drei leer bleiben. Genau die stehen danach im Kontofilter und zeigen
kein einziges Set.

Richtig ist: Der Ort gehört in die Konten, deren Zeilen er beschreibt. Die
werden deshalb VORHER ermittelt. Das ersetzt zugleich den früheren
Rücknahme-Umweg (eine Ausnahme, die im Fang wieder zu 0 wurde): Trifft die
Auswahl kein Konto, ist nichts zu tun, und es entsteht auch kein Eintrag —
dieselbe Eigenschaft, nur ohne Transaktion, die etwas zurücknimmt, das sie
gar nicht hätte tun müssen.
```

<a id="ortevon"></a>
## `orteVon`

```text
Der Vorrat EINES oder MEHRERER Konten.

── Warum die Aufrufer die IDs mitbringen ──────────────────────────────────

Dieselbe Trennung wie bei [setzeLagerort]: Wer wessen Liste sehen darf,
entscheidet src/haushalt/haushalt.ts, nicht diese Datei. Hier steht nur, wie man
sie liest.

Sortiert wird ohne Rücksicht auf Gross-/Kleinschreibung — sonst stünde
„regal" hinter „Zimmer", und niemand fände es.
```

<a id="legeortan"></a>
## `legeOrtAn`

```text
Einen Ort in den Vorrat legen — oder den vorhandenen zurückgeben.

Kein Fehler, wenn es ihn schon gibt: Das Anlegen wird aus zwei Richtungen
gerufen — aus den Einstellungen (dort WILL man die Absage sehen) und
nebenbei beim Setzen eines Lagerorts (dort wäre sie Unfug). Die Absage
`lagerort_doppelt` gehört deshalb in die Route der Einstellungen, nicht
hierher; sie entscheidet sich an [war_neu].
```

<a id="benenneortum"></a>
## `benenneOrtUm`

```text
Einen Ort umbenennen.

── Hier stand die Schleife, die den Namen in drei Tabellen nachschrieb ─────

Mit dem NAMEN als Zuordnung musste sie da sein: „Bliebe sie beim Umbenennen
stehen, stünden die Sets danach in einem Ort, den die Auswahlliste nicht
mehr kennt — ein Umbenennen wäre in Wahrheit ein Verlieren." Dazu eine
Transaktion, weil ein halber Durchlauf genau diesen Zustand hinterliesse.

Seit Migration 0031 ist die Zuordnung eine ID, und damit ist dieser ganze
Absatz gegenstandslos: Es gibt nichts nachzuschreiben, also auch keinen
halben Durchlauf. Eine Anweisung, eine Zeile, fertig — und der Fall, in dem
die Schleife eine Schreibweise NICHT traf (sie verglich zeichengenau), kann
nicht mehr entstehen. Nachgewiesen in test/lagerort-id-db.test.js.
```

<a id="lagerorte"></a>
## `lagerorte`

```text
Alle belegten Lagerorte im Blickfeld, mit Anzahl.

── Warum EINE Abfrage über beide Tabellen ──────────────────────────────────

Zwei getrennte Listen zu liefern hiesse, dass die Oberfläche sie zusammen-
führt — und zwar jede für sich, in Web und App getrennt. Ein Ort, in dem
sowohl ein Set als auch lose Teile liegen, stünde dann je nach Oberfläche
einmal oder zweimal da.

Gezählt wird nach ZEILEN, nicht nach Stückzahl: „In Kiste 3 liegen 4 Sets
und 120 Teilesorten" beantwortet „lohnt sich das Nachsehen?"; die Summe der
Einzelstücke beantwortet gar nichts.

── Warum die Figuren EIGEN gezählt werden ──────────────────────────────────

Seit Migration 0024 trägt auch eine Minifigur einen Lagerort. Sie zu den
Teilesorten zu addieren wäre die bequeme Lösung und die falsche: „18
Teilesorten" hiesse dann mal 18 Teilesorten und mal 12 Teilesorten und 6
Figuren, und niemand könnte der Zahl ansehen, welches davon gemeint ist.
```

<a id="vorgabe-schluessel"></a>
## `VORGABE_SCHLUESSEL`

```text
═══════════════════════════════════════════════════════════════════════════
Die VORGABE — welcher Ort beim Erfassen schon dasteht
═══════════════════════════════════════════════════════════════════════════

Marcos Vorgabe: „Weiter möchte ich ein Lagerort in den Einstellungen als
Default setzen können. Der soll dann bei einer Neuerfassung bereits
vorausgewählt sein. Ich stelle mir das mit einem Sternicon vor."

── Warum die ID gespeichert wird und nicht der Name ────────────────────────

Überall sonst in dieser Datei ist der NAME die Zuordnung (siehe die
Begründung oben: eine Fremdschlüssel-ID hätte jede bestehende Zeile
umschreiben müssen). Für die Vorgabe ist es umgekehrt, und zwar aus einem
nachprüfbaren Grund: Sie ist genau EIN Verweis, und sie muss zwei Ereignisse
überleben, die der Name nicht übersteht.

  Umbenennen  Mit dem Namen müsste [benenneOrtUm] die Vorgabe mitziehen —
              eine dritte Stelle, die beim Umbenennen stimmen muss. Mit der
              ID passiert nichts, weil sich nichts ändert.
  Löschen     Mit dem Namen bliebe eine Vorgabe stehen, die auf einen Ort
              zeigt, den es nicht mehr gibt. Beim Erfassen stünde dann ein
              Ort da, den die Auswahlliste nicht kennt — genau die Falle,
              die Migration 0020 beschreibt. Mit der ID findet [vorgabeVon]
              keine Zeile mehr und liefert null: die Vorgabe heilt sich
              selbst.

Deshalb braucht weder [benenneOrtUm] noch [loescheOrt] eine Zeile für die
Vorgabe. Das ist der ganze Gewinn — nachgewiesen in
test/lagerort-vorgabe-db.test.js, das beide Ereignisse durchspielt.

── Warum user_settings und keine eigene Spalte ─────────────────────────────

`user_settings` ist die Schlüssel-Wert-Tabelle für genau solche
Einzelwerte — Währung, Erfassungs-Zustand und Sprache stehen dort. Eine
Spalte `is_default` an storage_locations bräuchte eine Migration UND einen
partiellen Eindeutigkeitsindex, damit nicht zwei Orte gleichzeitig Vorgabe
sind. Ein einzelner Wert in einer Tabelle, die es schon gibt, kann nicht
zweimal dastehen.
```

<a id="vorgabevon"></a>
## `vorgabeVon`

```text
Die Vorgabe EINES Kontos — oder null.

Gelesen wird über einen JOIN auf den Vorrat, nicht nur die Zahl aus den
Einstellungen: Eine Vorgabe, deren Ort gelöscht wurde, ist keine Vorgabe.
Und `user_id = $1` stellt sicher, dass eine fremde ID in den Einstellungen
(durch einen Import, durch einen Fehler) nicht den Ort eines anderen Kontos
zurückgibt.
```

<a id="ortfuerneuerfassung"></a>
## `ortFuerNeuerfassung`

```text
Der Ort, unter dem ein NEU erfasstes Stueck landet.

── Marcos Befund vom 20.10. ────────────────────────────────────────────────

  „Der Default Lagerort wird nicht gesetzt."

GEMESSEN: Vorgabe auf „Kiste 7" gesetzt (vorgabeVon liefert sie), dann ein
Teil und eine Figur so angelegt, wie der Wanted-Import es tut — also ohne
`storage`. Beide landeten mit Lagerort `null`.

Marcos Stern wurde bis hierher ALLEIN im Browser eingelöst: ladeLagerortVorgabe()
in public/js/02-gallery.js befuellt die Felder der fuenf Erfassungsformulare
vor. Wer kein Formular benutzt, bekam nichts — der Wanted-Listen-Import, der
CSV-Import, die API mit Token. Sein Wunsch lautete aber „bei einer
Neuerfassung", nicht „in einem Formular".

── Warum `undefined` und `''` verschieden sind ─────────────────────────────

Fehlt das Feld GANZ, hat niemand etwas zu diesem Ort gesagt — dann gilt die
Vorgabe. Kommt es LEER herein, hat jemand sie weggeraeumt, und das ist eine
Aussage: Sie hinterher wieder einzusetzen waere gegen den Stern, nicht fuer
ihn.

Diese Unterscheidung konnte der Server vorher nicht treffen, weil
selectedStorage() in 02-gallery.js fuer ein leeres Feld `undefined` lieferte
und der Schluessel damit aus dem Rumpf fiel — ein geleertes Feld sah aus wie
ein Import. Es gibt dort jetzt `''` zurueck, damit „ausdruecklich keiner"
auch gesagt wird.

NUR beim Anlegen: Die drei PUT-Wege …/storage setzen und loeschen einen Ort
und rufen weiterhin normalisiereLagerort() direkt. Dort heisst leer
„loeschen" — eine Vorgabe, die sich in ein Loeschen hineindraengt, waere ein
Ort, den niemand wegbekommt.
```
