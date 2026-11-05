# Begründungen zu `public/js/05-settings.js`

Die ausführlichen Kommentare aus `public/js/05-settings.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="gueltigkeit"></a>
## `gueltigkeit`

```text
POST, nicht GET: Der Aufruf LEGT eine Nonce AN. Als GET war
er über eine Navigation von einer fremden Seite auslösbar, weil
SameSite=lax das Cookie dort mitschickt.
Die gewaehlte Laufzeit des SPAETEREN Geraete-Tokens reist mit der
Erzeugung, nicht mit dem Einloesen: POST /v1/auth/qr-login ist
unangemeldet erreichbar, und wer einen Code abfotografiert, duerfte sich
sonst selbst die laengste Frist aussuchen (Begruendung ausfuehrlich in
db/migrations/0016-token-laufzeit.sql).
```

<a id="serverurl"></a>
## `serverUrl`

```text
── Welche Adresse in den Code kommt ───────────────────────

Genau eine: die, die der Server nennt (`url`, aus APP_BASE_URL). Der
Klient hat hier NICHTS zu entscheiden.

Hier stand erst `window.location.origin`, dann `d.url || origin`. Beides
war falsch, und das zweite war das gefaehrlichere: Es sah nach einem
vernuenftigen Rueckfall aus. Aber die Adresse in der Browserzeile ist
die des BETRACHTERS, nicht die des Servers — wer die Webapp ueber
http://192.168.x.x:3000 oeffnet, haette dem Telefon eine Adresse
gereicht, die ausser Haus nicht existiert. Gescannt wird der Code
trotzdem; die App findet den Server dann nie wieder.

Ohne APP_BASE_URL kommt hier gar kein Erfolg mehr an: Die Route
antwortet mit 503 und einem Satz, der sagt, was zu tun ist — der wird
im Zweig darueber angezeigt. Nichts zu zeigen ist besser als etwas
Falsches zu zeigen, das sich anstandslos scannen laesst.
```

<a id="klartext"></a>
## `klartext`

```text
Wie lange der ZUGANG danach gilt — die Antwort des Servers, nicht die
Auswahl daneben: Kennt er den Wert nicht, hat er nichts vermerkt, und
dann gilt die Gleitfrist. Eigene Zeile, weil die darueber im
Sekundentakt neu geschrieben wird (der Zaehler des Codes).

Drei Faelle, nicht zwei: `0` heisst „unbegrenzt" und ist nicht dasselbe
wie „nichts gewaehlt" (null). Ein `d.token_days ? … : …` wuerde beide
in denselben Zweig werfen und bei „unbegrenzt" die Gleitfrist ansagen —
also genau das Gegenteil.
Ohne TLS verbindet sich die Android-App nicht (sie nimmt nur HTTPS an).
```

<a id="die-endpunkte-v1-settings-tokens-gab-es"></a>
## Die Endpunkte /v1/settings/tokens gab es schon, einen Weg dorthin nicht:

```text
── ANGEMELDETE GERÄTE ────────────────────────────────────────────────────

Die Endpunkte /v1/settings/tokens gab es schon, einen Weg dorthin nicht:
Ein verlorenes Telefon war nur loszuwerden, indem man das Passwort ändert
(das verwirft ALLE Zugänge). Wer nur eines aussperren wollte, sperrte alle
aus.

Der Browser selbst ist kein Token, sondern die Sitzung; die Liste zeigt die
Geräte mit Token (App, ältere Browser-Anmeldungen).
```

<a id="revokeothertokens"></a>
## `revokeOtherTokens`

```text
Alle Zugänge ausser dem eigenen entwerten.

Nacheinander über den bestehenden Endpunkt, statt dafür einen neuen zu
bauen: Es sind eine Handvoll Zeilen, und eine zweite Adresse für „dasselbe,
nur mehrfach" wäre genau die Art Doppelung, die dieses Projekt sonst
abbaut. Gezählt wird, was WIRKLICH weg ist — nicht, wie oft geklickt wurde.

