package ch.brickinventoryapp.konto.ui

import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** Die Einstellungen und ihre Unterseiten. */
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
