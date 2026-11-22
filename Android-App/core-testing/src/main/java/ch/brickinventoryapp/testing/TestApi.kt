package ch.brickinventoryapp.testing

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.SetCatalogRepository
import ch.brickinventoryapp.data.repository.SetFilesRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.StockReconciliation
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import retrofit2.Invocation
import retrofit2.Retrofit
import java.io.IOException
import java.lang.reflect.Method
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.TimeUnit
import retrofit2.Response as RetrofitResponse

/** The displayed message as a string, the way NumbersTexts builds it; null without a message. */
val MessageChannel.text: String? get() = message.value.text

/** A message as a checkable string: „t<id>(werte)“, „m<id>:<anzahl>“ or the text itself. */
val Message?.text: String?
    get() = when (this) {
        null -> null
        is Message.Text -> text
        is Message.Resource -> "t$id" + if (values.isEmpty()) "" else values.joinToString(", ", "(", ")")
        is Message.Quantity -> "m$id:$count"
    }

/** Shared scaffold of the ViewModel tests that run against a test server. */
object TestApi {

    /** The same JSON configuration as in di/AppModule. */
    fun forTarget(server: MockWebServer): BrickApiService = forTarget(server.url("/").toString(),
        OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build())

    fun forTarget(basis: String, call: Call.Factory): BrickApiService {
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
    fun redirected(server: MockWebServer): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            val old = chain.request()
            chain.proceed(old.newBuilder().url(old.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()).build())
        }
        .readTimeout(2, TimeUnit.SECONDS).connectTimeout(2, TimeUnit.SECONDS).build()

    fun response(body: String, code: Int = 200): MockResponse =
        MockResponse().setResponseCode(code)
            .setHeader("Content-Type", "application/json").setBody(body)

    /** Waits for real network responses; viewModelScope runs on the test main thread. */
    fun pollUntil(was: String, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 5000
        while (!condition()) {
            check(System.currentTimeMillis() < end) { "Zeitüberschreitung: $was" }
            Thread.sleep(10)
        }
    }
}

/** Returns the resource number — the test checks WHICH text arrived. */
object NumbersTexts : Texts {
    override fun text(id: Int, vararg args: Any?) = "t$id"
    override fun quantity(id: Int, count: Int, vararg args: Any?) = "m$id:$count"
    override fun message(error: Outcome.Failure) = "fehler"
    override fun loggedIn() = true
}

/**
 * A test server that answers by PATH instead of by order — ViewModels
 * fire several fetches side by side. Unknown paths get 404; every
 * request is recorded (method, path including query).
 */
