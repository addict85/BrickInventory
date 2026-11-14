package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/**
 * Die Ziele der Sammlung als typsichere Routen: Navigation kodiert die Werte selbst
 * und liest sie mit `toRoute()` zurück. Andere Bereiche öffnen sie nur über die
 * Rückrufe ihrer Navigationsschnittstelle, die die App erfüllt.
 */
@Serializable
sealed interface SammlungZiel {
    @Serializable data object Gallery : SammlungZiel, Reiterziel {
        override val rollSchluessel get() = "gallery"
    }
    @Serializable data object Wanted : SammlungZiel

    /** Dasselbe Set kann neu und gebraucht auf der Merkliste stehen; erst der Zustand macht es eindeutig. */
    @Serializable data class MerkpostenDetail(val setNumber: String, val condition: Zustand) : SammlungZiel
    @Serializable data class SetDetail(val setNumber: String) : SammlungZiel
    @Serializable data class BarcodeScanner(val herkunft: Scannerherkunft) : SammlungZiel
    @Serializable data object Comparison : SammlungZiel

    /** Käufe eines Sets, Teils oder einer Figur. */
    @Serializable data class AcquisitionManagement(
        val art: Postenart,
        val id: String,
        val colorId: Int = KEINE_FARBE,
        val title: String,
    ) : SammlungZiel
}
