package ch.brickinventoryapp.catalog.ui

import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** The catalog's destinations. */
@Serializable
sealed interface KatalogZiel {
    @Serializable data object Catalog : KatalogZiel, Reiterziel {
        override val rollSchluessel get() = "catalog"
    }
    @Serializable data class CatalogDetail(val setNumber: String) : KatalogZiel

    /**
     * List and detail as a sub-graph: both fetch their ViewModel at its entry,
     * so the list sees "I own this" from the detail. No destination.
     */
    @Serializable data object Bereich
}
