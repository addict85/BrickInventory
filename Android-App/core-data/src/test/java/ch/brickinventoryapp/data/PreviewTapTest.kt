package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.WarmUp
import ch.brickinventoryapp.data.di.vorschauAbgriff
import ch.brickinventoryapp.security.StoreCipher
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
 * The preview store's tap in the image client, against a test server: it stores
 * a fetched preview without taking the body from the caller, steps in when
 * the server is silent or the cache comes up empty with 504, and stores the
 * warmer's requests as speculative.
 *
 * Counter-checks (patches under gegenproben/):
 *   abgriff-ohne-rueckfall     in the catch throw again instead of from the store → red “without a server …”
 *   abgriff-504-durchgereicht  the 504 branch removed → red “a 504 …”
 *   abgriff-liest-rumpf        body.bytes() instead of peekBody → red “a fetched preview …”
 *   abgriff-ohne-marke         speculative always false → red “a request of the warmer …”
 */
class PreviewTapTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-abgriff-${System.nanoTime()}")
    private val speicher = VorschauSpeicher({ root }, StoreCipher { ByteArray(32) { 4 } }) { ByteArray(32) { 14 } }
    private val server = MockWebServer().apply { start() }
    private val client = OkHttpClient.Builder().addInterceptor(vorschauAbgriff(speicher)).build()
    private val bild = "JPEG-75192".toByteArray()

    @After
    fun zu() {
        runCatching { server.shutdown() }
        root.deleteRecursively()
    }

    private fun adresse(pfad: String) = server.url(pfad).toString()

    private fun fetch(url: String, tag: Boolean = false): Pair<Int, ByteArray> {
        val anfrage = Request.Builder().url(url).apply { if (tag) tag(WarmUp::class.java, WarmUp) }.build()
        return client.newCall(anfrage).execute().use { it.code to it.body.bytes() }
    }

    @Test
    fun `a fetched preview is stored, and the caller gets it whole`() {
        server.enqueue(MockResponse().setBody(Buffer().write(bild)))
        server.enqueue(MockResponse().setBody("voll"))
        val vorschau = adresse("/images/set/75192-1?thumb=1")
        val voll = adresse("/images/set/75192-1")

        val (code, rumpf) = fetch(vorschau)
        fetch(voll)

        assertEquals(200, code)
        assertArrayEquals("Der Aufrufer bekommt den Rumpf nicht mehr", bild, rumpf)
        assertArrayEquals(bild, speicher.lies(vorschau))
        assertNull("Die volle Auflösung landet in der Ablage", speicher.lies(voll))
        assertNull("Der Abgriff setzt selbst eine bedingte Anfrage", server.takeRequest().getHeader("If-None-Match"))
    }

    @Test
    fun `without a server the preview comes from the store`() {
        val vorschau = adresse("/images/set/10179-1?thumb=1")
        speicher.schreibe(vorschau, bild)
        server.shutdown()

        val (code, rumpf) = fetch(vorschau)

        assertEquals(200, code)
        assertArrayEquals(bild, rumpf)
    }

    @Test
    fun `a 504 of the cache is replaced from the store`() {
        val vorschau = adresse("/images/set/10294-1?thumb=1")
        speicher.schreibe(vorschau, bild)
        server.enqueue(MockResponse().setResponseCode(504))

        val (code, rumpf) = fetch(vorschau)

        assertEquals(200, code)
        assertArrayEquals(bild, rumpf)
    }

    @Test
    fun `a request of the warmer is stored speculatively, a call as used`() {
        server.enqueue(MockResponse().setBody(Buffer().write(bild)))
        server.enqueue(MockResponse().setBody(Buffer().write(bild)))
        val vorschau = adresse("/images/set/42115-1?thumb=1")
        val oneTag = 24L * 3600 * 1000
        fun alter() = System.currentTimeMillis() - root.walkTopDown().single { it.isFile }.lastModified()

        fetch(vorschau, tag = true)
        assertTrue("Vorgewärmt, aber mit frischem Zeitstempel abgelegt", alter() > oneTag)
        fetch(vorschau)
        assertFalse("Angesehen, aber weiter als vorgewärmt abgelegt", alter() > oneTag)
    }
}
