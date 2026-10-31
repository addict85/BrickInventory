# Begründungen zu `jobs/priceJob.ts`

Die ausführlichen Kommentare aus `jobs/priceJob.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="acquirerunlock"></a>
## `acquireRunLock`

```text
Sperre über die ganze Laufzeit halten — auf einer EIGENEN Verbindung.

── Warum state.running nicht reicht ────────────────────────────────────────
`state.running` liegt im Speicher EINES Prozesses. Geplant läuft der Job nur
im Primary-Worker, aber es gibt zwei manuelle Auslöser
(POST /api/finance/job-trigger und POST /api/v1/admin/trigger-price-job), und
die laufen in dem Worker, der die Anfrage gerade bearbeitet. Dort war
state.running false — also startete ein vollständiger Preislauf, unabhängig
davon, ob im Primary gerade einer lief. Zwei Klicks auf verschiedenen Workern
ergaben zwei komplette Durchgänge über alle Sets, jeder mit eigenen
BrickLink-Aufrufen, und beide schrieben in dasselbe Fortschrittsfeld — die
Anzeige sprang zwischen den Ständen hin und her.

Dieselbe Sache war beim Login-Zähler, beim Bild-Cache-Aufräumlauf und beim
Rebrickable-Tageskontingent schon behoben. Die Werkzeuge dafür liegen im
Projekt bereit; dem Preis-Job fehlte nur die Sperre.

KEIN pg_try_advisory_xact_lock: Der Lauf dauert Minuten, eine Transaktion so
lange offen zu halten wäre falsch. Deshalb eine eigene Verbindung aus dem
Pool, die bis zum Ende gehalten und im finally freigegeben wird — sonst
blockiert ein abgestürzter Lauf alle folgenden bis zum Neustart.

@returns Freigabefunktion, oder null wenn anderswo bereits ein Lauf läuft
```

<a id="parallellimit"></a>
## `parallelLimit`

```text
getSetting()/getGlobalSetting() standen hier als wortgleiche Kopien von
src/konto/settings.ts — inklusive der eigenen SELECT-Anweisung auf
global_settings. Beide sind ersatzlos gestrichen: Wer den Tabellenzugriff
aendert (Zwischenspeicher, Umbenennung einer Spalte), soll das an EINER
Stelle tun und nicht danach suchen muessen.

Ein Unterschied bleibt zu beachten: Die zentrale Fassung nimmt den
Ersatzwert nur bei NULL (`??`), die hiesige Kopie nahm ihn auch bei einem
leeren Eintrag (`||`). Fuer die beiden Zahlenwerte unten haengt daran, ob
parseInt('') ein NaN liefert — deshalb steht dort jeweils ein
ausgeschriebenes `||`.
```

<a id="runpricerefresh-eigene"></a>
## `eigene`

```text
── Bestand UND Merkliste ──────────────────────────────────────────

Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?"

Weil dieser Lauf bis hierher nur `sets` kannte. Ein Merkposten ist kein
Bestand, hatte also nie einen Preis im Cache — und /price-history LIEST
den Cache nur, es holt nichts. Das Merkposten-Detail zeigte deshalb „—",
und der Preisverlauf blieb leer, weil nie jemand einen Punkt schrieb.

Ausgerechnet fuer einen MERKPOSTEN ist die Preisentwicklung das
Wichtigste: Man wartet ja darauf. Ein Set, das man schon hat, braucht
sie weniger dringend als eines, das man kaufen will.

── Was der Merklisten-Anteil kostet (Marcos Frage) ────────────────────

Ein Merkposten bringt eine zusaetzliche Zeile in diese Liste, also einen
zusaetzlichen Durchgang durch fetchAndCachePrice() je gewuenschtem
Zustand. Ein BrickLink-Abruf wird daraus aber nur, wenn der Cache
nichts Frisches hat — und price_cache ist ueber
(set_number, condition, currency_code) verschluesselt, NICHT ueber den
Nutzer (db/schema.sql). Daraus folgt die Obergrenze:

  Abrufe/Tag  =  Anzahl verschiedener (Set, Zustand, Waehrung) ueber
                 ALLE Merklisten, die nicht ohnehin im Bestand sind
                 +  einer je Antwort ganz ohne Preis (Rueckfall auf den
                    anderen Zustand, siehe fetchAndCachePrice)

