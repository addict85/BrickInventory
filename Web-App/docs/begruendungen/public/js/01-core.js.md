# Begründungen zu `public/js/01-core.js`

Die ausführlichen Kommentare aus `public/js/01-core.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="was-nicht-mehr-hier-steht-obwohl-es-hier"></a>
## Was NICHT (mehr) hier steht, obwohl es hier stand:

```text
═══ Escaping, Werkzeuge, api(), i18n-Glue, Auth & Panels, Login/Logout ═══

Was NICHT (mehr) hier steht, obwohl es hier stand:
  Kontofilter                    → js/14-scope.js
  eigener Scrollbalken           → js/15-scrollbar.js
  PDF-Betrachter                 → js/12-pdfviewer.js
  CSV-Import-Fortschrittsbalken  → js/01-fortschritt.js
  Überwachung und Protokollfenster → js/01-monitor.js

Diese Liste ist kein Verzeichnis, sondern eine Warnung: Die Datei war
zweimal auf über 1300 Zeilen gewachsen, weil Neues dort angehängt wurde, wo
gerade jemand las. Was hier hineingehört, steht in der Zeile darüber — alles
andere bekommt eine eigene Datei, auch wenn es klein anfängt.
```

<a id="alle-listen-und-detailansichten-werden-p"></a>
## Alle Listen und Detailansichten werden per innerHTML aus Template-Literalen

```text
── ESCAPING ───────────────────────────────────────────────────────────────
Alle Listen und Detailansichten werden per innerHTML aus Template-Literalen
gebaut. Jeder Wert, der aus der DB, einem CSV-Import oder einer Fremd-API
kommt, MUSS deshalb durch einen dieser Helfer — sonst ist jedes freie
Textfeld (Teilename, Farbname, Notiz, Bild-URL) ein Stored-XSS-Vektor.
Faustregel:
  Textinhalt oder doppelt-gequotetes Attribut  → esc()
  Wert in einem JS-String im Attribut          → escJs()   z.B. data-click="fn" data-arg="${escJs(x)}"
  src / href                                   → escUrl()
  Farbwert in data-farbe=""                    → escHex()
```

<a id="passwort-min-zeichen"></a>
## `PASSWORT_MIN_ZEICHEN`

```text
Wie kurz ein Passwort hoechstens sein darf — dieselbe Zahl wie im Server
(PASSWORT_MIN_ZEICHEN in src/konto/auth.ts) und in der App.

Sie steht hier ZUSAETZLICH und nicht statt dessen: Der Server ist die
Instanz, die es durchsetzt, der Browser der, der es dem Nutzer sagt, bevor
er auf Speichern drueckt. Dass sie damit an drei Orten steht, ist
unvermeidbar (drei Laufzeiten) — test/passwortlaenge.test.js haelt sie
zusammen, damit aus „unvermeidbar" nicht „auseinandergelaufen" wird.
```

<a id="passwortzukurz"></a>
## `passwortZuKurz`

```text
Ist dieses Passwort zu kurz?

── Warum es das hier ueberhaupt gibt ───────────────────────────────────────
Nachgemessen: Die Webapp prueft die Laenge an KEINER ihrer fuenf Stellen,
die ein Passwort setzen (Registrieren, Zuruecksetzen, Aendern, Konto
anlegen, Konto-Passwort zuruecksetzen). Die Android-App prueft sie in ihrer
Oberflaeche sehr wohl (SettingsScreen, LoginScreen) — die beiden
Oberflaechen verhielten sich also unterschiedlich, und die Webapp lief in
einen Serverfehler, wo die App den Knopf gar nicht erst freigibt.
```

<a id="hexziffern"></a>
## `hexZiffern`

```text
Dieselbe Prüfung wie [escHex], aber OHNE das Doppelkreuz.

Für Attribute, die den nackten Farbwert tragen und deren Leser das `#`
selbst ergänzen — `data-hex` in der Farbauswahl ist so eines:

    dot.style.background = hex ? '#' + hex : 'var(--s200)';

escHex() dort einzusetzen hätte beide Leser gebrochen (`##RRGGBB`). Statt
die Regel zu verbiegen, gibt es sie zweimal: einmal für `style`, einmal für
das Attribut. Geprüft wird beide Male dasselbe — genau sechs Hexziffern.
```

<a id="diese-helfer-werden-von-anderen-modulen"></a>
## Diese Helfer werden von anderen Modulen bei DEREN Top-Level-Auswertung

```text
── UTILS ──────────────────────────────────────────────
── Warum function statt const-Pfeilfunktion ────────────────────────────────
Diese Helfer werden von anderen Modulen bei DEREN Top-Level-Auswertung
benutzt (z. B. G('parts-search').addEventListener(…) in 03-parts.js). Bei
gegenseitigen Importen wertet JavaScript das importierte Modul zuerst aus —
eine `const`-Pfeilfunktion aus 01-core.js liegt dann noch in der temporalen
Todeszone und wirft "G is not a function". Funktionsdeklarationen sind
dagegen schon beim Instanziieren initialisiert und sofort erreichbar.
```

<a id="knopfbesetzt"></a>
## `knopfBesetzt`

```text
Einen Knopf für die Dauer eines Aufrufs sperren.

