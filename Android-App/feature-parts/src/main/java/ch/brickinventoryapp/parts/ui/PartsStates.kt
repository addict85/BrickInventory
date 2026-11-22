package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.ComponentHeaderView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.FigureOrder
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.UsingSetView
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.session.AppUiState
import java.io.Serializable

/**
 * What the parts list filters by and how it shows them — a single value that lives as a whole in
 * the SavedStateHandle and comes back after a process death. Every loader reads it from
 * the state, never as a parameter: otherwise `onLoadMore` would attach an unfiltered page.
 * Account and storage location are not part of it; they stay only in memory (the view).
 */
data class PartsFilter(
    val search: String = "",
    /** Like the web app's parts-spare. */
    val spare: SparePartChoice = SparePartChoice.ALL,
    /** Cards or table; the table also fetches "In Sets" (`with_sets=1`), hence in the filter. */
    val view: ListView = ListView.CARDS,
    /** Sorting happens in the view; the list is already fully loaded. */
    val order: Order = Order.COLOR,
    /** The color name travels along as `color=`. */
    val color: ColorPicker = ColorPicker.All,
    /** The value (`category_name`), not the label: the server filters by it. */
    val category: CategoryChoice = CategoryChoice.All,
) : Serializable {
    /** The web app's three sort orders; the rules live in sorted() (PartsOrder.kt). */
    enum class Order { COLOR, NAME, QUANTITY }

    private companion object {
        // Fixed, otherwise the JVM would compute the id from the class shape, and every new
        // version of the app would discard the remembered filter.
        private const val serialVersionUID: Long = 2L
    }
}

/** The parts tab: list, filter with its selection lists, key figures. */
data class PartsUiState(
    val parts: List<PartView> = emptyList(),
    /**
     * The manually entered parts (/parts/manual). null means "not loaded yet", empty
     * "none present": the scroll position waits for the list, even when it is empty.
     */
    val manualParts: List<ManualPartView>? = null,
    val partsTotal: Int = 0,
    val partsPage: Int = 1,
    val filter: PartsFilter = PartsFilter(),
    /** The choice of the two filters with counts (/parts/colors and /parts/categories). */
    val partsFilterColors: List<FilterColorView> = emptyList(),
    val partsCategories: List<CategoryView> = emptyList(),
    /** The last fetch; the list comes from the store and stays as is. */
    val partsFetch: Load<Unit> = Load.Data(Unit),
    /** Parts list from disk storage: the time it was stored, otherwise null. */
    val partsOfflineStatus: Long? = null,
    val partsStats: PartsMetricsView? = null,
    /** All colors for the entry dialog. */
    val partsColors: List<ColorView> = emptyList(),
)

/** The figures tab: a state of its own, so that paging through the parts does not redraw it. */
data class MinifigsUiState(
    val minifigs: List<FigureView> = emptyList(),
    /** The manually entered figures, null as for [PartsUiState.manualParts]. */
    val manualFigs: List<ManualMinifigView>? = null,
    /** Key figures of the tiles — from the server, not from the (filtered) list. */
    val minifigStats: MinifigsMetricsView = MinifigsMetricsView(),
    val minifigsFetch: Load<Unit> = Load.Data(Unit),
    val minifigsOfflineStatus: Long? = null,
    /** The search happens on the server before grouping; a second search in the screen would hit different things. */
    val minifigsQuery: String = "",
    val minifigsView: ListView = ListView.CARDS,
    val order: FigureOrder = FigureOrder.DEFAULT,
)

/**
 * The detail dialog for a part or figure from a set: zoom, quantity read-only
 * only, and which sets it is in. Its own flow, because the dialog
 * produces interim states that concerned every tab; `open == null` means: no
 * dialog. One state for both, because the server delivers the same shape.
 */
data class SetItemUiState(
    /** null means: the dialog is closed. */
    val kind: ItemKind? = null,
    val number: String = "",
    val colorId: Int = WITHOUT_COLOR,
    val fetch: Load<Unit> = Load.Data(Unit),
    val header: ComponentHeaderView? = null,
    val sets: List<UsingSetView> = emptyList(),
) {
    val open: Boolean get() = kind != null
}

/**
 * The build list in the ViewModel: a rotation rebuilds the screen, the generated list
 * and a running fetch stay. The set numbers survive even a process end
 * (SavedStateHandle), the parts do not — a thousand rows would blow up the bundle.
 */
data class PartListUiState(
    val sets: List<PlSet> = emptyList(),
    val parts: List<PlPart> = emptyList(),
    val generated: Boolean = false,
    /** Generating the list; errors on individual sets are named by [status]. */
    val generating: Load<Unit> = Load.Data(Unit),
    /** Progress, result or error of the last action; null means nothing to say. */
    val status: Message? = null,
    val onlyLose: Boolean = false,
    val withSubAccounts: Boolean = false,
    /** The comparison with one's own stock; its result is named by [status]. */
    val stock: Operation = Operation.Done,
    val pdf: Operation = Operation.Done,
    /** Finished PDF that the screen offers once to open. */
    val pdfFile: java.io.File? = null,
    /** The set just taken off the list, as long as „Undo“ is offered. */
    val removed: RemovedSet? = null,
) {
    /**
     * A removed set and the list as it stood before: „Undo“ restores exactly that list,
     * including the generated parts, as long as nothing else changed in between.
     */
    data class RemovedSet(val set: PlSet, val before: List<PlSet>, val wasGenerated: Boolean)
}

/**
 * What parts and figures read from the session: server for the images, currency and
 * the preselected condition when entering. Not the whole session, so that a
 * change to sign-in or theme does not redraw the lists.
 */
internal data class PartsSessionUiState(
    val serverUrl: String = "",
    val currency: CurrencyCode = CurrencyCode.EUR,
    val userDefaultCondition: Condition? = null,
)

internal fun partsSession(s: AppUiState) = PartsSessionUiState(s.serverUrl, s.currency, s.userDefaultCondition)
