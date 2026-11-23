package ch.brickinventoryapp.finances.ui

import ch.brickinventoryapp.ui.TabTarget
import kotlinx.serialization.Serializable

/** The goals of finances; the collection also opens the PDF viewer (via the app). */
@Serializable
sealed interface FinanceTarget {
    @Serializable data object Finance : FinanceTarget, TabTarget {
        override val rollKey get() = "finance"
    }
    @Serializable data object Vouchers : FinanceTarget
    /** Only one key: address and title live in the PdfSelection, not in the saved back stack. */
    @Serializable data class PdfViewer(val key: String) : FinanceTarget
}
