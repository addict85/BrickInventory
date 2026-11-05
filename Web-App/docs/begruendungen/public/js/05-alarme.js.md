# Begründungen zu `public/js/05-alarme.js`

Die ausführlichen Kommentare aus `public/js/05-alarme.js` (bis zur Teilung in `public/js/05-settings.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="der-lagerort-soll-ein-auswahlfeld-mit-ei"></a>
## „Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man auch

```text
── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
═══ LAGERORTE VERWALTEN ════════════════════════════════════════════════════

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man auch
gleich neue Auswahlwerte erfassen kann. Die Werte sollen pro User verwaltet
werden können und sollen in den Einstellungen bearbeitbar sein."

Hier ist die Verwaltung; die Auswahl selbst steckt im Detailfenster
(ladeOrtAuswahl in js/07-admin.js). Diese Seite zeigt NUR die eigenen Orte:
Ein Lagerort ist ein Regal in der eigenen Wohnung, und fremde Regale
umzubenennen ist keine Einstellung, sondern ein Versehen.
```

<a id="alle-preisalarme-des-kontos-die-uebersic"></a>
## Alle Preisalarme des Kontos — die Uebersicht in den Einstellungen.

```text
Alle Preisalarme des Kontos — die Uebersicht in den Einstellungen.

── Marcos Frage vom 25.09. ─────────────────────────────────────────────────

  „Wie finde ich alle Preisalarme?"

Bis hierher: gar nicht. Ein Alarm war nur im Detaildialog SEINES Sets zu
sehen — man musste das Set also schon gefunden haben. Wer fuenfzig setzt,
hatte keinen Ort, an dem sie zusammen stehen, und keinen, an dem er sieht,
welche noch scharf sind.

── Warum die Zeile so aussieht, wie sie aussieht ───────────────────────────

Setnummer UND Name: `40820-1` sagt niemandem etwas. Der Zustand daneben,
weil derselbe Set zwei Alarme haben kann (neu und gebraucht) und die Zeilen
sich sonst nur an einem Buchstaben im Schluessel unterscheiden wuerden.

Die Schwelle ist ein Eingabefeld und kein Text: Marcos Wunsch war, den Wert
HIER anpassen zu koennen. Gespeichert wird beim Verlassen des Feldes —
dieselbe Geste wie im Wunsch-Detail, damit man nicht nach
einem Knopf suchen muss, den es anderswo nicht gibt.

Der letzte Preis steht dabei, weil eine Schwelle ohne ihn nicht zu beurteilen
ist: „unter 30" heisst etwas anderes, wenn das Set bei 28 steht, als wenn es
bei 300 steht.
```

<a id="marke"></a>
## `marke`

```text
„scharf" gegen „unscharf" — und der Unterschied darf NICHT in der Farbe
liegen. Marco ist rot-gruen-schwach; gruen gegen grau ist fuer ihn
zweimal dasselbe, und damit stand die Aussage bisher nirgends. Sie
haengt jetzt an drei Dingen, von denen jedes einzeln reicht: am Wort
(ein echtes Gegensatzpaar), an der Flaeche (gefuellt gegen umrandet)
und am Zeichen davor (● gegen ○). Dieselben drei wie in der App.
```

<a id="oeffnet"></a>
## `oeffnet`

```text
Die ganze Zeile oeffnet den Detaildialog — derselbe `openModal` wie in
den Finanzen und in der Galerie. Weil der Dialog ueber der Seite liegt
und diese nicht verlaesst, steht man nach dem Schliessen wieder an
derselben Stelle; dafuer ist nichts zu merken.

Feld und Loeschknopf tragen deshalb ihr eigenes data-click: Der
Verteiler nimmt das NAECHSTGELEGENE Element mit data-click, und ohne
`stopEvent` oeffnete jeder Klick ins Zahlenfeld den Dialog ueber dem
Feld, in das man gerade tippen wollte.
Anklickbar nur, wenn es das Set in der Sammlung gibt — `openModal` holt
`/v1/sets/:nummer`, und fuer ein Set, das man nicht (mehr) besitzt,
waere der Klick eine Fehlermeldung statt eines Dialogs.
```

<a id="importalarmecsv"></a>
## `importAlarmeCsv`

```text
Preisalarme aus einer CSV einlesen.

── Warum der Währungshinweis gesondert gemeldet wird ───────────────────────

Die Route übernimmt die Schwellen UNVERÄNDERT und setzt sie in die Währung
des Kontos — sie rechnet nicht um (ein falscher Kurs wäre schlimmer als
eine genannte Abweichung). Damit bedeutet dieselbe Zahl unter Umständen
etwas anderes als in der Datei, und genau das darf nicht im Erfolgston
untergehen. Steht `waehrung_hinweis` in der Antwort, wird daraus eine
Meldung der Stufe „info" statt „success" — Form und Wort tragen die
Aussage, nicht die Farbe.
```
