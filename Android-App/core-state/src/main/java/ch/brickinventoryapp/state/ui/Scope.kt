package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.data.ScopeFilterStorage
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.accountOptions
import ch.brickinventoryapp.session.FilterSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/** Where the chosen filters per view live — on the device a DataStore file, in the test a map. */
interface FilterStore {
    suspend fun account(view: ScopeFilter.View): String
    suspend fun storage(view: ScopeFilter.View): String
    suspend fun setAccount(view: ScopeFilter.View, value: String)
    suspend fun applyStorage(view: ScopeFilter.View, value: String)
    suspend fun forgetAll()
}

class ScopeFilterStore @Inject constructor(
    private val memory: ScopeFilterStorage,
) : FilterStore {
    override suspend fun account(view: ScopeFilter.View) = memory.flow(view).first()
    override suspend fun storage(view: ScopeFilter.View) = memory.storageFlow(view).first()
    override suspend fun setAccount(view: ScopeFilter.View, value: String) = memory.set(view, value)
    override suspend fun applyStorage(view: ScopeFilter.View, value: String) = memory.setStorage(view, value)
    override suspend fun forgetAll() = memory.resetAll()
}

/**
 * What the user is currently viewing: account filter per view, storage-location filter, the
 * household's accounts and the storage locations.
 *
 * A singleton, because gallery, parts, finances, wishlist and settings
 * show the same accounts and locations. Whoever changes a filter afterwards reloads its
 * own list; the Blickfeld service itself loads no inventory data.
 */
interface Scope : FilterSource {
    val accounts: StateFlow<ScopeUiState>
    val storage: StateFlow<StorageUiState>
    fun accountFor(view: ScopeFilter.View): AccountSelection?
    fun storageFor(view: ScopeFilter.View): String?
    suspend fun setAccount(view: ScopeFilter.View, value: String)
    suspend fun applyStorage(view: ScopeFilter.View, value: String)
    suspend fun loadStock(owner: List<Int>)
    suspend fun loginBegins()
    fun reset()
}

/** For tests without Hilt. */
fun Scope(
    store: FilterStore,
    household: HouseholdRepository,
    parts: PartsRepository,
): Scope = ScopeService(store, household, parts)

@Singleton
class ScopeService @Inject constructor(
    private val store: FilterStore,
    private val household: HouseholdRepository,
    private val parts: PartsRepository,
) : Scope {
    private val _accounts = MutableStateFlow(ScopeUiState())
    override val accounts: StateFlow<ScopeUiState> = _accounts.asStateFlow()

    private val _storage = MutableStateFlow(StorageUiState())
    override val storage: StateFlow<StorageUiState> = _storage.asStateFlow()

    /** Whose inventory the view shows, or null for „all accounts“. */
    override fun accountFor(view: ScopeFilter.View): AccountSelection? =
        AccountSelection.from(ScopeFilter.asQuery(_accounts.value.scopeModes[view]))

    /** The value for `storage=`, or null for „all locations“. */
    override fun storageFor(view: ScopeFilter.View): String? = ScopeFilter.storageAsQuery(_storage.value.modes[view])

    override suspend fun setAccount(view: ScopeFilter.View, value: String) {
        store.setAccount(view, value)
        _accounts.update { it.copy(scopeModes = it.scopeModes + (view to value)) }
    }

    override suspend fun applyStorage(view: ScopeFilter.View, value: String) {
        store.applyStorage(view, value)
        _storage.update { it.copy(modes = it.modes + (view to value)) }
    }

    /** The remembered filters from the store — once after signing in. */
    override suspend fun loadFilter() {
        val accounts = ScopeFilter.View.entries.associateWith { store.account(it) }
        val storage = ScopeFilter.View.entries.associateWith { store.storage(it) }
        _accounts.update { it.copy(scopeModes = accounts) }
        _storage.update { it.copy(modes = storage) }
    }

    /**
     * The household's accounts. A remembered filter on an account that no
     * longer belongs falls back to „all“ — otherwise the list would stay empty
     * without a visible filter explaining it.
     */
    override suspend fun loadMembers() {
        val r = household.getHouseholdMembers() as? Outcome.Success ?: return
        val members = r.data
        val allowed = accountOptions(members, "", "").map { it.first }
        _accounts.update { st ->
            st.copy(
                householdMembers = members,
                scopeModes = st.scopeModes.mapValues { (_, v) ->
                    if (allowed.isEmpty() || v in allowed) v else ScopeFilter.ALL
                },
            )
        }
    }

    /** The occupied locations in the gallery's Blickfeld — they feed the storage filter. */
    override suspend fun fetchStorageLocations() {
        val r = parts.getLocations(accountFor(ScopeFilter.View.GALLERY))
        val locations = (r as? Outcome.Success)?.data ?: return
        _storage.update { it.copy(locations = locations) }
    }

    /** The stock of a set's owners — suggestions for the storage-location field. */
    override suspend fun loadStock(owner: List<Int>) {
        val r = parts.getLocationStock(owner)
        val locations = (r as? Outcome.Success)?.data ?: return
        _storage.update { it.copy(stock = locations) }
    }

    /** One's own locations including the default — for capture and management; what the store then has is shown. */
    override suspend fun loadOwnLocations() {
        parts.refreshLocationStock()
        val stock = parts.observeLocationStock().first().list
        _storage.update {
            it.copy(own = stock.map { v -> v.location }, default = stock.firstOrNull { v -> v.default }?.location)
        }
    }

    /**
     * Every sign-in starts with „all accounts“: a filter that survives signing out
     * would make the collection look halved next time, with nothing pointing
     * to why. The same rule as in the web app.
     */
    override suspend fun loginBegins() {
        store.forgetAll()
        reset()
    }

    override fun reset() {
        _accounts.value = ScopeUiState()
        _storage.value = StorageUiState()
    }
}
