package ch.brickinventoryapp.account.ui

import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** Settings and its subpages. */
@Serializable
sealed interface KontoZiel {
    @Serializable data object Settings : KontoZiel, Reiterziel {
        override val rollSchluessel get() = "settings"
    }
    @Serializable data object Preisalarme : KontoZiel
    @Serializable data object Lagerorte : KontoZiel
    @Serializable data object Haushalt : KontoZiel
    @Serializable data object CsvImport : KontoZiel
    @Serializable data object Konto : KontoZiel
}
