package ch.brickinventoryapp.data.account

import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.asQuery
import ch.brickinventoryapp.data.api.withSetsAsQuery
import ch.brickinventoryapp.data.repository.allPages
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.dataapi.account.AccountView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.offline.Domain
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Page size of the gallery, as in the web app (`public/js/collection.js`): two
 * sizes would give two scrolling experiences for the same stock.
 */
internal const val GALLERY_PAGE_SIZE = 60

/**
 * The view over selected accounts, storage locations or with „In Sets“: quantities and
 * prices per account are split only by the server, the local row carries the sum
 * of all. Hence an own read model next to the store, not a second
 * path to the same lists.
 */
@Singleton
internal class StoreAccountView @Inject constructor(
    private val sets: SetsApi,
    private val parts: PartsApi,
    private val figures: MinifigsApi,
    store: OfflineStore,
    private val retry: RetryPolicy,
) : AccountView {
    /**
     * A read model only the server fills: the most recently requested list in
     * memory, never in Room. If the store changes ([trigger]), it asks the
     * server anew — a write thus shows up here too, without a signal.
     */
    class ServerList<A, T>(
        private val store: OfflineStore,
        private val trigger: Array<Domain<*>>,
        private val clock: () -> Long = System::currentTimeMillis,
        private val fetch: suspend (A) -> Outcome<List<T>>,
    ) : AccountView.ServerView<A, T> {
        private data class Item<A, T>(val area: String, val query: A, val list: Local<T>)

        private val last = MutableStateFlow<Item<A, T>?>(null)

        /** Never loaded means state null, as in the store; a response for a different account does not count. */
        override fun observe(query: A): Flow<Local<T>> = channelFlow {
            launch { store.altered(*trigger).collectLatest { refresh(query) } }
            launch {
                last.map { e ->
                    if (e == null || e.query != query || e.area != store.area()) Local(emptyList(), null) else e.list
                }.distinctUntilChanged().collect { send(it) }
            }
            awaitClose()
        }

        override suspend fun refresh(query: A): Outcome<Unit> {
            val before = store.area() ?: return Outcome.Success(Unit)
            return when (val r = fetch(query)) {
                is Outcome.Success -> {
                    if (store.area() == before) last.value = Item(before, query, Local(r.data, clock()))
                    Outcome.Success(Unit)
                }
                is Outcome.Failure -> r
            }
        }
    }

    override val gallery = ServerList<AccountView.SetsQuery, SetView>(store, arrayOf(Slots.SETS)) { a: AccountView.SetsQuery ->
        allPages({ it.sets }, { it.setNumber }, { it.total }, retry) { page ->
            safeCall { sets.getSets(a.accounts?.request, a.search, a.theme, a.sort?.identifier, page, GALLERY_PAGE_SIZE, a.storageLocation) }
        }.mapData { l -> l.map { it.asView() } }
    }

    override val wantedList = ServerList<AccountView.RememberQuery, WantedItemView>(store, arrayOf(Slots.WANTED_LIST)) { a: AccountView.RememberQuery ->
        retry.retry {
            safeCall { sets.getWantedList(a.search, a.condition?.identifier, a.sort?.identifier, a.accounts.request) }
        }.mapData { r -> r.item.map { it.asView() } }
    }

    override val partList = ServerList<AccountView.PartsQuery, PartView>(store, arrayOf(Slots.PARTS)) { a: AccountView.PartsQuery ->
        allPages({ it.parts }, { "${it.partNumber}|${it.colorId}|${it.isSpare}" }, { it.total }, retry) { page ->
            safeCall {
                parts.getParts(search = a.search, color = a.color.value, category = a.category.value, page = page, pageSize = 500, excludeManual = "1", accounts = a.accounts?.request,
                    spare = a.spareParts.asQuery(), withSets = withSetsAsQuery(a.withSets), storage = a.storageLocation)
            }
        }.mapData { l -> l.map { it.asView() } }
    }

    override val manualParts = ServerList<AccountView.ManualQuery, ManualPartView>(store, arrayOf(Slots.MANUAL_PARTS)) { a: AccountView.ManualQuery ->
        retry.retry { safeCall { parts.getManualParts(a.accounts?.request, a.search, a.storageLocation) } }
            .mapData { r -> r.parts.map { it.asView() } }
    }

    override val figureList = ServerList<AccountView.MinifigsQuery, FigureView>(store, arrayOf(Slots.FIGURES)) { a: AccountView.MinifigsQuery ->
        retry.retry {
            safeCall { figures.getMinifigs(source = "set", accounts = a.accounts.request, search = a.search) }
        }.mapData { r -> r.figs.map { it.asView() } }
    }

    override val manualMinifigs = ServerList<AccountView.MinifigsQuery, ManualMinifigView>(store, arrayOf(Slots.MANUAL_FIGURES)) { a: AccountView.MinifigsQuery ->
        retry.retry { safeCall { figures.getManualMinifigs(a.accounts.request, a.search) } }
            .mapData { r -> r.figs.map { it.asView() } }
    }
}
