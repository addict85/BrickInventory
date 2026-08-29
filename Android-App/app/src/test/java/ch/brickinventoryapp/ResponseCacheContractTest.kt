package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.MinifigsResponse
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.model.ValuationSet
import ch.brickinventoryapp.data.model.StatsResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Der Plattenspeicher (data/cache/ResponseCache.kt) legt API-Antworten als JSON
 * ab und liest sie zurück, wenn ein Abruf scheitert. Das trägt nur, solange
 * jede gecachte Antwortklasse verlustfrei durch die Serialisierung geht.
 *
 * Dieser Test braucht kein Android — er prüft genau diese Runde für die vier
 * Klassen, die tatsächlich gecacht werden. Bricht eine Modelländerung die
 * Runde, fällt es hier auf und nicht erst als leerer Bildschirm nach einem
 * Neustart ohne Netz.
 */
class ResponseCacheContractTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun `SetsResponse ueberlebt die Runde`() {
        val raw = """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falcon","year":2017,"quantity":2,"condition":"N",
             "instructions":[{"url":"https://x/y.pdf","description":"Heft 1"}]},
            {"set_number":"10290-1","name":"Pickup","quantity":1}]}"""
        val decoded = json.decodeFromString(SetsResponse.serializer(), raw)
        val round = json.decodeFromString(SetsResponse.serializer(),
            json.encodeToString(SetsResponse.serializer(), decoded))
        assertEquals(decoded.sets.size, round.sets.size)
        assertEquals("75192-1", round.sets[0].setNumber)
        assertEquals("Falcon", round.sets[0].name)
        // Verschachtelte Listen sind der Punkt, an dem eine relationale
        // Zwischenschicht TypeConverter gebraucht hätte.
        assertEquals(1, round.sets[0].instructions.size)
        assertEquals(2, round.sets[0].quantity)
    }

    @Test
    fun `MinifigsResponse ueberlebt die Runde`() {
        val raw = """{"success":true,"total":1,"figs":[
            {"fig_number":"sw0001","fig_name":"Luke","quantity":3,"source":"set"}]}"""
        val decoded = json.decodeFromString(MinifigsResponse.serializer(), raw)
        val round = json.decodeFromString(MinifigsResponse.serializer(),
            json.encodeToString(MinifigsResponse.serializer(), decoded))
        assertEquals(1, round.figs.size)
        assertEquals("sw0001", round.figs[0].figNumber)
        assertEquals(3, round.figs[0].quantity)
    }

    @Test
    fun `StatsResponse ueberlebt die Runde`() {
        val raw = """{"success":true,"stats":{"total_sets":380,"total_pieces":243700}}"""
        val decoded = json.decodeFromString(StatsResponse.serializer(), raw)
        val round = json.decodeFromString(StatsResponse.serializer(),
            json.encodeToString(StatsResponse.serializer(), decoded))
        assertNotNull(round.stats)
    }

    @Test
    fun `unbekannte Felder brechen den Cache nicht`() {
        // Der Server darf seine Antwort erweitern, ohne dass ein alter
        // Cache-Eintrag unlesbar wird.
        val raw = """{"success":true,"sets":[{"set_number":"1-1","neues_feld":42}],"noch_eins":"x"}"""
        val decoded = json.decodeFromString(SetsResponse.serializer(), raw)
        assertEquals(1, decoded.sets.size)
    }
}

/**
 * Preisfelder der Finanz-Antwort.
 *
 * Der Marktpreis ist seit der serverseitigen Umstellung `avg_price`, nicht der
 * mengengewichtete Schnitt — der liegt systematisch darunter und war der Grund,
 * warum die App im Finanzen-Reiter und im Detail-Dialog einen zu niedrigen Wert
 * zeigte. Dazu liefert der Server jetzt den mengengewichteten Kaufpreis mit.
 */
class ValuationPriceFieldsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `total_avg und purchase_price werden gelesen`() {
        val raw = """{"set_number":"10290-1","quantity":2,
            "avg_price":148.72,"qty_avg_price":141.60,
            "total_avg":"297.44","total_qty_avg":"283.20","purchase_price":120.0}"""
        val s = json.decodeFromString(ch.brickinventoryapp.data.model.ValuationSet.serializer(), raw)
        assertEquals(148.72, s.avgPrice!!, 0.001)
        assertEquals("297.44", s.totalAvg)
        assertEquals(120.0, s.purchasePrice!!, 0.001)
    }

    @Test
    fun `fehlende Felder brechen nichts`() {
        // Ältere Server liefern total_avg und purchase_price nicht.
        val s = json.decodeFromString(ch.brickinventoryapp.data.model.ValuationSet.serializer(),
            """{"set_number":"1-1","qty_avg_price":10.0,"total_qty_avg":"10.00"}""")
        assertEquals(null, s.totalAvg)
        assertEquals(null, s.purchasePrice)
        assertEquals("10.00", s.totalQtyAvg)
    }
}

