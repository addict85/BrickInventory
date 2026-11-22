package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.data.util.networkRecording
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import ch.brickinventoryapp.testing.Sources

/**
 * What the app writes to logcat: in release nothing, in the debug build neither token
 * nor bodies, and apart from the wrapper network/util/AppLog.kt nobody writes.
 *
 * Counter-checks:
 *   A  in Protokoll.warning() `if (active)` removed → red “in the release build
 *      the wrapper writes nothing”
 *   B  networkRecording() with Level.BODY → red “the network log names neither
 *      token nor body” (password and response body in the log)
 *   C  redactHeader("Authorization") removed → red “… even with a raised
 *      level” (bearer token in the log)
 *   D  in ComparisonScreen.kt `Log.d(…)` inserted again → red “apart from the
 *      wrapper no code writes to logcat”
 */
class LogTest {

    private val written = Collections.synchronizedList(mutableListOf<String>())
    private val before = AppLog.active to AppLog.target
    private val server = MockWebServer()

    init {
        AppLog.target = { level, tag, text, error -> written += "$level $tag $text ${error?.message.orEmpty()}" }
    }

    @After
    fun tearDown() {
        AppLog.active = before.first
        AppLog.target = before.second
        server.shutdown()
    }

    @Test
    fun `in the release build the wrapper writes nothing`() {
        AppLog.active = false
        AppLog.warning("Preisalarm", "Abruf fehlgeschlagen", RuntimeException("https://nas/api?token=geheim"))
        AppLog.note("OkHttp", "--> GET https://nas/api/v1/sets")
        assertTrue(written.toString(), written.isEmpty())

        AppLog.active = true
        AppLog.warning("Preisalarm", "Abruf fehlgeschlagen")
        AppLog.note("OkHttp", "--> GET")
        assertEquals(listOf("WARNING Preisalarm Abruf fehlgeschlagen ", "NOTE OkHttp --> GET "), written.toList())
    }

    private fun recording(level: HttpLoggingInterceptor.Level?): List<String> {
        val rows = Collections.synchronizedList(mutableListOf<String>())
        val reader = networkRecording { rows += it }
        level?.let { reader.level = it }
        server.enqueue(MockResponse().setHeader("Set-Cookie", "sid=geheim-antwort").setBody("geheim-rumpf"))
        val c = OkHttpClient.Builder().addInterceptor(reader).build()
        c.newCall(Request.Builder().url(server.url("/api/v1/auth/login"))
            .header("Authorization", "Bearer geheim-token").header("Cookie", "sid=geheim-sitzung")
            .post("""{"password":"geheim-pw"}""".toRequestBody("application/json".toMediaType())).build())
            .execute().use { it.body.string() }
        return rows.toList()
    }

    @Test
    fun `the network log names neither token nor body`() {
        val rows = recording(null)
        assertTrue(rows.toString(), rows.any { it.startsWith("--> POST") } && rows.any { it.startsWith("<-- 200") })
        assertTrue(rows.toString(), rows.none { "geheim" in it })
    }

    @Test
    fun `the network log redacts token and session even with a raised level`() {
        val rows = recording(HttpLoggingInterceptor.Level.HEADERS)
        assertTrue("Die Köpfe stehen da, nur geschwärzt: $rows", rows.any { it.startsWith("Authorization:") })
        assertTrue(rows.toString(), rows.none { "geheim" in it })
    }

    /** Structure: raw logcat, println and printStackTrace exist only in the wrapper. */
    @Test
    fun `apart from the wrapper no code writes to logcat`() {
        val raw = Regex("""\bandroid\.util\.Log\b|(?<![\w.])Log\.(v|d|i|w|e|wtf|println)\(|\bprintln\(|printStackTrace\(|System\.(out|err)\b""")
        val files = Sources.all()
        val hits = files.filter { it.name != "AppLog.kt" }.flatMap { f ->
            Sources.withoutComments(f.readText()).lines().mapIndexedNotNull { i, z ->
                if (raw.containsMatchIn(z)) "${f.name}:${i + 1}: ${z.trim()}" else null
            }
        }
        assertTrue("Die Hülle selbst wurde nicht gefunden", files.any { it.name == "AppLog.kt" })
        assertTrue("Ins Logcat nur über network/util/AppLog.kt:\n" + hits.joinToString("\n"), hits.isEmpty())
    }
}
