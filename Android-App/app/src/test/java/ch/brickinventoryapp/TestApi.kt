package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.viewmodel.Texte
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Bestandssignal
import ch.brickinventoryapp.ui.Blickfeld
import ch.brickinventoryapp.ui.FilterAblage
import ch.brickinventoryapp.ui.ScrollMemory
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.viewmodel.AppDienste
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import retrofit2.Retrofit
import java.io.File
import java.util.Collections
import java.util.concurrent.TimeUnit

/** Gemeinsames Gerüst der ViewModel-Tests, die gegen einen Testserver laufen. */
object TestApi {

    /** Dieselbe Json-Konfiguration wie in di/AppModule. */
    fun fuer(server: MockWebServer): BrickApiService {
        val client = OkHttpClient.Builder()
            .readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build()
        val json = ch.brickinventoryapp.data.api.ApiJson
        return Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
    }

    fun antwort(rumpf: String, code: Int = 200): MockResponse =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(rumpf)

    /** Wartet auf echte Netzantworten; viewModelScope läuft auf dem Test-Main. */
    fun warteBis(was: String, bedingung: () -> Boolean) {
        val ende = System.currentTimeMillis() + 5000
        while (!bedingung()) {
            check(System.currentTimeMillis() < ende) { "Zeitüberschreitung: $was" }
            Thread.sleep(10)
        }
    }
}

/** Gibt die Ressourcennummer zurück — der Test prüft, WELCHER Text kam. */
object NummernTexte : Texte {
    override fun text(id: Int, vararg args: Any?) = "t$id"
    override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
    override fun meldung(fehler: Result.Error) = "fehler"
    override fun angemeldet() = true
}

/**
 * Ein Testserver, der nach PFAD antwortet statt nach Reihenfolge — ViewModels
 * stellen mehrere Abrufe nebeneinander. Unbekannte Pfade bekommen 404; jede
 * Anfrage wird mitgeschrieben (Methode, Pfad samt Abfrage).
 */
class PfadServer(vararg regeln: Pair<String, String>) {
    val server = MockWebServer()
    val antworten: MutableMap<String, String> = Collections.synchronizedMap(linkedMapOf(*regeln))
    val anfragen: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** Die Rümpfe in derselben Reihenfolge wie [anfragen]. */
    val koerper: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** Abweichender Statuscode je Pfad, z. B. 401 für „Sitzung abgelaufen“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty()
                anfragen += "${request.method} $pfad"
                koerper += request.body.readUtf8()
                val ohneAbfrage = pfad.substringBefore('?')
                val rumpf = antworten[ohneAbfrage]
                return if (rumpf == null) TestApi.antwort("""{"success":false}""", codes[ohneAbfrage] ?: 404)
                       else TestApi.antwort(rumpf, codes[ohneAbfrage] ?: 200)
            }
        }
        server.start()
    }

    fun anfragenAn(pfad: String): List<String> = synchronized(anfragen) { anfragen.filter { pfad in it } }
}

/** Filterablage im Speicher. */
class SpeicherAblage : FilterAblage {
    val konten = mutableMapOf<String, String>()
    val lager = mutableMapOf<String, String>()
    override suspend fun konto(view: ScopeFilter.View) = konten[view.key] ?: ScopeFilter.ALL
    override suspend fun lager(view: ScopeFilter.View) = lager[view.key] ?: ""
    override suspend fun setzeKonto(view: ScopeFilter.View, wert: String) { konten[view.key] = wert }
    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) { lager[view.key] = wert }
    override suspend fun allesVergessen() { konten.clear(); lager.clear() }
}

/** Die gemeinsamen Dienste der Bereichs-ViewModels, gegen einen Testserver. */
class TestDienste(server: MockWebServer, texte: Texte = NummernTexte) {
    val cacheDir: File = File(System.getProperty("java.io.tmpdir"), "bim-vm-${System.nanoTime()}").apply { mkdirs() }
    val api = TestApi.fuer(server)
    val cache = ResponseCache { cacheDir }
    val sitzung = Sitzung()
    val blickfeld = Blickfeld(SpeicherAblage(), HaushaltRepository(api, cache), TeileRepository(api, cache))
    val meldungen = MeldungsKanal()
    val bestand = Bestandssignal()
    val scrollMemory = ScrollMemory()
    val dienste = AppDienste(sitzung, blickfeld, meldungen, texte, bestand, scrollMemory)

    /**
     * Sammelt die Meldungen ans Bestandssignal, während [block] läuft, und
     * wartet auf [erwartet] Stück, ehe es aufhört — eine Meldung kommt oft erst
     * nach dem Zustand, auf den der Test wartet. Bei 0 kurz warten: Es soll
     * nichts kommen.
     */
    fun gemeldet(erwartet: Int, block: () -> Unit): List<ch.brickinventoryapp.ui.Aenderung> {
        val liste = Collections.synchronizedList(mutableListOf<ch.brickinventoryapp.ui.Aenderung>())
        val sammler = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
            bestand.aenderungen.collect { liste += it }
        }
        block()
        if (erwartet > 0) TestApi.warteBis("$erwartet Meldungen") { liste.size >= erwartet }
        else Thread.sleep(200)
        sammler.cancel()
        return liste.toList()
    }

    private val erzeugt = mutableListOf<androidx.lifecycle.ViewModel>()

    /** Merkt sich das ViewModel, damit [aufraeumen] seine Koroutinen beendet. */
    fun <T : androidx.lifecycle.ViewModel> merke(vm: T): T = vm.also { erzeugt += it }

    /**
     * Vor Dispatchers.resetMain() rufen: Die Sammler auf Abmeldung und
     * Bestandssignal laufen sonst weiter und stossen auf ein fehlendes Main.
     */
    fun aufraeumen() {
        erzeugt.forEach { it.viewModelScope.cancel() }
        cacheDir.deleteRecursively()
    }
}
