package ch.brickinventoryapp

import ch.brickinventoryapp.util.IMG_PROXY
import ch.brickinventoryapp.util.resolveFullUrl
import ch.brickinventoryapp.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.util.resolveThumbUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Serveradresse mit Schrägstrich am Ende: Die Helfer schneiden ihn ab. */
private const val SERVER = "http://nas:3000/"

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
        val src = read("util/BildRueckfall.kt")
        assert(src.contains("fun rememberTileImageWithFallback(")) {
            "Der Rückfall-Helfer fehlt"
        }
        val fn = src.substring(src.indexOf("fun rememberTileImageWithFallback("))
        assert(fn.contains("var useFallback by remember")) { "Der Zustand fehlt" }
    }

    @Test
    fun `imageLocal wird unverändert übernommen — kein eigener _thumb-Rateversuch mehr`() {
        // Der Server prüft, ob die Vorschau existiert, und liefert den passenden
        // Pfad; ein clientseitig geratenes "_thumb.jpg" scheiterte genau dann.
        assertEquals("http://nas:3000/images/sets/10283-1.jpg",
            resolveThumbUrl(SERVER, "/images/sets/10283-1.jpg", "https://cdn.rebrickable.com/x.jpg"))
        assertEquals("http://nas:3000/images/sets/10283-1_thumb.jpg",
            resolveThumbUrl(SERVER, "/images/sets/10283-1_thumb.jpg", null))
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
        // Hier standen zwei Verbote: kein `retryNonce`, kein `setParameter`
        // (das hiess in Coil 2 so; heute `memoryCacheKeyExtra`).
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

    @Test
    fun `HttpLoggingInterceptor haengt nicht mehr nur am API-Client`() {
        // Kommentare ausblenden, BEVOR das Fenster geschnitten wird: Ein
        // wachsender Erklärtext schob die geprüfte Zeile sonst aus den 800
        // Zeichen — die Regel galt weiter, nur der Ausschnitt war zu kurz.
        val src = Quellen.di().lines()
            .joinToString("\n") { if (it.trim().startsWith("//")) "" else it }
        val start = src.indexOf("internal fun buildInterceptorClient")
        val fn = src.substring(start, minOf(src.length, start + 2000))
        assert(!fn.contains("if (isApiClient && BuildConfig.DEBUG)")) {
            "Die alte Bedingung schloss den Bild-Client von der Protokollierung aus"
        }
        assert(fn.contains("if (BuildConfig.DEBUG) {")) {
            "Beide Clients müssen im Debug-Build protokolliert werden"
        }
        // Die Umschreibung des Platzhalters prüft ServerWaechterTest ausgeführt.
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
 * Jetzt gilt einheitlich: Vorschau UND volle Auflösung über den Server-Proxy
 * (ImageUrls.kt, IMG_PROXY).
 * Der Server bringt dort Plattencache, Negativ-Cache und Entpacken mit —
 * Arbeit, die bei einem Direktzugriff wirkungslos bliebe.
 *
 * Der Klassenname bleibt, damit die Historie auffindbar ist; geprüft wird
 * jetzt die umgekehrte Aussage.
 */
class FullResolutionBypassesProxyTest {

    @Test
    fun `resolveFullUrl leitet die volle Aufloesung ueber den Server-Proxy`() {
        // Kein Gerät spricht direkt mit dem CDN (Cloudflares Bot-Erkennung);
        // die volle Auflösung trägt kein &thumb=1.
        assertEquals("http://nas:3000$IMG_PROXY?url=https%3A%2F%2Fcdn.rebrickable.com%2Fsets%2F1+2.jpg",
            resolveFullUrl(SERVER, null, "https://cdn.rebrickable.com/sets/1 2.jpg"))
        assertEquals("ein Server-Pfad braucht keinen Proxy", "http://nas:3000/media/a.jpg",
            resolveFullUrl(SERVER, null, "/media/a.jpg"))
        assertNull(resolveFullUrl(SERVER, null, null))
    }

    @Test
    fun `Vorschaubild laeuft weiterhin ueber den Proxy mit thumb=1`() {
        assertEquals("http://nas:3000$IMG_PROXY?url=https%3A%2F%2Fcdn.rebrickable.com%2Fx.jpg&thumb=1",
            resolveThumbUrl(SERVER, null, "https://cdn.rebrickable.com/x.jpg"))
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
        assertEquals("http://nas:3000$IMG_PROXY?url=https%3A%2F%2Fcdn.rebrickable.com%2Fp.png",
            resolveFullUrlViaProxy(SERVER, null, "https://cdn.rebrickable.com/p.png"))
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
 *
 * Die Adress-Prüfungen dieser Datei rufen die Helfer auf, statt ihren Quelltext
 * zu lesen. Gegenproben (31.10.2026, gemessen):
 *   A  in resolveImageUrl das Entfernen von `_thumb` weggelassen → rot „resolveFullUrl
 *      entfernt …“ und „Vorschau und volle Aufloesung …“
 *   B  `&thumb=1` beim Vorschaubild weggelassen → rot „Vorschaubild laeuft …“
 *   C  im Zweig der vollen Auflösung den Proxy umgangen (`imageUrl` direkt) → rot
 *      „resolveFullUrl leitet …“ und NoDirectCdnAccessTest „resolveImageUrl-Helfer …“
 */
class FullResolutionStripsThumbSuffixTest {

    @Test
    fun `resolveFullUrl entfernt ein vorhandenes _thumb-Suffix`() {
        assertEquals("http://nas:3000/images/sets/10283-1.jpg", resolveFullUrl(SERVER, "/images/sets/10283-1_thumb.jpg", null))
        assertEquals("die Abfrage bleibt", "http://nas:3000/images/p/3001.png?v=2",
            resolveFullUrl(SERVER, "/images/p/3001_thumb.png?v=2", null))
        assertEquals("nur das Suffix vor der Endung", "http://nas:3000/images/x_thumbnail.jpg",
            resolveFullUrl(SERVER, "/images/x_thumbnail.jpg", null))
    }

    @Test
    fun `resolveFullUrlViaProxy entfernt ebenfalls ein vorhandenes _thumb-Suffix`() {
        assertEquals("http://nas:3000/images/minifigs/sw0001.jpg",
            resolveFullUrlViaProxy(SERVER, "/images/minifigs/sw0001_thumb.jpg", null))
    }

    @Test
    fun `Vorschau und volle Aufloesung liefern unterschiedliche Adressen bei einem Vorschau-Pfad`() {
        val pfad = "/images/sets/10283-1_thumb.jpg"
        assertNotEquals(resolveThumbUrl(SERVER, pfad, null), resolveFullUrl(SERVER, pfad, null))
    }

}
