# Begründungen zu `utils/basisUrl.ts`

Die ausführlichen Kommentare aus `utils/basisUrl.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="basisurl"></a>
## `basisUrl`

```text
APP_BASE_URL — die EINE Adresse, unter der dieser Server von aussen zu
erreichen ist.

── Warum es diese Datei gibt ───────────────────────────────────────────────

Die Variable wurde an drei Stellen gelesen, jede mit eigener Schreibweise:

  routes/auth.ts    getBaseUrl()   — Links in Verifizierungs- und Reset-Mails
  utils/mailer.ts   baueAlarmMail  — der Knopf „Set ansehen" in der Alarmmail
  routes/auth.ts    /qr-token      — die Adresse im QR-Code (neu)

Alle drei mussten dasselbe wissen: Ein abschliessender Schraegstrich gehoert
weg, sonst entsteht `https://host//?set=123`. Alle drei mussten es einzeln
richtig machen, und die vierte Stelle haette es wieder einzeln gemusst.

── Was hier NICHT entschieden wird ─────────────────────────────────────────

Was geschieht, wenn die Variable fehlt, ist an jeder der drei Stellen eine
ANDERE Antwort, und das ist kein Versehen:

  getBaseUrl      faellt auf den Host-Header zurueck. Aeltere Installationen
                  liefen nie mit dieser Variablen; ein harter Abbruch haette
                  ihnen die Passwort-Zuruecksetzung genommen.
  baueAlarmMail   laesst den Knopf weg. Der Preislauf entsteht aus KEINER
                  Anfrage — es gibt keinen Host, den man raten koennte.
  /qr-token       verweigert. Ein QR-Code mit falscher Adresse ist schlimmer
                  als keiner: Er laesst sich scannen, und die App findet den
                  Server danach nie wieder.

Deshalb gibt diese Funktion `null` zurueck und trifft keine Entscheidung.
```

<a id="gemeldet"></a>
## `_gemeldet`

```text
Ein Hinweis ins Protokoll — EINMAL je Bereich und Prozess.

Der Merker ist noetig, weil die Aufrufer in Schleifen stecken: Der Preislauf
baut die Mail fuer JEDEN gerissenen Alarm. Bei zwanzig Alarmen saehe
zwanzigmal dieselbe Zeile aus wie ein Sturm statt wie ein Hinweis.

Je BEREICH und nicht global: Wer den QR-Code erzeugt und spaeter eine Mail
ausloest, soll beide Stellen im Protokoll sehen — es sind zwei verschiedene
Folgen derselben fehlenden Zeile in der Konfiguration.
```
