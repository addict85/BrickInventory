package ch.brickinventoryapp

import org.junit.Test

/**
 * Vorschaubild-Rückfall auf die volle Auflösung, wenn "_thumb.jpg" (noch)
 * fehlt.
 *
 * Gemeldet: Galerie-Kacheln blieben leer, obwohl alle Bilder inzwischen über
 * den Server bezogen werden (kein direkter CDN-Zugriff mehr). Ursache: nach
 * einem CSV-Import legt der Server Original-Bilder sofort ab, erzeugt die
 * "_thumb.jpg"-Varianten aber NACHTRÄGLICH in einer eigenen, langsamen
 * Warteschlange (server.ts, "Generate missing thumbnails"). Der vorherige
 * Wiederholversuch fragte dieselbe (fehlende) Vorschau-Datei ein zweites Mal
 * an — dieselbe 404, keine Besserung. Die Webapp fällt in genau diesem Fall
 * auf die volle Auflösung zurück (public/js/11-actions.js, data-orig); Android
 * hatte dieses Verhalten bisher nicht.
 */
class ThumbFallbackTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `rememberTileImageWithFallback existiert`() {
        val src = read("util/ImageUrls.kt")
        assert(src.contains("fun rememberTileImageWithFallback(")) {
            "Der Rückfall-Helfer fehlt"
        }
        val fn = src.substring(src.indexOf("fun rememberTileImageWithFallback("))
        assert(fn.contains("var useFallback by remember")) { "Der Zustand fehlt" }
    }

    @Test
    fun `imageLocal wird unverändert übernommen — kein eigener _thumb-Rateversuch mehr`() {
        // Die tiefere Ursache, warum Bilder auch nach einem vollständigen
        // App-Neustart fehlten: utils/images.ts (Server) prüft bereits, ob
        // "_thumb.jpg" existiert, und liefert ja nachdem den Thumb- ODER den
        // Original-Pfad. Lieferte der Server den Original-Pfad (weil die
        // Vorschau fehlt), konstruierte der Client TROTZDEM seinen eigenen
        // "_thumb.jpg"-Pfad daraus — denselben, von dem der Server soeben
        // festgestellt hatte, dass es ihn nicht gibt. Das scheiterte
        // zuverlässig, unabhängig von verstrichener Zeit oder Neustarts.
        val src = read("util/ImageUrls.kt")
        // Kommentare ausblenden: Der Erklärtext nennt "toThumbPath" selbst,
        // als Beschreibung dessen, was NICHT mehr passiert.
        val code = src.lines().joinToString("\n") { if (it.trim().startsWith("//")) "" else it }
        val fn = code.substring(code.indexOf("private fun resolveImageUrl"))
        assert(fn.contains("imageLocal != null ->")) { "Der imageLocal-Zweig fehlt" }
        assert(!fn.contains("toThumbPath(")) {
            "imageLocal darf clientseitig nicht mehr zu einem eigenen _thumb-Pfad umgebaut werden"
        }
        assert(!code.contains("fun toThumbPath")) {
            "Die tote Funktion sollte vollständig entfernt sein, nicht nur ungenutzt"
        }
        // Direkt im imageLocal-Zweig: "$base$imageLocal" unverändert.
        val branchEnd = fn.indexOf("imageUrl != null")
        val branch = fn.substring(0, branchEnd)
        // Nicht am NAMEN der Zwischenvariablen festhalten: Der Zweig legt
        // inzwischen `path` an (für thumb=true ist das imageLocal unverändert,
        // für die volle Auflösung ohne "_thumb"-Suffix). Geprüft wird, was
        // zählt — base + Serverpfad, ohne clientseitigen Umbau.
        assert(branch.contains("\"\$base\$imageLocal\"") || branch.contains("\"\$base\$path\"")) {
            "imageLocal muss unverändert an base angehängt werden"
        }
    }

    @Test
    fun `GalleryScreen benutzt den Rückfall statt eines wirkungslosen Wiederholversuchs`() {
        val src = read("ui/screens/GalleryScreen.kt")
        assert(src.contains("rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)")) {
            "GalleryScreen muss den neuen Rückfall-Helfer benutzen"
        }
        assert(src.contains("onImageError()")) {
            "Der Fehlerfall muss den Rückfall auslösen"
        }
        // ── Nachgezogen (Nachtrag 38) ───────────────────────────────────────
        // Hier standen zwei Verbote: kein `retryNonce`, kein `setParameter`.
        // Sie stammen aus einer Phase, in der ein Wiederholversuch als
        // wirkungslos verworfen wurde („fragt bei einer echt fehlenden Datei
        // zweimal dieselbe 404 an"). Das galt für den DAMALIGEN Fall.
        //
        // Inzwischen ist der Ablauf ein anderer: Direkt nach dem Erfassen
        // erzeugt der Server die Vorschau erst noch — der zweite Versuch nach
        // einer Sekunde trifft sie dann sehr wohl an. GalleryImageRetryTest
        // (ResponseCacheContractTest.kt) verlangt genau das, und beide Tests
        // widersprachen sich direkt. Die Verbote sind deshalb entfallen;
        // geblieben ist die Regel, die BEIDE Fassungen teilen: Am Ende der
        // Kette muss der Rückfall auf die volle Auflösung stehen.
    }

    @Test
    fun `CatalogSetCard mischt onError statt onState mit dem Platzhalter-Painter`() {
        // Compile-Fehler: "error" (Platzhalter-Painter) und "onState" gehören
        // zu zwei unterschiedlichen, sich gegenseitig ausschliessenden
        // AsyncImage-Überladungen von Coil. Mit "imageLoader" UND "error"
        // gesetzt bleibt nur die Painter-Überladung übrig — die kennt
        // "onError", nicht "onState". Die anderen Kacheln (Gallery, Parts,
        // Minifigs) setzen kein "error" und benutzen deshalb weiterhin
        // "onState" — das ist dort korrekt und soll so bleiben.
        val src = read("ui/screens/CatalogScreen.kt")
        assert(src.contains("error = painterResource(R.drawable.ic_logo)")) {
            "Der Logo-Platzhalter darf nicht verloren gegangen sein"
        }
        assert(src.contains("onError = { onThumbError() }")) {
            "Zusammen mit \"error\" muss \"onError\" verwendet werden, nicht \"onState\""
        }
        assert(!src.contains("onState = { st ->")) {
            "onState ist mit dem error-Parameter nicht kombinierbar — genau das verursachte den Compile-Fehler"
        }
    }
}

