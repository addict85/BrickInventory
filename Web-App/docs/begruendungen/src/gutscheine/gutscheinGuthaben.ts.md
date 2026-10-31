# Begründungen zu `src/gutscheine/gutscheinGuthaben.ts`

Die ausführlichen Kommentare aus `src/gutscheine/gutscheinGuthaben.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Das Guthaben einer LEGO-Geschenkkarte abfragen.

── Marcos Vorgaben ─────────────────────────────────────────────────────────

  „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
   abgefragt und gespeichert werden kann?"

  „Wichtig das Ausgabeland soll in den Einstellungen bei den Gutscheinen
   für alle erfasst werden können (wie in der Prototyp-App). Der
   Zurückgemeldete Betrag soll im Feld Betrag gespeichert werden."

  „Der Botschutz beibehalten, dass nicht mehr Aufrufe generiert werden wenn
   ein Schutz greift. Ich möchte aber den Notweg weglassen."

  „Bitte auch dafür sorgen dass maximal 1 Request pro 30sek abgesetzt
   werden kann. (über alle Benutzer)"

„dies" war ein Prototyp-Server, den er mitgeschickt hat. Diese Datei ist
dessen Kern, in diesen Baum eingepasst — nicht abgeschrieben: Was der
Prototyp als eigenständiger Testserver tun durfte, muss hier durch die
Regeln dieses Baums (Hostliste, Drosselung, Protokollierung).

── Was hier geschieht, und was es NICHT ist ────────────────────────────────

Abgefragt wird über denselben Endpunkt, den die LEGO-Seite benutzt, wenn man
Nummer und PIN dort eintippt: der eigene Vorgang, automatisiert, für die
eigenen Karten. Es wird nichts erraten und nichts durchprobiert — ohne die
richtige PIN gibt es keine Antwort, und das ist auch hier so.

Drei Dinge, die der Prototyp selbst nennt und die deshalb hier stehen:

  * Der Endpunkt ist INTERN und undokumentiert. Er kann sich ohne
    Ankündigung ändern; dann bricht die Abfrage — nicht die Anwendung.
  * BOT-SCHUTZ. Bei HTTP 403 blockiert vermutlich Cloudflare. Der Prototyp
    bot dafür einen Notweg an (authorization und cookie aus den Devtools);
    DEN WILL MARCO NICHT. Statt eines Umwegs um den Schutz gibt es hier
    also [BotSchutz] — einen eigenen Fehlerfall, auf den der Aufrufer
    AUFHÖRT (src/gutscheine/gutscheinGuthabenSchranke.ts setzt eine Pause). Das ist
    die Umsetzung von „dass nicht mehr Aufrufe generiert werden".
  * Nummer und PIN gehen an lego.com. Unvermeidlich für die Sache; die
    Hostliste unten ist deshalb enger als die des Baums.

── Warum hier KEINE Drossel mehr steht ─────────────────────────────────────

Der erste Entwurf hatte `new RateLimiter(5, 60_000)` — die Zahl aus dem
README des Prototyps, prozesslokal. Marcos Grenze ist strenger UND anders
gemeint: ein Aufruf je 30 Sekunden „über alle Benutzer". Ein Limiter im
Modulspeicher kann das nicht leisten; der Server läuft im Cluster
(WORKERS = max(2, Kerne)), und jeder Arbeiter hätte seine eigene Instanz
mit eigener Zählung. Genau dieser Fehler ist in diesem Baum zweimal
behoben worden (src/konto/loginLimiter.ts: „aus 5 Fehlversuchen werden sonst
N×5"; utils/rateLimiter.ts zum Rebrickable-Tageskontingent).

Die Grenze steht deshalb in src/gutscheine/gutscheinGuthabenSchranke.ts und wird in
einer Transaktion über eine eigene Tabelle durchgesetzt (Migration 0039) —
einmal für die ganze Installation. Hier steht sie NICHT auch noch: Zwei Drosseln
wären zwei Wahrheiten, und die kleinere hätte die grössere stillgelegt.

── Die Hostliste ist ENGER als die des Baums ───────────────────────────────

ERLAUBTE_DOWNLOAD_HOSTS enthält `lego.com`, und hostErlaubt() lässt echte
Subdomains durch — `www.lego.com` wäre damit schon erlaubt. Für DIESEN Weg
genügt das nicht: Hier geht eine PIN hinaus, und sie soll nicht an
irgendeine Subdomain gehen, die irgendwann einmal dazukommt. Deshalb eine
eigene Liste mit genau einem Eintrag, exakt geprüft.

── Die PIN steht in KEINEM Protokoll ───────────────────────────────────────

Der Prototyp sagt es als Regel („Geloggt werden nur die letzten 4 Ziffern
der Karte, nie die PIN"), und hier ist es durchgesetzt: `verdecke()` läuft
über jeden Text, der nach draussen oder ins Protokoll geht — auch über die
Fehlertexte der Gegenseite. Eine fremde Fehlermeldung, die die Eingabe
zurückwirft, wäre sonst der eine Weg, auf dem die PIN doch ins Protokoll
käme.
```

