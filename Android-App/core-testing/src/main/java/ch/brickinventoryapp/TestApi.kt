package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.ui.viewmodel.Texte
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import java.io.IOException
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
import ch.brickinventoryapp.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.ui.viewmodel.Meldungen
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
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
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.ui.Aenderung
import kotlinx.serialization.serializer
import okhttp3.ResponseBody
import retrofit2.Invocation
import retrofit2.Response as RetrofitAntwort
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.util.WeakHashMap

/** Gemeinsames Gerüst der ViewModel-Tests, die gegen einen Testserver laufen. */
object TestApi {

    /** Dieselbe Json-Konfiguration wie in di/AppModule. */
    fun fuer(server: MockWebServer): BrickApiService = fuer(server.url("/").toString(),
        OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build())

    fun fuer(basis: String, rufe: Call.Factory): BrickApiService {
        val json = ApiJson
        return Retrofit.Builder()
            .baseUrl(basis)
            .callFactory(rufe)
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
    override fun meldung(fehler: Ergebnis.Error) = "fehler"
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
    /** Antwort erst nach so vielen Millisekunden — für „was geschieht, solange der Server rechnet“. */
    val verzoegert: MutableMap<String, Long> = Collections.synchronizedMap(mutableMapOf())
    /** Im Takt: Pfade, deren Antwort zurückgehalten wird, bis [freigeben] sie schickt. */
    val ausbleibend: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private val gehalten: MutableList<() -> Unit> = Collections.synchronizedList(mutableListOf())
    /** Antwortet vor den Regeln, etwa aus einer Reihe ([ReihenServer]); null heisst: nach Pfad. */
    var vorrang: ((methode: String, pfad: String) -> Pair<Int, String>?)? = null
    /** Im Takt: Antworten, die nicht zum DTO passten; [pruefeEinlesen] scheitert an ihnen. */
    val einlesefehler: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** Schreibt die Anfrage mit und liefert Statuscode und Rumpf nach den Regeln. */
    private fun beantworte(methode: String, pfad: String, rumpf: String): Pair<Int, String> {
        anfragen += "$methode $pfad"
        koerper += rumpf
        vorrang?.invoke(methode, pfad)?.let { return it }
        val ohneAbfrage = pfad.substringBefore('?')
        val antwort = antworten[ohneAbfrage]
        return if (antwort == null) (codes[ohneAbfrage] ?: 404) to """{"success":false}"""
               else (codes[ohneAbfrage] ?: 200) to antwort
    }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty()
                val (code, rumpf) = beantworte(request.method.orEmpty(), pfad, request.body.readUtf8())
                val antwort = TestApi.antwort(rumpf, code)
                verzoegert[pfad.substringBefore('?')]?.let { antwort.setHeadersDelay(it, TimeUnit.MILLISECONDS) }
                return antwort
            }
        }
        server.start()
    }

    /**
     * Dieselben Regeln ohne Netz: Ein Interceptor antwortet, und OkHttp führt den Abruf
     * im aufrufenden Faden aus. Mit Test-Dispatchern läuft ein ViewModel samt Abruf so in
     * der Testuhr, und kein Test wartet in Echtzeit. Statt verzögert gibt es [ausbleibend].
     */
    fun imTakt(): BrickApiService {
        val client = OkHttpClient.Builder().addInterceptor { kette ->
            val anfrage = kette.request()
            val pfad = pfadMitAbfrage(anfrage)
            check(verzoegert.isEmpty()) { "Im Takt gibt es keine verzögerte Antwort ($pfad); dafür ausbleibend" }
            val rumpf = anfrage.body?.let { b -> Buffer().also { b.writeTo(it) }.readUtf8() }.orEmpty()
            val (code, text) = beantworte(anfrage.method, pfad, rumpf)
            if (code in 200..299) pruefeGegenDto(anfrage, pfad, text)
            Response.Builder().request(anfrage).protocol(Protocol.HTTP_1_1).code(code).message("OK")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val bleibtAus = { anfrage: Request, senden: () -> Unit ->
            (pfadMitAbfrage(anfrage).substringBefore('?') in ausbleibend).also { if (it) gehalten += senden }
        }
        val api = TestApi.fuer("http://im-takt.test/", object : Call.Factory {
            override fun newCall(request: Request): Call = SofortRuf(client.newCall(request), bleibtAus)
        })
        synchronized(herkunft) { herkunft[api] = this }
        return api
    }

    private fun pfadMitAbfrage(anfrage: Request) =
        anfrage.url.encodedPath + (anfrage.url.encodedQuery?.let { "?$it" } ?: "")

    /**
     * Liest die Antwort wie Retrofit gegen das DTO der aufgerufenen Methode. Scheitert das
     * Einlesen bei Retrofit, kommt der Fehler über Dispatchers.Default zurück und der Test
     * verlässt den Takt. Ein AssertionError ist keine Exception: Retrofit reicht ihn im
     * aufrufenden Faden durch, und [pruefeEinlesen] nennt ihn beim Aufräumen.
     */
    private fun pruefeGegenDto(anfrage: Request, pfad: String, text: String) {
        val typ = anfrage.tag(Invocation::class.java)?.let { antworttyp(it.method()) } ?: return
        try {
            ApiJson.decodeFromString(ApiJson.serializersModule.serializer(typ), text)
        } catch (e: IllegalArgumentException) {
            val grund = "${anfrage.method} $pfad: ${e.message?.lineSequence()?.firstOrNull()}"
            einlesefehler += grund
            throw AssertionError("Testantwort passt nicht zum DTO — $grund", e)
        }
    }

    /**
     * Schickt die zurückgehaltenen Antworten, im aufrufenden Faden. Ein inzwischen
     * abgebrochener Abruf bekommt keine mehr: So prüft ein Test, dass Abbrechen wirkt.
     */
    fun freigeben() {
        ausbleibend.clear()
        val jetzt = synchronized(gehalten) { gehalten.toList().also { gehalten.clear() } }
        jetzt.forEach { it() }
    }

    /** Scheitert, wenn eine Antwort im Takt nicht zum DTO passte. */
    fun pruefeEinlesen() {
        val fehler = synchronized(einlesefehler) { einlesefehler.toList() }
        if (fehler.isNotEmpty()) {
            throw AssertionError("Testantworten passen nicht zum DTO; die Antwort vervollständigen:\n  " +
                fehler.joinToString("\n  "))
        }
    }

    companion object {
        private val herkunft = WeakHashMap<BrickApiService, PfadServer>()

        /** Der Server hinter einem Dienst aus [imTakt], sonst null. */
        fun von(api: BrickApiService): PfadServer? = synchronized(herkunft) { herkunft[api] }
    }

    fun anfragenAn(pfad: String): List<String> = synchronized(anfragen) { anfragen.filter { pfad in it } }

    /**
     * Ein neuer Prozess bekommt einen eigenen Server mit denselben Antworten und
     * eigene Dienste. Abrufe, die das alte ViewModel noch unterwegs hat, landen
     * so nicht in [anfragen] des neuen — sonst entscheidet die Ankunftsreihenfolge.
     */
    fun <T> neuerProzess(io: CoroutineDispatcher? = null, block: (PfadServer, TestDienste) -> T): T {
        val pfade = PfadServer(*antworten.toList().toTypedArray())
        val t = if (io == null) TestDienste(pfade.server) else TestDienste(pfade.imTakt(), io = io)
        try { return block(pfade, t) } finally { t.aufraeumen(); pfade.server.shutdown() }
    }
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

/**
 * Die gemeinsamen Dienste der Bereichs-ViewModels, gegen einen Testserver oder
 * eine [FakeApi]. Mit [io] = Test-Dispatcher läuft auch die Ablage in virtueller Zeit.
 */
class TestDienste(val api: BrickApiService, texte: Texte = NummernTexte, val io: CoroutineDispatcher = Dispatchers.IO) {
    /** Mit einem Test-Dispatcher ist alles schon gelaufen, wenn ein Aufruf zurückkehrt. */
    private val imTakt = io != Dispatchers.IO

    constructor(server: MockWebServer, texte: Texte = NummernTexte) : this(TestApi.fuer(server), texte)

    val cacheDir: File = File(System.getProperty("java.io.tmpdir"), "bim-vm-${System.nanoTime()}").apply { mkdirs() }
    val cache = ResponseCache(io = io) { cacheDir }
    val sitzung = Sitzung()
    val blickfeld = Blickfeld(SpeicherAblage(), HaushaltRepository(api, cache), TeileRepository(api, cache))
    val meldungen = MeldungsKanal()
    val bestand = Bestandssignal()
    val scrollMemory = ScrollMemory()
    val hinweise = Meldungen(meldungen, texte)

    /**
     * Filter setzen läuft wie in der App ausserhalb des ViewModels; [aufraeumen] beendet es.
     * Erst beim ersten Filter: Tests legen TestDienste vor setMain() an.
     */
    private val filterBereichLazy = lazy {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    }
    private val filterBereich by filterBereichLazy
    fun filter(): Filterwahl = Filterwahl(blickfeld, filterBereich)

    /**
     * Sammelt die Meldungen ans Bestandssignal, während [block] läuft, und
     * wartet auf [erwartet] Stück, ehe es aufhört — eine Meldung kommt oft erst
     * nach dem Zustand, auf den der Test wartet. Bei 0 kurz warten: Es soll
     * nichts kommen.
     */
    fun gemeldet(erwartet: Int, block: () -> Unit): List<Aenderung> {
        val liste = Collections.synchronizedList(mutableListOf<Aenderung>())
        val sammler = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
            bestand.aenderungen.collect { liste += it }
        }
        block()
        if (!imTakt) {
            if (erwartet > 0) TestApi.warteBis("$erwartet Meldungen") { liste.size >= erwartet } else Thread.sleep(200)
        }
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
        val jobs = erzeugt.mapNotNull { it.viewModelScope.coroutineContext[kotlinx.coroutines.Job] }
        erzeugt.forEach { it.viewModelScope.cancel() }
        if (filterBereichLazy.isInitialized()) filterBereich.cancel()
        // Abbrechen allein reicht nicht: Eine Antwort, die schon unterwegs ist,
        // beendet ihre Koroutine erst danach auf Main. Kommt sie nach resetMain(),
        // wirft sie im gerade laufenden fremden Test.
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.withTimeoutOrNull(5_000) { jobs.forEach { it.join() } }
        }
        cacheDir.deleteRecursively()
        PfadServer.von(api)?.pruefeEinlesen()
    }
}

