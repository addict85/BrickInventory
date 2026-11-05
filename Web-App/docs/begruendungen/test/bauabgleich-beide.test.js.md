# Begründungen zu `test/bauabgleich-beide.test.js`

Die ausführlichen Kommentare aus `test/bauabgleich-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Kann ich das bauen?" — dieselbe Antwort in beiden Oberflächen.

── Warum es diese Prüfung gibt ─────────────────────────────────────────────

Marcos stehende Vorgabe: zwei saubere Apps, in den Oberflächen einheitliche
Ansichten, ansonsten identische Funktion. Eine Erweiterung, die nur in der
Webapp landet, ist deshalb keine halbe Erweiterung, sondern eine, die die
Vorgabe verletzt — und das fällt erst auf, wenn jemand am Telefon danach
sucht.

Geprüft wird die NAHT: dass beide Seiten denselben Endpunkt in derselben
Schreibweise ansprechen, und dass beide die Unterscheidung „alles / nur
lose" anbieten. Ob die Zahlen stimmen, beantwortet
test/bestandsabgleich-db.test.js gegen echte Daten.
```

<a id="lies"></a>
## `const lies = p => ohneKommentare(fs.readFileSync(p, 'utf8'));`

```text
Kommentare ABSTREIFEN, und zwar hier schon beim Lesen.

Dieser Test schneidet Funktionsrümpfe an Namen heraus. Ein Erklärkommentar,
der einen dieser Namen NENNT, verschiebt den Schnitt — und dann prüft die
Regel einen anderen Rumpf als gemeint. Genau das ist passiert: Ein Kommentar
im Zusammenfass-Block verwies auf `ladeTeilelisteBestand`, der Schnitt begann
dort statt an der Funktion, und die Regel meldete eine BrickLink-Nummer, die
in der Funktion gar nicht steht.
```

<a id="kt-api"></a>
## `const KT_API   = ohneKommentare(require('../scripts/kotlin-vertrag.js'`

```text
── Jeder Pfad in den Android-Baum AUSGESCHRIEBEN ───────────────────────────

Kein Helfer `app(rel)` mit variablem Segment: test/baumbruecken.test.js löst
diese Brücken statisch auf und kann eine Variable nicht sehen. Es meldete
diese Datei prompt, als sie einen solchen Helfer hatte — und zu Recht:
Genau die unauflösbaren Brücken sind die, die beim nächsten Umbenennen
lautlos ins Leere zeigen.
```

<a id="js-stelle"></a>
## `const js = web('public/js/08-init.js');`

```text
── Was sich geändert hat (Marcos Vorgabe) ────────────────────────────────

„Ja die Stückzahl soll mitgezählt werden aber nur die eigenen Sets. Oder
eine zusätzliche checkbox 'Unteraccounts mit einbeziehen'."

Bis dahin übernahm der Abgleich in BEIDEN Oberflächen stillschweigend den
Kontofilter des TEILE-Reiters. Das war als Gleichklang gedacht, hatte aber
zwei Haken: Der Filter steht nach jeder Anmeldung auf „Alle Konten" — der
Abgleich zählte also immer den ganzen Haushalt —, und er sitzt auf einem
anderen Bildschirm, wo ihn niemand als Antwort auf „wessen Teile zähle
ich" liest.

Jetzt hat die Teileliste ihre eigene Wahl, in beiden Oberflächen dieselbe:
ohne Haken `accounts=own`, mit Haken der ganze Haushalt. Die Namen sind
weiterhin die des Servers (src/haushalt/haushalt.ts, parseScopeMode) — es ist
dieselbe Sache, nur an der richtigen Stelle bedient.
```
