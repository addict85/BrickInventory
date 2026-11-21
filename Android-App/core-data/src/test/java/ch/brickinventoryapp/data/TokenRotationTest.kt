package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.network.di.ServerWaechter
import ch.brickinventoryapp.network.di.Zugangslage
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.io.File
import java.util.Collections
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.network.di.PLACEHOLDER_BASE
import java.io.IOException
import okhttp3.mockwebserver.SocketPolicy
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Der Tausch des Tokens im echten Netzweg: Wächter, Konto-Repository und
 * TokenSwap über einen Client, gegen einen Testserver, der den alten Token
 * abweist oder den Tausch per Kopfzeile verlangt. Der Testserver spricht http
 * auf localhost; der Wächter läuft darum wie im Debug-Build (entwicklung = true).
 *
 * Gegenproben:
 *   A  in ServerWaechter den Zweig für 401 `token_rotation_noetig` entfernt →
 *      rot „a rejected old token is swapped and the request retried“
 *      (401 statt 200, Sitzung abgelaufen gemeldet)
 *   B  den Zweig für die Kopfzeile entfernt → rot „die Kopfzeile tauscht im
 *      Hintergrund, einmal“ (Zeitüberschreitung, kein Tausch)
 *   C  AccountApi.rotateToken wieder als `suspend` (über den Dispatcher) →
 *      rot „simultaneously rejected requests do not block the swap“
 *      (Zeitüberschreitung: beide Plätze warten auf den Tausch, der Tausch auf
 *      einen Platz)
 * Gegenproben:
 *   D  in TokenSwap die Prüfung `stand() != vorher` vor der Wiederholung
 *      entfernt → rot „ein Serverwechsel waehrend der Wiederholung …“ (LATER)
 *   E  im Wächter wieder die alte Regel (Kopf nur weg, wenn er der jetzige Token
 *      ist) → rot „ein selbst gesetzter alter Token geht nach dem Serverwechsel …“
 *   F  in AccountRepository.rotateToken() eine feste fremde Herkunft statt der
 *      Anfrage-URL → rot „ein abgewiesener alter Token wird getauscht …“,
 *      „gleichzeitig abgewiesene …“, „die Kopfzeile tauscht …“ (nichts gespeichert)
 */
class TokenRotationTest {

    private val server = MockWebServer()
    private val events: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-rot-${System.nanoTime()}")
    @Volatile private var gespeichert = "alt"
    @Volatile private var abgelaufen = 0
    /** Gesetzt: Der Tausch antwortet so (etwa 503), statt zu tauschen. */
    @Volatile private var rotationMute: (() -> MockResponse)? = null

    /** Gesetzt nach einem Serverwechsel im Test; sonst der Testserver. */
    @Volatile private var moved: String? = null
    private fun adresse() = moved ?: server.url("/").toString().trimEnd('/')
    private val situation = object : Zugangslage {
        override fun serverUrl() = adresse()
        override fun token() = gespeichert
        override fun tokenOrigin(): String? = NetworkPolicy.herkunft(serverUrl())
        override fun generation() = limit.generation
    }
    private val limit = TokenLimit()
    /** Echte Fäden: Der Tausch läuft hier gegen einen echten Testserver. */
    private val hintergrund = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Wie PreferencesManager.tokenStatus(): ohne Bindung gilt die eingetragene Adresse. */
    private fun stand() = TokenStatus(gespeichert, NetworkPolicy.herkunft(adresse()), limit.generation)