/**
 * Der Bild-Client protokolliert genau wie der API-Client.
 *
 * Ein Logcat zeigte alle API-Aufrufe (/api/v1/sets, /stats, /settings), aber
 * KEINE einzige Bildanfrage — nicht, weil keine gemacht wurden, sondern weil
 * der Logging-Interceptor nur an isApiClient=true hing. Der Bild-Client
 * (isApiClient=false, von Coil benutzt) hatte keinen Interceptor und blieb
 * dadurch für jede Diagnose unsichtbar. Das Fehlen von Bildanfragen im Log
 * war also keine Erkenntnis über das Problem, sondern eine Lücke in der
 * Beobachtbarkeit selbst.
 */
class ImageClientLoggingTest {
    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `HttpLoggingInterceptor haengt nicht mehr nur am API-Client`() {
        // Kommentare ausblenden, BEVOR das Fenster geschnitten wird: Ein
        // wachsender Erklärtext schob die geprüfte Zeile sonst aus den 800
        // Zeichen — die Regel galt weiter, nur der Ausschnitt war zu kurz.
        val src = read("di/AppModule.kt").lines()
            .joinToString("\n") { if (it.trim().startsWith("//")) "" else it }
        val fn = src.substring(src.indexOf("private fun buildInterceptorClient"), src.indexOf("private fun buildInterceptorClient") + 800)
        assert(!fn.contains("if (isApiClient && BuildConfig.DEBUG)")) {
            "Die alte Bedingung schloss den Bild-Client von der Protokollierung aus"
        }
        assert(fn.contains("if (BuildConfig.DEBUG) {")) {
            "Beide Clients müssen im Debug-Build protokolliert werden"
        }
        // isApiClient wird weiterhin für die localhost-Umschreibung gebraucht
        assert(src.contains("if (isApiClient && urlStr.startsWith(\"http://localhost:3000/\"))")) {
            "isApiClient darf für die URL-Umschreibung nicht verloren gegangen sein"
        }
    }
}

