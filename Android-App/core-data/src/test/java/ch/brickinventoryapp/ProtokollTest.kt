package ch.brickinventoryapp

import ch.brickinventoryapp.util.Protokoll
import ch.brickinventoryapp.util.netzMitschnitt
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

/**
 * Was die App ins Logcat schreibt: im Release nichts, im Debug-Build weder Token
 * noch Rümpfe, und ausser der Hülle util/Protokoll.kt schreibt niemand.
 *
 * Gegenproben (01.11.2026, gemessen):
 *   A  in Protokoll.warnung() `if (aktiv)` entfernt → rot „im Release-Build
 *      schreibt die Hülle nichts“
 *   B  netzMitschnitt() mit Level.BODY → rot „der Netzmitschnitt nennt weder
 *      Token noch Rumpf“ (Passwort und Antwortrumpf im Mitschnitt)
 *   C  redactHeader("Authorization") entfernt → rot „… auch mit hochgedrehter
 *      Stufe“ (Bearer-Token im Mitschnitt)
 *   D  in ComparisonScreen.kt wieder `Log.d(…)` eingefügt → rot „ausser der
 *      Hülle schreibt kein Code ins Logcat“
 */
class ProtokollTest {

    private val geschrieben = Collections.synchronizedList(mutableListOf<String>())
    private val vorher = Protokoll.aktiv to Protokoll.ziel
    private val server = MockWebServer()

    init {
        Protokoll.ziel = { stufe, tag, text, fehler -> geschrieben += "$stufe $tag $text ${fehler?.message.orEmpty()}" }
    }

    @After
    fun zu() {
        Protokoll.aktiv = vorher.first
        Protokoll.ziel = vorher.second
        server.shutdown()
    }

    @Test
    fun `im Release-Build schreibt die Huelle nichts`() {
        Protokoll.aktiv = false
        Protokoll.warnung("Preisalarm", "Abruf fehlgeschlagen", RuntimeException("https://nas/api?token=geheim"))
        Protokoll.notiz("OkHttp", "--> GET https://nas/api/v1/sets")
        assertTrue(geschrieben.toString(), geschrieben.isEmpty())

        Protokoll.aktiv = true
        Protokoll.warnung("Preisalarm", "Abruf fehlgeschlagen")
        Protokoll.notiz("OkHttp", "--> GET")
        assertEquals(listOf("WARNUNG Preisalarm Abruf fehlgeschlagen ", "NOTIZ OkHttp --> GET "), geschrieben.toList())
    }

    private fun mitschnitt(stufe: HttpLoggingInterceptor.Level?): List<String> {
        val zeilen = Collections.synchronizedList(mutableListOf<String>())
        val leser = netzMitschnitt { zeilen += it }
        stufe?.let { leser.level = it }
        server.enqueue(MockResponse().setHeader("Set-Cookie", "sid=geheim-antwort").setBody("geheim-rumpf"))
        val c = OkHttpClient.Builder().addInterceptor(leser).build()
        c.newCall(Request.Builder().url(server.url("/api/v1/auth/login"))
            .header("Authorization", "Bearer geheim-token").header("Cookie", "sid=geheim-sitzung")
            .post("""{"password":"geheim-pw"}""".toRequestBody("application/json".toMediaType())).build())
            .execute().use { it.body.string() }
        return zeilen.toList()
    }

    @Test
    fun `der Netzmitschnitt nennt weder Token noch Rumpf`() {
        val zeilen = mitschnitt(null)
        assertTrue(zeilen.toString(), zeilen.any { it.startsWith("--> POST") } && zeilen.any { it.startsWith("<-- 200") })
        assertTrue(zeilen.toString(), zeilen.none { "geheim" in it })
    }

    @Test
    fun `der Netzmitschnitt schwaerzt Token und Sitzung auch mit hochgedrehter Stufe`() {
        val zeilen = mitschnitt(HttpLoggingInterceptor.Level.HEADERS)
        assertTrue("Die Köpfe stehen da, nur geschwärzt: $zeilen", zeilen.any { it.startsWith("Authorization:") })
        assertTrue(zeilen.toString(), zeilen.none { "geheim" in it })
    }

    /** Struktur: rohes Logcat, println und printStackTrace gibt es nur in der Hülle. */
    @Test
    fun `ausser der Huelle schreibt kein Code ins Logcat`() {
        val roh = Regex("""\bandroid\.util\.Log\b|(?<![\w.])Log\.(v|d|i|w|e|wtf|println)\(|\bprintln\(|printStackTrace\(|System\.(out|err)\b""")
        val dateien = Quellen.alle()
        val treffer = dateien.filter { it.name != "Protokoll.kt" }.flatMap { f ->
            Quellen.ohneKommentare(f.readText()).lines().mapIndexedNotNull { i, z ->
                if (roh.containsMatchIn(z)) "${f.name}:${i + 1}: ${z.trim()}" else null
            }
        }
        assertTrue("Die Hülle selbst wurde nicht gefunden", dateien.any { it.name == "Protokoll.kt" })
        assertTrue("Ins Logcat nur über util/Protokoll.kt:\n" + treffer.joinToString("\n"), treffer.isEmpty())
    }
}