── Der Befund ───────────────────────────────────────────────

Fünf Stellen taten dasselbe: sperren, „läuft"-Text setzen, danach freigeben
und die Beschriftung ZURÜCKSCHREIBEN. Und alle fünf schrieben sie als
deutsches Literal zurück:

    btn.textContent = 'Registrieren'    // im HTML: data-i18n="register.submit"

Zwei Folgen, beide unbemerkt: In einer englischen Oberfläche stand nach dem
ersten Klick ein deutsches Wort auf dem Knopf. Und das Literal stimmte nicht
einmal mit dem Wörterbuch überein — `register.submit` heisst „Konto
erstellen", nicht „Registrieren"; der Knopf beschriftete sich also selbst
bei deutscher Oberfläche um.

Die Beschriftung wird deshalb nicht mehr NEU GESETZT, sondern GEMERKT. Damit
gibt es keine zweite Fassung, die auseinanderlaufen kann — und der Helfer
braucht keine Sprache zu kennen.

Die BESCHRIFTUNG BLEIBT STEHEN. Frueher tauschte der Helfer sie gegen
Auslassungspunkte; Marco am 22.09.: „Wenn ich Bereits vorhandene Teile
eintragen klicke verschwindet der Button nach wie vor kurz und man sieht
ganz kurz Punkt." Genau das war es — der Knopf sah fuer zwei
Zehntelsekunden leer aus. Dass er arbeitet, zeigen jetzt drei Dinge, die
die Breite nicht anfassen: Er ist gesperrt (.btn:disabled blendet ihn ab),
der Zeiger wird zu „progress", und ueber die Unterkante laeuft ein
schmaler Streifen (.besetzt in styles.css). Die App macht es seit demselben
Tag genauso — dort wird nur das Symbol zum Kreisel, die Beschriftung bleibt
(PartsListScreen.kt).

Sprachfrei bleibt es damit erst recht: Es kommt gar kein Wort hinzu.
```

<a id="breite"></a>
## `breite`

```text
Die Breite einfrieren, BEVOR sich etwas aendern kann.

Ohne das riss der Knopf die ganze Zeile mit: Auslassungspunkte sind rund
200 px schmaler als „Bereits vorhandene Teile eintragen", und in einer
flex-Zeile rutscht dann alles rechts daneben nach. Gemessen an Marcos
Video vom 22.09.: sieben Bilder bei 30 B/s, gut 0,2 s.

Seit die Beschriftung stehen bleibt, greift das nur noch im Fall mit
eigenem Wartetext. Es steht trotzdem hier und nicht dort, weil die Regel
fuer BEIDE Wege dieselbe ist.

offsetWidth ist die Aussenbreite inklusive Rahmen und Innenabstand; 0
heisst „wird gerade nicht angezeigt" (display:none, oder jsdom ohne
Layout) — da gibt es nichts einzufrieren.
```

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

<a id="tp"></a>
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

<a id="xml-icon-svg"></a>
## `XML_ICON_SVG`

```text
Symbol für die BrickLink-Wanted-Listen-Knöpfe: ein XML-Dokument.

── Warum dieses Bild (Marcos Wunsch vom 20.10.) ────────────────────────────

„Kannst du das Icon der Bricklink xml-Buttons ersetzen durch ein sprechendes
 Icon für Bricklink oder xml?"

Dort stand ein Ziegelstein (🧱) — dasselbe Zeichen, das in diesem Baum für
Teile, Sets und die Marke steht; es sagte über diesen Knopf nichts.

Gezeichnet ist jetzt, was der Knopf TUT: eine Datei mit Eselsohr und den
spitzen Klammern `<` `>` darin. Das ist das übliche Bild für eine
XML-Datei und braucht keine Erklärung.

