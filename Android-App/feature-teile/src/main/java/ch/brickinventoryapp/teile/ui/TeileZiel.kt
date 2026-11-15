package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** Die Ziele von Teilen und Minifiguren. */
@Serializable
sealed interface TeileZiel {
    @Serializable data object Parts : TeileZiel, Reiterziel {
        override val rollSchluessel get() = "parts"
    }
    @Serializable data object Minifigs : TeileZiel, Reiterziel {
        override val rollSchluessel get() = "minifigs"
    }
    @Serializable data object PartsList : TeileZiel

    /** Detail eines manuell erfassten Teils oder einer Figur. */
    @Serializable data class ManualItemDetail(
        val art: Postenart,
        val id: String,
        val colorId: Int = KEINE_FARBE,
        val title: String,
    ) : TeileZiel
}
