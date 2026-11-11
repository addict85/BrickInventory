package ch.brickinventoryapp.katalog.ui

import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** Die Ziele des Katalogs. */
@Serializable
sealed interface KatalogZiel {
    @Serializable data object Catalog : KatalogZiel, Reiterziel {
        override val rollSchluessel get() = "catalog"
    }
    @Serializable data class CatalogDetail(val setNumber: String) : KatalogZiel

    /**
     * Liste und Detail als Teilgraph: Beide holen ihr ViewModel an dessen Eintrag,
     * so sieht die Liste das „besitze ich“ aus dem Detail. Kein Ziel.
     */
    @Serializable data object Bereich
}