Dieser Browser hängt an der Sitzung, nicht an einem Token — „alle anderen"
sind darum alle Token und alle übrigen Sitzungen.
```

<a id="loadhousehold"></a>
## `loadHousehold`

```text
Ablauf: Das Hauptkonto erzeugt einen Einladungscode, das andere Konto gibt
ihn hier ein. Zustimmen muss zwingend BEIDE Seiten — der eine durch
Erzeugen, der andere durch Einlösen.

Die Karte zeigt je nach Rolle nur EINEN der beiden Kästen. Wer schon
Unterkonto ist, sieht keinen Einladungsknopf (Konten lassen sich nur über
eine Stufe verknüpfen), und wer Unterkonten hat, sieht kein Eingabefeld.
Beides würde der Server ohnehin ablehnen — aber ein Knopf, der immer eine
Fehlermeldung erzeugt, ist schlimmer als keiner.
```

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

<a id="marcos-befund-dass-die-felder-alle-schoe"></a>
## Marcos Befund: „dass die Felder alle schön gleich ausgerichtet sind wie in

```text
── Vier Spalten wie in einer Tabelle ───────────────────────────────────

Marcos Befund: „dass die Felder alle schön gleich ausgerichtet sind wie in
einer Tabelle? aktuell sind sie alle unterschiedlich lang".

Vorher war jede Zeile ein eigenes Flexfeld mit `flex:1` auf dem
Eingabefeld. Der Platz, der dem Feld blieb, haengt damit an der LAENGE DES
BELEGUNGSTEXTES daneben — „406 Sets, 0 Teilesorten, 0 Figuren" ist
breiter als „leer", und das Feld daneben entsprechend schmaler.

Jetzt traegt die LISTE das Raster und die Zeilen sind display:contents.
Damit teilen sich alle Zeilen dieselben vier Spaltenbreiten: Das Feld
nimmt den Rest (minmax(0,1fr) — nicht 1fr, sonst sprengt ein langer Name
die Spalte), die drei anderen genau so viel, wie ihr laengster Inhalt
braucht.

Der Trennstrich sass an der Zeile. Ein display:contents-Element erzeugt
keinen Kasten und kann keinen Rahmen tragen — er liegt deshalb an jeder
Zelle und ergibt zusammen dieselbe durchgehende Linie.
```

<a id="schaltelagerortvorgabe"></a>
## `schalteLagerortVorgabe`

```text
Den Stern umschalten.

── Warum der Stern und nicht eine Farbe ────────────────────────────────────

★ und ☆ unterscheiden sich in der FORM. Marco ist rot-gruen-schwach; ein
farbig hervorgehobener Eintrag waere fuer ihn kein Unterschied. Dazu tragen
beide Zustaende einen eigenen Titel (und aria-pressed), damit die Aussage
auch dort ankommt, wo niemand hinsieht.

`war` kommt aus dem Knopf: Der zweite Druck auf denselben Stern schaltet die
Vorgabe ab. Ein eigener Knopf dafuer waere ein zweites Bedienelement fuer
eine Frage mit zwei Antworten.
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

<a id="marcos-vorgabe-bitte-auch-den-import-der"></a>
## Marcos Vorgabe: „Bitte auch den Import der xml Files für wanted listen in den

```text
── Die Wanted-Liste ist UMGEZOGEN (19.10.) ────────────────────────────────

Marcos Vorgabe: „Bitte auch den Import der xml Files für wanted listen in den
Sets, teilen und Minifiguren ergänzen und aus den Einstellungen entfernen."

Hier standen `_wantedDatei`, `zeichneWantedBericht`, `wantedListeVorschau`,
`wantedListeSchreiben` und `wantedListeSenden` — rund 110 Zeilen. Sie liegen
jetzt in js/18-wanted-xml.js, zusammen mit der Vorschautabelle und dem
Export, den es damals noch nicht gab.
```
