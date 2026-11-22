package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.ui.ScannerOrigin
import ch.brickinventoryapp.ui.TabTarget
import kotlinx.serialization.Serializable

/**
 * The collection's destinations as type-safe routes: navigation encodes the values itself
 * and reads them back with `toRoute()`. Other areas only open them via
 * the callbacks of their navigation interface, which the app fulfills.
 */
@Serializable
sealed interface CollectionTarget {
    @Serializable data object Gallery : CollectionTarget, TabTarget {
        override val rollKey get() = "gallery"
    }
    @Serializable data object Wanted : CollectionTarget

    /** The same set can be on the watchlist new and used; only the condition makes it unambiguous. */
    @Serializable data class WantedItemDetail(val setNumber: String, val condition: Condition) : CollectionTarget
    @Serializable data class SetDetail(val setNumber: String) : CollectionTarget
    @Serializable data class BarcodeScanner(val origin: ScannerOrigin) : CollectionTarget
    @Serializable data object Comparison : CollectionTarget

    /** Purchases of a set, a part or a figure. */
    @Serializable data class AcquisitionManagement(
        val kind: ItemKind,
        val id: String,
        val colorId: Int = NO_COLOR,
        val title: String,
    ) : CollectionTarget
}
