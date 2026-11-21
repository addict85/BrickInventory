package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.ui.Reiterziel
import kotlinx.serialization.Serializable

/** The goals of finances; the collection also opens the PDF viewer (via the app). */
@Serializable
sealed interface FinanzZiel {
    @Serializable data object Finance : FinanzZiel, Reiterziel {
        override val rollSchluessel get() = "finance"
    }
    @Serializable data object Gutscheine : FinanzZiel
    /** Only one key: address and title live in the PdfSelection, not in the saved back stack. */
    @Serializable data class PdfViewer(val schluessel: String) : FinanzZiel
}
