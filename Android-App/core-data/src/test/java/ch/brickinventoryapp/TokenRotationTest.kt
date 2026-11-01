package ch.brickinventoryapp

import ch.brickinventoryapp.data.TokenTausch
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
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.Collections
import java.util.concurrent.TimeUnit

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
 */
class TokenRotationTest {

    private val server = MockWebServer()
    private val ereignisse: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-rot-${System.nanoTime()}")
    @Volatile private var gespeichert = "alt"
    @Volatile private var abgelaufen = 0

    private val lage = object : Zugangslage {
        override fun serverUrl() = server.url("/").toString().trimEnd('/')
        override fun token() = gespeichert
        override fun tokenHerkunft(): String? = null
    }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty().substringBefore('?')
                val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")
                ereignisse += "$pfad $bearer"
                return when {
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

    private lateinit var konto: KontoRepository
    private val tausch = TokenTausch(
        token = { gespeichert },
        speichere = { ereignisse += "speichere $it"; gespeichert = it },
        rotiere = { konto.tokenRotieren(it) },
    )
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen++ }, rotation = tausch))
        .readTimeout(2, TimeUnit.SECONDS).build()

    init {
        konto = KontoRepository(Retrofit.Builder().baseUrl(server.url("/")).client(client)
            .addConverterFactory(ch.brickinventoryapp.data.api.ApiJson.asConverterFactory("application/json".toMediaType()))
            .build().create(KontoApi::class.java), ResponseCache { dir })
    }

    @After
    fun zu() {
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
        val t = TokenTausch(token = { gespeichert }, speichere = { gespeichert = it }, rotiere = { k.tokenRotieren(it) })
        val c = OkHttpClient.Builder().dispatcher(plaetze)
            .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = { abgelaufen++ }, rotation = t))
            .readTimeout(2, TimeUnit.SECONDS).build()
        k = KontoRepository(Retrofit.Builder().baseUrl(server.url("/")).client(c)
            .addConverterFactory(ch.brickinventoryapp.data.api.ApiJson.asConverterFactory("application/json".toMediaType()))
            .build().create(KontoApi::class.java), ResponseCache { dir })
        val codes: MutableList<Int> = Collections.synchronizedList(mutableListOf())
        repeat(2) {
            c.newCall(Request.Builder().url(server.url("/api/v1/sets")).build()).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) { codes += -1 }
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
}