/**
 * Bildauflösung für Minifiguren.
 *
 * Der Server legt Minifiguren-Bilder seit der Erweiterung des img-dl-Laufs
 * lokal unter /images/ ab und liefert sie über express.static — deutlich
 * schneller als über das CDN. Die App nutzte aber ausschliesslich `image_url`
 * und kannte `image_local` gar nicht; sie hätte von der Änderung nichts gehabt.
 */
class MinifigImageFieldTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `image_local wird gelesen und hat Vorrang`() {
        val fig = json.decodeFromString(
            ch.brickinventoryapp.data.model.Minifig.serializer(),
            """{"fig_number":"fig-000140","image_url":"https://cdn.rebrickable.com/x.jpg",
                "image_local":"/images/sets/fig-000140.jpg"}"""
        )
        assertEquals("/images/sets/fig-000140.jpg", fig.imageLocal)

        // Auflösung wie im Screen: lokal gewinnt, sonst absolute CDN-Adresse
        val serverUrl = "https://lego.example.org"
        val resolved = when {
            fig.imageLocal != null -> "$serverUrl${fig.imageLocal}"
            fig.imageUrl != null && fig.imageUrl!!.startsWith("/") -> "$serverUrl${fig.imageUrl}"
            else -> fig.imageUrl
        }
        assertEquals("https://lego.example.org/images/sets/fig-000140.jpg", resolved)
    }

    @Test
    fun `ohne image_local bleibt die CDN-Adresse`() {
        // Solange der Hintergrundlauf das Bild noch nicht geholt hat.
        val fig = json.decodeFromString(
            ch.brickinventoryapp.data.model.Minifig.serializer(),
            """{"fig_number":"fig-1","image_url":"https://cdn.rebrickable.com/y.jpg"}"""
        )
        assertEquals(null, fig.imageLocal)
        assertEquals("https://cdn.rebrickable.com/y.jpg", fig.imageUrl)
    }

    @Test
    fun `auch die Finanz-Minifiguren kennen image_local`() {
        val item = json.decodeFromString(
            ch.brickinventoryapp.data.model.FigValuationItem.serializer(),
            """{"fig_number":"fig-2","image_local":"/images/sets/fig-2.jpg"}"""
        )
        assertEquals("/images/sets/fig-2.jpg", item.imageLocal)
    }
}

/**
 * Bild-Nebenläufigkeit des gemeinsamen Coil-Clients.
 *
 * Der OkHttpClient hinter dem ImageLoader ist eine einzige, app-weit geteilte
 * Instanz (siehe MainActivity). Eine für den Katalog gedachte Drosselung
 * (3 Verbindungen pro Host) traf dadurch auch die Galerie: Bei einer
 * Kachelwand mit mehr als drei gleichzeitigen Bildanfragen an denselben Host
 * standen die übrigen in einer Warteschlange, und ein Wegscrollen liess Coil
 * die wartende Anfrage abbrechen — die Kachel blieb dauerhaft leer.
 */
class ImageConcurrencyConfigTest {