    private fun swapFor(k: () -> AccountRepository, speichern: (String) -> Unit) = TokenSwap(
        stand = { stand() },
        ersetze = { vorher, neu, h -> limit.replaceIf(vorher, h, { stand() }) { speichern(neu) } },
        rotiere = { k().rotateToken(it) },
        pausen = listOf(50, 50, 50),
        hintergrund = hintergrund,
    )

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty().substringBefore('?')
                val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")
                events += "$pfad $bearer"
                return when {
                    pfad == "/api/v1/auth/token-rotieren" && rotationMute != null -> rotationMute!!.invoke()
                    pfad == "/api/v1/auth/token-rotieren" -> MockResponse().setBody(
                        """{"success":true,"token":"neu","token_info":{"scope":"app","never_expires":true,
                           "rotation_faellig":false},"alt_gueltig_bis":"2026-10-30T12:05:00Z","ueberlappung_sek":300}""")
                    pfad == "/api/v1/sets" && bearer == "alt" ->
                        MockResponse().setResponseCode(401).setBody("""{"success":false,"code":"token_rotation_noetig"}""")
                    pfad == "/api/v1/parts" && bearer == "alt" ->
                        MockResponse().setHeader("X-Token-Rotation", "faellig").setBody("""{"success":true}""")
                    else -> MockResponse().setBody("""{"success":true}""")
                }
            }
        }
        server.start()
    }

    private val konto: AccountRepository
    private val tausch = swapFor({ konto }) { events += "speichere $it"; gespeichert = it }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(situation, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen++ }, rotation = tausch))
        .readTimeout(2, TimeUnit.SECONDS).build()

    init {
        konto = testAccountRepository(Retrofit.Builder().baseUrl(PLACEHOLDER_BASE).client(client)
            .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
            .build().create(AccountApi::class.java))
    }

    @After
    fun zu() {
        hintergrund.cancel()
        server.shutdown()
        dir.deleteRecursively()
    }

    private fun fetch(pfad: String) = client.newCall(Request.Builder().url(server.url(pfad)).build()).execute().use { it.code }

    @Test
    fun `a rejected old token is swapped and the request retried`() {
        assertEquals(200, fetch("/api/v1/sets"))
        assertEquals(listOf("/api/v1/sets alt", "/api/v1/auth/token-rotieren alt", "speichere neu", "/api/v1/sets neu"),
            events.toList())
        assertEquals("Ein Tausch ist keine abgelaufene Sitzung", 0, abgelaufen)
    }

    /**
     * Abgewiesene Anfragen warten im Interceptor auf den Tausch und belegen dabei
     * ihre Plätze im Dispatcher. Braucht der Tausch selbst einen, wartet er ewig.
     */
    @Test
    fun `simultaneously rejected requests do not block the swap`() {
        val places = okhttp3.Dispatcher().apply { maxRequestsPerHost = 2 }
        lateinit var k: AccountRepository
        val t = swapFor({ k }) { gespeichert = it }
        val c = OkHttpClient.Builder().dispatcher(places)
            .addInterceptor(ServerWaechter(situation, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen++ }, rotation = t))
            .readTimeout(2, TimeUnit.SECONDS).build()
        k = testAccountRepository(Retrofit.Builder().baseUrl(server.url("/")).client(c)
            .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
            .build().create(AccountApi::class.java))
        val codes: MutableList<Int> = Collections.synchronizedList(mutableListOf())
        repeat(2) {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) { codes += -1 }
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) { response.use { codes += it.code } }
            })
        }
        TestApi.warteBis("beide Antworten") { codes.size == 2 }
        assertEquals(listOf(200, 200), codes.toList())
        assertEquals(1, events.count { it.startsWith("/api/v1/auth/token-rotieren") })
    }

    @Test
    fun `the header swaps in the background, once`() {
        assertEquals(200, fetch("/api/v1/parts"))
        assertEquals(200, fetch("/api/v1/parts"))
        TestApi.warteBis("Tausch") { gespeichert == "neu" }
        Thread.sleep(100)
        assertEquals(1, events.count { it.startsWith("/api/v1/auth/token-rotieren") })
        assertEquals("speichere neu", events.last { it.startsWith("speichere") })
    }

    /**
     * Die Antwort auf den Tausch geht verloren, und währenddessen wechselt die App den Server
     * (saveServerUrl: Token weg, neue Adresse). Der alte Token darf den neuen
     * Server nie erreichen — weder über eine Wiederholung noch im selbst gesetzten Kopf.
     */
    @Test
    fun `a server switch during the retry does not send the old token to the new server`() {
        val neuer = MockWebServer()
        val dort: MutableList<String?> = Collections.synchronizedList(mutableListOf())
        neuer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                dort += request.getHeader("Authorization")
                return MockResponse().setResponseCode(503)
            }
        }
        neuer.start()
        try {
            rotationMute = {
                kotlinx.coroutines.runBlocking {
                    limit.schreibe { gespeichert = ""; moved = neuer.url("/").toString().trimEnd('/') }
                }
                MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
            }
            val ergebnis = kotlinx.coroutines.runBlocking { tausch.tausche("alt") }
            assertEquals(Tauschergebnis.DISCARDED, ergebnis)
            assertTrue(events.any { it.startsWith("/api/v1/auth/token-rotieren alt") })
            assertEquals("Der neue Server sah: $dort", 0, dort.size)
            assertEquals("", gespeichert)
        } finally {
            neuer.shutdown()
        }
    }

    /** Dasselbe ohne die Prüfung im Tausch: Dann hält der Wächter den Kopf zurück. */
    @Test
    fun `a self-set old token goes out without header after the server switch`() {
        val neuer = MockWebServer()
        val dort: MutableList<String?> = Collections.synchronizedList(mutableListOf())
        neuer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                dort += request.getHeader("Authorization")
                return MockResponse().setResponseCode(401).setBody("""{"success":false,"code":"token_ungueltig"}""")
            }
        }
        neuer.start()
        try {
            gespeichert = ""
            moved = neuer.url("/").toString().trimEnd('/')
            val r = kotlinx.coroutines.runBlocking { konto.rotateToken("alt") }
            assertTrue(r is Ergebnis.Fehler)
            assertEquals(listOf<String?>(null), dort.toList())
        } finally {
            neuer.shutdown()
        }
    }
}