/** Ein Repository gegen einen Testserver, mit Ablage in einem Wegwerf-Ordner. */
fun <R, T> mitRepo(bau: (BrickApiService, ResponseCache) -> R, block: (PfadServer, R) -> T): T {
    val pfade = PfadServer()
    val ordner = File(System.getProperty("java.io.tmpdir"), "bim-repo-${System.nanoTime()}").apply { mkdirs() }
    try {
        return block(pfade, bau(TestApi.fuer(pfade.server), ResponseCache { ordner }))
    } finally { pfade.server.shutdown(); ordner.deleteRecursively() }
}

/** Ein Abruf, der auch asynchron gestellt im aufrufenden Faden läuft (PfadServer.imTakt). */
private class SofortRuf(private val echt: Call, private val bleibtAus: (Request, () -> Unit) -> Boolean) : Call by echt {
    override fun enqueue(responseCallback: Callback) {
        if (bleibtAus(echt.request()) { senden(responseCallback) }) return
        senden(responseCallback)
    }

    private fun senden(responseCallback: Callback) {
        if (echt.isCanceled()) return
        val antwort = try { echt.execute() } catch (e: IOException) { responseCallback.onFailure(this, e); return }
        responseCallback.onResponse(this, antwort)
    }

    override fun clone(): Call = SofortRuf(echt.clone(), bleibtAus)
}

