package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.di.Netzablagen
import ch.brickinventoryapp.data.di.NetzModule
import ch.brickinventoryapp.data.di.buildInterceptorClient
import ch.brickinventoryapp.sicherheit.AblageChiffre
import ch.brickinventoryapp.sicherheit.Ablageschluessel
import ch.brickinventoryapp.sicherheit.TokenVerschluesselung
import ch.brickinventoryapp.sicherheit.ZertifikatsFrage
import ch.brickinventoryapp.netz.util.BildHostWaechter
import ch.brickinventoryapp.testing.testVertrauenschiffre
import coil3.request.ImageRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Die Clients zum eigenen Server, wie NetzModule sie baut, gegen einen Testserver: Keiner
 * folgt Umleitungen selbst (das tut der Wächter), der Bild-Client läuft über den
 * Host-Wächter, drosselt ohne eine Kachelwand auszuhungern und hat einen
 * Zwischenspeicher, aus dem er offline liefert; der API-Client hat keinen. Coil lädt
 * über genau diesen Bild-Client. Unter Robolectric mit echter Ablage.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   server-client-folgt-umleitung  followRedirects(false) in buildInterceptorClient entfernt → rot „kein Server-Client …“
 *   bild-client-ohne-waechter      BildHostWaechter nicht eingehängt → rot „der Bild-Client spricht …“
 *   bild-client-ohne-rueckfall     der FORCE_CACHE-Rückfall wirft weiter → rot „ist der Server …“
 *   coil-ohne-bild-client          Coil ohne den Fetcher des Bild-Clients → rot „Coil lädt …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ServerClientsTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val server = MockWebServer().apply { start() }

    /** Robolectric hat keinen AndroidKeyStore; umhüllt wird hier nur zum Schein. */
    private object Klartresor : TokenVerschluesselung {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    @After
    fun zu() {
        bereich.cancel()
        runCatching { server.shutdown() }
    }

    private val netz: Netzablagen by lazy {
        runBlocking {
            val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "clients-${System.nanoTime()}.preferences_pb") }
            val geraet = GeraeteAblage(ctx, store, testVertrauenschiffre())
            val token = TokenAblage(store, Klartresor, geraet, bereich).also { it.warteAufStart() }
            token.saveServerUrl(server.url("/").toString())
            Netzablagen(token, geraet)
        }
    }

    private fun apiClient() = buildInterceptorClient(netz, isApiClient = true, sessionExpired = SessionExpiredSignal(),
        ctx = ctx, frage = ZertifikatsFrage())

    private fun bildClient() = NetzModule.provideImageOkHttpClient(ctx, netz, SessionExpiredSignal(),
        VorschauSpeicher({ File(ctx.filesDir, "vorschau-clients") }, AblageChiffre { ByteArray(32) { 2 } }),
        ZertifikatsFrage(), Ablageschluessel(File(ctx.noBackupFilesDir, "clients.schluessel"), Klartresor))

    private fun hole(client: OkHttpClient, adresse: String) =
        client.newCall(Request.Builder().url(adresse).build()).execute().use { it.code to it.body.string() }

    @Test
    fun `kein Server-Client folgt einer Umleitung selbst`() {
        for ((name, c) in listOf("api" to apiClient(), "bild" to bildClient())) {
            assertFalse("$name: OkHttp folgte Umleitungen am Wächter vorbei", c.followRedirects)
            assertFalse("$name: OkHttp folgte einer Umleitung von https auf http", c.followSslRedirects)
        }
    }

    @Test
    fun `der Bild-Client spricht nur ueber den Host-Waechter und drosselt mit Mass`() {
        val bild = bildClient()
        assertTrue("Der Bild-Client lädt ohne Host-Wächter", bild.interceptors.any { it is BildHostWaechter })
        val jeHost = bild.dispatcher.maxRequestsPerHost
        assertTrue("maxRequestsPerHost=$jeHost ist zu eng für eine Kachelwand", jeHost >= 6)
        assertTrue("maxRequests=${bild.dispatcher.maxRequests} ist keine bewusste Drosselung",
            bild.dispatcher.maxRequests in jeHost..32)
        assertNotNull("Der Bild-Client hat keinen Zwischenspeicher", bild.cache)
        assertNull("Der API-Client hat einen Zwischenspeicher: Eine Änderung könnte aus ihm beantwortet werden",
            apiClient().cache)
    }

    @Test
    fun `ist der Server nicht erreichbar, kommt das Bild aus dem Zwischenspeicher`() {
        server.enqueue(MockResponse().setHeader("Cache-Control", "max-age=0").setBody("bild-10179"))
        val bild = bildClient()
        val adresse = server.url("/api/v1/images/set/10179-1").toString()
        assertEquals(200 to "bild-10179", hole(bild, adresse))
        server.shutdown()
        assertEquals("Offline bleibt die Kachel leer", 200 to "bild-10179", hole(bild, adresse))
    }

    @Test
    fun `Coil laedt ueber den Bild-Client und legt keinen eigenen Plattencache an`() {
        server.enqueue(MockResponse().setBody("kein Bild"))
        val loader = NetzModule.provideImageLoader(ctx, bildClient())
        assertNull("Coil hielte dieselben Bytes noch einmal, im Klartext", loader.diskCache)
        runBlocking { loader.execute(ImageRequest.Builder(ctx).data(server.url("/api/v1/images/set/1-1").toString()).build()) }
        val anfrage = server.takeRequest(5, TimeUnit.SECONDS)
        assertNotNull("Coil hat nichts angefragt", anfrage)
        assertNotNull("Die Anfrage lief nicht über den Wächter des Bild-Clients", anfrage!!.getHeader("X-App-Api"))
    }
}
