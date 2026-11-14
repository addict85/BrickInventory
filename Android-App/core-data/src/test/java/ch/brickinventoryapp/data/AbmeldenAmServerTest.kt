package ch.brickinventoryapp.data

import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.netz.di.ServerWaechter
import ch.brickinventoryapp.netz.di.Zugangslage
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.ResponseCache

/**
 * Abmelden entwertet den Token am Server (POST /auth/logout mit dem Token), und
 * zwar begrenzt: Ein schweigender oder fehlender Server hält das Abmelden nicht auf.
 *
 * Gegenproben:
 *   A  withTimeoutOrNull entfernt → rot „ein schweigender Server haelt das
 *      Abmelden nicht auf“ (erst die Lesegrenze des Clients nach 2 s)
 *   B  der catch-Zweig für Exception entfernt → rot „ein fehlender Server …“
 *      (ConnectException fliegt durch)
 */
class AbmeldenAmServerTest {

    private val server = MockWebServer().apply { start() }
    private val dir = File(System.getProperty("java.io.tmpdir"), "bim-ab-${System.nanoTime()}")
    private val lage = object : Zugangslage {
        override fun serverUrl() = server.url("/").toString().trimEnd('/')
        override fun token() = "geheim"
        override fun tokenHerkunft(): String? = NetworkPolicy.herkunft(serverUrl())
        override fun generation() = 0L
    }
    private val client = OkHttpClient.Builder()
        .addInterceptor(ServerWaechter(lage, true, entwicklung = true, sitzungAbgelaufen = {}))
        .readTimeout(2, TimeUnit.SECONDS).build()
    private val konto = KontoRepository(Retrofit.Builder().baseUrl(server.url("/")).client(client)
        .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
        .build().create(KontoApi::class.java), ResponseCache { dir })

    @After
    fun zu() {
        runCatching { server.shutdown() }
        dir.deleteRecursively()
    }

    @Test
    fun `Abmelden schickt den Token zum Entwerten an den Server`() {
        server.enqueue(MockResponse().setBody("""{"success":true}"""))
        assertTrue(runBlocking { konto.abmeldenAmServer() })
        val anfrage = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("POST", anfrage.method)
        assertEquals("/api/v1/auth/logout", anfrage.path)
        assertEquals("Bearer geheim", anfrage.getHeader("Authorization"))
    }

    @Test
    fun `ein schweigender Server haelt das Abmelden nicht auf`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val beginn = System.nanoTime()
        assertFalse(runBlocking { konto.abmeldenAmServer(grenzeMs = 300) })
        val dauer = (System.nanoTime() - beginn) / 1_000_000
        assertTrue("Abmelden dauerte $dauer ms", dauer < 1_500)
    }

    @Test
    fun `ein fehlender oder fehlerhafter Server haelt das Abmelden nicht auf`() {
        server.enqueue(MockResponse().setResponseCode(500))
        assertFalse(runBlocking { konto.abmeldenAmServer() })
        server.shutdown()
        assertFalse(runBlocking { konto.abmeldenAmServer() })
    }
}
