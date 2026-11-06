package ch.brickinventoryapp

import ch.brickinventoryapp.data.TokenSchranke
import ch.brickinventoryapp.data.TokenStand
import ch.brickinventoryapp.data.TokenTausch
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.di.ServerWaechter
import ch.brickinventoryapp.di.Zugangslage
import ch.brickinventoryapp.util.NetworkPolicy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import ch.brickinventoryapp.di.Rotationsanlass

/**
 * Ein Serverwechsel, während eine Anfrage beim alten Server hängt: Der alte (A)
 *
 * Gegenproben:
 *   A  in ServerWaechter.tokenFuer() die Bindung weggelassen (`passt` nur
 *      `token.isNotBlank()`) → rot „eine Anfrage ohne Token fasst nach dem
 *      Wechsel nicht mit dem Token des neuen Servers nach“ (A erhielt Bearer B)
 *   B  TokenTausch.noetig() wieder ohne Herkunft und Generation UND im Wächter
 *      `.takeIf { dieselbeSitzung() }` entfernt → rot „ein Tausch nach dem
 *      Wechsel schickt den Token des neuen Servers nicht an den alten“
 *   C  im Wächter `dieselbeSitzung()` aus der Meldung von 401/403 entfernt →
 *      rot „ein 401 oder 403 des alten Servers beendet die neue Sitzung nicht“
 *   D  in tokenFuer() die Generation nicht neu gelesen (immer die vom Senden) →
 *      rot „nach der Anmeldung beim selben Server fasst eine Anfrage ohne Token
 *      weiterhin nach“ (die Meldung des echten 401 bliebe aus)
 */
class ServerwechselTest {

    private val a = MockWebServer()
    private val b = MockWebServer()
    private val anA = Collections.synchronizedList(mutableListOf<String?>())
    private val freigabe = CountDownLatch(1)
    private val angekommen = CountDownLatch(1)
    private val abgelaufen = AtomicInteger()
    private val entzogen = AtomicInteger()

    /** Wie A auf die zurückgehaltene Anfrage antwortet. */
    @Volatile private var spaeteAntwort: () -> MockResponse = { MockResponse().setResponseCode(401).setBody("{}") }

    private val schranke = TokenSchranke()
    @Volatile private var url = ""
    @Volatile private var token = ""
    @Volatile private var herkunft: String? = null

    private val lage = object : Zugangslage {
        override fun serverUrl() = url
        override fun token() = token
        override fun tokenHerkunft() = herkunft
        override fun generation() = schranke.generation
    }

    private fun adresse(s: MockWebServer) = s.url("/").toString().trimEnd('/')

