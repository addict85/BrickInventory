package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.cache.WarmUp
import ch.brickinventoryapp.data.di.previewTap
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
 * Counter-checks (patches under counter-checks/):
 *   interceptor-without-fallback     in the catch throw again instead of from the store → red “without a server …”
 *   interceptor-passes-504  the 504 branch removed → red “a 504 …”
 *   interceptor-reads-body        body.bytes() instead of peekBody → red “a fetched preview …”
 *   interceptor-without-marker         speculative always false → red “a request of the warmer …”
 */
class PreviewTapTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-abgriff-${System.nanoTime()}")
    private val memory = PreviewMemory({ root }, StoreCipher { ByteArray(32) { 4 } }) { ByteArray(32) { 14 } }
    private val server = MockWebServer().apply { start() }
    private val client = OkHttpClient.Builder().addInterceptor(previewTap(memory)).build()
    private val image = "JPEG-75192".toByteArray()

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
        root.deleteRecursively()
    }

    private fun address(path: String) = server.url(path).toString()

    private fun fetch(url: String, tag: Boolean = false): Pair<Int, ByteArray> {
        val request = Request.Builder().url(url).apply { if (tag) tag(WarmUp::class.java, WarmUp) }.build()
        return client.newCall(request).execute().use { it.code to it.body.bytes() }
    }

    @Test
    fun `a fetched preview is stored, and the caller gets it whole`() {
        server.enqueue(MockResponse().setBody(Buffer().write(image)))
        server.enqueue(MockResponse().setBody("voll"))
        val preview = address("/images/set/75192-1?thumb=1")
        val full = address("/images/set/75192-1")

        val (code, body) = fetch(preview)
        fetch(full)

        assertEquals(200, code)
        assertArrayEquals("The caller no longer gets the body", image, body)
        assertArrayEquals(image, memory.read(preview))
        assertNull("The full resolution lands in the store", memory.read(full))
        assertNull("The tap sets a conditional request itself", server.takeRequest().getHeader("If-None-Match"))
    }

    @Test
    fun `without a server the preview comes from the store`() {
        val preview = address("/images/set/10179-1?thumb=1")
        memory.write(preview, image)
        server.shutdown()

        val (code, body) = fetch(preview)

        assertEquals(200, code)
        assertArrayEquals(image, body)
    }

    @Test
    fun `a 504 of the cache is replaced from the store`() {
        val preview = address("/images/set/10294-1?thumb=1")
        memory.write(preview, image)
        server.enqueue(MockResponse().setResponseCode(504))

        val (code, body) = fetch(preview)

        assertEquals(200, code)
        assertArrayEquals(image, body)
    }

    @Test
    fun `a request of the warmer is stored speculatively, a call as used`() {
        server.enqueue(MockResponse().setBody(Buffer().write(image)))
        server.enqueue(MockResponse().setBody(Buffer().write(image)))
        val preview = address("/images/set/42115-1?thumb=1")
        val oneTag = 24L * 3600 * 1000
        fun old() = System.currentTimeMillis() - root.walkTopDown().single { it.isFile }.lastModified()

        fetch(preview, tag = true)
        assertTrue("Prewarmed, but stored with a fresh timestamp", old() > oneTag)
        fetch(preview)
        assertFalse("Viewed, but still stored as prewarmed", old() > oneTag)
    }
}