class PathServer(vararg rules: Pair<String, String>) {
    val server = MockWebServer()
    val responses: MutableMap<String, String> = Collections.synchronizedMap(linkedMapOf(*rules))
    val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** The bodies in the same order as [requests]. */
    val bodyBytes: MutableList<String> = Collections.synchronizedList(mutableListOf())
    /** A deviating status code per path, e.g. 401 for „session expired“. */
    val codes: MutableMap<String, Int> = Collections.synchronizedMap(mutableMapOf())
    /** Answers only after this many milliseconds — for „what happens while the server is computing“. */
    val delayed: MutableMap<String, Long> = Collections.synchronizedMap(mutableMapOf())
    /** Held back: paths whose response is withheld until [release] sends it. */
    val missing: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private val held: MutableList<() -> Unit> = Collections.synchronizedList(mutableListOf())
    /** Answers ahead of the rules, e.g. from a sequence ([RowsServer]); null means: by path. */
    var priority: ((method: String, path: String) -> Pair<Int, String>?)? = null
    /** Held back: responses that didn't fit the DTO; [checkReadIn] fails on them. */
    val readError: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** Records the request and returns status code and body according to the rules. */
    private fun answer(method: String, path: String, body: String): Pair<Int, String> {
        requests += "$method $path"
        bodyBytes += body
        priority?.invoke(method, path)?.let { return it }
        val withoutQuery = path.substringBefore('?')
        val response = responses[withoutQuery]
        return if (response == null) (codes[withoutQuery] ?: 404) to """{"success":false}"""
               else (codes[withoutQuery] ?: 200) to response
    }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                val (code, body) = answer(request.method.orEmpty(), path, request.body.readUtf8())
                val response = TestApi.response(body, code)
                delayed[path.substringBefore('?')]?.let { response.setHeadersDelay(it, TimeUnit.MILLISECONDS) }
                return response
            }
        }
        server.start()
    }

    /**
     * The same rules without a network: an interceptor answers, and OkHttp runs the fetch
     * on the calling thread. With test dispatchers, a ViewModel including the fetch thus runs on
     * the test clock, and no test waits in real time. Instead of delayed, there is [missing].
     */
    fun onTick(): BrickApiService {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val path = pathWithQuery(request)
            check(delayed.isEmpty()) { "Im Takt gibt es keine verzögerte Antwort ($path); dafür ausbleibend" }
            val body = request.body?.let { b -> Buffer().also { b.writeTo(it) }.readUtf8() }.orEmpty()
            val (code, text) = answer(request.method, path, body)
            if (code in 200..299) checkAgainstDto(request, path, text)
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("OK")
                .body(text.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val staysFrom = { request: Request, send: () -> Unit ->
            (pathWithQuery(request).substringBefore('?') in missing).also { if (it) held += send }
        }
        val api = TestApi.forTarget("http://im-takt.test/", object : Call.Factory {
            override fun newCall(request: Request): Call = ImmediatelyCall(client.newCall(request), staysFrom)
        })
        synchronized(origin) { origin[api] = this }
        return api
    }

    private fun pathWithQuery(request: Request) =
        request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: "")

    /**
     * Reads the response like Retrofit, against the DTO of the called method. If
     * reading fails at Retrofit, the error comes back via Dispatchers.Default and the test
     * leaves the clock. An AssertionError is not an exception: Retrofit passes it through on the
     * calling thread, and [checkReadIn] names it during cleanup.
     */
    private fun checkAgainstDto(request: Request, path: String, text: String) {
        val type = request.tag(Invocation::class.java)?.let { responseType(it.method()) } ?: return
        try {
            BrickJson.decodeFromString(BrickJson.serializersModule.serializer(type), text)
        } catch (e: IllegalArgumentException) {
            val reason = "${request.method} $path: ${e.message?.lineSequence()?.firstOrNull()}"
            readError += reason
            throw AssertionError("Testantwort passt nicht zum DTO — $reason", e)
        }
    }

    /**
     * Sends the held-back responses, on the calling thread. A fetch that has
     * since been cancelled gets no more: this is how a test checks that cancelling works.
     */
    fun release() {
        missing.clear()
        val now = synchronized(held) { held.toList().also { held.clear() } }
        now.forEach { it() }
    }

    /** Fails if a held-back response didn't fit the DTO. */
    fun checkReadIn() {
        val error = synchronized(readError) { readError.toList() }
        if (error.isNotEmpty()) {
            throw AssertionError("Testantworten passen nicht zum DTO; die Antwort vervollständigen:\n  " +
                error.joinToString("\n  "))
        }
    }

    companion object {
        private val origin = WeakHashMap<BrickApiService, PathServer>()

        /** The server behind a service from [onTick], otherwise null. */
        fun of(api: BrickApiService): PathServer? = synchronized(origin) { origin[api] }
    }

    fun requestsTo(path: String): List<String> = synchronized(requests) { requests.filter { path in it } }

    /**
     * A new process gets its own server with the same responses and
     * its own services. Fetches the old ViewModel still has in flight thus don't
     * end up in the new one's [requests] — otherwise arrival order would decide.
     */
    fun <T> newProcess(io: CoroutineDispatcher? = null, block: (PathServer, TestServices) -> T): T {
        val paths = PathServer(*responses.toList().toTypedArray())
        val t = if (io == null) TestServices(paths.server) else TestServices(paths.onTick(), io = io)
        try { return block(paths, t) } finally { t.cleanUp(); paths.server.shutdown() }
    }
}

/** In-memory filter store. */
class StorageStore : FilterStore {
    val accounts = mutableMapOf<String, String>()
    val storage = mutableMapOf<String, String>()
    override suspend fun account(view: ScopeFilter.View) = accounts[view.key] ?: ScopeFilter.ALL
    override suspend fun storage(view: ScopeFilter.View) = storage[view.key] ?: ""
    override suspend fun setAccount(view: ScopeFilter.View, value: String) { accounts[view.key] = value }
    override suspend fun applyStorage(view: ScopeFilter.View, value: String) { storage[view.key] = value }
    override suspend fun forgetAll() { accounts.clear(); storage.clear() }
}

/**
 * The scope ViewModels' shared services, against a test server or
 * a [FakeApi]. With [io] = test dispatcher, the store too runs in virtual time.
 */
class TestServices(val api: BrickApiService, texts: Texts = NumbersTexts, val io: CoroutineDispatcher = Dispatchers.IO) {

    constructor(server: MockWebServer, texts: Texts = NumbersTexts) : this(TestApi.forTarget(server), texts)

    val session = Session()
    val viewport = Scope(StorageStore(), testHouseholdRepository(api), testPartsRepository(api))
    val messages = MessageChannel()

    /** One store for all of this test's repositories: what one writes, the others' lists see. */
    val store = TestStore()
    val accountView: AccountView = testAccountView(api, store)
    val sync: StockReconciliation = testStockReconciliation(api, store)

