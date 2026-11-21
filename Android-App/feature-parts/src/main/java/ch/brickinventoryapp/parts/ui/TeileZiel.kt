package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** The destinations of parts and minifigures. */
@Serializable
sealed interface TeileZiel {
    @Serializable data object Parts : TeileZiel, Reiterziel {
        override val rollSchluessel get() = "parts"
    }
    @Serializable data object Minifigs : TeileZiel, Reiterziel {
        override val rollSchluessel get() = "minifigs"
    }
    @Serializable data object PartsList : TeileZiel

    /** Detail of a manually entered part or figure. */
    @Serializable data class ManualItemDetail(
        val art: Postenart,
        val id: String,
        val colorId: Int = KEINE_FARBE,
        val title: String,
    ) : TeileZiel
}