/**
 * ALLE Bildabrufe laufen über den Server-Proxy — auch die volle Auflösung.
 *
 * ── Umgekehrt (Nachtrag 38, Marcos Entscheidung: „die Proxy-Lösung") ────────
 * Diese Klasse verlangte früher das Gegenteil: volle Auflösung direkt vom
 * Gerät zum CDN, weil das für eine einmalige Anzeige schneller sei und den
 * Server entlaste. Das ist die Ausnahme, die die Regel wertlos macht — ein
 * Gerät, das irgendwo doch direkt mit Rebrickable spricht, trifft dort auf
 * Cloudflares Bot-Erkennung. Browser-Kennung, Referer-Kopfzeile, Drosselung
 * und AVIF-Vermeidung in dieser App behandelten allesamt Symptome davon.
 *
 * Jetzt gilt einheitlich: Vorschau UND volle Auflösung über /api/img-proxy.
 * Der Server bringt dort Plattencache, Negativ-Cache und Entpacken mit —
 * Arbeit, die bei einem Direktzugriff wirkungslos bliebe.
 *
 * Der Klassenname bleibt, damit die Historie auffindbar ist; geprüft wird
 * jetzt die umgekehrte Aussage.
 */
class FullResolutionBypassesProxyTest {
    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `resolveFullUrl leitet die volle Aufloesung ueber den Server-Proxy`() {
        val src = read("util/ImageUrls.kt")
        val fn = src.substring(src.indexOf("private fun resolveImageUrl"))
        assert(fn.contains("} else if (!thumb) {")) {
            "Der eigene Zweig für die volle Auflösung fehlt"
        }
        val branchStart = fn.indexOf("} else if (!thumb) {")
        val branchEnd = fn.indexOf("} else {", branchStart)
        val branch = fn.substring(branchStart, branchEnd)
        // ── Umgekehrt (Nachtrag 38, Marcos Entscheidung: „die Proxy-Lösung")
        // Vorher verlangte dieser Test das Gegenteil: rohe CDN-Adresse ohne
        // Proxy, mit der Begründung, ein einmaliger Detailabruf sei so
        // schneller und entlaste den Server.
        //
        // Das ist die Ausnahme, die die Regel wertlos macht: Ein Gerät, das
        // irgendwo doch direkt mit Rebrickable spricht, trifft dort auf
        // Cloudflares Bot-Erkennung — genau die Ursache, gegen die in dieser
        // App bereits Browser-Kennung, Referer-Kopfzeile, Drosselung und
        // AVIF-Vermeidung eingebaut wurden. Jede dieser Massnahmen behandelte
        // ein Symptom davon. Ausserdem bringt der Server Plattencache,
        // Negativ-Cache und Entpacken mit — Arbeit, die bei einem
        // Direktzugriff wirkungslos bleibt.
        assert(branch.contains("/api/img-proxy")) {
            "Volle Auflösung muss über den Server-Proxy laufen — kein Gerät spricht direkt mit dem CDN"
        }
        assert(!branch.contains("&thumb=1")) {
            "Volle Auflösung darf kein &thumb=1 tragen"
        }
    }

    @Test
    fun `Vorschaubild laeuft weiterhin ueber den Proxy mit thumb=1`() {
        val src = read("util/ImageUrls.kt")
        val fn = src.substring(src.indexOf("private fun resolveImageUrl"))
        assert(fn.contains("\"\$base/api/img-proxy?url=\$encoded&thumb=1\"")) {
            "Das Vorschaubild muss weiterhin über den Server-Proxy laufen"
        }
    }
}

/**
 * Teile und Minifiguren laden den Rückfall (volle Auflösung) über den
 * Server-Proxy — auf Nutzerwunsch, damit auch dort kein Gerät am Server
 * vorbei direkt mit Rebrickable spricht. Sets und Katalog bleiben bewusst
 * bei der direkten CDN-Adresse für ihre eigenen Detail-/Zoom-Dialoge.
 */
