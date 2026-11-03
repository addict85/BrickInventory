package ch.brickinventoryapp

import ch.brickinventoryapp.di.PLATZHALTER_BASIS
import ch.brickinventoryapp.di.ServerWaechter
import ch.brickinventoryapp.di.Zugangslage
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.eigeneAdresse
import ch.brickinventoryapp.util.pdfImBetrachter
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * Der Token gehört dem Server unter seinem Pfad, nicht dem ganzen Host (sec7, N2):
 * Hinter einem gemeinsamen Reverse-Proxy liegt unter `/andere-app` eine andere
 * Anwendung. Ein Testserver, die App unter `/brick`.
 *
 * Gegenproben (03.11.2026, kotlinc lokal gemessen):
 *   A  im Wächter `unserServer` ohne imBasisPfad() → rot „eine Anfrage ausserhalb
 *      des Pfads geht ohne Token“ (Bearer an /andere-app)
 *   B  in naechsteUmleitung() die Pfadprüfung entfernt → rot „eine Umleitung aus
 *      dem Pfad hinaus wird nicht verfolgt“ (302 verfolgt, Token an /andere-app/x)
 *   C  in imBasisPfad() `startsWith(basis)` statt `"$basis/"` → rot „ausserhalb …“
 *      (/brickfremd bekam den Token)
 *   D  eigeneAdresse() ohne imBasisPfad() → rot „eigeneAdresse bleibt unter dem Pfad“
 *   E  gleicherServer() nur über die Herkunft → rot „ein anderer Pfad ist ein anderer Server“
 */
class BasisPfadTest {

    private val server = MockWebServer().apply { start() }
    private val basis = server.url("/brick").toString().trimEnd('/')

    private val lage = object : Zugangslage {
        override fun serverUrl() = basis
        override fun token() = "geheim"
        override fun tokenHerkunft(): String? = NetworkPolicy.herkunft(basis)
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = {}))
        .followRedirects(false).followSslRedirects(false)
        .readTimeout(2, TimeUnit.SECONDS).build()

    @After
    fun zu() {
        server.shutdown()
    }

    private fun hole(url: String, mitKopf: Boolean = false): Int = client.newCall(Request.Builder().url(url)
        .apply { if (mitKopf) header("Authorization", "Bearer selbst-gesetzt") }.build()).execute().use { it.code }

    @Test
    fun `eine API-Anfrage geht unter den Pfad und mit Token`() {
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, hole(PLATZHALTER_BASIS + "api/v1/sets"))
        val a = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/sets", a.path)
        assertEquals("Bearer geheim", a.getHeader("Authorization"))
    }

    @Test
    fun `eine Anfrage ausserhalb des Pfads geht ohne Token`() {
        for (pfad in listOf("/andere-app/x", "/brickfremd/x", "/")) {
            server.enqueue(MockResponse().setBody("{}"))
            assertEquals(200, hole(server.url(pfad).toString(), mitKopf = true))
            val a = server.takeRequest(1, TimeUnit.SECONDS)!!
            assertNull("Token an $pfad", a.getHeader("Authorization"))
        }
        server.enqueue(MockResponse().setBody("{}"))
        hole(server.url("/brick/uploads/a.jpg").toString())
        assertEquals("Bearer geheim", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Authorization"))
    }

    @Test
    fun `eine Umleitung aus dem Pfad hinaus wird nicht verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/andere-app/x"))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(302, hole(PLATZHALTER_BASIS + "api/v1/h"))
        server.takeRequest()
        assertEquals("Nur eine Anfrage, keine an /andere-app", 1, server.requestCount)
    }

    @Test
    fun `eine Umleitung unter dem Pfad wird mit Token verfolgt`() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/brick/api/v1/h2"))
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals(200, hole(PLATZHALTER_BASIS + "api/v1/h"))
        server.takeRequest()
        val zweite = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/brick/api/v1/h2", zweite.path)
        assertEquals("Bearer geheim", zweite.getHeader("Authorization"))
    }

    @Test
    fun `eigeneAdresse bleibt unter dem Pfad`() {
        val s = "https://s.example/brick"
        assertEquals("https://s.example/brick/uploads/a.pdf", eigeneAdresse(s, "/uploads/a.pdf"))
        assertNull(eigeneAdresse(s, "//fremd.example/x"))
        assertNull(eigeneAdresse(s, "../andere-app/x"))
        assertNull(eigeneAdresse(s, "%2e%2e/andere-app/x"))
        assertTrue(pdfImBetrachter("https://s.example/brick/api/v1/vouchers/7/pdf", s))
        assertFalse(pdfImBetrachter("https://s.example/andere-app/a.pdf", s))
    }

    @Test
    fun `ein anderer Pfad ist ein anderer Server`() {
        assertTrue(NetworkPolicy.gleicherServer("https://s.example/brick", "https://S.example:443/brick/"))
        assertFalse(NetworkPolicy.gleicherServer("https://s.example/brick", "https://s.example/andere-app"))
        assertFalse(NetworkPolicy.gleicherServer("https://s.example/brick", "https://s.example"))
        assertTrue(NetworkPolicy.gleicherServer("https://s.example", "https://s.example/"))
    }
}
