# Begründungen zu `test/umleitungen.test.js`

Die ausführlichen Kommentare aus `test/umleitungen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ausgehende Umleitungen: begrenzt, nur https, ohne Geheimnisse.

── Woher das kommt ─────────────────────────────────────────────────────────
Der Baum hatte die Regel an zwei Stellen richtig und an zwei Stellen gar
nicht:

  RICHTIG   routes/imgProxy.ts holt mit `https.get`, das von sich aus keiner
            Umleitung folgt — plus eine Host-Allowlist.
  RICHTIG   Die Android-App baut ihren Update-Client mit
            `followSslRedirects(false)` (di/NetzModule.kt).
  FEHLTE    clients/rebrickable.ts folgte Umleitungen von Hand, an zwei
            Stellen, und pruefte dabei nichts.

Drei Folgen, alle nachgemessen:

 1. DER SCHLUESSEL WANDERTE MIT. Neun der zwoelf Aufrufer von
    httpsGetRobust schicken `Authorization: key <REBRICKABLE_API_KEY>`
    (rebrickable.ts 122/217/312/352/384, routes/parts.ts 125/149,
    src/teile/abfragen.ts 533, jobs/rebrickableCsvSync.ts 281). Der Kopf
    ging unveraendert an das Umleitungsziel.
 2. HTTPS -> HTTP war erlaubt (`protocol === 'https:' ? https : http`) —
    derselbe Schluessel im Klartext.
 3. KEIN ENDE: httpsGetRobust hatte keinen Umleitungszaehler. Eine Schleife
    A -> B -> A lief unbegrenzt, ausloesbar allein vom fremden Server.

Geprueft wird hier die REGEL selbst (sie ist rein und damit direkt
aufrufbar) UND dass die beiden Stellen sie wirklich benutzen. Nur das eine
zu pruefen reichte in diesem Baum noch nie: Die frueheren Token-Regeln waren
jahrelang gruen, weil nur ihr Vorhandensein geprueft wurde und nie ihr
Gebrauch.

Ausfuehren: npm test
```

<a id="der-bdp-eimer-darf-geholt-werden-aber-nu"></a>
## `test('der BDP-Eimer darf geholt werden — aber nur er', () => {`

```text
Die Anleitungen der BrickLink Designer Programme.

── Marcos Serverprotokoll ─────────────────────────────────────────────────

    [download] Adresse nicht in der Liste erlaubter Hosts:
               https://bdpinstructions.s3.amazonaws.com/11010.pdf

Seitenweise, fuer jedes BDP-Set. Diese Adresse baut der Baum SELBST
(src/katalog/instructions.ts, Rueckfall 2) und lehnte sie dann ab: Der Rueckfall
konnte nie etwas holen, seit es ihn gibt.
```

<a id="for-stelle"></a>
## `for (const fremd of ['https://amazonaws.com/x.pdf',`

```text
── Und NICHT der halbe Anbieter ─────────────────────────────────────────

Der Punkt dieses Falls. `amazonaws.com` in die Liste zu schreiben waere
die bequeme Fassung gewesen — und die Erlaubnis fuer jeden fremden
S3-Eimer der Welt, denn hostErlaubt() laesst echte Subdomains durch und
ein Eimername IST eine Subdomain. Ohne diese Haelfte waere der Fall
darueber auch mit der bequemen Fassung gruen.
```
