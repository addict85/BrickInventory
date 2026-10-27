package ch.brickinventoryapp

import android.net.Uri
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.ui.viewmodel.Texte
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Das Gutschein-ViewModel, ausgeführt gegen einen Testserver.
 *
 * Möglich, seit es aus MainViewModel herausgelöst ist und Texte über eine
 * Schnittstelle bekommt statt über den Context.
 *
 * Gegenproben:
 *  - In speichere() die 422-Übernahme entfernt (nur Meldung): „aus dem PDF
 *    Gelesenes landet im Formular" rot — Nummer leer.
 *  - Die PDF-Prüfung `typ != "application/pdf"` entfernt: „eine Nicht-PDF-Datei
 *    geht nicht zum Server" rot — ein Abruf statt keinem.
 *  - Im finally von frageAlleGuthabenAb() wieder `lade()` statt
 *    `ladeGutscheine()`: „abgebrochener Lauf räumt auf und lädt neu" rot — die
 *    abgebrochene Coroutine lädt nicht mehr (zwei Abrufe statt drei).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GutscheinViewModelTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var kanal: MeldungsKanal
    private lateinit var vm: GutscheinViewModel

    /** Gibt die Ressourcennummer zurück — der Test prüft, WELCHER Text kam. */
    private val texte = object : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id"
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id"
        override fun meldungFuerSnackbar(fehler: Result.Error) = "fehler"
    }

    private fun antwort(rumpf: String, code: Int = 200) =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(rumpf)

    private val zweiKarten = """{"success":true,"vouchers":[
        {"id":1,"number":"6000111122223333","pin":"1234","amount":50,"currency":"CHF"},
        {"id":2,"number":"6000444455556666","pin":"5678","amount":25.5,"currency":"EUR"}]}"""

    /** Wartet auf echte Netzantworten; viewModelScope läuft auf dem Test-Main. */
    private fun warteBis(was: String, bedingung: () -> Boolean) {
        val ende = System.currentTimeMillis() + 5000
        while (!bedingung()) {
            check(System.currentTimeMillis() < ende) { "Zeitüberschreitung: $was" }
            Thread.sleep(10)
        }
    }

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-gut-${System.nanoTime()}")
        cacheDir.mkdirs()
        val client = OkHttpClient.Builder()
            .readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build()
        val json = Json {
            ignoreUnknownKeys = true; isLenient = true
            encodeDefaults = true; coerceInputValues = true
        }
        val api = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
        kanal = MeldungsKanal()
        vm = GutscheinViewModel(
            repo = GutscheineRepository(api, ResponseCache { cacheDir }),
            texte = texte,
            leser = object : DateiLeser { override suspend fun lies(uri: Uri): Pair<String?, ByteArray>? = null },
            meldungen = kanal,
        )
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `die Liste wird geladen und ein Gutschein ins Formular geholt`() {
        server.enqueue(antwort(zweiKarten))
        vm.ladeGutscheine()
        warteBis("Liste") { vm.state.value.gutscheine.size == 2 && !vm.state.value.laedt }

        vm.bearbeiteGutschein(1)
        val s = vm.state.value
        assertEquals(1, s.bearbeitet)
        assertEquals("6000111122223333", s.nummer)
        // Ganze Beträge ohne „.0" — was im Feld steht, tippt der Nutzer weiter.
        assertEquals("50", s.betrag)
        vm.bearbeiteGutschein(2)
        assertEquals("25.5", vm.state.value.betrag)
        assertEquals("EUR", vm.state.value.waehrung)
    }

    @Test
    fun `aus dem PDF Gelesenes landet im Formular`() {
        server.enqueue(antwort("""{"success":false,"error":"Betrag fehlt",
            "gelesen":{"number":"6000999988887777","pin":"4321","currency":"EUR"}}""", 422))
        vm.speichere { "application/pdf" to byteArrayOf(37, 80, 68, 70) }
        warteBis("Formular") { !vm.state.value.speichert && server.requestCount == 1 && kanal.fluss.value != null }

        val s = vm.state.value
        assertEquals("6000999988887777", s.nummer)
        assertEquals("4321", s.pin)
        assertEquals("EUR", s.waehrung)
        assertEquals("", s.betrag)
        assertEquals("t${R.string.vouchers_pdf_incomplete}", kanal.fluss.value)
        assertTrue(server.takeRequest().path!!.endsWith("/api/v1/vouchers/pdf"))
    }

    @Test
    fun `eine Nicht-PDF-Datei geht nicht zum Server`() {
        vm.speichere { "image/png" to byteArrayOf(1, 2, 3) }
        warteBis("Meldung") { kanal.fluss.value != null && !vm.state.value.speichert }
        assertEquals("t${R.string.vouchers_only_pdf}", kanal.fluss.value)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `abgebrochener Lauf raeumt auf und laedt neu`() {
        server.enqueue(antwort(zweiKarten))
        vm.ladeGutscheine()
        warteBis("Liste") { vm.state.value.gutscheine.size == 2 }

        // Die Schranke meldet „abstand": Das ViewModel wartet sichtbar.
        server.enqueue(antwort("""{"success":false,"grund":"abstand","wartenSek":30}""", 429))
        server.enqueue(antwort(zweiKarten))
        vm.frageAlleGuthabenAb()
        warteBis("Wartezeit") { (vm.state.value.guthabenLauf?.wartenSek ?: 0) > 0 }
        assertEquals(2, vm.state.value.guthabenLauf?.gesamt)

        vm.guthabenLaufAbbrechen()
        warteBis("neu geladen") { server.requestCount == 3 }
        assertNull(vm.state.value.guthabenLauf)
        assertNull(vm.state.value.guthabenLaeuft)
        assertEquals("t${R.string.vouchers_balance_alle_fertig}", kanal.fluss.value)
    }
}
