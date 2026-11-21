package ch.brickinventoryapp.testing

import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.state.ui.viewmodel.Texte
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
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import retrofit2.Retrofit
import java.util.Collections
import java.util.concurrent.TimeUnit
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.serializer
import okhttp3.ResponseBody
import retrofit2.Invocation
import retrofit2.Response as RetrofitResponse
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.util.WeakHashMap

/** The displayed message as a string, the way NumbersTexts builds it; null without a message. */
val MeldungsKanal.text: String? get() = meldung.value.text

/** A message as a checkable string: „t<id>(werte)“, „m<id>:<anzahl>“ or the text itself. */
val Meldung?.text: String?
    get() = when (this) {
        null -> null
        is Meldung.Text -> text
        is Meldung.Resource -> "t$id" + if (werte.isEmpty()) "" else werte.joinToString(", ", "(", ")")
        is Meldung.Menge -> "m$id:$anzahl"
    }

/** Shared scaffold of the ViewModel tests that run against a test server. */
object TestApi {

    /** The same JSON configuration as in di/AppModule. */
    fun fuer(server: MockWebServer): BrickApiService = fuer(server.url("/").toString(),
        OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build())

    fun fuer(basis: String, call: Call.Factory): BrickApiService {
        val json = BrickJson
        return Retrofit.Builder()
            .baseUrl(basis)
            .callFactory(call)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BrickApiService::class.java)
    }

    /**
     * A client that sends every request to [server] — like the app's guard
     * rewrites the placeholder address to the configured server.
     */
    fun umgeleitet(server: MockWebServer): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { kette ->
            val alt = kette.request()
            kette.proceed(alt.newBuilder().url(alt.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()).build())
        }
        .readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build()

    fun antwort(rumpf: String, code: Int = 200): MockResponse =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(rumpf)

    /** Waits for real network responses; viewModelScope runs on the test main thread. */
    fun warteBis(was: String, bedingung: () -> Boolean) {
        val ende = System.currentTimeMillis() + 5000
        while (!bedingung()) {
            check(System.currentTimeMillis() < ende) { "Zeitüberschreitung: $was" }
            Thread.sleep(10)
        }
    }
}

/** Returns the resource number — the test checks WHICH text arrived. */
object NumbersTexts : Texte {
    override fun text(id: Int, vararg args: Any?) = "t$id"
    override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
    override fun meldung(fehler: Ergebnis.Fehler) = "fehler"
    override fun angemeldet() = true
}

/**
 * A test server that answers by PATH instead of by order — ViewModels
 * fire several fetches side by side. Unknown paths get 404; every
 * request is recorded (method, path including query).
 */
