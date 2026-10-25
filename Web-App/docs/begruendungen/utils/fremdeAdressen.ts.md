# Begründungen zu `utils/fremdeAdressen.ts`

Die ausführlichen Kommentare aus `utils/fremdeAdressen.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Welche fremden Adressen darf der Server abrufen — und was gilt bei einer
Umleitung?

── Woher diese Datei kommt ─────────────────────────────────────────────────

Der Baum hatte die Regel schon, nur nicht überall:

  • routes/imgProxy.ts prüft die Zieladresse gegen eine Allowlist und holt
    sie mit `https.get` — und das folgt von sich aus KEINER Umleitung.
  • Die Android-App baut ihren Update-Client mit `followSslRedirects(false)`.
  • clients/rebrickable.ts folgt Umleitungen dagegen von Hand, an ZWEI
    Stellen, und prüfte dabei nichts.

Das ist die Bauart von Fehler, gegen die dieses Projekt sonst überall
angeht: eine Regel in mehreren Schreibweisen, von denen nur eine bekannt
ist. Deshalb steht sie jetzt hier — einmal, für beide Seiten.

── Was an einer ungeprüften Umleitung gefährlich ist ───────────────────────

1. DER SCHLÜSSEL WANDERT MIT. Neun der zwölf Aufrufer von httpsGetRobust
   schicken `Authorization: key <REBRICKABLE_API_KEY>`. Beim Folgen wurde
   der Kopf unverändert weitergereicht — eine Umleitung auf einen fremden
   Host bekam damit den Schlüssel. Browser und curl werfen ihn bei einem
   Hostwechsel ab; genau das tut [naechsteUmleitung] jetzt auch.

2. HTTPS → HTTP. Beide Stellen wählten die Bibliothek nach dem Schema
   `protocol === 'https:' ? https : http`. Eine Umleitung von https auf http
   gab denselben Schlüssel im Klartext preis. Ein Downgrade wird nicht mehr
   befolgt.

3. KEIN ENDE. httpsGetRobust hatte gar keinen Umleitungszähler (`attempts`
   wird zwar hochgezählt, aber nur bei 429, Timeout und ECONNRESET
   geprüft). Eine Schleife A→B→A lief unbegrenzt — auslösbar allein vom
   fremden Server.

4. DAS ZIEL IST BELIEBIG. downloadFile legt die geholte Datei unter
   data/instructions/ ab, wo sie jeder angemeldete Nutzer abrufen kann. Ein
   Umleitungsziel wie http://127.0.0.1:… wurde also geholt UND
   zurückgegeben. Deshalb prüft dieser Weg zusätzlich den HOST — nicht nur
   am Anfang, sondern bei jedem Sprung.
```

<a id="erlaubte-download-hosts"></a>
## `ERLAUBTE_DOWNLOAD_HOSTS`

```text
Hosts, von denen der Server DATEIEN auf die Platte holen darf.

Die Bild-Hosts plus lego.com — dort liegen die Anleitungs-PDFs.

`assets.lego.com` steht NICHT eigens dabei: [hostErlaubt] lässt echte
Subdomains ohnehin durch, und derselbe Host zweimal wäre genau die Sorte
Doppelung, die später an einer der beiden Stellen nachgezogen wird.

── Was diese Liste nebenbei mitrepariert ───────────────────────────────────
scrapeInstructions() sammelt Adressen mit
`/href="(https?:\/\/[^"]*lego\.com[^"]*\.pdf[^"]*)"/`. Dieses Muster trifft
auch `https://lego.com.angreifer.tld/x.pdf` und `https://evil-lego.com/x.pdf`
— es prüft eine Teilzeichenkette, keinen Host. Die Prüfung am HOLENDEN Ende
fängt das mit ab, und zwar unabhängig davon, wie die Adresse dorthin kam.

── bdpinstructions.s3.amazonaws.com, und warum GENAU dieser Host ──────────

Marcos Serverprotokoll, seitenweise:

    [download] Adresse nicht in der Liste erlaubter Hosts:
               https://bdpinstructions.s3.amazonaws.com/11010.pdf

Diese Adresse baut der Baum SELBST: utils/instructions.ts, Rueckfall 2 fuer
die BrickLink Designer Programme. Sie zu bauen und dann abzulehnen ist
keine Schranke, sondern eine Unstimmigkeit zwischen zwei Stellen — der
Rueckfall konnte nie etwas holen, und zwar seit er existiert.

Der VOLLE Host und nicht `amazonaws.com`: Letzteres liesse jeden fremden
S3-Eimer der Welt durch, und hostErlaubt() lässt echte Subdomains ohnehin
durch — `amazonaws.com` waere also die Erlaubnis fuer alles, was irgendwer
dort ablegt. Ein Eimername ist eine Subdomain, kein Pfad.
```

<a id="hosterlaubt"></a>
## `hostErlaubt`

```text
Darf diese Adresse abgerufen werden?

Exakter Host-Treffer oder echte Subdomain. Ein blosses `host.endsWith(h)`
liesse auch "evil-rebrickable.com" durch — daher der Punkt davor. Dieselbe
Falle wie beim Bearer-Token der App (util/NetworkPolicy.kt) und bei der
Update-Adresse (util/AppUpdate.kt); sie ist in diesem Baum schon dreimal
aufgetreten.

@param url  vollständige Adresse
@param liste  eine der beiden Listen oben
@returns false, wenn die Adresse nicht parsebar ist — im Zweifel NICHT holen
```

<a id="naechsteumleitung"></a>
## `naechsteUmleitung`

```text
Den nächsten Sprung prüfen und vorbereiten — oder ablehnen.

@param von         die Adresse, die umgeleitet hat (für relative Ziele)
@param location    der Location-Kopf der Antwort
@param kopfzeilen  die bisher geschickten Kopfzeilen
@param erlaubteHosts  gesetzt: der Zielhost wird geprüft. Weggelassen: nicht.
                   Der Dateidownload prüft (die Datei wird ausgeliefert), die
                   API-Abrufe nicht — deren Ausgangsadressen sind fest, und
                   eine Liste mit geratenen Hosts wäre schlechter als keine.
@returns null, wenn nicht gefolgt werden darf
```