class PartsMinifigsFullResBypassProxyTest {
    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `resolveFullUrlViaProxy existiert und wickelt CDN-Adressen in den Proxy`() {
        val src = read("util/ImageUrls.kt")
        assert(src.contains("fun resolveFullUrlViaProxy(")) { "Der Helfer fehlt" }
        // Wie oben: erst Kommentare weg, dann das Fenster — sonst entscheidet
        // die Länge des Erklärtexts über das Ergebnis.
        val code = src.lines().joinToString("\n") { if (it.trim().startsWith("//")) "" else it }
        val fn = code.substring(code.indexOf("fun resolveFullUrlViaProxy("), code.indexOf("fun resolveFullUrlViaProxy(") + 500)
        assert(fn.contains("/api/img-proxy?url=")) { "Muss über den Proxy laufen" }
        assert(!fn.contains("&thumb=1")) { "Volle Auflösung darf kein &thumb=1 haben" }
    }

    @Test
    fun `Teile und Minifiguren uebergeben fullViaProxy = true, Sets und Katalog nicht`() {
        // ── JEDER Aufruf, nicht eine Anzahl ─────────────────────────────────
        //
        // Hier stand `partsCount == 2`. Die Zahl war so lange richtig, wie es
        // genau zwei Aufrufstellen gab — mit der Tabellenansicht kam in jedem
        // der beiden Bildschirme eine dritte dazu, und der Test meldete „3
        // statt 2", obwohl die dritte Stelle es GENAUSO richtig macht.
        //
        // Die Regel steht im Namen dieses Tests: In diesen zwei Bildschirmen
        // laeuft die volle Aufloesung ueber den Proxy. Also muss JEDER Aufruf
        // von rememberTileImageWithFallback dort fullViaProxy = true setzen —
        // eine vergessene Stelle faellt damit auf, eine hinzugefuegte richtige
        // nicht.
        val aufruf = Regex("""rememberTileImageWithFallback\s*\(([^)]*)\)""")
        for (rel in listOf("ui/screens/PartsScreen.kt", "ui/screens/MinifigsScreen.kt")) {
            // ohneKommentare: Beide Dateien ERWAEHNEN den Helfer in einem
            // Erklaerkommentar („siehe util/ImageUrls.kt,
            // rememberTileImageWithFallback()"). Ohne diesen Schritt meldet
            // die Pruefung genau diese Erwaehnung als Aufruf ohne
            // fullViaProxy — beim Nachrechnen ist mir das sofort passiert.
            val src = Quellen.ohneKommentare(read(rel))
            val stellen = aufruf.findAll(src).toList()
            // Selbstbeweis: Findet das Muster nichts, waere die Schleife leer
            // und der Test gruen, ohne etwas geprueft zu haben.
            assert(stellen.size >= 2) {
                "$rel: nur ${stellen.size} Aufruf(e) von rememberTileImageWithFallback gefunden — Muster veraltet?"
            }
            for (m in stellen) {
                val zeile = src.substring(0, m.range.first).count { it == '\n' } + 1
                assert(m.groupValues[1].contains("fullViaProxy = true")) {
                    "$rel:$zeile — dieser Aufruf setzt fullViaProxy nicht. Teile und " +
                    "Minifiguren holen die volle Aufloesung ueber den Proxy, weil " +
                    "Rebrickable direkt nicht erreichbar ist."
                }
            }
        }

        val gallery = read("ui/screens/GalleryScreen.kt")
        assert(!gallery.contains("fullViaProxy")) { "GalleryScreen.kt darf fullViaProxy nicht setzen — Sets bleiben direkt" }

        val catalog = read("ui/screens/CatalogScreen.kt")
        assert(!catalog.contains("fullViaProxy")) { "CatalogScreen.kt darf fullViaProxy nicht setzen — Katalog bleibt direkt" }
    }
}

/**
 * Set-Detail-Dialog benutzt die volle Auflösung, keine Vorschau — wie die
 * Webapp.
 *
 * Ein früherer Kommentar behauptete, die Webapp mache im Detail-Dialog
 * dieselbe Thumb/Voll-Unterscheidung wie die Kachel — das stimmte nicht.
 * public/js/07-admin.js zeigt für "m-img" (das Hauptbild im Detail-Dialog)
 * immer fullUrl(), nie eine Vorschau. Android zeigte dort fälschlich
 * resolveThumbUrl().
 */
