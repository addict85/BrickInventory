package ch.brickinventoryapp

import ch.brickinventoryapp.di.ServerWaechter
import ch.brickinventoryapp.di.Zugangslage
import ch.brickinventoryapp.util.BeweisSpeicher
import ch.brickinventoryapp.util.ServerBeweis
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.util.Collections
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Der Wächter aller Anfragen an den eigenen Server, ausgeführt gegen einen
 * Testserver im Klartext (localhost) — also mit Serverbeweis.
 *
 * Gegenproben (am 29.10.2026 gemessen, kotlinc gegen di/ServerWaechter.kt):
 *   A  in pruefeServer() wieder `if (code != 200 && grund == "token_ungueltig")
 *      sitzungAbgelaufen()` → rot „ein abgewiesener Serverbeweis meldet nicht ab …“
 *   B  `tokenGehoertHierher` immer true → rot „der Token geht nur an den Server,
 *      der ihn ausgab“ und „ein selbst gesetzter Kopf …“
 *   C  `unserServer` ohne isSameOrigin (nur serverUrl.isNotBlank()) → rot
 *      „ein fremder Host bekommt weder Token noch Sprache“
 *   D  das Nachfassen entfernt → rot „eine Anfrage ohne Token fasst mit dem neuen nach“
 *   E  die 401-Meldung ohne `tokenMitgeschickt` → rot „ein 401 ohne Token meldet
 *      nicht ab“ und „der Token geht nur an den Server, der ihn ausgab“
 *   F  den Pfad des Servers beim Umschreiben weggelassen → rot „der Platzhalter
 *      wird auf den Server samt Pfad umgeschrieben“
 *   G  eigeneKoepfe() nicht aufgerufen → rot „der eigene Server bekommt Sprache
 *      und Fassung“
 *   I  (30.10.2026) lage.klartextErlaubt() nicht an isCleartextAllowed()
 *      weitergereicht → rot „ohne Expertenschalter erreicht keine Klartext-Anfrage …“
 *   H  (30.10.2026) /settings/theme vom Token ausgenommen (`mitToken` falsch für
 *      Pfade auf "/settings/theme") → rot „das Design des Kontos wird mit Token geholt“
 */
class ServerWaechterTest {

    private val server = MockWebServer()
    private val anfragen = Collections.synchronizedList(mutableListOf<Pair<String, String?>>())
    /** Wie der Server auf den Beweis antwortet: "echt", "falsch" oder "abgewiesen". */
    @Volatile private var beweisArt = "echt"
    private val codes = Collections.synchronizedMap(mutableMapOf<String, Int>())
    private val abgelaufen = AtomicInteger()

    private inner class Lage(
        var url: String,
        var tokens: ArrayDeque<String> = ArrayDeque(listOf(TOKEN)),
        var herkunft: String? = null,
        var klartext: Boolean = true,
    ) : Zugangslage {
        override fun serverUrl() = url
        override fun token(): String = if (tokens.size > 1) tokens.removeFirst() else tokens.first()
        override fun tokenHerkunft() = herkunft
        override fun klartextHosts() = emptySet<String>()
        override fun klartextErlaubt() = klartext
        override fun netz() = "heim"
    }

