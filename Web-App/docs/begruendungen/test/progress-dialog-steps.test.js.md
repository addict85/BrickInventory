# Begründungen zu `test/progress-dialog-steps.test.js`

Die ausführlichen Kommentare aus `test/progress-dialog-steps.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Zwischendialog beim Erfassen eines Sets zeigt nur Schritte, auf die der
Browser tatsächlich wartet.

── Fehlerbild ──────────────────────────────────────────────────────────────
Der Dialog listete sechs Punkte: Set-Informationen, Bild, Anleitungen, Teile,
Teilbilder, Preis. Vier davon waren zu dem Zeitpunkt längst tot:

  • 'parts_start', 'parts_importing', 'parts_done', 'parts_images' und
    'parts_error' kamen aus importPartsForSet(). Seit der Teile-Import aus
    addSet() heraus in ein setTimeout gewandert ist, übergab JEDE Aufruf-
    stelle `null` als Fortschritts-Melder — die Ereignisse konnten den
    Browser gar nicht mehr erreichen.
  • 'instructions' wurde zwar noch gesendet, der Download lief aber schon in
    einem setImmediate(). Der Punkt sprang auf „aktiv" und blieb dort stehen.
  • 'price' wurde von KEINER Serverstelle je gesendet.

Der Dialog behauptete also Arbeit, auf die niemand wartete. Nach aussen sah
das aus wie ein hängender Import.

── Was dieser Test festhält ────────────────────────────────────────────────
Die beiden Richtungen der Kopplung zwischen Server und Dialog:

  1. Jeder `case` in handleSseEvent() muss von einer Serverstelle gesendet
     werden, deren Melder mindestens ein Aufrufer NICHT als `null` übergibt.
     Das ist die Richtung, die den Fehler oben verhindert hätte.
  2. Jede `ps-…`-Kennung, die das Frontend anspricht, muss es in index.html
     geben — sonst schreibt setStep() ins Leere.

Bewusst NICHT geprüft wird die Gegenrichtung „jeder gesendete Schritt hat
einen case": 'done_meta' hatte jahrelang keinen, und der Server darf mehr
melden, als der Dialog zeigt.
```

<a id="nach-dem-letzten-ereignis-haengt-kein-pu"></a>
## `test('nach dem letzten Ereignis hängt kein Punkt mehr auf „aktiv"', ()`

```text
Spielt den Ablauf einmal durch, statt nur Muster zu suchen.

Der eigentliche Fehler war ja nicht „ein Fall zu viel", sondern: ein Punkt
sprang auf „aktiv" und wurde nie fertig, weil das abschliessende Ereignis
ausblieb. Genau das fällt einer Mustersuche nicht auf — hier fällt es auf,
weil die Sendereihenfolge des Servers auf die Schaltlogik des Dialogs
angewendet wird und am Ende kein Punkt mehr „aktiv" stehen darf.
```