    private fun read(rel: String): String {
        val f = java.io.File(rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `Bild-Nebenläufigkeit ist nicht zu eng für eine Kachelwand`() {
        val src = read("src/main/java/ch/brickinventoryapp/di/AppModule.kt")
        val perHost = Regex("""maxRequestsPerHost\s*=\s*(\d+)""").find(src)
        val total   = Regex("""maxRequests\s*=\s*(\d+)(?!PerHost)""").find(src)
        assertNotNull("maxRequestsPerHost nicht gefunden", perHost)
        assertNotNull("maxRequests nicht gefunden", total)

        val perHostVal = perHost!!.groupValues[1].toInt()
        val totalVal = total!!.groupValues[1].toInt()

        // Drei war zu eng — Regression, die zu leeren Galerie-Kacheln führte.
        assert(perHostVal >= 6) { "maxRequestsPerHost=$perHostVal ist zu eng für eine Kachelwand" }
        // Weiterhin klar unter den OkHttp-Standardwerten (5 Host / 64 gesamt
        // wären ohne diese Einstellung aktiv) — die Drosselung für den
        // Katalog auf langsamen Verbindungen bleibt bestehen, nur nicht mehr
        // eng genug, um die Galerie zu verhungern.
        assert(totalVal in perHostVal..32) { "maxRequests=$totalVal wirkt nicht mehr wie eine bewusste Drosselung" }
    }
}

/**
 * Wiederholversuch für Galerie-Kacheln nach einem Ladefehler.
 *
 * Beobachtet: Kacheln blieben leer, das Bild erschien aber sofort, sobald man
 * das betroffene Set öffnete — ein Hinweis auf einen einmaligen, transienten
 * Fehlschlag beim ersten Ladeversuch. Coil versucht eine fehlgeschlagene
 * Anfrage nicht von sich aus erneut.
 */
class GalleryImageRetryTest {

    private fun read(rel: String): String {
        val f = java.io.File(rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `SetCard versucht ein fehlgeschlagenes Bild genau einmal erneut`() {
        val src = read("src/main/java/ch/brickinventoryapp/ui/screens/GalleryScreen.kt")

        assert(src.contains("var retryNonce by remember(set.setNumber, imageUrl)")) {
            "Der Wiederholzähler fehlt oder ist nicht je Kachel/Bild gebunden"
        }
        assert(src.contains("AsyncImagePainter.State.Error && retryNonce == 0")) {
            "Der Wiederholversuch muss auf GENAU EINMAL begrenzt sein"
        }
        assert(src.contains(".setParameter(\"retry\", retryNonce)")) {
            "Die Anfrage braucht ein unterscheidbares Merkmal, sonst könnte Coil " +
            "sie mit dem fehlgeschlagenen Vorgänger verwechseln"
        }
        assert(src.contains("kotlinx.coroutines.delay(1000)")) {
            "Der Wiederholversuch sollte verzögert erfolgen, nicht sofort im selben Moment"
        }
    }
}

/**
 * Browser-ähnliche Kennung für Bildanfragen an fremde Hosts.
 *
 * Weder die breitere Warteschlange noch der Wiederholversuch hatten eine
 * Wirkung — das spricht gegen einen transienten Fehler und für eine
 * PERSISTENTE Ablehnung, die bei jedem Versuch neu greift. OkHttps
 * Standard-User-Agent identifiziert die Anfrage eindeutig als
 * Nicht-Browser-Client; Cloudflare vor Rebrickables CDN kann solche Anfragen
 * dauerhaft blockieren oder mit einer HTML-Challenge statt des Bildes
 * beantworten.
 */
class ImageRequestHeadersTest {

    private fun read(rel: String): String {
        val f = java.io.File(rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    @Test
    fun `Bildanfragen an fremde Hosts tragen eine Browser-Kennung`() {
        val src = read("src/main/java/ch/brickinventoryapp/di/AppModule.kt")
        val raw = src.substring(src.indexOf("fun provideImageOkHttpClient"))
        // Kommentare ausblenden: Der Erklärtext nennt "image/avif" selbst
        // (als Beispiel, was NICHT mehr gesendet werden soll) und würde die
        // Prüfung sonst verfälschen.
        // Nur ganze Kommentarzeilen ausblenden — ein naives Abschneiden ab
        // "//" träfe auch "https://" innerhalb der Kopfzeilen-Werte.
        val fn = raw.lines().joinToString("\n") { line ->
            if (line.trim().startsWith("//")) "" else line
        }

        assert(fn.contains("Chrome/120.0.0.0 Safari/537.36")) {
            "Der browserähnliche User-Agent fehlt"
        }
        assert(fn.contains("\"Referer\", \"https://rebrickable.com/\"")) {
            "Referer fehlt — ohne ihn bleibt die Anfrage als Nicht-Browser erkennbar"
        }
        // Regression: "image/avif" in Accept liess das CDN AVIF-Dateien
        // ausliefern. Nicht jedes Android-Gerät hat trotz ausreichendem
        // API-Level einen AV1-Decoder — Ergebnis war
        // "Failed to create image decoder with message 'unimplemented'"
        // statt eines angezeigten Bildes.
        assert(!fn.contains("image/avif")) {
            "image/avif darf nicht mehr im Accept-Header stehen — nicht jedes " +
            "Gerät kann es dekodieren, auch wenn die API-Stufe es erlaubt"
        }
        assert(fn.contains("\"Accept\", \"image/webp")) {
            "Ein Accept-Header muss weiterhin gesetzt sein, nur ohne avif"
        }
        assert(fn.contains("isOwnServer")) {
            "Die Unterscheidung eigener Server vs. externe CDN fehlt"
        }
        // Reihenfolge der Builder-Aufrufe ist für OkHttp unerheblich (Dispatcher
        // und Interceptor sind unabhängige Einstellungen) — nur PRÜFEN, dass
        // beide tatsächlich in derselben Funktion konfiguriert werden.
        assert(fn.contains("maxRequestsPerHost")) {
            "Die Nebenläufigkeits-Drosselung aus der vorigen Runde darf nicht verloren gegangen sein"
        }
    }
}
