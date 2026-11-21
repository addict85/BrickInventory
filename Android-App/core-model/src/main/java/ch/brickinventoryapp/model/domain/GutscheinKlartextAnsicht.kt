package ch.brickinventoryapp.model.domain

/** Number and PIN in plaintext for display; the screen does not know the server model. */
data class PlaintextView(val id: Int, val number: String, val pin: String?)

/** The server's mask for the PIN, for display. */
const val PIN_MASK_DISPLAY = VOUCHER_PIN_MASK

fun isMaskedNumber(nummer: String): Boolean = isVoucherMask(nummer)
