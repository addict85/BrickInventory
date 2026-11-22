package ch.brickinventoryapp.state.testing

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.account.AccountView
import ch.brickinventoryapp.data.account.HouseholdRepository
import ch.brickinventoryapp.data.catalog.SetCatalogRepository
import ch.brickinventoryapp.data.collection.AlarmRepository
import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.collection.SetsRepository
import ch.brickinventoryapp.data.collection.WantedRepository
import ch.brickinventoryapp.data.local.StockReconciliation
import ch.brickinventoryapp.data.parts.MinifigsRepository
import ch.brickinventoryapp.data.parts.PartsRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.BrickApiService
import ch.brickinventoryapp.data.testing.FakeApi
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.TestStore
import ch.brickinventoryapp.data.testing.testAccountView
import ch.brickinventoryapp.data.testing.testAlarmRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetCatalogRepository
import ch.brickinventoryapp.data.testing.testSetFilesRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.data.testing.testStockReconciliation
import ch.brickinventoryapp.data.testing.testWantedRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.session.testing.testSession
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.state.ui.ScopeService
import ch.brickinventoryapp.state.ui.viewmodel.AppMessages
import ch.brickinventoryapp.state.ui.viewmodel.AreaFilter
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import okhttp3.mockwebserver.MockWebServer

/** Returns the resource number — the test checks WHICH text arrived. */
object NumbersTexts : Texts {
    override fun text(id: Int, vararg args: Any?) = "t$id"
    override fun quantity(id: Int, count: Int, vararg args: Any?) = "m$id:$count"
    override fun message(error: Outcome.Failure) = "fehler"
    override fun loggedIn() = true
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

    val session = testSession()
    val viewport = ScopeService(StorageStore(), testHouseholdRepository(api), testPartsRepository(api))
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
    val hints = AppMessages(messages, texts)

    /**
     * Setting a filter runs, like in the app, outside the ViewModel; [cleanUp] ends it.
     * Only on the first filter: tests create TestServices before setMain().
     */
    private val filterAreaLazy = lazy {
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    }
    private val filterArea by filterAreaLazy
    fun filter(): FilterChoice = AreaFilter(viewport, filterArea)

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

/**
 * A new process gets its own server with the same responses and
 * its own services. Fetches the old ViewModel still has in flight thus don't
 * end up in the new one's [requests] — otherwise arrival order would decide.
 */
fun <T> PathServer.newProcess(io: CoroutineDispatcher? = null, block: (PathServer, TestServices) -> T): T {
    val paths = PathServer(*responses.toList().toTypedArray())
    val t = if (io == null) TestServices(paths.server) else TestServices(paths.onTick(), io = io)
    try { return block(paths, t) } finally { t.cleanUp(); paths.server.shutdown() }
}
