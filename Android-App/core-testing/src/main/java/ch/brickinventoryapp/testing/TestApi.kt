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

/** Die angezeigte Meldung als Satz, wie NumbersTexts ihn bildet; null ohne Meldung. */
val MeldungsKanal.text: String? get() = meldung.value.text

/** Eine Meldung als prüfbarer Satz: „t<id>(werte)“, „m<id>:<anzahl>“ oder der Text selbst. */
val Meldung?.text: String?
    get() = when (this) {
        null -> null
        is Meldung.Text -> text
        is Meldung.Resource -> "t$id" + if (werte.isEmpty()) "" else werte.joinToString(", ", "(", ")")
        is Meldung.Menge -> "m$id:$anzahl"
    }

/** Gemeinsames Gerüst der ViewModel-Tests, die gegen einen Testserver laufen. */
object TestApi {

    /** Dieselbe Json-Konfiguration wie in di/AppModule. */
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
     * Ein Client, der jede Anfrage an [server] schickt — wie der Wächter der App die
     * Platzhalter-Adresse auf den eingetragenen Server umschreibt.
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
object NumbersTexts : Texte {
    override fun text(id: Int, vararg args: Any?) = "t$id"
    override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
    override fun meldung(fehler: Ergebnis.Fehler) = "fehler"
    override fun angemeldet() = true
}

/**
 * Ein Testserver, der nach PFAD antwortet statt nach Reihenfolge — ViewModels
 * stellen mehrere Abrufe nebeneinander. Unbekannte Pfade bekommen 404; jede
 * Anfrage wird mitgeschrieben (Methode, Pfad samt Abfrage).
 */
class PfadServer(vararg rules: Pair<String, String>) {
    val server = MockWebServer()
    val antworten: MutableMap<String, String> = Collections.synchronizedMap(linkedMapOf(*rules))
    val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** Die Rümpfe in derselben Reihenfolge wie [requests]. */
    val koerper: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** Abweichender Statuscode je Pfad, z. B. 401 für „Sitzung abgelaufen“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())
    /** Antwort erst nach so vielen Millisekunden — für „was geschieht, solange der Server rechnet“. */
    val delayed: MutableMap<String, Long> = Collections.synchronizedMap(mutableMapOf())
    /** Im Takt: Pfade, deren Antwort zurückgehalten wird, bis [freigeben] sie schickt. */
    val ausbleibend: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private val held: MutableList<() -> Unit> = Collections.synchronizedList(mutableListOf())
    /** Antwortet vor den Regeln, etwa aus einer Reihe ([RowsServer]); null heisst: nach Pfad. */
    var priority: ((methode: String, pfad: String) -> Pair<Int, String>?)? = null
    /** Im Takt: Antworten, die nicht zum DTO passten; [pruefeEinlesen] scheitert an ihnen. */
    val readError: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** Schreibt die Anfrage mit und liefert Statuscode und Rumpf nach den Regeln. */
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
     * Dieselben Regeln ohne Netz: Ein Interceptor antwortet, und OkHttp führt den Abruf
     * im aufrufenden Faden aus. Mit Test-Dispatchern läuft ein ViewModel samt Abruf so in
     * der Testuhr, und kein Test wartet in Echtzeit. Statt verzögert gibt es [ausbleibend].
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
     * Liest die Antwort wie Retrofit gegen das DTO der aufgerufenen Methode. Scheitert das
     * Einlesen bei Retrofit, kommt der Fehler über Dispatchers.Default zurück und der Test
     * verlässt den Takt. Ein AssertionError ist keine Exception: Retrofit reicht ihn im
     * aufrufenden Faden durch, und [pruefeEinlesen] nennt ihn beim Aufräumen.
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
     * Schickt die zurückgehaltenen Antworten, im aufrufenden Faden. Ein inzwischen
     * abgebrochener Abruf bekommt keine mehr: So prüft ein Test, dass Abbrechen wirkt.
     */
    fun freigeben() {
        ausbleibend.clear()
        val jetzt = synchronized(held) { held.toList().also { held.clear() } }
        jetzt.forEach { it() }
    }

