package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.Vorwaermung
import ch.brickinventoryapp.data.di.vorschauAbgriff
import ch.brickinventoryapp.sicherheit.AblageChiffre
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Der Abgriff der Vorschau-Ablage im Bild-Client, gegen einen Testserver: Er legt
 * eine geholte Vorschau ab, ohne dem Aufrufer den Rumpf zu nehmen, springt ein, wenn
 * der Server schweigt oder der Zwischenspeicher mit 504 leer ausgeht, und legt die
 * Anfragen des Vorwärmers als spekulativ ab.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   abgriff-ohne-rueckfall     im catch wieder werfen statt aus der Ablage → rot „ohne Server …“
 *   abgriff-504-durchgereicht  der 504-Zweig entfernt → rot „ein 504 …“
 *   abgriff-liest-rumpf        body.bytes() statt peekBody → rot „eine geholte Vorschau …“
 *   abgriff-ohne-marke         spekulativ immer false → rot „eine Anfrage des Vorwärmers …“
 */
class VorschauAbgriffTest {

    private val wurzel = File(System.getProperty("java.io.tmpdir"), "bim-abgriff-${System.nanoTime()}")
    private val speicher = VorschauSpeicher({ wurzel }, AblageChiffre { ByteArray(32) { 4 } })
    private val server = MockWebServer().apply { start() }
    private val client = OkHttpClient.Builder().addInterceptor(vorschauAbgriff(speicher)).build()
    private val bild = "JPEG-75192".toByteArray()

    @After
    fun zu() {
        runCatching { server.shutdown() }
        wurzel.deleteRecursively()
    }

    private fun adresse(pfad: String) = server.url(pfad).toString()

    private fun hole(url: String, tag: Boolean = false): Pair<Int, ByteArray> {
        val anfrage = Request.Builder().url(url).apply { if (tag) tag(Vorwaermung::class.java, Vorwaermung) }.build()
        return client.newCall(anfrage).execute().use { it.code to it.body.bytes() }
    }

    @Test
    fun `eine geholte Vorschau wird abgelegt, und der Aufrufer bekommt sie ganz`() {
        server.enqueue(MockResponse().setBody(Buffer().write(bild)))
        server.enqueue(MockResponse().setBody("voll"))
        val vorschau = adresse("/images/set/75192-1?thumb=1")
        val voll = adresse("/images/set/75192-1")

        val (code, rumpf) = hole(vorschau)
        hole(voll)

        assertEquals(200, code)
        assertArrayEquals("Der Aufrufer bekommt den Rumpf nicht mehr", bild, rumpf)
        assertArrayEquals(bild, speicher.lies(vorschau))
        assertNull("Die volle Auflösung landet in der Ablage", speicher.lies(voll))
        assertNull("Der Abgriff setzt selbst eine bedingte Anfrage", server.takeRequest().getHeader("If-None-Match"))
    }

    @Test
    fun `ohne Server kommt die Vorschau aus der Ablage`() {
        val vorschau = adresse("/images/set/10179-1?thumb=1")
        speicher.schreibe(vorschau, bild)
        server.shutdown()

        val (code, rumpf) = hole(vorschau)

        assertEquals(200, code)
        assertArrayEquals(bild, rumpf)
    }

    @Test
    fun `ein 504 des Zwischenspeichers wird aus der Ablage ersetzt`() {
        val vorschau = adresse("/images/set/10294-1?thumb=1")
        speicher.schreibe(vorschau, bild)
        server.enqueue(MockResponse().setResponseCode(504))

        val (code, rumpf) = hole(vorschau)

        assertEquals(200, code)
        assertArrayEquals(bild, rumpf)
    }

    @Test
    fun `eine Anfrage des Vorwaermers wird spekulativ abgelegt, ein Aufruf gebraucht`() {
        server.enqueue(MockResponse().setBody(Buffer().write(bild)))
        server.enqueue(MockResponse().setBody(Buffer().write(bild)))
        val vorschau = adresse("/images/set/42115-1?thumb=1")
        val einTag = 24L * 3600 * 1000
        fun alter() = System.currentTimeMillis() - wurzel.walkTopDown().single { it.isFile }.lastModified()

        hole(vorschau, tag = true)
        assertTrue("Vorgewärmt, aber mit frischem Zeitstempel abgelegt", alter() > einTag)
        hole(vorschau)
        assertFalse("Angesehen, aber weiter als vorgewärmt abgelegt", alter() > einTag)
    }
}