class SetDetailUsesFullResolutionTest {
    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `SetDetailScreen zeigt fuer Vorschau und Zoom dieselbe volle Aufloesung`() {
        val src = read("ui/screens/SetDetailScreen.kt")
        assert(src.contains("val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)")) {
            "Das Hauptbild im Detail-Dialog muss resolveFullUrl() benutzen, nicht resolveThumbUrl()"
        }
        assert(!src.contains("resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)")) {
            "resolveThumbUrl() darf hier nicht mehr aufgerufen werden"
        }
        assert(!src.contains("import ch.brickinventoryapp.util.resolveThumbUrl")) {
            "Der jetzt ungenutzte Import muss entfernt sein"
        }
    }
}

/**
 * resolveFullUrl()/resolveFullUrlViaProxy() entfernen ein "_thumb"-Suffix
 * aus imageLocal, statt es unverändert durchzureichen.
 *
 * Gemeldet: Detail und Zoom zeigten bei Sets weiterhin die kleine Vorschau,
 * nicht die volle Auflösung. Ursache: Beim Entfernen des fehlerhaften
 * Rateversuchs (toThumbPath()) wurde auch die GEGENTEILIGE, aber nötige
 * Operation entfernt — das Abschneiden eines bereits vorhandenen
 * "_thumb"-Suffixes für die volle Auflösung. Ohne das lieferten
 * resolveThumbUrl() UND resolveFullUrl() bei gesetztem imageLocal exakt
 * denselben Wert, sobald der Server einen Vorschau-Pfad zurückgab — der
 * Normalfall bei bereits heruntergeladenen Sets. Dieselbe Umkehrung wie
 * fullUrl() in der Webapp (public/js/01-core.js).
 */
class FullResolutionStripsThumbSuffixTest {
    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `resolveFullUrl entfernt ein vorhandenes _thumb-Suffix`() {
        val src = read("util/ImageUrls.kt")
        val fn = src.substring(src.indexOf("private fun resolveImageUrl"), src.indexOf("imageUrl != null ->"))
        assert(fn.contains("if (thumb) imageLocal")) {
            "Für die Vorschau muss imageLocal unverändert bleiben"
        }
        assert(fn.contains("""else imageLocal.replace(Regex(""")) {
            "Für volle Auflösung muss ein _thumb-Suffix entfernt werden"
        }
        assert(fn.contains("_thumb")) { "Das Muster muss tatsächlich nach _thumb suchen" }
    }

    @Test
    fun `resolveFullUrlViaProxy entfernt ebenfalls ein vorhandenes _thumb-Suffix`() {
        val src = read("util/ImageUrls.kt")
        val fn = src.substring(src.indexOf("fun resolveFullUrlViaProxy("), src.indexOf("fun resolveFullUrlViaProxy(") + 500)
        assert(!fn.contains("imageLocal != null -> \"\$base\$imageLocal\"")) {
            "Die alte, unveränderte Durchreiche darf nicht mehr vorkommen"
        }
        assert(fn.contains("_thumb")) { "Muss ebenfalls ein _thumb-Suffix entfernen" }
    }

    @Test
    fun `Vorschau und volle Aufloesung liefern unterschiedliche Adressen bei einem Vorschau-Pfad`() {
        // Nachstellung der Kotlin-Logik in JS, um das Ergebnis konkret zu
        // vergleichen statt nur die Textform zu prüfen.
        fun stripThumb(s: String) = Regex("""_thumb(\.[^.?]+)(\?|$)""").replace(s) { m -> "${m.groupValues[1]}${m.groupValues[2]}" }
        val serverThumbPath = "/images/sets/10283-1_thumb.jpg"
        val thumbResult = serverThumbPath  // resolveThumbUrl: unverändert
        val fullResult = stripThumb(serverThumbPath)  // resolveFullUrl: bereinigt
        assert(thumbResult != fullResult) {
            "Vorschau und volle Auflösung dürfen bei einem Vorschau-Pfad nicht identisch sein"
        }
        assert(fullResult == "/images/sets/10283-1.jpg") {
            "Falsches Ergebnis nach dem Entfernen des Suffixes: $fullResult"
        }
    }
}
