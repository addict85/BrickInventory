package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.WantedItemPricesView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedSort
import ch.brickinventoryapp.model.ui.Load

/**
 * The watchlist — what you'd like to have, separate from what you own. Its own state instead of
 * a field in AppUiState: it only changes on this screen, and a
 * field in the main state would recompose the whole tree on every load.
 */
data class WantedUiState(
    val wantedItem: List<WantedItemView> = emptyList(),
    /** The last fetch from the server; the list itself comes from the cache. */
    val fetch: Load<Unit> = Load.Data(Unit),
    // Three values here; the fourth, the owner, lives as in every view in
    // AppUiState.scopeModes — the same choice under the same key as in gallery, parts,
    // minifigures and finances.
    /** Search text — matches number AND name. Empty means: no filter. */
    val query: String = "",
    /** null: both conditions. */
    val stateFilter: Condition? = null,
    val sorting: WantedSort = WantedSort.DEFAULT,
)

/**
 * What a watchlist item's detail additionally needs — its own state as with the
 * set detail, because it only changes while exactly one detail is open. The
 * watchlist item itself isn't here: it lives in the loaded list, a second
 * copy would drift apart on delete or redeem.
 */
data class WantedItemDetailUiState(
    /**
     * Which set this detail shows — set as soon as loading starts, before any response.
     * setPriceAlert() recognizes from this that the screen is open and the alerts
     * may be refetched; the watchlist-item detail loads no SetDetail where that would otherwise
     * be visible.
     */
    val setNumber: String? = null,
    /** Thema, Teile, Minifiguren, BrickLink, Preisvergleich. */
    val catalog: CatalogDetailView? = null,
    /** The HISTORY. The current prices are in [prices] — see there. */
    val history: PriceHistoryView? = null,
    /**
     * The current market prices, freshly fetched. Separate from [history], because they come
     * from a different source and arrive earlier: the history only reads
     * price_cache, this response fills it — so the prices are there right away.
     */
    val prices: WantedItemPricesView? = null,
    val fetch: Load<Unit> = Load.Data(Unit),
    /** This set's price alerts — the same ones as in the set detail. */
    val priceAlarms: List<PriceAlertView> = emptyList(),
)