Zwei Nutzer mit demselben Merkposten in derselben Waehrung kosten also
EINEN Abruf, nicht zwei; ein Merkposten auf ein Set, das jemand schon
besitzt, kostet nichts. Der Takt ist price_cache_ttl (Vorgabe 24 h),
nicht das Job-Intervall — ein stuendlicher Lauf fragt denselben Merkposten
trotzdem nur einmal am Tag. Nur Sets, zu denen BrickLink gar keinen
Preis kennt, werden oefter versucht (ZERO_PRICE_TTL_HOURS = 6 h).

Wer das nicht will, nimmt die zweite Haelfte wieder heraus; dann bleibt
das Merkposten-Detail auf den Preis angewiesen, den es beim Oeffnen selbst
holt (routes/api_v1/wanted.ts) — und es entsteht kein Verlauf.

`.catch`: Ein Aufbau, der nur initSchema() gelaufen ist, hat die
Tabelle nicht (siehe db/schema.sql). Dann bleibt es beim Bestand.
```

<a id="runpricerefresh"></a>
## Abschnitt

```text
KEIN scheduleNext() hier: Der finally-Block unten macht das ohnehin, und
zwar für JEDEN Ausgang. Vorher stand es an beiden Stellen — ein Lauf
ohne Sets hinterliess dadurch ZWEI Intervall-Timer statt einem (am
laufenden Job nachgezählt). Weil jeder gefeuerte Timer wieder einen Lauf
startet und der wieder Timer stellt, wächst die Zahl der geplanten Läufe
mit der Zeit — der Job liefe irgendwann viel häufiger als eingestellt und
verbrennt das BrickLink-Tageskontingent. Im Test hielten die
überzähligen Timer ausserdem den Prozess am Leben, bis der Runner nach
60 s abbrach.
```

<a id="runpricerefresh-zustaende"></a>
## `zustaende`

```text
Zustände je Set vorab bestimmen — drei Abfragen für den ganzen Nutzer,
nicht drei je Set. Gemischte Sets brauchen beide Preise, reine nur
einen; jeder überflüssige Abruf ginge auf das BrickLink-Tageskontingent.

Hier stand die Regel vorher ein ZWEITES Mal (Erfassungen, sonst
sets-Zeile, sonst DEFAULT_PRICE_CONDITION) — und diese Fassung kannte
die Merkliste nicht. Ein Merkposten hat weder Erfassung noch sets-Zeile,
fiel also auf den Vorgabewert durch, und der ist 'U'
(src/finanzen/rechnung/preise.ts). Gemessen hiess das: JEDER Merkposten wurde als
GEBRAUCHT geholt — auch der auf ein neues Set. Der Preisverlauf im
Merkposten-Detail füllte sich damit für den falschen Zustand, und für den
gewünschten blieb er leer.
```

<a id="runpricerefresh-2"></a>
## Abschnitt

```text
── Preisalarme (Nachtrag 176) ──────────────────────────────────────────

Hier und nicht in fetchAndCachePrice(): Dort wird JE SET UND ZUSTAND
geholt, oft auch ohne dass sich etwas geaendert hat (Cache-Treffer).
Eine Pruefung dort liefe pro Lauf tausendfach und meldete dieselbe
Schwelle mehrfach je Durchgang.

Am Ende des Laufs steht dagegen fest, was heute gilt — und die Pruefung
geht nur noch die Sets durch, auf die ueberhaupt jemand wartet.

Der ganze Block ist gekapselt: Ein nicht erreichbarer SMTP-Server oder
eine fehlende Tabelle darf den Preislauf nicht abbrechen. Die Preise
sind dann geholt, nur die Meldung fehlt — und sie wird beim naechsten
Lauf erneut versucht, weil der Merker ungesetzt bleibt.
```

<a id="abschnitt"></a>
## Abschnitt

```text
Der Portfolio-Schnappschuss je Konto ist entfallen (Nachtrag 82).

Er legte täglich einen Gesamtwert unter dem Pseudo-Set
'__portfolio__<id>' ab, und die Kurve las für ein einzelnes Konto daraus.
Ein Schnappschuss hält aber fest, was AN JENEM TAG erfasst war — die
Frage „was wäre der heutige Bestand damals wert gewesen" lässt sich
daraus nicht beantworten, und genau daran hingen Marcos +850 %. Die
Kurve rekonstruiert jetzt aus dem Verlauf JE SET, für jede
Kontoauswahl gleich.

