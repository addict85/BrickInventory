# Begründungen zu `public/js/01-fortschritt.js`

Die ausführlichen Kommentare aus `public/js/01-fortschritt.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="der-block-lag-in-js-01-core-js-und-war-d"></a>
## Der Block lag in js/01-core.js und war dort mit 211 Zeilen der zweitgrösste

```text
── CSV-Import-Fortschrittsbalken (der Balken im Kopf der Seite) ─────────────

── Warum eine eigene Datei ──────────────────────────────────

Der Block lag in js/01-core.js und war dort mit 211 Zeilen der zweitgrösste
zusammenhängende Gegenstand. Er ist geschlossen: zwölf Namen, von denen drei
nach aussen gebraucht werden — der Rest ist Innenleben (zwei Zeitgeber, ein
EventSource, zwei Merker). Genau deshalb fiel er beim Lesen von 01-core.js
nie auf: Wer dort nach esc() oder api() sucht, scrollt an 211 Zeilen
Fortschrittsanzeige vorbei, ohne dass sie ihn etwas angingen.

Diese Datei greift nach unten: sie holt aus 01-core.js nur Allgemeingut (G,
api, ME) und aus 02-gallery.js die Ladefunktionen. Umgekehrt ruft 01-core.js
GENAU ZWEI Namen von hier — gibCheckOnLoad() beim Anmelden und
gibZuruecksetzen() beim Abmelden. Das ist ein Ring, und er ist Absicht: Der
Balken hängt an der Sitzung, also muss die Sitzung ihn starten und stoppen
können. Entscheidend ist, dass es zwei benannte Funktionen sind und nicht
fünf Variablen — vorher stand das Innenleben des Balkens in showLogin()
ausgeschrieben, und wer eine sechste Variable hinzufügte, musste daran
denken. ES-Module tragen den Ring (01-core.js und 02-gallery.js bilden
längst denselben); kritisch wäre nur ein const-Zugriff während der
Auswertung, und den gibt es hier nicht.
```

<a id="protokollzeile"></a>
## `protokollZeile`

```text
Eine Zeile fuers Import-Protokoll — oder null, wenn es nichts zu sagen gibt.

── Marcos Befund vom 21.10. ────────────────────────────────────────────────

  „Nach dem Import erscheint dann ganz viele Zeilen mit
   Undefined - aktualisiert"

`results` traegt zweierlei: beim CSV-Import je Set ein echtes Ergebnis, beim
Wanted-Listen-Import bis zum 21.10. nur Zaehl-Platzhalter (`{success:true}`),
aus denen buildJobStatus ok/warn/err rechnet. Die hatten kein `set_number` —
und daraus wurde 322-mal „undefined – aktualisiert".

Die Platzhalter sind weg (beendeAuftrag bekommt jetzt echte Zeilen, siehe
src/auftraege/importAuftrag.ts), aber die Schranke bleibt: Eine Zeile, die nichts
benennt, sagt dem Betrachter nichts und kostet ihn das Vertrauen in die
uebrigen. Die ZAEHLUNG darueber ist davon unberuehrt — sie kommt aus
`s.ok`/`s.warn`/`s.err` und nicht von hier.

── Warum EINE Fassung ──────────────────────────────────────────────────────

Diese drei Zeilen standen zweimal: hier fuer die zuschauende Sitzung und in
public/js/02-gallery.js fuer die, die den Import gestartet hat. Zwei
Fassungen heissen zwei Stellen, an denen die naechste Schranke fehlt — und
genau das war hier der Fall. Der SCHREIBER bleibt verschieden (gibAddLog
schreibt in beide Protokolle, addCsvLog nur in das des Dialogs); gemeinsam
ist, WAS dasteht.
```

<a id="url"></a>
## `url`

```text
Kein Token in der Adresse. EventSource kann zwar keine Kopfzeile setzen,
schickt mit `withCredentials: true` aber das Sitzungs-Cookie — und genau
das war schon vorher der Weg, auf dem dieser Kanal wirklich lief. Der
angehängte `?token=` war der Sitzungstoken selbst; er hätte im
Reverse-Proxy-Protokoll und im Browserverlauf gestanden. Den „Bearer-Fall"
ohne Cookie gibt es hier nicht: `webToken` entsteht erst nach der
Anmeldung, die das Cookie setzt. Siehe src/konto/auth.ts.
```

<a id="gibzuruecksetzen"></a>
## `gibZuruecksetzen`

```text
Setzt den Balken auf „nichts läuft" zurück: Anzeige aus, beide Abfragen
gestoppt, Protokoll geleert.

Warum das eine Funktion ist und nicht beim Abmelden steht (dem einzigen
Aufrufer): `_gibCheckTimer` und `_gibLastCount` sind Innenleben dieses
Balkens. Wer sie von aussen zurückdreht, muss wissen, welche der fünf
Variablen dieser Datei dazugehören — und beim Hinzufügen einer sechsten
daran denken. Die Abmeldung soll nur sagen, WAS sie will.
```

<a id="handlesseevent"></a>
## `handleSseEvent`

```text
Verarbeitet die SSE-Ereignisse beim Erfassen EINES Sets.

── Warum hier nur noch zwei Schritte stehen ────────────────────────────────
Der Dialog listete früher sechs Schritte: Set-Infos, Bild, Anleitungen,
Teile, Teilbilder, Preis. Davon wartet der Aufrufer heute nur noch auf die
ersten beiden — `addSet()` (src/sets/setService.ts) holt Set-Daten und Bild
synchron und schiebt alles Übrige in ein `setTimeout`, das erst nach der
Antwort läuft. Die vier hinteren Schritte konnten den Browser deshalb gar
nicht mehr erreichen:
  • `instructions` wurde zwar noch gesendet, aber der Download lief bereits
    in einem `setImmediate` — der Punkt sprang auf „aktiv" und blieb dort
    stehen, weil ihn nie ein Abschluss erreichte.
  • `parts_start`, `parts_importing`, `parts_done`, `parts_images` und
    `parts_error` stammen aus `importPartsForSet()`. NACHGEMESSEN: alle fünf
    Aufrufstellen übergeben dort `null` als Fortschritts-Melder.
  • `step:'price'` wurde von KEINER Serverstelle je gesendet.
Ein Fortschrittsbalken, der Arbeit anzeigt, auf die niemand wartet, ist
keine Auskunft, sondern eine Behauptung. Statt der vier Punkte steht jetzt
ein fester Hinweis im Dialog (`prog-hint`), dass diese Arbeit im Hintergrund
weiterläuft — was zutrifft und den Dialog nicht künstlich offen hält.

`done_meta` markiert die Stelle, an der der synchrone Teil fertig ist. Der
Schritt wurde bisher gesendet und vom Browser verworfen; er schliesst jetzt
den Bild-Schritt ab. Ohne ihn bliebe „Bild herunterladen" bis zum Ende auf
„aktiv", weil das früher der `instructions`-Zweig erledigt hat.
```

<a id="if"></a>
## `if`

```text
Antwortet der Server mit gewöhnlichem JSON statt einem Ereignisstrom, ist
die Sache schon entschieden — beim Erfassen etwa, wenn das Set bereits im
Blickfeld steht (src/sets/setAdd.ts). Dann gibt es nichts zu verfolgen, und
die eine Antwort wird wie ein einzelnes Ereignis durchgereicht. Ohne
diesen Zweig liefe der Leser über JSON-Text, fände keine `data:`-Zeile und
der Aufrufer bekäme nie ein Ereignis — die Anzeige bliebe hängen.
```