    @Before
    fun auf() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty()
                anfragen += pfad to request.getHeader("Authorization")
                if (pfad.endsWith("/auth/serverbeweis")) {
                    val nonce = Regex("\"nonce\":\"([0-9a-f]+)\"").find(request.body.readUtf8())!!.groupValues[1]
                    return when (beweisArt) {
                        "echt" -> MockResponse().setBody("""{"success":true,"beweis":"${ServerBeweis.erwartet(TOKEN, nonce)}"}""")
                        "falsch" -> MockResponse().setBody("""{"success":true,"beweis":"${"0".repeat(64)}"}""")
                        else -> MockResponse().setResponseCode(401).setBody("""{"success":false,"code":"token_ungueltig"}""")
                    }
                }
                return MockResponse().setResponseCode(codes[pfad.substringBefore('?')] ?: 200).setBody("""{"success":true}""")
            }
        }
        server.start()
    }

    @After
    fun zu() = server.shutdown()

    private fun basis() = server.url("/").toString().trimEnd('/')

    private fun client(lage: Zugangslage, api: Boolean = true) = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, api, BeweisSpeicher(), sitzungAbgelaufen = { abgelaufen.incrementAndGet() },
            eigeneKoepfe = { _, ziel -> ziel.header("Accept-Language", "de") }))
        .readTimeout(2, TimeUnit.SECONDS).build()

    private fun hole(c: OkHttpClient, url: String): Int =
        c.newCall(Request.Builder().url(url).build()).execute().use { it.code }

    private fun anfragenAn(teil: String) = synchronized(anfragen) { anfragen.filter { teil in it.first } }

    @Test
    fun `ein abgewiesener Serverbeweis meldet nicht ab und sendet den Token nicht`() {
        beweisArt = "abgewiesen"
        try {
            hole(client(Lage(basis())), "http://localhost:3000/api/v1/sets")
            fail("Ohne Beweis darf die Anfrage nicht hinausgehen")
        } catch (_: IOException) { }
        assertEquals("Ein fremder Server darf keine Abmeldung erzwingen", 0, abgelaufen.get())
        assertTrue("Der Token ging trotzdem hinaus", anfragenAn("/api/v1/sets").isEmpty())
    }

    @Test
    fun `ein falscher Beweis meldet ebenfalls nicht ab`() {
        beweisArt = "falsch"
        runCatching { hole(client(Lage(basis())), "http://localhost:3000/api/v1/sets") }
        assertEquals(0, abgelaufen.get())
        assertTrue(anfragenAn("/api/v1/sets").isEmpty())
    }

    @Test
    fun `nach gueltigem Beweis meldet ein 401 die abgelaufene Sitzung`() {
        codes["/api/v1/sets"] = 401
        val c = client(Lage(basis()))
        assertEquals(401, hole(c, "http://localhost:3000/api/v1/sets"))
        assertEquals("Bearer $TOKEN", anfragenAn("/api/v1/sets").single().second)
        assertEquals(1, abgelaufen.get())
    }

    @Test
    fun `auch der Bild-Client haengt den Token an und meldet einen 401`() {
        codes["/images/sets/1.jpg"] = 401
        hole(client(Lage(basis()), api = false), basis() + "/images/sets/1.jpg")
        assertEquals("Bearer $TOKEN", anfragenAn("/images/").single().second)
        assertEquals(1, abgelaufen.get())
    }

    /** Ohne Token lieferte der Server die Vorgabe statt des Designs dieses Kontos. */
    @Test
    fun `das Design des Kontos wird mit Token geholt`() {
        hole(client(Lage(basis())), "http://localhost:3000/api/v1/settings/theme")
        assertEquals("Bearer $TOKEN", anfragenAn("/api/v1/settings/theme").single().second)
    }

    @Test
    fun `der Platzhalter wird auf den Server samt Pfad umgeschrieben`() {
        hole(client(Lage(basis() + "/brick")), "http://localhost:3000/api/v1/sets?seite=2")
        assertEquals("/brick/api/v1/sets?seite=2", anfragenAn("/api/v1/sets").single().first)
    }

    @Test
    fun `der Token geht nur an den Server, der ihn ausgab`() {
        codes["/api/v1/sets"] = 401
        val lage = Lage(basis(), herkunft = "http://anderer.example:3000")
        assertEquals(401, hole(client(lage), "http://localhost:3000/api/v1/sets"))
        assertNull("Der alte Token ging an den neuen Server", anfragenAn("/api/v1/sets").single().second)
        assertEquals("Ohne Token ist ein 401 kein Ablauf", 0, abgelaufen.get())
    }

    @Test
    fun `ein selbst gesetzter Kopf mit dem Token faellt bei fremder Herkunft weg`() {
        val lage = Lage(basis(), herkunft = "http://anderer.example:3000")
        client(lage).newCall(Request.Builder().url(basis() + "/api/v1/csv")
            .header("Authorization", "Bearer $TOKEN").build()).execute().close()
        assertNull(anfragenAn("/api/v1/csv").single().second)
    }

    @Test
    fun `der eigene Server bekommt Sprache und Fassung`() {
        // Ohne Token, damit kein Serverbeweis vorausgeht.
        hole(client(Lage(basis(), tokens = ArrayDeque(listOf(""))), api = false), basis() + "/api/v1/stats")
        val r = server.takeRequest()
        assertEquals("de", r.getHeader("Accept-Language"))
        assertEquals(ch.brickinventoryapp.util.APP_API_VERSION.toString(), r.getHeader("X-App-Api"))
    }

    @Test
    fun `ein fremder Host bekommt weder Token noch Sprache`() {
        // Derselbe Testserver unter seiner IP ist für den Wächter ein anderer Host.
        val fremd = server.url("/bild.jpg").newBuilder().host("127.0.0.1").build().toString()
        hole(client(Lage(server.url("/").newBuilder().host("localhost").build().toString()), api = false), fremd)
        val r = server.takeRequest()
        assertNull(r.getHeader("Authorization"))
        assertNull(r.getHeader("Accept-Language"))
        assertNull(r.getHeader("X-App-Api"))
    }

    @Test
    fun `eine Anfrage ohne Token fasst mit dem neuen nach`() {
        // Die erste Lesung liefert noch keinen Token, die zweite den frisch abgelegten.
        codes["/api/v1/sets"] = 401
        val lage = Lage(basis(), tokens = ArrayDeque(listOf("", TOKEN)))
        hole(client(lage), "http://localhost:3000/api/v1/sets")
        val an = anfragenAn("/api/v1/sets")
        assertEquals(listOf(null, "Bearer $TOKEN"), an.map { it.second })
        assertEquals("Nach dem Nachfassen ist der 401 echt", 1, abgelaufen.get())
    }

    @Test
    fun `ein 401 ohne Token meldet nicht ab`() {
        codes["/api/v1/auth/login"] = 401
        val lage = Lage(basis(), tokens = ArrayDeque(listOf("")))
        assertEquals(401, hole(client(lage), "http://localhost:3000/api/v1/auth/login"))
        assertEquals(0, abgelaufen.get())
    }

    @Test
    fun `Klartext zu einer oeffentlichen Adresse bricht vor dem Netz ab`() {
        try {
            hole(client(Lage("http://8.8.8.8:3000")), "http://localhost:3000/api/v1/sets")
            fail("Klartext ins Internet muss abbrechen")
        } catch (e: IOException) {
            assertTrue(e.message.orEmpty().contains("8.8.8.8"))
        }
    }

    @Test
    fun `ohne Expertenschalter erreicht keine Klartext-Anfrage den Server`() {
        try {
            hole(client(Lage(basis(), klartext = false)), "http://localhost:3000/api/v1/sets")
            fail("Ohne Expertenschalter darf nichts im Klartext hinaus")
        } catch (e: IOException) {
            assertTrue(e.message.orEmpty(), e.message.orEmpty().contains("Expertenschalter"))
        }
        assertEquals(0, server.requestCount)
    }

    private companion object { const val TOKEN = "geheim-0123" }
}
