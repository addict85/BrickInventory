# Begründungen zu `test/benutzername-menueknopf.test.js`

Die ausführlichen Kommentare aus `test/benutzername-menueknopf.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die drei Striche stecken IM Benutzernamen — und bleiben dort.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

Erst (16.10.): „die restlichen Seiten oben Rechts hinter dem Benutzernamen
als Aufklappbares Menu mit 3 - anzeigen." Gebaut wurde das als zwei Dinge
nebeneinander: die Namensplakette, und daneben ein Knopf mit „☰".

Dann (17.10.): „kannst du die 3 Striche oben Rechts in den Benutzernamen
integrieren?" Seither IST der Namenszug der Knopf.

── Warum das eine Prüfung braucht ──────────────────────────────────────────

Nicht wegen des Aussehens — das sieht man. Sondern wegen einer Falle, die
man NICHT sieht und die beim Bauen fast zugeschnappt ist:

    01-konto.js:827   G('ubadge').textContent = ME.username;
    05-settings.js   if (uel) uel.textContent = username;

Beide Stellen schreiben den Namen über `textContent`. Das ersetzt den
GANZEN Inhalt des Elements. Läge `id="ubadge"` am Knopf — der nächstliegende
Umbau, wenn Name und Knopf eins werden —, dann wären die drei Striche in
dem Augenblick weg, in dem sich jemand anmeldet. Nicht beim Laden der
Seite, wo man es beim Entwickeln sähe: beim ANMELDEN. Wer die Seite mit
offener Sitzung neu lädt, läuft durch genau dieselbe Zeile.

Darum hängt die ID an einem inneren Feld, und darum prüft das hier nicht
das Markup, sondern das Ergebnis: Namen setzen wie die Anwendung es tut,
danach müssen die Striche noch da sein.
```

<a id="menueknopf"></a>
## `function menueKnopf(document) {`

```text
Den Menüknopf über seinen HANDLER finden, nicht über die ID.

Der Grund ist eine Gegenprobe, die zunächst nichts gemessen hat: Wer Name
und Striche zu einem Element verschmilzt, schreibt am ehesten

    <button class="ubadge" id="ubadge" data-click="benutzerMenue">— ☰</button>

— ein Knopf, der `ubadge` HEISST. Dann gibt es gar kein `btn-umenu` mehr,
und eine Prüfung, die darüber sucht, scheitert an `assert.ok(knopf)`, statt
den eigentlichen Schaden zu zeigen. Über `data-click` findet sie den Knopf
in beiden Bauweisen und kann sagen, was wirklich kaputt ist.
```

<a id="der-namenszug-traegt-den-verwalter-hinwe"></a>
## `test('der Namenszug trägt den Verwalter-Hinweis, die Kachel ist weg', `

```text
── Nachtrag vom 17.10.: der Verwalter-Hinweis steht IM Namen ───────────────

Marcos Vorgabe: „Kannst du das \"Admin\" nicht als eigene Kachel anzeigen
sondern in () hinter dem Benuzter? Also z.b. marco.bigolin (Admin) oder
marco.bigolin sofern der User kein Admin ist. Das menu soll dann ganz
rechts sein."

Die eigene Plakette (`#abadge`) ist damit aus der Kopfleiste verschwunden.
Sie stand ZWISCHEN dem Namensknopf und dem rechten Rand — deshalb sass das
Menü nicht ganz rechts. Mit ihr ist der Knopf das letzte Element der Reihe.

── Warum hier zwei Fälle stehen und nicht einer ────────────────────────────

„(Admin) steht dahinter" allein wäre auch grün, wenn es IMMER dahinter
stünde — und dann trüge jeder Gast einen Verwalter-Hinweis. Der zweite Fall
ist der wichtigere.
```
