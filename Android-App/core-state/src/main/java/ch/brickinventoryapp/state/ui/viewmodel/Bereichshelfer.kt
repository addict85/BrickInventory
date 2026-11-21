package ch.brickinventoryapp.state.ui.viewmodel

import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import ch.brickinventoryapp.model.domain.Kontoauswahl
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.session.Sitzung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Notifications into the app's one channel, along with the strings they're built from. */
interface Meldungen : Texte {
    /** Null zeigt nichts. */
    fun zeige(text: String?)

    /** Retract an outdated notification, e.g. after a successful second scan. */
    fun acknowledge()
}

/** For tests without Hilt. */
fun Meldungen(kanal: MeldungsKanal, texts: Texte): Meldungen = AppMessages(kanal, texts)

class AppMessages @Inject constructor(
    private val kanal: MeldungsKanal,
    texts: Texte,
) : Meldungen, Texte by texts {
    override fun zeige(text: String?) = kanal.zeige(text)
    override fun acknowledge() = kanal.acknowledge()
}

/**
 * Account and storage-location filter, as a scope displays and sets them. The screens
 * read `blickfeld` and `storageState` on the ViewModel; this passes the filter choice
 * through by delegation, instead of inheriting it from a base class.
 */
interface Filterwahl {
    val blickfeld: StateFlow<ScopeUiState>
    val storageState: StateFlow<LagerUiState>

    /** The value for `accounts=`, or null for „all accounts“. */
    fun accountFor(view: ScopeFilter.View): Kontoauswahl?

    /** The value for `storage=`, or null for „all locations“. */
    fun storageFor(view: ScopeFilter.View): String?

    fun setScope(view: ScopeFilter.View, value: String)
    fun setStorageFilter(view: ScopeFilter.View, value: String)

    /** Suggestions for the storage-location field: the locations of the owners of the shown entry. */
    fun loadLocationStock(besitzer: List<Int>)

    /** One's own locations including the default — for the capture dialogs. */
    fun loadOwnLocations()

    /** For scopes that reload their list after setting it. */
    suspend fun setAccount(view: ScopeFilter.View, value: String)
    suspend fun setzeLager(view: ScopeFilter.View, value: String)

    /** After a change in the scope whose result the caller waits for. */
    suspend fun loadMembers()
    suspend fun ladeLagerorte()
    suspend fun ownLocationsNew()
}

/** For tests without Hilt. */
fun Filterwahl(dienst: Scope, bereich: CoroutineScope): Filterwahl = AreaFilter(dienst, bereich)

/**
 * In the app's scope: a filter that someone set is remembered, even if
 * the screen disappears right after. The Blickfeld state is a
 * singleton and tolerates any thread.
 */
class AreaFilter @Inject constructor(
    private val dienst: Scope,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : Filterwahl {
    override val blickfeld: StateFlow<ScopeUiState> = dienst.konten
    override val storageState: StateFlow<LagerUiState> = dienst.lager
    override fun accountFor(view: ScopeFilter.View) = dienst.accountFor(view)
    override fun storageFor(view: ScopeFilter.View) = dienst.storageFor(view)
    override fun setScope(view: ScopeFilter.View, value: String) { bereich.launch { setAccount(view, value) } }
    override fun setStorageFilter(view: ScopeFilter.View, value: String) { bereich.launch { setzeLager(view, value) } }
    override fun loadLocationStock(besitzer: List<Int>) { bereich.launch { dienst.loadStock(besitzer) } }
    override fun loadOwnLocations() { bereich.launch { dienst.loadOwnLocations() } }
    override suspend fun setAccount(view: ScopeFilter.View, value: String) = dienst.setAccount(view, value)
    override suspend fun setzeLager(view: ScopeFilter.View, value: String) = dienst.setzeLager(view, value)
    override suspend fun loadMembers() = dienst.loadMembers()
    override suspend fun ladeLagerorte() = dienst.ladeLagerorte()
    override suspend fun ownLocationsNew() = dienst.loadOwnLocations()
}

/**
 * After a sign-out, the scope clears whatever belonged to the previous account; the
 * next user on the same device would otherwise see it. drop(1): the counter already
 * stands at its value when collecting starts, and that is not a new sign-out.
 */
fun ViewModel.sequenceSignOut(sitzung: Sitzung, reset: () -> Unit) {
    viewModelScope.launch { sitzung.signOuts.drop(1).collect { reset() } }
}

/**
 * Loads as soon as [zustand] gets its first observer, and again after every pause without one:
 * entering the page triggers the load, not a LaunchedEffect of the screen.
 * No stateIn, so `.value` is correct even without an observer.
 */
fun ViewModel.observeLoadOn(zustand: MutableStateFlow<*>, laden: () -> Unit) {
    viewModelScope.launch {
        zustand.subscriptionCount.map { it > 0 }.distinctUntilChanged().collect { if (it) laden() }
    }
}

/**
 * Loads as long as [zustand] is observed, once per server address: on entering the
 * page, and again if the address changes while it's open. Nothing without an address.
 */
fun ViewModel.loadPerServer(sitzung: Sitzung, zustand: MutableStateFlow<*>, laden: () -> Unit) =
    loadPerServer(sitzung, zustand.subscriptionCount, laden)

/** The same for a passed-through flow. */
fun ViewModel.loadPerServer(sitzung: Sitzung, zustand: Observed<*>, laden: () -> Unit) =
    loadPerServer(sitzung, zustand.observer, laden)

/** Like [observeLoadOn] for a passed-through flow. */
fun ViewModel.observeLoadOn(zustand: Observed<*>, laden: () -> Unit) {
    viewModelScope.launch {
        zustand.observer.map { it > 0 }.distinctUntilChanged().collect { if (it) laden() }
    }
}

private fun ViewModel.loadPerServer(sitzung: Sitzung, observer: StateFlow<Int>, laden: () -> Unit) {
    viewModelScope.launch {
        observer.map { it > 0 }.distinctUntilChanged().collectLatest { beobachtet ->
            if (beobachtet) sitzung.state.map { it.serverUrl }.distinctUntilChanged().filter { it.isNotBlank() }.collect { laden() }
        }
    }
}

/**
 * A foreign state with counted observers: this way a ViewModel can load on entering the page,
 * even if it only passes the flow through (e.g. the session), or per entry that the
 * page displays ([observeOn] runs as soon as the first observer arrives).
 */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
class Observed<T>(private val quelle: StateFlow<T>, private val observeOn: () -> Unit = {}) : StateFlow<T> {
    private val counter = MutableStateFlow(0)
    val observer: StateFlow<Int> = counter.asStateFlow()
    override val value: T get() = quelle.value
    override val replayCache: List<T> get() = quelle.replayCache
    override suspend fun collect(collector: FlowCollector<T>): Nothing {
        if (counter.getAndUpdate { it + 1 } == 0) observeOn()
        try {
            quelle.collect(collector)
        } finally {
            counter.update { it - 1 }
        }
    }
}
