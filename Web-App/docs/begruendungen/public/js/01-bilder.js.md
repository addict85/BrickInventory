# Begründungen zu `public/js/01-bilder.js`

Die ausführlichen Kommentare aus `public/js/01-bilder.js` (bis zur Teilung in `public/js/01-core.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="img-proxy"></a>
## `IMG_PROXY`

```text
Die Adresse des Bild-Proxys — und die alte daneben.

Der Proxy ist mit der API-Zusammenlegung nach /api/v1 gezogen. Die alte
Schreibweise muss der Browser trotzdem ERKENNEN: `image_url` kommt aus der
Datenbank, und ein Abbild, das aelter ist als die Migration, traegt sie
noch. GEBAUT wird nur die neue.

Die Begruendung in ganzer Laenge steht serverseitig bei den gleichnamigen
Konstanten in src/katalog/bilder/images.ts.
```

<a id="stripownorigin"></a>
## `stripOwnOrigin`

```text
Adressen auf den EIGENEN Server auf ihren Pfad zurückführen.

── Warum das nötig ist ─────────────────────────────────────────────────────
`imgEl.src` liefert nicht den Attributwert, sondern die vom Browser
AUFGELÖSTE absolute Adresse: Aus src="/images/sets/9396-1.jpg" wird
"https://<server>/images/sets/9396-1.jpg". Genau diesen Wert reicht der Zoom
weiter (11-actions.js, openImageLightboxFromEl greift auf this.src zurück,
wenn data-orig nur den Platzhalter trägt).

Seit imgUrl()/fullUrl() JEDE absolute Adresse über /api/img-proxy leiten,
landete damit die eigene Server-Adresse im url=-Parameter — und der Proxy
lehnte sie mit 403 ab, völlig zu Recht: Seine Allowlist kennt nur die
Bild-CDNs, und ein Proxy, der auf sich selbst zeigt, wäre eine offene
Weiterleitung.

Die Kacheln waren nicht betroffen, weil sie ihre Adressen aus den Vorlagen
beziehen (relativ) statt aus der IDL-Eigenschaft — deshalb fiel es nur beim
Zoom auf.
```

<a id="if-2"></a>
## `if`

```text
Bereits eine Server-Adresse (lokale Datei oder Proxy) — unverändert lassen.

VORHER stand hier ein "Entpacken": Zeigte eine Proxy-Adresse auf einen
Host, der NICHT rebrickable.com war (Brickset, BrickLink), wurde die
eingebettete Adresse ausgepackt und direkt geladen — also am Backend
vorbei. Ebenso fiel jede absolute Adresse, die nicht mit
cdn.rebrickable.com begann, am Ende der Funktion unverändert durch.

Beides ist entfallen: Der Browser spricht ausschliesslich mit dem eigenen
Server. Das ist nicht nur Konsistenz — der Proxy setzt die Kopfzeilen
gegen Cloudflares Hotlink-Schutz, entpackt komprimierte Antworten, hält
einen Plattencache und einen Negativ-Cache. Nichts davon wirkt, wenn der
Browser die Adresse selbst aufruft.
```

<a id="vorschauen-entstehen-im-proxy-thumb"></a>
## `tp`

```text
Teilebilder haben auf dem CDN keine _thumb-Variante; die Verkleinerung
entsteht serverseitig aus dem Proxy-Cache (siehe routes/imgProxy.ts).
`thumb` kennt drei Werte:
  false  — volle Auflösung
  true   — Vorschau; fehlt sie, wird sie erzeugt
  'nur'  — Vorschau NUTZEN, aber keine erzeugen (Marcos Frage:
           „Der Proxy sollte das Bild in Originalgrösse weitergeben und
           die Thumbs mit einem Job nachladen")

Der dritte Wert ist für den KATALOG. Er zeigt rund 25 000 fremde Sets;
für jedes eine Verkleinerung zu rechnen ist Arbeit, die niemand je
wieder braucht — man scrollt vorbei. Der eigene Bestand (Galerie, Teile,
Minifiguren) bleibt bei `true`: Das sind ein paar hundert Bilder, die man
täglich wiedersieht, und dort lohnt die Verkleinerung.
```

<a id="thumburl"></a>
## `thumbUrl`

```text
Bildadresse für eine lokale Datei — unverändert, wie vom Server geliefert.

Vorher konstruierte diese Funktion aus JEDEM lokalen Pfad selbst eine
"_thumb.jpg"-Variante, unabhängig davon, ob diese Datei existiert.
`src/katalog/bilder/images.ts` (Server, resolveImageLocal()) prüft das aber bereits: Es
liefert für `image_local` je nachdem den Thumb- ODER den Original-Pfad,
mit eigenem Existenz-Cache. Lieferte der Server den Original-Pfad, weil
die Vorschau (noch) fehlt, baute diese Funktion TROTZDEM ihre eigene
"_thumb.jpg"-Adresse daraus — denselben Pfad, von dem der Server soeben
festgestellt hatte, dass es ihn nicht gibt. Das führte zu Bildern, die
auch nach einem vollständigen Neuladen der Seite nicht erschienen: Der
Fehler lag nicht an fehlender Zeit, sondern daran, dass der Client die
bereits richtige Antwort des Servers verwarf und erneut die falsche
Adresse selbst zusammenbaute.

Dieselbe Ursache und derselbe Fix wie in der Android-App
(util/ImageUrls.kt, resolveThumbUrl() — dort wurde toThumbPath()
vollständig entfernt). Für lokale Dateien gibt es jetzt an keiner Stelle
mehr einen client-seitigen Rateversuch — beide Clients laden Bilder
identisch.

CDN-Adressen (über /api/img-proxy) sind davon nicht betroffen: Dort
entscheidet weiterhin der Aufrufer per &thumb=1, ob eine Vorschau
angefordert wird — der Proxy-Cache kennt keine serverseitige
Vorab-Entscheidung wie image_local, das Vorschaubild entsteht bei Bedarf.
```

<a id="observelazyimages"></a>
## `observeLazyImages`

```text
Blendet Bilder erst beim Sichtbarwerden ein — und markiert alles, was schon
fertig geladen ist, SOFORT als geladen.

Der zweite Teil behebt das Flackern beim Neuaufbau einer Liste. styles.css
blendet Lazy-Bilder ein:

    img[loading=lazy]        { opacity:0; transition:opacity .25s ease }
    img[loading=lazy].loaded { opacity:1 }

Wird eine Liste per innerHTML neu gebaut, sind alle <img> neue Elemente und
starten wieder bei opacity:0 — auch wenn das Bild längst im Browser-Cache
liegt. Die .loaded-Klasse kam bisher ausschliesslich aus dem
IntersectionObserver-Callback, und das ist asynchron: Zwischen innerHTML und
Callback liegt mindestens ein Paint mit unsichtbaren Bildern. Genau das ist
die kurz weisse Kachelwand, wenn enrichGalleryWithPrices() die Galerie ein
zweites Mal rendert.

complete && naturalWidth > 0 heisst "steht sofort zur Verfügung" — solche
Bilder brauchen weder Beobachtung noch Einblendung.
```