BEWUSST NICHT das BrickLink-Logo: Es ist eine fremde Marke. Dass die Liste
von dort kommt, sagt die Beschriftung daneben („BL-XML") und der Titel des
Knopfes — ein nachgezeichnetes Logo wäre eine Anmassung, die dieser Baum
nirgends sonst begeht.

Form und Bauart wie beim Papierkorb darunter: 24er-Raster, `currentColor`,
`aria-hidden` (die Beschriftung steht daneben, das Symbol ist Zierde).
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

<a id="fmtn"></a>
## `fmtN`

```text
Ein GELDBETRAG in der Waehrung des Nutzers.

── Warum der Rueckfall nicht mehr 'EUR' ist ─────────────────

Hier stand `cur||'EUR'`. Wer das zweite Argument vergisst, bekam damit still
Euro — und zwar auch dann, wenn der Nutzer in Franken rechnet. Genau das ist
im Teile-Detail passiert: Zwei Aufrufe uebergaben gar keine Waehrung, weil
sie ueberhaupt keinen Betrag formatieren wollten, sondern eine ANZAHL.
Angezeigt wurde „EUR 6.00×" statt „6×".

Die Anzahlen sind umgestellt (13-acquisition-modals.js). Der Rueckfall hier
bleibt trotzdem falsch: Ein vergessenes Argument soll wenigstens die
eingestellte Waehrung nehmen, nicht eine fest verdrahtete. `CURRENCY` traegt
sie; 'EUR' steht nur noch als letzte Stufe da, falls die Einstellung noch
nicht geladen ist.

Dass ueberhaupt kein Aufruf das Argument weglaesst, haelt
test/geldformat.test.js fest — dort steht auch, warum das die eigentliche
Regel ist.
```

<a id="applytheme"></a>
## `applyTheme`

```text
── DESIGN, VORGABEN, NAMENSZUG ──────────────────────────────────────────
Setzt das globale App-Design (vom Admin gewählt) als data-theme auf <html>.
Das CSS bringt für [data-theme="brick"] das blaue Stein-Design mit.

Die eigentliche Anwendung liegt in js/00-theme-boot.js, das schon im <head>
läuft — sonst hätte der Login-Screen das Design erst nach dem Einloggen.
Hier wird nur noch durchgereicht, damit der localStorage-Cache mitgeführt
wird und ein Design-Wechsel des Admins beim nächsten Laden sofort greift.
```

<a id="if"></a>
## `if`

```text
── Keine zweite Liste hier ────────────────────────────────

Hier stand `if (theme !== 'brick' && theme !== 'classic') return null;` —
eine EIGENE Liste der gueltigen Designs, geschrieben, als es zwei gab.
Inzwischen sind es sechs. Die vier neueren wurden hier abgewiesen und
NIE angewendet: Der Wechsel wirkte erst beim naechsten Seitenaufruf,
wenn js/00-theme-boot.js den Serverwert aus dem <html>-Attribut liest.

Marco: „Teilweise (nicht bei allen Designs) muss beim Aendern die Seite
neu geladen werden." Genau die zwei aus der alten Liste schalteten
sofort um, die vier danach nicht.

Dieselbe Bauart wie der fehlende <link> eine Runde vorher: eine
handgepflegte Aufzaehlung von Designs, die beim Hinzufuegen des
naechsten nicht mitwaechst. Die Pruefung dazu steht in theme.test.js.

Die gueltigen Werte kennt ausschliesslich js/00-theme-boot.js. Ohne
dieses Skript wird NICHTS gesetzt — lieber kein Design als ein
ungeprueftes Attribut.
```

<a id="zeigebenutzernamen"></a>
## `zeigeBenutzernamen`

```text
Den Namenszug in der Kopfleiste schreiben — mit dem Verwalter-Zusatz.

── Marcos Vorgabe vom 17.10. ───────────────────────────────────────────────

„Kannst du das \"Admin\" nicht als eigene Kachel anzeigen sondern in ()
hinter dem Benuzter? Also z.b. marco.bigolin (Admin) oder marco.bigolin
sofern der User kein Admin ist."

Die eigene Plakette (`#abadge`) ist damit aus der Kopfleiste verschwunden.
Sie war ein zweites Element, das dasselbe sagte wie der Name daneben — und
sie stand zwischen dem Namensknopf und dem rechten Rand, weshalb das Menü
nicht ganz rechts sass.

── Warum als EINE Funktion und nicht zweimal hingeschrieben ────────────────

Geschrieben wird der Name an ZWEI Stellen: hier beim Anmelden und in
js/05-settings.js nach dem Ändern des Profils. Genau dort stand die Zeile
schon einmal falsch („uname" statt „ubadge") und lief ins Leere, ohne dass
es jemand merkte. Zwei Fassungen derselben Regel laufen auseinander; diese
hier ist die einzige.

Der Zusatz kommt aus dem Sprachtext (`users.admin_badge`) und nicht als
Literal: Er stand schon übersetzt in der Plakette, und eine englische
Oberfläche soll nicht plötzlich „Admin" auf Deutsch zeigen.
```