class PfadServer(vararg rules: Pair<String, String>) {
    val server = MockWebServer()
    val antworten: MutableMap<String, String> = Collections.synchronizedMap(linkedMapOf(*rules))
    val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** The bodies in the same order as [requests]. */
    val koerper: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** A deviating status code per path, e.g. 401 for „session expired“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())
    /** Answers only after this many milliseconds — for „what happens while the server is computing“. */
    val delayed: MutableMap<String, Long> = Collections.synchronizedMap(mutableMapOf())
    /** Held back: paths whose response is withheld until [freigeben] sends it. */
    val ausbleibend: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private val held: MutableList<() -> Unit> = Collections.synchronizedList(mutableListOf())
    /** Answers ahead of the rules, e.g. from a sequence ([RowsServer]); null means: by path. */
    var priority: ((methode: String, pfad: String) -> Pair<Int, String>?)? = null
    /** Held back: responses that didn't fit the DTO; [pruefeEinlesen] fails on them. */
    val readError: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** Records the request and returns status code and body according to the rules. */
    private fun answer(methode: String, pfad: String, rumpf: String): Pair<Int, String> {
        requests += "$methode $pfad"
        koerper += rumpf
        priority?.invoke(methode, pfad)?.let { return it }
        val withoutQuery = pfad.substringBefore('?')
        val antwort = antworten[withoutQuery]
        return if (antwort == null) (codes[withoutQuery] ?: 404) to """{"success":false}"""
               else (codes[withoutQuery] ?: 200) to antwort
    }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val pfad = request.path.orEmpty()
                val (code, rumpf) = answer(request.method.orEmpty(), pfad, request.body.readUtf8())
                val antwort = TestApi.antwort(rumpf, code)
                delayed[pfad.substringBefore('?')]?.let { antwort.setHeadersDelay(it, TimeUnit.MILLISECONDS) }
                return antwort
            }
        }
        server.start()
    }

    /**
     * The same rules without a network: an interceptor answers, and OkHttp runs the fetch
     * on the calling thread. With test dispatchers, a ViewModel including the fetch thus runs on
     * the test clock, and no test waits in real time. Instead of delayed, there is [ausbleibend].
     */
    fun imTakt(): BrickApiService {
        val client = OkHttpClient.Builder().addInterceptor { kette ->
            val anfrage = kette.request()
            val pfad = pathWithQuery(anfrage)
            check(delayed.isEmpty()) { "Im Takt gibt es keine verzögerte Antwort ($pfad); dafür ausbleibend" }
            val rumpf = anfrage.body?.let { b -> Buffer().also { b.writeTo(it) }.readUtf8() }.orEmpty()
            val (code, text) = answer(anfrage.method, pfad, rumpf)
            if (code in 200..299) checkAgainstDto(anfrage, pfad, text)
            Response.Builder().request(anfrage).protocol(Protocol.HTTP_1_1).code(code).message("OK")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val staysFrom = { anfrage: Request, senden: () -> Unit ->
            (pathWithQuery(anfrage).substringBefore('?') in ausbleibend).also { if (it) held += senden }
        }
        val api = TestApi.fuer("http://im-takt.test/", object : Call.Factory {
            override fun newCall(request: Request): Call = ImmediatelyCall(client.newCall(request), staysFrom)
        })
        synchronized(herkunft) { herkunft[api] = this }
        return api
    }

    private fun pathWithQuery(anfrage: Request) =
        anfrage.url.encodedPath + (anfrage.url.encodedQuery?.let { "?$it" } ?: "")

    /**
     * Reads the response like Retrofit, against the DTO of the called method. If
     * reading fails at Retrofit, the error comes back via Dispatchers.Default and the test
     * leaves the clock. An AssertionError is not an exception: Retrofit passes it through on the
     * calling thread, and [pruefeEinlesen] names it during cleanup.
     */
    private fun checkAgainstDto(anfrage: Request, pfad: String, text: String) {
        val typ = anfrage.tag(Invocation::class.java)?.let { antworttyp(it.method()) } ?: return
        try {
            BrickJson.decodeFromString(BrickJson.serializersModule.serializer(typ), text)
        } catch (e: IllegalArgumentException) {
            val grund = "${anfrage.method} $pfad: ${e.message?.lineSequence()?.firstOrNull()}"
            readError += grund
            throw AssertionError("Testantwort passt nicht zum DTO — $grund", e)
        }
    }

    /**
     * Sends the held-back responses, on the calling thread. A fetch that has
     * since been cancelled gets no more: this is how a test checks that cancelling works.
     */
    fun freigeben() {
        ausbleibend.clear()
        val jetzt = synchronized(held) { held.toList().also { held.clear() } }
        jetzt.forEach { it() }
    }

    /** Fails if a held-back response didn't fit the DTO. */
    fun pruefeEinlesen() {
        val fehler = synchronized(readError) { readError.toList() }
        if (fehler.isNotEmpty()) {
            throw AssertionError("Testantworten passen nicht zum DTO; die Antwort vervollständigen:\n  " +
                fehler.joinToString("\n  "))
        }
    }

    companion object {
        private val herkunft = WeakHashMap<BrickApiService, PfadServer>()

        /** The server behind a service from [imTakt], otherwise null. */
        fun von(api: BrickApiService): PfadServer? = synchronized(herkunft) { herkunft[api] }
    }

    fun requestsAn(pfad: String): List<String> = synchronized(requests) { requests.filter { pfad in it } }

    /**
     * A new process gets its own server with the same responses and
     * its own services. Fetches the old ViewModel still has in flight thus don't
     * end up in the new one's [requests] — otherwise arrival order would decide.
     */
    fun <T> newProcess(io: CoroutineDispatcher? = null, block: (PfadServer, TestDienste) -> T): T {
        val paths = PfadServer(*antworten.toList().toTypedArray())
        val t = if (io == null) TestDienste(paths.server) else TestDienste(paths.imTakt(), io = io)
        try { return block(paths, t) } finally { t.aufraeumen(); paths.server.shutdown() }
    }
}