Nebenbei gespart: eine price_cache-Abfrage je Set und Konto bei JEDEM
Lauf, plus eine Zeile je Konto und Tag in price_history.
```

<a id="zustaendejeset"></a>
## `zustaendeJeSet`

```text
Welche Preis-Zustände braucht dieser Nutzer für diese Sets?

── Die eine Fassung der Regel ─────────────────────────────────────────────
Sie stand zweimal im Baum: einmal hier als conditionsNeededFor() für EIN Set
(Sofort-Abruf beim Erfassen) und einmal ausgeschrieben in der Schleife des
Nachtlaufs, dort gebündelt über alle Sets eines Nutzers. Zwei Fassungen,
und sie waren nicht gleich: Die Schleife kannte die Merkliste nicht.
Deshalb steht die Regel jetzt EINMAL, gebündelt — der Einzelfall ist eine
Liste mit einem Eintrag.

── Die Staffelung ─────────────────────────────────────────────────────────

  Bestand    die vorkommenden Zustände der Erfassungen, plus der Hinweis;
             sonst der gespeicherte Zustand der sets-Zeile
  Merkposten     die gewünschten Zustände — sie treten IMMER hinzu
  sonst      'N'

Seit der zustandsabhängigen Bewertung (src/finanzen/setValue.ts) braucht ein Set mit
einem neuen UND einem gebrauchten Exemplar BEIDE Preise im Cache. Vorher holte
der Job immer nur einen Zustand und wich nur dann auf den anderen aus, wenn
der erste gar keinen Preis lieferte — bei gemischten Sets fehlte damit dauerhaft
eine Hälfte, und die Bewertung fiel auf den jeweils anderen Zustand zurück.

── Warum der Merkposten HINZUTRITT statt zu verlieren ─────────────────────────
Wer ein Set neu besitzt und ein gebrauchtes zweites sucht, wartet auf den
Gebraucht-Preis — den Neu-Preis hat er schon. Beide Fragen sind echt, also
werden beide beantwortet. Das kostet einen zusätzlichen Abruf, aber nur für
Sets, die jemand besitzt UND in einem ANDEREN Zustand wünscht.

Bewusst nur die tatsächlich vorkommenden Zustände: Jeder zusätzliche Abruf geht
auf das BrickLink-Tageskontingent, und für ein reines Neu-Set ist der
Gebraucht-Preis wertlos.

`.catch`: Ein Aufbau, der nur initSchema() gelaufen ist, hat die
wanted-Tabelle nicht (siehe db/schema.sql). Dann bleibt es beim Bestand.

@param hintCondition Zustand einer Erfassung, die es noch nicht GIBT (siehe
       conditionsNeededFor) — gilt für alle übergebenen Sets, wird deshalb
       nur mit einem einzelnen aufgerufen.
@returns Map mit einem Eintrag je übergebenem Set, nie leer je Eintrag
```

<a id="conditionsneededfor"></a>
## `conditionsNeededFor`

```text
Derselbe Beschluss für ein EINZELNES Set — der Weg beim Erfassen.

Der Hinweis ist hier das Entscheidende: Beim Anlegen eines neuen Sets
existiert die set_acquisitions-Zeile noch nicht, denn
getCurrentMarketPrice() ruft refreshPriceForSet() auf, BEVOR
recordAcquisition() geschrieben hat. Ohne den Hinweis sah diese Funktion
nichts, fiel auf 'N' zurück, und nur der Neupreis wurde geholt. Die
anschliessende Preisabfrage fand für 'U' noch nichts im Cache und wich auf
den gerade gecachten Neupreis aus — ein als gebraucht importiertes Set
bekam so den Neupreis als Kaufpreis, obwohl „Gebraucht" gewählt war.

@returns {Promise<string[]>} z. B. ['N'], ['U'] oder ['N','U']
```

<a id="triggernow"></a>
## `triggerNow`

```text
Manueller Anstoss aus dem Monitoring.

Holt die Sperre SELBST, statt sie dem Lauf zu überlassen: Nur so kann die
Antwort ehrlich sein. Vorher meldete die Route `started: true`, sobald der
eigene Prozess nicht beschäftigt war — lief anderswo schon ein Durchgang,
stimmte die Meldung nicht, und ein zweiter Klick startete tatsächlich einen
zweiten kompletten Lauf über alle Sets.
```
