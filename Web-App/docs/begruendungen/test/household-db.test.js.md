# Begründungen zu `test/household-db.test.js`

Die ausführlichen Kommentare aus `test/household-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Haushalt gegen eine ECHTE Datenbank.

test/household.test.js prüft die Regeln am Quelltext — das fängt
Doppelungen und vergessene Aufrufe, sagt aber nichts darüber, ob die
Abfragen tun, was sie sollen. Genau da liegen die Fehler, die man sonst erst
im Betrieb sieht: eine Gruppierung, die Konten statt Teile zählt, ein
Parameter, der als Liste ankommt, wo Postgres eine Zahl erwartet.

Aufbau wie test/api-parity.test.js: echtes Schema, echte Handler, echte
Abfragen. Nichts gestubbt.
```

<a id="stelle"></a>
## `assert.equal(parseInt(all.total_sets), 2, 'verschiedene Sets im Hausha`

```text
── Warum hier jetzt 2 steht und vorher 3 ───────────────────────────────
Die Vorlage: kindA hat 75192-1 (×1) und 10290-1 (×1), kindB 75192-1 (×2).
Das sind DREI Tabellenzeilen, aber ZWEI verschiedene Sets — und die
Galerie zeigt zwei Kacheln, weil sie nach set_number gruppiert.

Die alte Zusicherung nagelte die Zeilenzahl fest, und ihre Beschriftung
sagte „(Mengen summiert)" — was COUNT(*) gerade nicht tut. Zwei
Zusicherungen weiter oben steht in DERSELBEN Datei
`getSets(..., 'subs').sets.length === 2`. Beide Zahlen standen hier
nebeneinander, verglichen hat sie nie jemand.

Der Vergleich selbst steht jetzt in kennzahlen-haushalt-db.test.js;
hier bleiben die konkreten Zahlen der Vorlage.
```

<a id="for-stelle"></a>
## `for (const mode of ['all', 'own', 'subs']) {`

```text
Diese Prüfung gibt es, weil genau hier ein Fehler durchgerutscht ist:
Nach der Umstellung auf user_id = ANY($1) bekam getSetting() die
ID-LISTE statt einer ID, und alle vier Endpunkte antworteten mit
  500 invalid input syntax for type integer: "{"2"}"
Im Browser hiess das: Finanzen-Reiter komplett leer.

Die Struktur-Tests konnten das nicht sehen — der Code war „richtig
verdrahtet", nur eben mit dem falschen Wert. Und der Paritätstest ruft
die Endpunkte nur OHNE Filter auf; bei accounts=subs fällt das fragende
Konto aus der Liste, und ids[0] wäre dann die Währung eines Kindes.
```

<a id="inbeiden"></a>
## `const inBeiden = async (table) => {`

```text
… und die Teile stehen jetzt bei BEIDEN: Die Quelle behält ihr Exemplar,
das Ziel bekommt eine Kopie. Ein Umhängen hätte die Quelle mit einem
Exemplar ohne Teile zurückgelassen.
Wird EIN Kaufpreis von zweien umgehängt, muss ALLES in beiden Konten
stehen: das Set selbst, seine Teile, seine Minifiguren und seine
Anleitungen. Kopieren statt verschieben — der Absender behält ja ein
Exemplar, und ein Exemplar ohne Teile wäre ein halber Bestand.
```

<a id="stelle-2"></a>
## `await giveSet(U.kindB, '31120-1', 1, 80);`

```text
── Woher dieser Test kommt ───────────────────────────────────────────
Die Webapp schickte als from_user_id den BETRACHTER mit. Zog das
Hauptkonto die Zeile eines Unterkontos zu sich, suchte der Server sie
unter dem falschen Konto → 404 „Kaufpreis nicht gefunden", obwohl das
Select im Dialog den richtigen Eigentümer längst anzeigte. Der Server
leitet den Absender jetzt selbst aus der Zeile ab
(acquisitionMoveSource); ein mitgeschickter from_user_id ist bedeutungslos.
```

<a id="stelle-3"></a>
## `/** Über die v1-Fabrik anlegen, mit gewähltem Zielkonto. */`

```text
── Warum diese Prüfung hier steht (Nachtrag 149) ────────────────────────
Die Regel „owner_user_id wird geprüft, nicht bloss übernommen" lag
ausschliesslich als Quelltextprüfung vor (test/household.test.js,
„Schreiben in ein fremdes Konto verlangt die richtige Richtung"). Die
suchte nach `resolveWriteTarget(` und nach einem 403 irgendwo in
derselben Datei — beides wäre auch dann noch dagestanden, wenn der
Rückgabewert nicht mehr ausgewertet würde.

Und das ist der teuerste denkbare stille Fehlalarm im ganzen Projekt:
Fällt die Prüfung aus, schreibt ein Konto in ein fremdes, ohne dass
irgendetwas rot wird. Deshalb wird sie jetzt über die ECHTEN Routen
gefahren, für alle drei Anlege-Pfade.
```