/** In-memory filter store. */
class StorageStore : FilterStore {
    val konten = mutableMapOf<String, String>()
    val lager = mutableMapOf<String, String>()
    override suspend fun konto(view: ScopeFilter.View) = konten[view.key] ?: ScopeFilter.ALL
    override suspend fun lager(view: ScopeFilter.View) = lager[view.key] ?: ""
    override suspend fun setAccount(view: ScopeFilter.View, wert: String) { konten[view.key] = wert }
    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) { lager[view.key] = wert }
    override suspend fun everythingForgotten() { konten.clear(); lager.clear() }
}

/**
 * The scope ViewModels' shared services, against a test server or
 * a [FakeApi]. With [io] = test dispatcher, the store too runs in virtual time.
 */
class TestDienste(val api: BrickApiService, texts: Texte = NumbersTexts, val io: CoroutineDispatcher = Dispatchers.IO) {

    constructor(server: MockWebServer, texts: Texte = NumbersTexts) : this(TestApi.fuer(server), texts)

    val sitzung = Sitzung()
    val blickfeld = Scope(StorageStore(), testHouseholdRepository(api), testPartsRepository(api))
    val meldungen = MeldungsKanal()

    /** One store for all of this test's repositories: what one writes, the others' lists see. */
    val ablage = Testablage()
    val kontosicht: Kontosicht = testKontosicht(api, ablage)
    val sync: Bestandsabgleich = testBestandsabgleich(api, ablage)

    /** The same instance, where a ViewModel only reads when the inventory changed. */
    val changes: Bestandsabgleich get() = sync
    fun sets(): SetsRepository = testSetsRepository(api, ablage)
    fun haushalt(): HouseholdRepository = testHouseholdRepository(api, ablage)
    fun merkliste(): WantedRepository = testWantedRepository(api, ablage)
    fun alerts(): AlarmRepository = testAlarmRepository(api, ablage)
    fun setCatalog(): SetKatalogRepository = testSetCatalogRepository(api)
    fun setFiles(): SetDateienRepository = testSetFilesRepository(api)
    fun teile(): PartsRepository = testPartsRepository(api, ablage)
    fun figuren(): MinifigsRepository = testMinifigsRepository(api, ablage)
    val scrollMemory = ScrollMemory()
    val hinweise = Meldungen(meldungen, texts)

    /**
     * Setting a filter runs, like in the app, outside the ViewModel; [aufraeumen] ends it.
     * Only on the first filter: tests create TestDienste before setMain().
     */
    private val filterAreaLazy = lazy {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    }
    private val filterArea by filterAreaLazy
    fun filter(): Filterwahl = Filterwahl(blickfeld, filterArea)

    private val erzeugt = mutableListOf<androidx.lifecycle.ViewModel>()

    /** Remembers the ViewModel, so [aufraeumen] can end its coroutines. */
    fun <T : androidx.lifecycle.ViewModel> merke(vm: T): T = vm.also { erzeugt += it }

