package ch.brickinventoryapp.state.ui.viewmodel

import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import ch.brickinventoryapp.model.domain.AccountSelection
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.session.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Notifications into the app's one channel, along with the strings they're built from. */
interface Messages : Texts {
    /** Null zeigt nichts. */
    fun show(text: String?)

    /** Retract an outdated notification, e.g. after a successful second scan. */
    fun acknowledge()
}

/** For tests without Hilt. */
fun Messages(channel: MessageChannel, texts: Texts): Messages = AppMessages(channel, texts)

class AppMessages @Inject constructor(
    private val channel: MessageChannel,
    texts: Texts,
) : Messages, Texts by texts {
    override fun show(text: String?) = channel.show(text)
    override fun acknowledge() = channel.acknowledge()
}

/**
 * Account and storage-location filter, as a scope displays and sets them. The screens
 * read `viewport` and `storageState` on the ViewModel; this passes the filter choice
 * through by delegation, instead of inheriting it from a base class.
 */
interface FilterChoice {
    val viewport: StateFlow<ScopeUiState>
    val storageState: StateFlow<StorageUiState>

    /** The value for `accounts=`, or null for „all accounts“. */
    fun accountFor(view: ScopeFilter.View): AccountSelection?

    /** The value for `storage=`, or null for „all locations“. */
    fun storageFor(view: ScopeFilter.View): String?

    fun setScope(view: ScopeFilter.View, value: String)
    fun setStorageFilter(view: ScopeFilter.View, value: String)

    /** Suggestions for the storage-location field: the locations of the owners of the shown entry. */
    fun loadLocationStock(owner: List<Int>)

    /** One's own locations including the default — for the capture dialogs. */
    fun loadOwnLocations()

    /** For scopes that reload their list after setting it. */
    suspend fun setAccount(view: ScopeFilter.View, value: String)
    suspend fun applyStorage(view: ScopeFilter.View, value: String)

    /** After a change in the scope whose result the caller waits for. */
    suspend fun loadMembers()
    suspend fun fetchStorageLocations()
    suspend fun ownLocationsNew()
}

/** For tests without Hilt. */
fun FilterChoice(service: Scope, area: CoroutineScope): FilterChoice = AreaFilter(service, area)

/**
 * In the app's scope: a filter that someone set is remembered, even if
 * the screen disappears right after. The Blickfeld state is a
 * singleton and tolerates any thread.
 */
class AreaFilter @Inject constructor(
    private val service: Scope,
    @param:ApplicationScope private val area: CoroutineScope,
) : FilterChoice {
    override val viewport: StateFlow<ScopeUiState> = service.accounts
    override val storageState: StateFlow<StorageUiState> = service.storage
    override fun accountFor(view: ScopeFilter.View) = service.accountFor(view)
    override fun storageFor(view: ScopeFilter.View) = service.storageFor(view)
    override fun setScope(view: ScopeFilter.View, value: String) { area.launch { setAccount(view, value) } }
    override fun setStorageFilter(view: ScopeFilter.View, value: String) { area.launch { applyStorage(view, value) } }
    override fun loadLocationStock(owner: List<Int>) { area.launch { service.loadStock(owner) } }
    override fun loadOwnLocations() { area.launch { service.loadOwnLocations() } }
    override suspend fun setAccount(view: ScopeFilter.View, value: String) = service.setAccount(view, value)
    override suspend fun applyStorage(view: ScopeFilter.View, value: String) = service.applyStorage(view, value)
    override suspend fun loadMembers() = service.loadMembers()
    override suspend fun fetchStorageLocations() = service.fetchStorageLocations()
    override suspend fun ownLocationsNew() = service.loadOwnLocations()
}

/**
 * After a sign-out, the scope clears whatever belonged to the previous account; the
 * next user on the same device would otherwise see it. drop(1): the counter already
 * stands at its value when collecting starts, and that is not a new sign-out.
 */
fun ViewModel.logoutSequence(session: Session, reset: () -> Unit) {
    viewModelScope.launch { session.logouts.drop(1).collect { reset() } }
}

/**
 * Loads as soon as [condition] gets its first observer, and again after every pause without one:
 * entering the page triggers the load, not a LaunchedEffect of the screen.
 * No stateIn, so `.value` is correct even without an observer.
 */
fun ViewModel.observeLoadOn(condition: MutableStateFlow<*>, load: () -> Unit) {
    viewModelScope.launch {
        condition.subscriptionCount.map { it > 0 }.distinctUntilChanged().collect { if (it) load() }
    }
}

/**
 * Loads as long as [condition] is observed, once per server address: on entering the
 * page, and again if the address changes while it's open. Nothing without an address.
 */
fun ViewModel.loadPerServer(session: Session, condition: MutableStateFlow<*>, load: () -> Unit) =
    loadPerServer(session, condition.subscriptionCount, load)

/** The same for a passed-through flow. */
fun ViewModel.loadPerServer(session: Session, condition: Observed<*>, load: () -> Unit) =
    loadPerServer(session, condition.observer, load)

/** Like [observeLoadOn] for a passed-through flow. */
fun ViewModel.observeLoadOn(condition: Observed<*>, load: () -> Unit) {
    viewModelScope.launch {
        condition.observer.map { it > 0 }.distinctUntilChanged().collect { if (it) load() }
    }
}

private fun ViewModel.loadPerServer(session: Session, observer: StateFlow<Int>, load: () -> Unit) {
    viewModelScope.launch {
        observer.map { it > 0 }.distinctUntilChanged().collectLatest { observed ->
            if (observed) session.state.map { it.serverUrl }.distinctUntilChanged().filter { it.isNotBlank() }.collect { load() }
        }
    }
}

/**
 * A foreign state with counted observers: this way a ViewModel can load on entering the page,
 * even if it only passes the flow through (e.g. the session), or per entry that the
 * page displays ([observeOn] runs as soon as the first observer arrives).
 */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
class Observed<T>(private val source: StateFlow<T>, private val observeOn: () -> Unit = {}) : StateFlow<T> {
    private val counter = MutableStateFlow(0)
    val observer: StateFlow<Int> = counter.asStateFlow()
    override val value: T get() = source.value
    override val replayCache: List<T> get() = source.replayCache
    override suspend fun collect(collector: FlowCollector<T>): Nothing {
        if (counter.getAndUpdate { it + 1 } == 0) observeOn()
        try {
            source.collect(collector)
        } finally {
            counter.update { it - 1 }
        }
    }
}
