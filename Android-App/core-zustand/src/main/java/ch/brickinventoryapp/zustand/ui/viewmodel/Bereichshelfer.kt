package ch.brickinventoryapp.zustand.ui.viewmodel

import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import ch.brickinventoryapp.model.fach.Kontoauswahl
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.zustand.ui.Scope
import ch.brickinventoryapp.zustand.ui.ScopeUiState
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.sitzung.Sitzung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Meldungen in den einen Kanal der App, samt den Texten, aus denen sie entstehen. */
interface Meldungen : Texte {
    /** Null zeigt nichts. */
    fun zeige(text: String?)

    /** Eine überholte Meldung zurücknehmen, etwa nach einem gelungenen zweiten Scan. */
    fun acknowledge()
}

/** Für Tests ohne Hilt. */
fun Meldungen(kanal: MeldungsKanal, texts: Texte): Meldungen = AppMessages(kanal, texts)

class AppMessages @Inject constructor(
    private val kanal: MeldungsKanal,
    texts: Texte,
) : Meldungen, Texte by texts {
    override fun zeige(text: String?) = kanal.zeige(text)
    override fun acknowledge() = kanal.acknowledge()
}

/**
 * Konto- und Lagerortfilter, wie ein Bereich sie zeigt und setzt. Die Bildschirme
 * lesen `blickfeld` und `storageState` am ViewModel; dieses reicht die Filterwahl
 * per Delegation durch, statt sie von einer Basisklasse zu erben.
 */
interface Filterwahl {
    val blickfeld: StateFlow<ScopeUiState>
    val storageState: StateFlow<LagerUiState>

    /** Der Wert für `accounts=`, oder null für „alle Konten“. */
    fun accountFor(view: ScopeFilter.View): Kontoauswahl?

    /** Der Wert für `storage=`, oder null für „alle Orte“. */
    fun storageFor(view: ScopeFilter.View): String?

    fun setScope(view: ScopeFilter.View, value: String)
    fun setStorageFilter(view: ScopeFilter.View, value: String)

    /** Vorschläge fürs Lagerortfeld: die Orte der Besitzer des gezeigten Eintrags. */
    fun loadLocationStock(besitzer: List<Int>)

    /** Die eigenen Orte samt Vorgabe — für die Erfassungsdialoge. */
    fun loadOwnLocations()

    /** Für Bereiche, die nach dem Setzen ihre Liste neu laden. */
    suspend fun setAccount(view: ScopeFilter.View, value: String)
    suspend fun setzeLager(view: ScopeFilter.View, value: String)

    /** Nach einer Änderung im Bereich, deren Ergebnis der Aufrufer abwartet. */
    suspend fun loadMembers()
    suspend fun ladeLagerorte()
    suspend fun ownLocationsNew()
}

/** Für Tests ohne Hilt. */
fun Filterwahl(dienst: Scope, bereich: CoroutineScope): Filterwahl = AreaFilter(dienst, bereich)

/**
 * Im Bereich der App: Ein Filter, den jemand gesetzt hat, wird gemerkt, auch wenn
 * der Bildschirm gleich danach verschwindet. Der Blickfeld-Zustand ist ein
 * Singleton und verträgt jeden Faden.
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
 * Nach einer Abmeldung leert der Bereich, was dem vorigen Konto gehörte; der
 * nächste Nutzer auf demselben Gerät sähe es sonst. drop(1): Der Zähler steht
 * beim Sammeln schon auf seinem Wert, und der ist keine neue Abmeldung.
 */
fun ViewModel.sequenceSignOut(sitzung: Sitzung, reset: () -> Unit) {
    viewModelScope.launch { sitzung.signOuts.drop(1).collect { reset() } }
}

/**
 * Lädt, sobald [zustand] seinen ersten Beobachter bekommt, und wieder nach jeder Pause ohne:
 * Das Betreten der Seite stösst das Laden an, nicht ein LaunchedEffect des Bildschirms.
 * Kein stateIn, damit `.value` auch ohne Beobachter stimmt.
 */
fun ViewModel.observeLoadOn(zustand: MutableStateFlow<*>, laden: () -> Unit) {
    viewModelScope.launch {
        zustand.subscriptionCount.map { it > 0 }.distinctUntilChanged().collect { if (it) laden() }
    }
}

/**
 * Lädt, solange [zustand] beobachtet wird, für jede Serveradresse einmal: beim Betreten der
 * Seite und wieder, wenn die Adresse wechselt, während sie offen ist. Ohne Adresse nichts.
 */
fun ViewModel.loadPerServer(sitzung: Sitzung, zustand: MutableStateFlow<*>, laden: () -> Unit) =
    loadPerServer(sitzung, zustand.subscriptionCount, laden)

/** Dasselbe für einen durchgereichten Fluss. */
fun ViewModel.loadPerServer(sitzung: Sitzung, zustand: Observed<*>, laden: () -> Unit) =
    loadPerServer(sitzung, zustand.observer, laden)

/** Wie [observeLoadOn] für einen durchgereichten Fluss. */
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
 * Ein fremder Zustand mit gezählten Beobachtern: So kann ein ViewModel beim Betreten der Seite
 * laden, auch wenn es den Fluss nur durchreicht (etwa die Sitzung), oder je Eintrag, den die
 * Seite zeigt ([observeOn] läuft, sobald der erste Beobachter kommt).
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