    /**
     * Call before Dispatchers.resetMain(): the collectors on sign-out and the
     * store otherwise keep running and hit a missing Main.
     */
    fun aufraeumen() {
        val jobs = erzeugt.mapNotNull { it.viewModelScope.coroutineContext[kotlinx.coroutines.Job] }
        erzeugt.forEach { it.viewModelScope.cancel() }
        if (filterAreaLazy.isInitialized()) filterArea.cancel()
        // Cancelling alone isn't enough: a response already in flight
        // only ends its coroutine afterwards on Main. If it arrives after resetMain(),
        // it throws in whichever foreign test happens to be running.
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.withTimeoutOrNull(5_000) { jobs.forEach { it.join() } }
        }
        PfadServer.von(api)?.pruefeEinlesen()
    }
}

/** A repository against a test server; if it needs a store, its factory brings one along. */
fun <R, T> withRepo(bau: (BrickApiService) -> R, block: (PfadServer, R) -> T): T {
    val paths = PfadServer()
    try {
        return block(paths, bau(TestApi.fuer(paths.server)))
    } finally { paths.server.shutdown() }
}

/** A fetch that runs on the calling thread even when posed asynchronously (PfadServer.imTakt). */
private class ImmediatelyCall(private val echt: Call, private val staysFrom: (Request, () -> Unit) -> Boolean) : Call by echt {
    override fun enqueue(responseCallback: Callback) {
        if (staysFrom(echt.request()) { senden(responseCallback) }) return
        senden(responseCallback)
    }

    private fun senden(responseCallback: Callback) {
        if (echt.isCanceled()) return
        val antwort = try { echt.execute() } catch (e: IOException) { responseCallback.onFailure(this, e); return }
        responseCallback.onResponse(this, antwort)
    }

    override fun clone(): Call = ImmediatelyCall(echt.clone(), staysFrom)
}

/**
 * What Retrofit reads from the response: T from `suspend fun …(): Response<T>`. Bodies without
 * a DTO (ResponseBody, Unit) Retrofit reads itself; nobody checks those.
 */
private fun antworttyp(methode: Method): Type? {
    var typ = (methode.genericParameterTypes.lastOrNull() as? ParameterizedType)?.actualTypeArguments?.singleOrNull()
    if (typ is WildcardType) typ = typ.lowerBounds.singleOrNull()
    if (typ is ParameterizedType && typ.rawType == RetrofitResponse::class.java) typ = typ.actualTypeArguments.single()
    if (typ is WildcardType) typ = typ.upperBounds.singleOrNull()
    return typ?.takeUnless { it == ResponseBody::class.java || it == Unit::class.java || it == Void::class.java }
}

/**
 * Responses in a fixed order like MockWebServer.enqueue, but held back: no
 * network thread, every response is read against the DTO. For flows that depend on the
 * order of fetches rather than on the path.
 */
class RowsServer {
    /** A posed request, as RecordedRequest showed it. */
    class Anfrage(val method: String, val path: String, val body: Buffer)

    private val paths = PfadServer()
    private val series = ArrayDeque<Pair<Int, String>>()
    private val gestellt = ArrayDeque<Anfrage>()
    val api: BrickApiService = paths.imTakt()
    val requestCount: Int get() = paths.requests.size

    init {
        paths.priority = { methode, pfad ->
            gestellt += Anfrage(methode, pfad, Buffer().writeUtf8(paths.koerper.last()))
            series.removeFirstOrNull() ?: throw AssertionError("Keine Antwort mehr in der Reihe für $methode $pfad")
        }
    }

    fun enqueue(antwort: MockResponse) {
        series += antwort.status.split(' ')[1].toInt() to antwort.getBody()?.readUtf8().orEmpty()
    }

    fun takeRequest(): Anfrage = gestellt.removeFirst()

    fun pruefeEinlesen() = paths.pruefeEinlesen()

    fun shutdown() = paths.server.shutdown()
}