/**
 * Was Retrofit aus der Antwort liest: T aus `suspend fun …(): Response<T>`. Rümpfe ohne
 * DTO (ResponseBody, Unit) liest Retrofit selbst; sie prüft niemand.
 */
private fun antworttyp(methode: Method): Type? {
    var typ = (methode.genericParameterTypes.lastOrNull() as? ParameterizedType)?.actualTypeArguments?.singleOrNull()
    if (typ is WildcardType) typ = typ.lowerBounds.singleOrNull()
    if (typ is ParameterizedType && typ.rawType == RetrofitAntwort::class.java) typ = typ.actualTypeArguments.single()
    if (typ is WildcardType) typ = typ.upperBounds.singleOrNull()
    return typ?.takeUnless { it == ResponseBody::class.java || it == Unit::class.java || it == Void::class.java }
}

/**
 * Antworten in fester Reihenfolge wie bei MockWebServer.enqueue, aber im Takt: kein
 * Netzfaden, jede Antwort wird gegen das DTO gelesen. Für Abläufe, die an der
 * Reihenfolge der Abrufe hängen statt am Pfad.
 */
class ReihenServer {
    /** Eine gestellte Anfrage, wie RecordedRequest sie zeigte. */
    class Anfrage(val method: String, val path: String, val body: Buffer)

    private val pfade = PfadServer()
    private val reihe = ArrayDeque<Pair<Int, String>>()
    private val gestellt = ArrayDeque<Anfrage>()
    val api: BrickApiService = pfade.imTakt()
    val requestCount: Int get() = pfade.anfragen.size

    init {
        pfade.vorrang = { methode, pfad ->
            gestellt += Anfrage(methode, pfad, Buffer().writeUtf8(pfade.koerper.last()))
            reihe.removeFirstOrNull() ?: throw AssertionError("Keine Antwort mehr in der Reihe für $methode $pfad")
        }
    }

    fun enqueue(antwort: MockResponse) {
        reihe += antwort.status.split(' ')[1].toInt() to antwort.getBody()?.readUtf8().orEmpty()
    }

    fun takeRequest(): Anfrage = gestellt.removeFirst()

    fun pruefeEinlesen() = pfade.pruefeEinlesen()

    fun shutdown() = pfade.server.shutdown()
}
