package ch.brickinventoryapp

import ch.brickinventoryapp.data.TokenSchranke
import ch.brickinventoryapp.data.TokenStand
import ch.brickinventoryapp.data.TokenTausch
import ch.brickinventoryapp.data.Tauschergebnis
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.di.ServerWaechter
import ch.brickinventoryapp.di.Zugangslage
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
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.di.PLATZHALTER_BASIS
import java.io.IOException
import okhttp3.mockwebserver.SocketPolicy

/**
 * Der Tausch des Tokens im echten Netzweg: Wächter, Konto-Repository und
 * TokenTausch über einen Client, gegen einen Testserver, der den alten Token
 * abweist oder den Tausch per Kopfzeile verlangt. Der Testserver spricht http
 * auf localhost; der Wächter läuft darum wie im Debug-Build (entwicklung = true).
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in ServerWaechter den Zweig für 401 `token_rotation_noetig` entfernt →
 *      rot „ein abgewiesener alter Token wird getauscht und die Anfrage wiederholt“
 *      (401 statt 200, Sitzung abgelaufen gemeldet)
 *   B  den Zweig für die Kopfzeile entfernt → rot „die Kopfzeile tauscht im
 *      Hintergrund, einmal“ (Zeitüberschreitung, kein Tausch)
 *   C  KontoApi.tokenRotieren wieder als `suspend` (über den Dispatcher) →
 *      rot „gleichzeitig abgewiesene Anfragen blockieren den Tausch nicht“
 *      (Zeitüberschreitung: beide Plätze warten auf den Tausch, der Tausch auf
 *      einen Platz)
 * Gegenproben (02.11.2026, gemessen mit kotlinc lokal):
 *   D  in TokenTausch die Prüfung `stand() != vorher` vor der Wiederholung
 *      entfernt → rot „ein Serverwechsel waehrend der Wiederholung …“ (SPAETER)
 *   E  im Wächter wieder die alte Regel (Kopf nur weg, wenn er der jetzige Token
 *      ist) → rot „ein selbst gesetzter alter Token geht nach dem Serverwechsel …“
 *   F  in KontoRepository.tokenRotieren() eine feste fremde Herkunft statt der
 *      Anfrage-URL → rot „ein abgewiesener alter Token wird getauscht …“,
 *      „gleichzeitig abgewiesene …“, „die Kopfzeile tauscht …“ (nichts gespeichert)
 */
class TokenRotationTest {

    private val server = MockWebServer()
    private val ereignisse: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-rot-${System.nanoTime()}")
    @Volatile private var gespeichert = "alt"
    @Volatile private var abgelaufen = 0
    /** Gesetzt: Der Tausch antwortet so (etwa 503), statt zu tauschen. */
    @Volatile private var rotationStumm: (() -> MockResponse)? = null

    /** Gesetzt nach einem Serverwechsel im Test; sonst der Testserver. */
    @Volatile private var umgezogen: String? = null
    private fun adresse() = umgezogen ?: server.url("/").toString().trimEnd('/')
    private val lage = object : Zugangslage {
        override fun serverUrl() = adresse()
        override fun token() = gespeichert
        override fun tokenHerkunft(): String? = null
        override fun generation() = schranke.generation
    }
    private val schranke = TokenSchranke()
    /** Echte Fäden: Der Tausch läuft hier gegen einen echten Testserver. */
    private val hintergrund = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Wie PreferencesManager.tokenStand(): ohne Bindung gilt die eingetragene Adresse. */
    private fun stand() = TokenStand(gespeichert, NetworkPolicy.herkunft(adresse()), schranke.generation)

