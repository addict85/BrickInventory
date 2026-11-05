# Begründungen zu `test/set-anlegen-antwortform-db.test.js`

Die ausführlichen Kommentare aus `test/set-anlegen-antwortform-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein NEU angelegtes Set wird in beiden Erfassungs-Routen gleich beantwortet.

── Marcos Meldung vom 01.10. ───────────────────────────────────────────────

  „Wenn ich ein Set mit einer Zahl hinzufügen möchte erscheint folgender
   Fehler in der Android-App:
   710-1 konnte nicht hinzugefügt werden: Field 'success' is required for
   type with serial name 'ch.brickinventoryapp.data.model.AddSetResponse',
   but it was missing at path: $"

Das Set war angelegt. Nur meldete die App das Gegenteil und lud die Galerie
nicht nach — der Eintrag fehlte bis zum nächsten Start.

── Die Ursache: EINE Route, ZWEI Antwortformen ─────────────────────────────

`addSet()` gibt `{action, set_number, name}` zurück, ohne `success`. Zwei
von drei Ausgängen wickelten das Ergebnis ein:

  routes/api_v1/sets.ts  POST /sets        → `{ success:true, ...result }`
  routes/api_v1/sets.ts  „schon im Blickfeld" → `{ success:true, action:'exists', … }`
  routes/api_v1/sets.ts  `step:'done'`     → `{ step:'done', ...result }`   ← ohne

Dieselbe Route antwortete also in zwei Formen, je nachdem ob das Set neu
war. Der Webapp fiel das nie auf, weil handleSseEvent() (public/js/
02-gallery.js) nur `action` und `set_number` liest — ein Feld, das niemand
liest, kann auch niemandem fehlen.

── Warum der bestehende Test das nicht gefangen hat ────────────────────────

set-add-exists-db.test.js fährt beide Routen, aber nur mit Sets, die SCHON
da sind — es ist der Test für genau diese Regel. Seine Konstante `NEU` wird
ausschliesslich für die exists-Vorabfrage benutzt, nie zum Anlegen. Der
Ausgang für ein wirklich neues Set war damit in keinem Test.

── Warum addSet() hier gestellt wird ───────────────────────────────────────

Der Anlege-Zweig holt Stammdaten und Bild von Rebrickable. Ein Test, der
davon abhängt, prüft das Netz mit. Gestellt wird GENAU das, was die echte
Funktion für ein neues Set zurückgibt (src/sets/setService.ts, Ende von
addSetIntern) — und Schritt 1 belegt mit der ECHTEN Funktion, dass dort
wirklich kein `success` steht. Ohne diesen Schritt könnte die Stellung
stillschweigend etwas anderes behaupten als die Wirklichkeit.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="gestellteaddset"></a>
## `let gestellteAddSet = null;`

```text
Der Nachzug nach dem Erfassen haengt an einem setTimeout und laeuft NACH
diesem Test, gegen einen dann geschlossenen Pool. Gleiche Vorsichtsmassnahme
wie in set-add-exists-db.test.js.

Im selben Zug wird addSet() durchgereicht oder gestellt: `null` heisst echt.
Der Zugriff muss hier liegen und nicht spaeter, weil die Router ihr Modul
EINMAL beim Laden holen — ein spaeteres Austauschen saehe keiner mehr.
```

<a id="ktpfad"></a>
## `const ktPfad = path.join(__dirname, '..', '..', 'Android-App', 'core-m`

```text
── 5. Die App verlangt nichts, was der Server nicht schickt ───────────

Die GEGENRICHTUNG zur Regel in alarm-uebersicht-db.test.js. Die prueft,
dass jedes gelieferte Feld in der Kotlin-Klasse Platz hat — sonst kommt
es still als null an. Hier geht es umgekehrt: Ein Feld OHNE Vorgabewert
ist in kotlinx.serialization ein Pflichtfeld, und fehlt es in der
Antwort, bricht das Lesen mit einer Ausnahme ab. Das ist der Fehler vom
01.10., nur allgemein formuliert.

Verglichen wird gegen die ECHTEN Antworten von oben, nicht gegen eine
abgeschriebene Liste.
```