    /** Scheitert, wenn eine Antwort im Takt nicht zum DTO passte. */
    fun pruefeEinlesen() {
        val fehler = synchronized(readError) { readError.toList() }
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

    fun requestsAn(pfad: String): List<String> = synchronized(requests) { requests.filter { pfad in it } }

    /**
     * Ein neuer Prozess bekommt einen eigenen Server mit denselben Antworten und
     * eigene Dienste. Abrufe, die das alte ViewModel noch unterwegs hat, landen
     * so nicht in [requests] des neuen — sonst entscheidet die Ankunftsreihenfolge.
     */
    fun <T> newProcess(io: CoroutineDispatcher? = null, block: (PfadServer, TestDienste) -> T): T {
        val paths = PfadServer(*antworten.toList().toTypedArray())
        val t = if (io == null) TestDienste(paths.server) else TestDienste(paths.imTakt(), io = io)
        try { return block(paths, t) } finally { t.aufraeumen(); paths.server.shutdown() }
    }
}

/** Filterablage im Speicher. */
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
 * Die gemeinsamen Dienste der Bereichs-ViewModels, gegen einen Testserver oder
 * eine [FakeApi]. Mit [io] = Test-Dispatcher läuft auch die Ablage in virtueller Zeit.
 */
class TestDienste(val api: BrickApiService, texts: Texte = NumbersTexts, val io: CoroutineDispatcher = Dispatchers.IO) {

    constructor(server: MockWebServer, texts: Texte = NumbersTexts) : this(TestApi.fuer(server), texts)

    val sitzung = Sitzung()
    val blickfeld = Scope(StorageStore(), testHouseholdRepository(api), testPartsRepository(api))
    val meldungen = MeldungsKanal()

    /** Eine Ablage für alle Repositories dieses Tests: Was eines schreibt, sehen die Listen der anderen. */
    val ablage = Testablage()
    val kontosicht: Kontosicht = testKontosicht(api, ablage)
    val sync: Bestandsabgleich = testBestandsabgleich(api, ablage)

    /** Dieselbe Instanz, wo ein ViewModel nur liest, wann sich der Bestand geändert hat. */
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
     * Filter setzen läuft wie in der App ausserhalb des ViewModels; [aufraeumen] beendet es.
     * Erst beim ersten Filter: Tests legen TestDienste vor setMain() an.
     */
    private val filterAreaLazy = lazy {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    }
    private val filterArea by filterAreaLazy
    fun filter(): Filterwahl = Filterwahl(blickfeld, filterArea)

    private val erzeugt = mutableListOf<androidx.lifecycle.ViewModel>()

    /** Merkt sich das ViewModel, damit [aufraeumen] seine Koroutinen beendet. */
    fun <T : androidx.lifecycle.ViewModel> merke(vm: T): T = vm.also { erzeugt += it }

    /**
     * Vor Dispatchers.resetMain() rufen: Die Sammler auf Abmeldung und
     * Ablage laufen sonst weiter und stossen auf ein fehlendes Main.
     */
    fun aufraeumen() {
        val jobs = erzeugt.mapNotNull { it.viewModelScope.coroutineContext[kotlinx.coroutines.Job] }
        erzeugt.forEach { it.viewModelScope.cancel() }
        if (filterAreaLazy.isInitialized()) filterArea.cancel()
        // Abbrechen allein reicht nicht: Eine Antwort, die schon unterwegs ist,
        // beendet ihre Koroutine erst danach auf Main. Kommt sie nach resetMain(),
        // wirft sie im gerade laufenden fremden Test.
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.withTimeoutOrNull(5_000) { jobs.forEach { it.join() } }
        }
        PfadServer.von(api)?.pruefeEinlesen()
    }
}

/** Ein Repository gegen einen Testserver; braucht es eine Ablage, bringt seine Fabrik eine mit. */
fun <R, T> withRepo(bau: (BrickApiService) -> R, block: (PfadServer, R) -> T): T {
    val paths = PfadServer()
    try {
        return block(paths, bau(TestApi.fuer(paths.server)))
    } finally { paths.server.shutdown() }
}

/** Ein Abruf, der auch asynchron gestellt im aufrufenden Faden läuft (PfadServer.imTakt). */
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
 * Was Retrofit aus der Antwort liest: T aus `suspend fun …(): Response<T>`. Rümpfe ohne
 * DTO (ResponseBody, Unit) liest Retrofit selbst; sie prüft niemand.
 */
private fun antworttyp(methode: Method): Type? {
    var typ = (methode.genericParameterTypes.lastOrNull() as? ParameterizedType)?.actualTypeArguments?.singleOrNull()
    if (typ is WildcardType) typ = typ.lowerBounds.singleOrNull()
    if (typ is ParameterizedType && typ.rawType == RetrofitResponse::class.java) typ = typ.actualTypeArguments.single()
    if (typ is WildcardType) typ = typ.upperBounds.singleOrNull()
    return typ?.takeUnless { it == ResponseBody::class.java || it == Unit::class.java || it == Void::class.java }
}

/**
 * Antworten in fester Reihenfolge wie bei MockWebServer.enqueue, aber im Takt: kein
 * Netzfaden, jede Antwort wird gegen das DTO gelesen. Für Abläufe, die an der
 * Reihenfolge der Abrufe hängen statt am Pfad.
 */
class RowsServer {
    /** Eine gestellte Anfrage, wie RecordedRequest sie zeigte. */
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