    private fun tauschFuer(k: () -> KontoRepository, speichern: (String) -> Unit) = TokenTausch(
        stand = { stand() },
        ersetze = { vorher, neu, h -> schranke.ersetzeFalls(vorher, h, { stand() }) { speichern(neu) } },
        rotiere = { k().tokenRotieren(it) },
        pausen = listOf(50, 50, 50),
        hintergrund = hintergrund,
    )

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty().substringBefore('?')
                val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")
                ereignisse += "$pfad $bearer"
                return when {
                    pfad == "/api/v1/auth/token-rotieren" && rotationStumm != null -> rotationStumm!!.invoke()
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

    private val konto: KontoRepository
    private val tausch = tauschFuer({ konto }) { ereignisse += "speichere $it"; gespeichert = it }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen++ }, rotation = tausch))
        .readTimeout(2, TimeUnit.SECONDS).build()

    init {
        konto = KontoRepository(Retrofit.Builder().baseUrl(PLATZHALTER_BASIS).client(client)
            .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
            .build().create(KontoApi::class.java), ResponseCache { dir })
    }

    @After
    fun zu() {
        hintergrund.cancel()
        server.shutdown()
        dir.deleteRecursively()
    }

    private fun hole(pfad: String) = client.newCall(Request.Builder().url(server.url(pfad)).build()).execute().use { it.code }

    @Test
    fun `ein abgewiesener alter Token wird getauscht und die Anfrage wiederholt`() {
        assertEquals(200, hole("/api/v1/sets"))
        assertEquals(listOf("/api/v1/sets alt", "/api/v1/auth/token-rotieren alt", "speichere neu", "/api/v1/sets neu"),
            ereignisse.toList())
        assertEquals("Ein Tausch ist keine abgelaufene Sitzung", 0, abgelaufen)
    }

    /**
     * Abgewiesene Anfragen warten im Interceptor auf den Tausch und belegen dabei
     * ihre Plätze im Dispatcher. Braucht der Tausch selbst einen, wartet er ewig.
     */
    @Test
    fun `gleichzeitig abgewiesene Anfragen blockieren den Tausch nicht`() {
        val plaetze = okhttp3.Dispatcher().apply { maxRequestsPerHost = 2 }
        lateinit var k: KontoRepository
        val t = tauschFuer({ k }) { gespeichert = it }
        val c = OkHttpClient.Builder().dispatcher(plaetze)
            .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen++ }, rotation = t))
            .readTimeout(2, TimeUnit.SECONDS).build()
        k = KontoRepository(Retrofit.Builder().baseUrl(server.url("/")).client(c)
            .addConverterFactory(ApiJson.asConverterFactory("application/json".toMediaType()))
            .build().create(KontoApi::class.java), ResponseCache { dir })
        val codes: MutableList<Int> = Collections.synchronizedList(mutableListOf())
        repeat(2) {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: IOException) { codes += -1 }
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) { response.use { codes += it.code } }
            })
        }
        TestApi.warteBis("beide Antworten") { codes.size == 2 }
        assertEquals(listOf(200, 200), codes.toList())
        assertEquals(1, ereignisse.count { it.startsWith("/api/v1/auth/token-rotieren") })
    }

    @Test
    fun `die Kopfzeile tauscht im Hintergrund, einmal`() {
        assertEquals(200, hole("/api/v1/parts"))
        assertEquals(200, hole("/api/v1/parts"))
        TestApi.warteBis("Tausch") { gespeichert == "neu" }
        Thread.sleep(100)
        assertEquals(1, ereignisse.count { it.startsWith("/api/v1/auth/token-rotieren") })
        assertEquals("speichere neu", ereignisse.last { it.startsWith("speichere") })
    }

    /**
     * Die Antwort auf den Tausch geht verloren, und währenddessen wechselt die App den Server
     * (saveServerUrl: Token weg, neue Adresse). Der alte Token darf den neuen
     * Server nie erreichen — weder über eine Wiederholung noch im selbst gesetzten Kopf.
     */
    @Test
    fun `ein Serverwechsel waehrend der Wiederholung schickt den alten Token nicht zum neuen Server`() {
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
            rotationStumm = {
                kotlinx.coroutines.runBlocking {
                    schranke.schreibe { gespeichert = ""; umgezogen = neuer.url("/").toString().trimEnd('/') }
                }
                MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
            }
            val ergebnis = kotlinx.coroutines.runBlocking { tausch.tausche("alt") }
            assertEquals(Tauschergebnis.VERWORFEN, ergebnis)
            assertTrue(ereignisse.any { it.startsWith("/api/v1/auth/token-rotieren alt") })
            assertEquals("Der neue Server sah: $dort", 0, dort.size)
            assertEquals("", gespeichert)
        } finally {
            neuer.shutdown()
        }
    }

    /** Dasselbe ohne die Prüfung im Tausch: Dann hält der Wächter den Kopf zurück. */
    @Test
    fun `ein selbst gesetzter alter Token geht nach dem Serverwechsel ohne Kopf hinaus`() {
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
            umgezogen = neuer.url("/").toString().trimEnd('/')
            val r = kotlinx.coroutines.runBlocking { konto.tokenRotieren("alt") }
            assertTrue(r is Result.Error)
            assertEquals(listOf<String?>(null), dort.toList())
        } finally {
            neuer.shutdown()
        }
    }
}
