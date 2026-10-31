# Begründungen zu `src/katalog/bilder/images.ts`

Die ausführlichen Kommentare aus `src/katalog/bilder/images.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Bild-Helfer — zentrale Implementierung.

Vorher existierten zwei abweichende Kopien (routes/finance.js und
routes/api_v1.js): die finance-Variante hatte den Thumb-Cache, konnte aber
keine /images/-Pfade; die api_v1-Variante konnte beide Pfade, machte aber
ein fs.existsSync PRO AUFRUF (d.h. pro Set in jeder Liste). Diese Version
vereint beides: beide Pfad-Präfixe UND der Existenz-Cache.
```

<a id="img-proxy-pfad"></a>
## `IMG_PROXY_PFAD`

```text
Die Adresse des Bild-Proxys — an EINER Stelle.

── Warum die alte Schreibweise weiterlebt (Nachtrag 162) ───────────────────

Der Proxy hiess bis zur Zusammenlegung der API-Oberflächen `/api/img-proxy`
und war damit die letzte Adresse neben `/api/v1`. Der Umzug ist gemacht,
aber er kann nicht ersatzlos sein, und zwar aus zwei Gründen:

 1. Diese Adresse wird GESPEICHERT, nicht nur gerufen: proxyImageUrl() baut
    sie in `image_url`, und die Werte stehen so in den Tabellen. Für den
    Bestand gibt es eine Migration; ein Abbild, das älter ist als sie,
    trägt weiterhin die alte Form.
 2. Installierte App-Fassungen bauen die Adresse SELBST zusammen
    (ImageUrls.kt). Wer nicht aktualisiert, bekäme sonst überhaupt keine
    Teilebilder mehr.

Deshalb bedient der Server beide, baut aber nur noch die neue. Der ALTE
Pfad ist eine Auslauf-Adresse, kein zweiter gleichrangiger Weg — das ist
der Unterschied, den die Namen hier festhalten sollen.
```

<a id="resolveifexists"></a>
## `resolveIfExists`

```text
Prüft (mit Cache), ob eine lokale Bilddatei existiert, und liefert bei
Treffer direkt den Thumb-bevorzugten Pfad über resolveImageLocal() —
sonst null.

fs.existsSync statt fs.promises.access(), aus demselben Grund wie bei
resolveImageLocal(): synchron plus Cache ist für dieses Zugriffsmuster
(derselbe Pfad wird über die Zeit immer wieder abgefragt) genügsamer als
async über den begrenzten libuv-Thread-Pool. Der Katalog fragte vorher pro
Anfrage bis zu 200 Sets gleichzeitig per fs.promises.access() ab — das
flutete den (standardmässig nur 4 Threads grossen) Pool und verzögerte
andere Pool-Arbeit, unter anderem TLS-Handshakes neuer
Datenbank-Verbindungen. Das erklärte die "timeout exceeded when trying to
connect"-Fehler beim Filtern nach Jahr, wo eine grosse Trefferzahl auf
einmal ausgeliefert wird.

@param {string} publicRelPath z. B. "/images/sets/10283-1.jpg"
@returns {string|null}
```
