package ch.brickinventoryapp.catalog.ui

import ch.brickinventoryapp.ui.TabTarget
import kotlinx.serialization.Serializable

/** The catalog's destinations. */
@Serializable
sealed interface CatalogTarget {
    @Serializable data object Catalog : CatalogTarget, TabTarget {
        override val rollKey get() = "catalog"
    }
    @Serializable data class CatalogDetail(val setNumber: String) : CatalogTarget

    /**
     * List and detail as a sub-graph: both fetch their ViewModel at its entry,
     * so the list sees "I own this" from the detail. No destination.
     */
    @Serializable data object Area
}
