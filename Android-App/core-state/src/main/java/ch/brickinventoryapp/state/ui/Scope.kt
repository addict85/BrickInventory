package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.session.Filterquelle
import ch.brickinventoryapp.model.domain.Kontoauswahl
import ch.brickinventoryapp.data.ScopeFilterStorage
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.model.domain.accountOptions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/** Where the chosen filters per view live — on the device a DataStore file, in the test a map. */
interface FilterStore {
    suspend fun konto(view: ScopeFilter.View): String
    suspend fun lager(view: ScopeFilter.View): String
    suspend fun setAccount(view: ScopeFilter.View, wert: String)
    suspend fun setzeLager(view: ScopeFilter.View, wert: String)
    suspend fun everythingForgotten()
}

class ScopeFilterStore @Inject constructor(
    private val speicher: ScopeFilterStorage,
) : FilterStore {
    override suspend fun konto(view: ScopeFilter.View) = speicher.flow(view).first()
    override suspend fun lager(view: ScopeFilter.View) = speicher.storageFlow(view).first()
    override suspend fun setAccount(view: ScopeFilter.View, wert: String) = speicher.set(view, wert)
    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) = speicher.setLager(view, wert)
    override suspend fun everythingForgotten() = speicher.resetAll()
}

/**
 * What the user is currently viewing: account filter per view, storage-location filter, the
 * household's accounts and the storage locations.
 *
 * A singleton, because gallery, parts, finances, wishlist and settings
 * show the same accounts and locations. Whoever changes a filter afterwards reloads its
 * own list; the Blickfeld service itself loads no inventory data.
 */
interface Scope : Filterquelle {
    val konten: StateFlow<ScopeUiState>
    val lager: StateFlow<LagerUiState>
    fun accountFor(view: ScopeFilter.View): Kontoauswahl?
    fun storageFor(view: ScopeFilter.View): String?
    suspend fun setAccount(view: ScopeFilter.View, wert: String)
    suspend fun setzeLager(view: ScopeFilter.View, wert: String)
    suspend fun loadStock(besitzer: List<Int>)
    suspend fun loginBegins()
    fun reset()
}

/** For tests without Hilt. */
fun Scope(
    ablage: FilterStore,
    haushalt: HouseholdRepository,
    teile: PartsRepository,
): Scope = ScopeService(ablage, haushalt, teile)

@Singleton
class ScopeService @Inject constructor(
    private val ablage: FilterStore,
    private val haushalt: HouseholdRepository,
    private val teile: PartsRepository,
) : Scope {
    private val _accounts = MutableStateFlow(ScopeUiState())
    override val konten: StateFlow<ScopeUiState> = _accounts.asStateFlow()

    private val _storage = MutableStateFlow(LagerUiState())
    override val lager: StateFlow<LagerUiState> = _storage.asStateFlow()

    /** Whose inventory the view shows, or null for „all accounts“. */
    override fun accountFor(view: ScopeFilter.View): Kontoauswahl? =
        Kontoauswahl.aus(ScopeFilter.asQuery(_accounts.value.scopeModes[view]))

    /** The value for `storage=`, or null for „all locations“. */
    override fun storageFor(view: ScopeFilter.View): String? = ScopeFilter.storageAsQuery(_storage.value.modi[view])

    override suspend fun setAccount(view: ScopeFilter.View, wert: String) {
        ablage.setAccount(view, wert)
        _accounts.update { it.copy(scopeModes = it.scopeModes + (view to wert)) }
    }

    override suspend fun setzeLager(view: ScopeFilter.View, wert: String) {
        ablage.setzeLager(view, wert)
        _storage.update { it.copy(modi = it.modi + (view to wert)) }
    }

    /** The remembered filters from the store — once after signing in. */
    override suspend fun loadFilter() {
        val konten = ScopeFilter.View.entries.associateWith { ablage.konto(it) }
        val lager = ScopeFilter.View.entries.associateWith { ablage.lager(it) }
        _accounts.update { it.copy(scopeModes = konten) }
        _storage.update { it.copy(modi = lager) }
    }

    /**
     * The household's accounts. A remembered filter on an account that no
     * longer belongs falls back to „all“ — otherwise the list would stay empty
     * without a visible filter explaining it.
     */
    override suspend fun loadMembers() {
        val r = haushalt.getHouseholdMembers() as? Ergebnis.Erfolg ?: return
        val mitglieder = r.data
        val erlaubt = accountOptions(mitglieder, "", "").map { it.first }
        _accounts.update { st ->
            st.copy(
                householdMembers = mitglieder,
                scopeModes = st.scopeModes.mapValues { (_, v) ->
                    if (erlaubt.isEmpty() || v in erlaubt) v else ScopeFilter.ALL
                },
            )
        }
    }

    /** The occupied locations in the gallery's Blickfeld — they feed the storage filter. */
    override suspend fun ladeLagerorte() {
        val r = teile.getLocations(accountFor(ScopeFilter.View.GALLERY))
        val orte = (r as? Ergebnis.Erfolg)?.data ?: return
        _storage.update { it.copy(orte = orte) }
    }

    /** The stock of a set's owners — suggestions for the storage-location field. */
    override suspend fun loadStock(besitzer: List<Int>) {
        val r = teile.getLocationStock(besitzer)
        val orte = (r as? Ergebnis.Erfolg)?.data ?: return
        _storage.update { it.copy(stock = orte) }
    }

    /** One's own locations including the default — for capture and management; what the store then has is shown. */
    override suspend fun loadOwnLocations() {
        teile.refreshLocationStock()
        val stock = teile.observeLocationStock().first().liste
        _storage.update {
            it.copy(eigene = stock.map { v -> v.ort }, vorgabe = stock.firstOrNull { v -> v.vorgabe }?.ort)
        }
    }

    /**
     * Every sign-in starts with „all accounts“: a filter that survives signing out
     * would make the collection look halved next time, with nothing pointing
     * to why. The same rule as in the web app.
     */
    override suspend fun loginBegins() {
        ablage.everythingForgotten()
        reset()
    }

    override fun reset() {
        _accounts.value = ScopeUiState()
        _storage.value = LagerUiState()
    }
}
