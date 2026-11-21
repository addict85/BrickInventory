package ch.brickinventoryapp.collection.ui

import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/**
 * The collection's destinations as type-safe routes: navigation encodes the values itself
 * and reads them back with `toRoute()`. Other areas only open them via
 * the callbacks of their navigation interface, which the app fulfills.
 */
@Serializable
sealed interface SammlungZiel {
    @Serializable data object Gallery : SammlungZiel, Reiterziel {
        override val rollSchluessel get() = "gallery"
    }
    @Serializable data object Wanted : SammlungZiel

    /** The same set can be on the watchlist new and used; only the condition makes it unambiguous. */
    @Serializable data class MerkpostenDetail(val setNumber: String, val condition: Zustand) : SammlungZiel
    @Serializable data class SetDetail(val setNumber: String) : SammlungZiel
    @Serializable data class BarcodeScanner(val herkunft: Scannerherkunft) : SammlungZiel
    @Serializable data object Comparison : SammlungZiel

    /** Purchases of a set, a part or a figure. */
    @Serializable data class AcquisitionManagement(
        val art: Postenart,
        val id: String,
        val colorId: Int = KEINE_FARBE,
        val title: String,
    ) : SammlungZiel
}