<a id="laender"></a>
## `LAENDER`

```text
Die Ausgabeländer — dieselben acht wie im Prototyp, in derselben Reihenfolge.

Warum die Liste HIER steht und nicht in der Oberfläche: Sie wird an zwei
Stellen gebraucht — das Auswahlfeld in public/index.html zeigt sie, und die
Route muss den gespeicherten Wert prüfen. Ein Land, das nicht geprüft wird,
wäre nicht bloss falsch, sondern eine Lücke: Aus dem Land wird eine Adresse
gebaut (`https://www.lego.com/<land>/gift-cards/balance`), und ein Wert wie
`../../evil` wäre ein Versuch, diese Adresse umzulenken. Die Hostprüfung in
`hole()` fängt das ohnehin ab — aber eine feste Liste ist die Prüfung, die
man zuerst haben will.

test/gutschein-guthaben.test.js hält gegen index.html fest, dass das
Auswahlfeld genau diese Werte trägt.
```

<a id="sitzungen"></a>
## `sitzungen`

```text
Die Sitzungen je Land.

Modulweit und im Gedächtnis, nicht in der Datenbank: Der Token lebt etwa
24 Stunden und gehört keinem Konto — er ist ein Gast-Token der Gegenseite.
Ihn zu speichern hiesse, ein fremdes Geheimnis aufzubewahren, das morgen
ungültig ist.

Dass der Vorrat prozesslokal ist, kostet hier nichts: Im schlimmsten Fall
baut jeder Arbeiter einmal eine eigene Sitzung auf. Das ist etwas anderes
als eine prozesslokale DROSSEL (siehe Kopf der Datei) — ein Vorrat, der
mehrfach gefüllt wird, ist eine Unschärfe; eine Grenze, die mehrfach gilt,
ist keine Grenze.
```

<a id="holeguthaben"></a>
## `holeGuthaben`

```text
Das Guthaben einer Karte holen.

Ein einziger Neuversuch, und nur beim einen Fall, für den er etwas taugt:
Ein 401 mit einem Token aus dem VORRAT kann ein abgelaufener Token sein —
dann lohnt eine frische Sitzung. Ein 401 mit frischer Sitzung heisst, dass
die Karte oder die PIN nicht stimmt, und ein zweiter Versuch wiederholte
nur dieselbe Antwort.

Bei [BotSchutz] gibt es KEINEN Neuversuch — der zweite Aufruf wäre genau
der, den Marco nicht will. Die gemerkte Sitzung wird dabei aber VERWORFEN,
und das ist kein Nebenher:

Marcos Frage am 15.10. war, ob ein Aufruf je 30 Sekunden den Bot-Schutz
auslöst. Beim Nachdenken darüber fiel diese Lücke auf: Der Vorrat hält eine
Sitzung, solange ihr Token lebt — bis zu 24 Stunden. Die Cookies darin
altern schneller; `__cf_bm` von Cloudflare lebt etwa 30 Minuten. Nach einem
403 stand die alte Sitzung weiter im Vorrat, die Schranke pausierte eine
halbe Stunde, und der nächste Versuch nahm WIEDER dieselben Cookies — bekam
wieder 403, pausierte wieder. Das konnte sich festfressen, ohne je die
Guthabenseite neu zu laden.

Das Verwerfen kostet KEINEN zusätzlichen Aufruf: Es passiert im Speicher,
und der nächste Seitenaufruf findet erst nach der Pause statt. Marcos
Vorgabe „dass nicht mehr Aufrufe generiert werden" bleibt unberührt.

Die Grenze „ein Aufruf je 30 Sekunden über alle Benutzer" steht NICHT hier,
sondern in src/gutscheine/gutscheinGuthabenSchranke.ts; der Grund steht im Kopf
dieser Datei. Deshalb ruft die Route dort an und nicht hier.
```
