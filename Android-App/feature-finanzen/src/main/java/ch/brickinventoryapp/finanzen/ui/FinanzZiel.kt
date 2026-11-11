package ch.brickinventoryapp.finanzen.ui

import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** Die Ziele der Finanzen; den PDF-Betrachter öffnet auch die Sammlung (über die App). */
@Serializable
sealed interface FinanzZiel {
    @Serializable data object Finance : FinanzZiel, Reiterziel {
        override val rollSchluessel get() = "finance"
    }
    @Serializable data object Gutscheine : FinanzZiel
    /** Nur ein Schlüssel: Adresse und Titel liegen in der PdfAuswahl, nicht im gespeicherten Rückstapel. */
    @Serializable data class PdfViewer(val schluessel: String) : FinanzZiel
}
