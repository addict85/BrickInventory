package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.PurchaseSumsView
import ch.brickinventoryapp.model.domain.PurchaseView
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.ui.Load

/**
 * Gallery: list, filter, paging state and figures. Its own flow, because
 * the gallery changes most often and only a few screens read it; in
 * AppUiState, everything else would redraw on every page.
 */
data class GalleryUiState(
    val sets: List<SetView> = emptyList(),
    /** Gallery filter, as configured; the source (cache or account view) evaluates it. */
    val galleryQuery: String = "",
    val galleryTheme: String = "",
    val gallerySort: SetSort = SetSort.DEFAULT,
    /** Themes of the whole inventory, from the unfiltered list. */
    val galleryThemes: List<String> = emptyList(),
    val galleryTotal: Int = 0,
    /**
     * The source is being filled; the list is already there, as far as it's cached. Without the
     * error, a load error looked like an empty collection.
     */
    val fetch: Load<Unit> = Load.Data(Unit),
    /** List from disk storage instead of the server: the cache's timestamp, else null. */
    val offlineStatus: Long? = null,
    val stats: MetricsView? = null,
)

/**
 * Set detail — its own flow: price and history fetches would otherwise redraw
 * everything AppUiState reads, even though only SetDetailScreen needs them.
 */
data class SetDetailUiState(
    val setDetail: SetView? = null,
    /** Without a detail and without a preview from the gallery, the spinner would stay otherwise. */
    val detailFetch: Load<Unit> = Load.Data(Unit),
    val setPrice: SetPriceView? = null,
    /** Price and history fail on their own; the card says so instead of staying empty. */
    val priceFetch: Load<Unit> = Load.Data(Unit),
    // The whole response instead of individual fields: since the
    // server change it carries both history series, the ready-made chart data, the
    // current prices and the valuation per condition. Pulled out
    // individually, every new field would have to be updated here AND in loadHistory —
    // the response is already the model.
    val priceHistory: PriceHistoryView? = null,
    val historyFetch: Load<Unit> = Load.Data(Unit),
    /**
     * This set's price alerts, at most two (new and used). Loaded separate from the set,
     * because they belong to the account: two people with the same set have
     * different alerts.
     */
    val priceAlarms: List<PriceAlertView> = emptyList(),
    val acquisitions: List<PurchaseView> = emptyList(),
    /**
     * Total row of the purchases — calculated by the server, not here.
     * The view only displays it; the rule lives in `utils/acquisitions.ts`.
     */
    val acquisitionTotals: PurchaseSumsView = PurchaseSumsView(),
    val purchasesFetch: Load<Unit> = Load.Data(Unit),
)
