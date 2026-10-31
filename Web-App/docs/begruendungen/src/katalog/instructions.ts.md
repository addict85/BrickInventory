# Begründungen zu `src/katalog/instructions.ts`

Die ausführlichen Kommentare aus `src/katalog/instructions.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Bauanleitungen beschaffen: Rebrickable → Brickset → BrickLink-Designer →
brickinstructions.com, und aus Bildseiten notfalls ein PDF bauen.

── Warum das nicht mehr in routes/sets.ts steht (Nachtrag 127) ─────────────

Die Kette hatte drei Aufrufer ausserhalb — die Anleitungs-Warteschlange, den
Admin-Endpunkt und den Brickset-Client — und keiner konnte sie importieren:
`routes/sets.ts` ist ein Router. Der Brickset-Client holte sie deshalb per
spätem `require('../routes/sets')`, was den Kreis

    sets → brickset → sets

schloss. Die Warteschlange ging noch einen Schritt weiter und packte den
Aufruf in ein `try/catch` mit anschliessender `typeof`-Prüfung — eine
Vorsichtsmassnahme, die nur nötig war, weil niemand garantieren konnte, dass
der Name zur Laufzeit existiert. Genau diese Sorte Absicherung erübrigt sich
mit einem echten Import: tsc prüft den Namen.

Hier ist die Kette ein Blatt — db, appPaths und die beiden API-Clients, kein
Rückbezug auf eine Route.

Der Name `fetchInstructions`, unter dem routes/sets.ts sie nach aussen gab,
entfällt: Die Funktion heisst downloadSetInstructions und heisst jetzt
überall so.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Setbild in den lokalen Cache holen.

Drei Dinge waren hier offen und sind es nicht mehr:
 1. Weiterleitungen wurden per REKURSION ohne Tiefenbegrenzung verfolgt —
    eine Kette, die im Kreis zeigt, lief endlos weiter. Jetzt höchstens
    fünf Sprünge, wie es der Bild-Proxy auch hält.
 2. Keine Grössenbegrenzung: Alles landete im Speicher, egal wie gross.
    Der Bild-Proxy kappt ebenfalls — beide Grenzen gehören zusammen.
 3. fs.existsSync + fs.writeFileSync blockieren den Event-Loop des Workers.
    Genau das ist in routes/parts.ts schon behoben worden (siehe Kommentar
    dort); diese Stelle war übersehen worden.
```

<a id="letzterabrufwarextern"></a>
## `_letzterAbrufWarExtern`

```text
Ob der letzte `downloadSetInstructions()`-Aufruf einen fremden Server
befragt hat.

Modulweit und nicht als Rückgabewert, weil drei der vier Aufrufer das
Ergebnis ohnehin verwerfen (`.catch(() => {})`) — eine geänderte Signatur
hätte dort nur Rauschen erzeugt. Der Job liest es unmittelbar nach seinem
eigenen Aufruf; dazwischen läuft nichts anderes, weil die Warteschlange
genau einen Vorgang gleichzeitig bearbeitet (`_running`).
```

<a id="anzahlanleitungen"></a>
## `anzahlAnleitungen`

```text
── shared_instructions: zaehlen, lesen, loeschen ───────────────────────────

Diese drei Fragen standen ueber den Baum verstreut — die Zaehlung dreimal
(hier zweimal, jobs/bricksetRetry, jobs/instructionQueue), das Lesen zweimal
(routes/sets, src/sets/abfragen), das Loeschen zweimal (routes/sets,
routes/api_v1/admin). Ein Fehlverhalten ist NICHT gemessen worden: Die
Fassungen waren gleich, und die Nummern kamen ueberall normalisiert an
(nachgesehen an enqueue() und beiden checkRateLimit-Aufrufern). Der Grund
ist die naechste Aenderung — etwa „nur zaehlen, was auch eine Datei hat".
Die soll an einer Stelle stehen.

mitVersion() gehoert dazu: Geschrieben wird unter der Nummer MIT Anhang.
```

<a id="anleitungenzusammenlegen"></a>
## `anleitungenZusammenlegen`

```text
Die Anleitungen eines Sets, wie ein Client sie sieht: erst die automatisch
importierten (shared_instructions), dann die selbst hochgeladenen
(instructions).

`is_manual` ist der einzige Weg, die beiden Herkuenfte am fertigen Objekt
noch auseinanderzuhalten — und damit die Antwort auf die Frage, ob
DELETE /api/v1/sets/:sn/instructions/:id diese Zeile ueberhaupt treffen
kann: Die Route sucht ausschliesslich in `instructions`.

Ohne die Angabe konnten die Clients das nicht unterscheiden. Beide Tabellen
haben eine Spalte `id`, beide Zaehler laufen unabhaengig voneinander, und
das Zusammenlegen wirft die Herkunft weg. Ein Papierkorb an einer
automatisch importierten Anleitung traf deshalb im guenstigen Fall nichts
(404) — und im unguenstigen die EIGENE hochgeladene Anleitung, die zufaellig
dieselbe Nummer trug.

Der Pfad taugt als Ersatz nicht: `local_path` ist bei geteilten Anleitungen
auch `null` (Eintrag ohne Datei), und die Regel „faengt mit /data/uploads/
an" muesste dann in jedem Client noch einmal stehen.
```

<a id="brickinstructionsfund"></a>
## `brickinstructionsFund`

```text
Wo liegt dieses Set bei brickinstructions.com, und ist dort ueberhaupt etwas?

── Warum das eine Funktion ist ─────────────────────────────────────────────
Diese sechs Zeilen standen ZWEIMAL in dieser Datei — einmal in
scrapeInstructionsFromFallback(), einmal in downloadSetInstructions(); nur
die Einrueckung war verschieden. Was DANACH damit geschieht, ist
unterschiedlich (die eine legt die Anleitung an, die andere reiht sie in
eine Liste ein), aber die ADRESSE und die Frage „ist da etwas?" muessen
dieselben sein. Laufen sie auseinander, sucht der eine Weg an einer Stelle,
an der der andere nichts findet — und ob eine Anleitung auftaucht, haenge
davon ab, welcher Weg gerade lief.

Die Ordnerregel (Tausenderblock, fuenfstellig aufgefuellt) ist die Ablage von
brickinstructions.com, nicht unsere: dort liegt 60445 unter 60000/.

Die Groessenschwelle gehoert dazu: Ein 200 mit ein paar hundert Byte ist die
Fehlerseite, kein Bild.

@returns null, wenn dort nichts liegt
```

<a id="downloadsetinstructions"></a>
## Abschnitt

```text
── Wurde für DIESES Set überhaupt ein fremder Server befragt? ────────────

Der Takt der Warteschlange (15 s) ist dazu da, Brickset und
brickinstructions.com zu schonen. Er hing bisher am DURCHGANG, nicht am
Abruf — und damit auch an Sets, die längst eine Anleitung haben und hier
eine Zeile weiter unten wieder herausfallen, ohne eine einzige Verbindung
zu öffnen.

Genau derselbe Fehler wie beim Bild-Job (Nachtrag 217): Das Kontingent
wurde auf Notizen angewandt statt auf CDN-Anfragen. Dort waren es 37
Minuten für nichts, hier 15 Sekunden je bereits erledigtem Set.
```
