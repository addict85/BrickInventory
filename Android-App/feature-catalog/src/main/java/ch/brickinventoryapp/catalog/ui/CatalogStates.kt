package ch.brickinventoryapp.catalog.ui

import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.CatalogThemeView
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.uistate.Load

/**
 * Catalog state — its own flow (like SetDetail/CsvImport): search and
 * paging update frequently; as part of AppUiState, every
 * catalog page would recompose the whole app.
 */
data class CatalogUiState(
    /** The last fetch of the first page; loaded pages stay visible while refetching. */
    val fetch: Load<Unit> = Load.Data(Unit),
    /**
     * Loaded pages, by page number. A map instead of a list, because the
     * timeline on the right scrolls fast instead of filtering: whoever jumps to 2005
     * lands in the middle of the inventory. The view therefore keeps all `total` slots
     * and loads the page that's becoming visible — forward and backward; what's still
     * missing stands in as a placeholder.
     */
    val loadedPages: Map<Int, List<CatalogSetView>> = emptyMap(),
    val loadingPages: Set<Int> = emptySet(),
    val total: Int = 0,
    /**
     * The scrubber's jump target — the running number to scroll to. The
     * view carries out the jump and reports it back with
     * catalogScrollConsumed(); without that reset, the same year
     * couldn't be jumped to a second time.
     */
    val scrollTo: Int? = null,
    // Filter
    val query: String = "",
    val themeId: Int? = null,
    val year: Int? = null,
    val sort: CatalogSort = CatalogSort.DEFAULT,
    // Meta
    val themes: List<CatalogThemeView> = emptyList(),
    val yearMin: Int? = null,
    val yearMax: Int? = null,
    /**
     * How many sets per year, with the current filters and in the list's
     * order — the numbers the bar on the right computes its label from (see
     * CatalogYearMath), as in the web app. Years without a year are already dropped,
     * same as there.
     */
    val yearDistribution: List<YearCountView> = emptyList(),
    // Detail
    /** An error stands here instead of the spinner, with a reason and "Try again". */
    val detail: Load<CatalogDetailView> = Load.Loads,
)
