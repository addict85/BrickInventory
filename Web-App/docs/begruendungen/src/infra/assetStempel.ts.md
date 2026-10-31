# Begründungen zu `src/infra/assetStempel.ts`

Die ausführlichen Kommentare aus `src/infra/assetStempel.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Der `?v=`-Stempel an den Assets — abgeleitet aus den DATEIEN, nicht aus
einer Zahl, die jemand gesetzt haben muss.

── Der Befund, der dazu gefuehrt hat ───────────────────────────────────────

Marcos Meldung, zweimal mit Bildschirmfoto: „Beim Logout-Eintrag fehlt der
Text." GEMESSEN in einem echten Chromium (der Container hat einen) rendert
derselbe Eintrag korrekt — „🚪 Sign out", rgb(185,28,28) auf Weiss, 210×32
px. Sein Browser lud also andere Dateien, als sein Server hatte.

Warum: index.html bindet alle Assets mit `?v=<Version>` ein, und
server.ts liefert public/ mit `maxAge: '7d'` aus. Der Satz dort — „die
versionierten Referenzen darin ziehen dann frische Assets nach" — stimmt
nur, solange die Version wechselt. Sie kam aus scripts/bump-version.js,
und das „laeuft automatisch als npm postinstall und explizit im
Docker-Build": also genau dann NICHT, wenn jemand `git pull` macht und den
Server neu startet. Der Stempel stand sechs Tage still; der Browser durfte
sieben Tage lang seine Kopie behalten. Das Ergebnis war ein gemischter
Stand — frisches index.html (no-cache), frisches app.bundle.js, altes
styles.css.

── Warum PRO DATEI und nicht eine Zahl fuer alle ───────────────────────────

Eine gemeinsame Versionsnummer entwertet bei jedem Deploy ALLE Dateien,
auch die unveraenderten — der Browser laedt dann 223 KB Buendel und sechs
Designs neu, weil sich ein Sprachtext geaendert hat. Ein Stempel je Datei
entwertet genau das, was anders ist. Das ist nicht nur sparsamer, es ist
auch das, was die Frist von sieben Tagen ueberhaupt erst sinnvoll macht.

── Woraus der Stempel besteht ──────────────────────────────────────────────

Aenderungszeit und Groesse, beide in Basis 36. KEINE Pruefsumme: Die
muesste jede Datei lesen (das Buendel allein ist 223 KB), und zwar bei
jedem Seitenaufruf oder hinter einem weiteren Cache. mtime+Groesse
unterscheidet jede Aenderung, die ein Deploy erzeugt — eine Datei, die
gleich gross bleibt UND dieselbe Aenderungszeit behaelt, ist dieselbe
Datei.

Nicht erfasst waere eine Aenderung, die Groesse und Zeitstempel exakt
erhaelt. Das kommt beim Auspacken eines Archivs mit gesetzten Zeiten vor,
nicht beim Bauen. Wer das ausschliessen will, braucht die Pruefsumme und
zahlt sie.
```

<a id="stempel-ttl-ms"></a>
## `STEMPEL_TTL_MS`

```text
Wie lange ein berechneter Satz Stempel gilt.

Ohne Frist wuerde jeder Seitenaufruf ein Dutzend `stat` ausloesen; mit einer
zu langen zeigt ein Deploy ohne Neustart minutenlang alte Adressen.
Dreissig Sekunden sind dieselbe Zahl, die in utils/indexHtml.ts schon fuer
das Design gilt — eine zweite, andere Frist waere nur eine zweite Zahl zum
Merken.
```

<a id="stempleassets"></a>
## `stempleAssets`

```text
Alle `?v=` in `html` durch den Stempel der jeweiligen Datei ersetzen.

Rein — kein Cache, kein Zustand. Genau deshalb laesst sich die Regel
pruefen, ohne einen Server zu starten.

Ersetzt wird nur bei `href="/…?v=…"` und `src="/…?v=…"`, also an
Verweisen, die ohnehin schon versioniert sind. Ein Pfad ohne `?v=` bleibt
unberuehrt: Wer eine Datei bewusst ohne Stempel einbindet, hat dafuer einen
Grund.

@param html   Der Seitenquelltext.
@param wurzel Das Verzeichnis, gegen das die absoluten Pfade aufloesen.
```