    init {
        a.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                anA += request.getHeader("Authorization")
                // Nur die erste Anfrage wird zurückgehalten; alles danach antwortet sofort.
                if (anA.size == 1) {
                    angekommen.countDown()
                    freigabe.await(10, TimeUnit.SECONDS)
                    return spaeteAntwort()
                }
                return MockResponse().setResponseCode(401).setBody("{}")
            }
        }
        b.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setBody("""{"success":true}""")
        }
        a.start(); b.start()
        url = adresse(a)
    }

    @After
    fun zu() {
        a.shutdown(); b.shutdown()
    }

    /** Wie saveServerUrl() mit anderer Herkunft und danach saveAuthToken(). */
    private fun wechsleUndMeldeAn(ziel: MockWebServer, neuerToken: String) = runBlocking {
        schranke.schreibe { url = adresse(ziel); token = ""; herkunft = null }
        schranke.schreibe { herkunft = NetworkPolicy.herkunft(adresse(ziel)); token = neuerToken }
    }

    private fun client(rotation: Rotationsanlass? = null) = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen.incrementAndGet() },
            rotation = rotation, rechteEntzogen = { entzogen.incrementAndGet() }))
        .readTimeout(10, TimeUnit.SECONDS).build()

    /** Schickt [anfrage] an A, wechselt währenddessen und gibt den Status zurück. */
    private fun waehrendDesWechsels(c: OkHttpClient, anfrage: Request, wechsel: () -> Unit): Int {
        val pool = Executors.newSingleThreadExecutor()
        try {
            val f = pool.submit<Int> { c.newCall(anfrage).execute().use { it.code } }
            assertTrue("A hat die Anfrage nicht erhalten", angekommen.await(5, TimeUnit.SECONDS))
            wechsel()
            freigabe.countDown()
            return f.get(10, TimeUnit.SECONDS)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `eine Anfrage ohne Token fasst nach dem Wechsel nicht mit dem Token des neuen Servers nach`() {
        val status = waehrendDesWechsels(client(), Request.Builder().url(a.url("/api/v1/settings/theme")).build()) {
            wechsleUndMeldeAn(b, "TOKEN-VON-B")
        }
        assertEquals(401, status)
        assertFalse("A erhielt den Token von B: $anA", anA.any { it?.contains("TOKEN-VON-B") == true })
        assertEquals("Ein 401 ohne Token meldet nicht ab", 0, abgelaufen.get())
    }

    @Test
    fun `ein Tausch nach dem Wechsel schickt den Token des neuen Servers nicht an den alten`() {
        token = "TOKEN-VON-A"; herkunft = NetworkPolicy.herkunft(adresse(a))
        spaeteAntwort = { MockResponse().setResponseCode(401).setBody("""{"code":"token_rotation_noetig"}""") }
        val tausch = TokenTausch(
            stand = { TokenStand(token, herkunft, schranke.generation) },
            ersetze = { _, _, _ -> false },
            rotiere = { Ergebnis.Error("", httpCode = 500) },
            pausen = emptyList(),
            // Der Test wartet auf noetig(); faellig() bräuchte einen eigenen Bereich nicht.
            hintergrund = CoroutineScope(Job()),
        )
        val status = waehrendDesWechsels(client(tausch), Request.Builder().url(a.url("/api/v1/sets"))
            .post("geheim".toRequestBody()).build()) {
            wechsleUndMeldeAn(b, "TOKEN-VON-B")
        }
        assertEquals(401, status)
        assertEquals("A erhielt: $anA", listOf("Bearer TOKEN-VON-A"), anA.toList())
    }

    @Test
    fun `ein 401 oder 403 des alten Servers beendet die neue Sitzung nicht`() {
        token = "TOKEN-VON-A"; herkunft = NetworkPolicy.herkunft(adresse(a))
        spaeteAntwort = { MockResponse().setResponseCode(401).setBody("""{"code":"token_ungueltig"}""") }
        waehrendDesWechsels(client(), Request.Builder().url(a.url("/api/v1/sets")).build()) {
            wechsleUndMeldeAn(b, "TOKEN-VON-B")
        }
        assertEquals("A hat die Sitzung bei B beendet", 0, abgelaufen.get())

        // Gegenstück ohne Wechsel: Derselbe 401 meldet ab, ein 403 nur_admins zieht Rechte nach.
        token = "TOKEN-VON-B"
        b.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = if (request.path.orEmpty().startsWith("/api/v1/admin"))
                MockResponse().setResponseCode(403).setBody("""{"code":"nur_admins"}""")
            else MockResponse().setResponseCode(401).setBody("""{"code":"token_ungueltig"}""")
        }
        client().newCall(Request.Builder().url(b.url("/api/v1/sets")).build()).execute().close()
        client().newCall(Request.Builder().url(b.url("/api/v1/admin/x")).build()).execute().close()
        assertEquals(1, abgelaufen.get())
        assertEquals(1, entzogen.get())
    }

    @Test
    fun `ein 403 nur_admins des alten Servers nimmt der neuen Sitzung keine Rechte`() {
        token = "TOKEN-VON-A"; herkunft = NetworkPolicy.herkunft(adresse(a))
        spaeteAntwort = { MockResponse().setResponseCode(403).setBody("""{"code":"nur_admins"}""") }
        waehrendDesWechsels(client(), Request.Builder().url(a.url("/api/v1/admin/x")).build()) {
            wechsleUndMeldeAn(b, "TOKEN-VON-B")
        }
        assertEquals(0, entzogen.get())
    }

    @Test
    fun `nach der Anmeldung beim selben Server fasst eine Anfrage ohne Token weiterhin nach`() {
        // Der Wettlauf, für den es das Nachfassen gibt: dieselbe Herkunft, neue Generation.
        val status = waehrendDesWechsels(client(), Request.Builder().url(a.url("/api/v1/settings/theme")).build()) {
            runBlocking { schranke.schreibe { herkunft = NetworkPolicy.herkunft(adresse(a)); token = "TOKEN-VON-A" } }
        }
        assertEquals(listOf(null, "Bearer TOKEN-VON-A"), anA.toList())
        assertEquals(401, status)
        assertEquals("Mit Token abgewiesen ist der 401 echt", 1, abgelaufen.get())
    }
}
