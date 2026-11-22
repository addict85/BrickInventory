package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.ComponentHeaderView
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.Figurenordnung
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.UsingSetView
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.ListView
import java.io.Serializable

/**
 * What the parts list filters by and how it shows them — a single value that lives as a whole in
 * the SavedStateHandle and comes back after a process death. Every loader reads it from
 * the state, never as a parameter: otherwise `onLoadMore` would attach an unfiltered page.
 * Account and storage location are not part of it; they stay only in memory (the view).
 */
data class Teilefilter(
    val suche: String = "",
    /** Like the web app's parts-spare. */
    val ersatz: Ersatzteilwahl = Ersatzteilwahl.ALLE,
    /** Cards or table; the table also fetches "In Sets" (`with_sets=1`), hence in the filter. */
    val ansicht: ListView = ListView.KARTEN,
    /** Sorting happens in the view; the list is already fully loaded. */
    val order: Order = Order.FARBE,
    /** The color name travels along as `color=`. */
    val farbe: ColorPicker = ColorPicker.Alle,
    /** The value (`category_name`), not the label: the server filters by it. */
    val kategorie: Kategoriewahl = Kategoriewahl.Alle,
) : Serializable {
    /** The web app's three sort orders; the rules live in sortiert() (TeileOrdnung.kt). */
    enum class Order { FARBE, NAME, QUANTITY }

    private companion object {
        // Fixed, otherwise the JVM would compute the id from the class shape, and every new
        // version of the app would discard the remembered filter.
        private const val serialVersionUID: Long = 2L
    }
}

/** The parts tab: list, filter with its selection lists, key figures. */
data class PartsUiState(
    val parts: List<TeilAnsicht> = emptyList(),
    /**
     * The manually entered parts (/parts/manual). null means "not loaded yet", empty
     * "none present": the scroll position waits for the list, even when it is empty.
     */
    val manualParts: List<ManualPartView>? = null,
    val partsTotal: Int = 0,
    val partsPage: Int = 1,
    val filter: Teilefilter = Teilefilter(),
    /** The choice of the two filters with counts (/parts/colors and /parts/categories). */
    val partsFilterColors: List<FilterColorView> = emptyList(),
    val partsCategories: List<CategoryView> = emptyList(),
    /** The last fetch; the list comes from the store and stays as is. */
    val partsFetch: Laden<Unit> = Laden.Daten(Unit),
    /** Parts list from disk storage: the time it was stored, otherwise null. */
    val partsOfflineStatus: Long? = null,
    val partsStats: PartsMetricsView? = null,
    /** All colors for the entry dialog. */
    val partsColors: List<ColorView> = emptyList(),
)

/** The figures tab: a state of its own, so that paging through the parts does not redraw it. */
data class MinifigsUiState(
    val minifigs: List<FigurAnsicht> = emptyList(),
    /** The manually entered figures, null as for [PartsUiState.manualParts]. */
    val manualFigs: List<ManualMinifigView>? = null,
    /** Key figures of the tiles — from the server, not from the (filtered) list. */
    val minifigStats: MinifigsMetricsView = MinifigsMetricsView(),
    val minifigsFetch: Laden<Unit> = Laden.Daten(Unit),
    val minifigsOfflineStatus: Long? = null,
    /** The search happens on the server before grouping; a second search in the screen would hit different things. */
    val minifigsQuery: String = "",
    val minifigsView: ListView = ListView.KARTEN,
    val order: Figurenordnung = Figurenordnung.DEFAULT,
)

/**
 * The detail dialog for a part or figure from a set: zoom, quantity read-only
 * only, and which sets it is in. Its own flow, because the dialog
 * produces interim states that concerned every tab; `offen == null` means: no
 * dialog. One state for both, because the server delivers the same shape.
 */
data class SetItemUiState(
    /** null means: the dialog is closed. */
    val art: Postenart? = null,
    val nummer: String = "",
    val colorId: Int = OHNE_FARBE,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    val kopf: ComponentHeaderView? = null,
    val sets: List<UsingSetView> = emptyList(),
) {
    val offen: Boolean get() = art != null
}

/**
 * The build list in the ViewModel: a rotation rebuilds the screen, the generated list
 * and a running fetch stay. The set numbers survive even a process end
 * (SavedStateHandle), the parts do not — a thousand rows would blow up the bundle.
 */
data class TeilelisteUiState(
    val sets: List<PlSet> = emptyList(),
    val parts: List<PlPart> = emptyList(),
    val generated: Boolean = false,
    /** Generating the list; errors on individual sets are named by [status]. */
    val erzeugen: Laden<Unit> = Laden.Daten(Unit),
    /** Progress, result or error of the last action; null means nothing to say. */
    val status: Meldung? = null,
    val onlyLose: Boolean = false,
    val withSubAccounts: Boolean = false,
    /** The comparison with one's own stock; its result is named by [status]. */
    val bestand: Vorgang = Vorgang.Fertig,
    val pdf: Vorgang = Vorgang.Fertig,
    /** Finished PDF that the screen offers once to open. */
    val pdfFile: java.io.File? = null,
    /** The set just taken off the list, as long as „Undo“ is offered. */
    val removed: RemovedSet? = null,
)

/**
 * A removed set and the list as it stood before: „Undo“ restores exactly that list,
 * including the generated parts, as long as nothing else changed in between.
 */
data class RemovedSet(val set: PlSet, val before: List<PlSet>, val wasGenerated: Boolean)

/**
 * What parts and figures read from the session: server for the images, currency and
 * the preselected condition when entering. Not the whole session, so that a
 * change to sign-in or theme does not redraw the lists.
 */
internal data class PartsSessionUiState(
    val serverUrl: String = "",
    val currency: Waehrung = Waehrung.EUR,
    val userDefaultCondition: Zustand? = null,
)