    /** The same instance, where a ViewModel only reads when the inventory changed. */
    val changes: StockReconciliation get() = sync
    fun sets(): SetsRepository = testSetsRepository(api, store)
    fun household(): HouseholdRepository = testHouseholdRepository(api, store)
    fun wantedList(): WantedRepository = testWantedRepository(api, store)
    fun alerts(): AlarmRepository = testAlarmRepository(api, store)
    fun setCatalog(): SetCatalogRepository = testSetCatalogRepository(api)
    fun setFiles(): SetFilesRepository = testSetFilesRepository(api)
    fun parts(): PartsRepository = testPartsRepository(api, store)
    fun figures(): MinifigsRepository = testMinifigsRepository(api, store)
    val scrollMemory = ScrollMemory()
    val hints = Messages(messages, texts)

    /**
     * Setting a filter runs, like in the app, outside the ViewModel; [cleanUp] ends it.
     * Only on the first filter: tests create TestServices before setMain().
     */
    private val filterAreaLazy = lazy {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    }
    private val filterArea by filterAreaLazy
    fun filter(): FilterChoice = FilterChoice(viewport, filterArea)

    private val created = mutableListOf<androidx.lifecycle.ViewModel>()

    /** Remembers the ViewModel, so [cleanUp] can end its coroutines. */
    fun <T : androidx.lifecycle.ViewModel> track(vm: T): T = vm.also { created += it }

    /**
     * Call before Dispatchers.resetMain(): the collectors on sign-out and the
     * store otherwise keep running and hit a missing Main.
     */
    fun cleanUp() {
        val jobs = created.mapNotNull { it.viewModelScope.coroutineContext[kotlinx.coroutines.Job] }
        created.forEach { it.viewModelScope.cancel() }
        if (filterAreaLazy.isInitialized()) filterArea.cancel()
        // Cancelling alone isn't enough: a response already in flight
        // only ends its coroutine afterwards on Main. If it arrives after resetMain(),
        // it throws in whichever foreign test happens to be running.
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.withTimeoutOrNull(5_000) { jobs.forEach { it.join() } }
        }
        PathServer.of(api)?.checkReadIn()
    }
}

/** A repository against a test server; if it needs a store, its factory brings one along. */
fun <R, T> withRepo(build: (BrickApiService) -> R, block: (PathServer, R) -> T): T {
    val paths = PathServer()
    try {
        return block(paths, build(TestApi.forTarget(paths.server)))
    } finally { paths.server.shutdown() }
}

/** A fetch that runs on the calling thread even when posed asynchronously (PathServer.onTick). */
private class ImmediatelyCall(private val real: Call, private val staysFrom: (Request, () -> Unit) -> Boolean) : Call by real {
    override fun enqueue(responseCallback: Callback) {
        if (staysFrom(real.request()) { send(responseCallback) }) return
        send(responseCallback)
    }

    private fun send(responseCallback: Callback) {
        if (real.isCanceled()) return
        val response = try { real.execute() } catch (e: IOException) { responseCallback.onFailure(this, e); return }
        responseCallback.onResponse(this, response)
    }

    override fun clone(): Call = ImmediatelyCall(real.clone(), staysFrom)
}

/**
 * What Retrofit reads from the response: T from `suspend fun …(): Response<T>`. Bodies without
 * a DTO (ResponseBody, Unit) Retrofit reads itself; nobody checks those.
 */
private fun responseType(method: Method): Type? {
    var type = (method.genericParameterTypes.lastOrNull() as? ParameterizedType)?.actualTypeArguments?.singleOrNull()
    if (type is WildcardType) type = type.lowerBounds.singleOrNull()
    if (type is ParameterizedType && type.rawType == RetrofitResponse::class.java) type = type.actualTypeArguments.single()
    if (type is WildcardType) type = type.upperBounds.singleOrNull()
    return type?.takeUnless { it == ResponseBody::class.java || it == Unit::class.java || it == Void::class.java }
}

/**
 * Responses in a fixed order like MockWebServer.enqueue, but held back: no
 * network thread, every response is read against the DTO. For flows that depend on the
 * order of fetches rather than on the path.
 */
class RowsServer {
    /** A posed request, as RecordedRequest showed it. */
    class RecordedCall(val method: String, val path: String, val body: Buffer)

    private val paths = PathServer()
    private val series = ArrayDeque<Pair<Int, String>>()
    private val posed = ArrayDeque<RecordedCall>()
    val api: BrickApiService = paths.onTick()
    val requestCount: Int get() = paths.requests.size

    init {
        paths.priority = { method, path ->
            posed += RecordedCall(method, path, Buffer().writeUtf8(paths.bodyBytes.last()))
            series.removeFirstOrNull() ?: throw AssertionError("Keine Antwort mehr in der Reihe für $method $path")
        }
    }

    fun enqueue(response: MockResponse) {
        series += response.status.split(' ')[1].toInt() to response.getBody()?.readUtf8().orEmpty()
    }

    fun takeRequest(): RecordedCall = posed.removeFirst()

    fun checkReadIn() = paths.checkReadIn()

    fun shutdown() = paths.server.shutdown()
}
