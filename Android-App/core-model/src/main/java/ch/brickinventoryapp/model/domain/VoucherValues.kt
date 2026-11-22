package ch.brickinventoryapp.model.domain

// What the voucher repository takes and delivers, in domain values instead of wire types.

/** A voucher as the form creates or changes it; [pin] null means none. */
data class VoucherInfo(val number: String, val pin: String?, val amount: Money, val currency: CurrencyCode)

/** What saving resulted in: saved (with numbers for a collective PDF) or read incompletely. */
sealed interface VoucherStorage {
    /** [newValue] and [changed] only for a PDF with several cards. */
    data class Saved(val newValue: Int? = null, val changed: Int? = null) : VoucherStorage

    /** The server did not read the PDF completely; what it found prefills the form. */
    data class Incomplete(
        val number: String? = null,
        val pin: String? = null,
        val amount: Money? = null,
        val currency: CurrencyCode? = null,
    ) : VoucherStorage
}

/**
 * The response to a balance query. Without [success] [reason] names the kind of refusal
 * („abstand“ with [waitSec], „botschutz“, „konto“) and [error] the server's sentence.
 */
data class BalanceInfo(
    val success: Boolean,
    val voucher: VoucherView? = null,
    val displayed: String? = null,
    val currencyChanged: Boolean = false,
    val reason: String? = null,
    val waitSec: Int? = null,
    val error: String? = null,
)
